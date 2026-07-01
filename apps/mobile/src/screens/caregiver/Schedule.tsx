/**
 * Caregiver Schedule (OH-220) — the Caregiver's hourly-booking landing surface
 * (PRD-0001 v1.7 stories 52–54, 82, 130; ADR-0014 amended). Wires the design's
 * §5.11.3 Today screen to the live `GET /v1/caregiver/bookings` feed:
 *
 *  - a sticky **active-session banner** (live elapsed timer + one-tap "End session
 *    & propose hours") whenever a Booking is `in-progress`;
 *  - a **Needs your attention** block — awarded Bookings to confirm within 24h
 *    (accept / decline) and a Parent's shorten request to approve / decline;
 *  - **Today / Upcoming** lists of confirmed sessions, each a time card with the
 *    family + the lifecycle StatusPill (and a Start control when it's time);
 *  - a link into the weekly **Availability** editor.
 *
 * Pre-activation (story 83): until verification clears, the Caregiver can't take
 * Bookings, so the schedule shows the shared PreActivation empty state instead.
 *
 * Design reference: Claude design — screens/provider-schedule.jsx (bound
 * role="caregiver"), adapted to the live lifecycle.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { CategoryChip, type Category } from '@/components/ui/CategoryChip';
import { StatusPill } from '@/components/ui/StatusPill';
import { TabStrip } from '@/components/ui/TabStrip';
import { CaregiverPreActivation } from '@/screens/caregiver/PreActivation';
import { ProposeHoursSheet } from '@/components/caregiver/ProposeHoursSheet';
import { useCaregiverBookings } from '@/lib/useCaregiverBookings';
import { useSupplyActivation } from '@/lib/SupplyActivationProvider';
import { minutesToClock } from '@/lib/consultation';
import { formatMoney } from '@/lib/offerCopy';
import {
  ApiError,
  acceptCaregiverBooking,
  approveCaregiverTimeChange,
  declineCaregiverBooking,
  declineCaregiverTimeChange,
  startCaregiverSession,
  type CaregiverBooking,
} from '@/api/client';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const TABS = ['Today', 'Upcoming'] as const;
type Tab = (typeof TABS)[number];

function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A ticking `now`, re-rendering every `ms` — drives the live session timer. */
function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function fmtElapsed(fromMs: number, nowMs: number): string {
  const total = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function categoryLabel(c: CaregiverBooking['category']): Category {
  if (c === 'tutor') return 'Tutor';
  if (c === 'nanny') return 'Nanny';
  return 'Babysitter';
}

function hoursOf(b: CaregiverBooking): number {
  return Math.round(((b.endMin - b.startMin) / 60) * 10) / 10;
}

function childLabel(b: CaregiverBooking): string {
  if (b.childCount == null) return '';
  return ` · ${b.childCount} ${b.childCount === 1 ? 'child' : 'children'}`;
}

function subLine(b: CaregiverBooking): string {
  const money = b.computedTotalCents != null ? ` · ${formatMoney(b.computedTotalCents)}` : '';
  return `${hoursOf(b)}h${money}${childLabel(b)}`;
}

export function CaregiverSchedule() {
  const router = useRouter();
  const { data: bookings, loading, error, refetch } = useCaregiverBookings();
  const { loading: actLoading, activated, verification, blockingStep } = useSupplyActivation();
  const now = useNow(1000);
  const [tab, setTab] = useState<Tab>('Today');
  const [proposeFor, setProposeFor] = useState<CaregiverBooking | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const todayIso = localISO(now);

  const active = useMemo(() => bookings.find((b) => b.state === 'in-progress') ?? null, [bookings]);

  const awarded = useMemo(
    () => bookings.filter((b) => b.state === 'requested').sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)),
    [bookings],
  );
  const shortenRequests = useMemo(
    () => bookings.filter((b) => b.state === 'accepted' && b.pendingTimeChange != null),
    [bookings],
  );

  const today = useMemo(
    () =>
      bookings
        .filter(
          (b) =>
            b.scheduledDate === todayIso &&
            (b.state === 'accepted' || b.state === 'in-progress' || b.state === 'awaiting-confirmation'),
        )
        .sort((a, b) => a.startMin - b.startMin),
    [bookings, todayIso],
  );
  const upcoming = useMemo(
    () =>
      bookings
        .filter(
          (b) =>
            b.scheduledDate > todayIso && (b.state === 'accepted' || b.state === 'awaiting-confirmation'),
        )
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.startMin - b.startMin),
    [bookings, todayIso],
  );

  // Gate on activation AFTER hooks so the hook order is stable.
  if (actLoading) {
    return (
      <Screen scroll edges={['top']} contentStyle={styles.content}>
        <AppBar large title="Schedule" />
        <View style={styles.state}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </Screen>
    );
  }
  if (!activated) {
    return <CaregiverPreActivation verification={verification} blockingStep={blockingStep} />;
  }

  const runAction = async (id: string, fn: () => Promise<unknown>, failMsg: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await fn();
      refetch();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof ApiError ? e.message : failMsg);
    } finally {
      setBusyId(null);
    }
  };

  const list = tab === 'Today' ? today : upcoming;

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      <AppBar large title="Schedule" actions={[{ icon: 'bell', badge: awarded.length > 0, label: 'Notifications' }]} />

      {/* Sticky active-session banner */}
      {active ? (
        <ActiveSessionBanner booking={active} nowMs={now.getTime()} onEnd={() => setProposeFor(active)} />
      ) : null}

      {/* Needs your attention — awarded confirms + shorten requests */}
      {awarded.length > 0 || shortenRequests.length > 0 ? (
        <View style={styles.attention}>
          <Text style={styles.attentionTitle}>Needs your attention</Text>
          {awarded.map((b) => (
            <AwardedCard
              key={b.id}
              booking={b}
              busy={busyId === b.id}
              onAccept={() => runAction(b.id, () => acceptCaregiverBooking(b.id), 'Could not accept the booking.')}
              onDecline={() =>
                confirmThen('Decline this booking?', 'The family will be notified and their hold released.', () =>
                  runAction(b.id, () => declineCaregiverBooking(b.id), 'Could not decline the booking.'),
                )
              }
            />
          ))}
          {shortenRequests.map((b) => (
            <ShortenCard
              key={b.id}
              booking={b}
              busy={busyId === b.id}
              onApprove={() =>
                runAction(b.id, () => approveCaregiverTimeChange(b.id), 'Could not approve the change.')
              }
              onDecline={() =>
                runAction(b.id, () => declineCaregiverTimeChange(b.id), 'Could not decline the change.')
              }
            />
          ))}
        </View>
      ) : null}

      <TabStrip tabs={TABS} value={tab} onChange={setTab} style={styles.tabStrip} />

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : error ? (
        <View style={styles.state}>
          <Text style={styles.stateText}>{error}</Text>
          <Pressable onPress={refetch} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : list.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Icon name="calendar" size={22} color={colors.brand} />
          </View>
          <Text style={styles.emptyTitle}>{tab === 'Today' ? 'Nothing today' : 'Nothing upcoming'}</Text>
          <Text style={styles.emptySub}>
            {tab === 'Today'
              ? 'Your accepted sessions for today will appear here.'
              : 'Sessions you accept will show up here until the day arrives.'}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {list.map((b) => (
            <SessionCard
              key={b.id}
              booking={b}
              showDate={tab === 'Upcoming'}
              busy={busyId === b.id}
              onStart={
                b.state === 'accepted'
                  ? () => runAction(b.id, () => startCaregiverSession(b.id), 'Could not start the session.')
                  : undefined
              }
            />
          ))}
        </View>
      )}

      {/* Availability entry */}
      <Pressable onPress={() => router.push('/availability')} style={styles.availCard}>
        <View style={styles.availIcon}>
          <Icon name="clock" size={18} color={colors.brand} />
        </View>
        <View style={styles.flexMin}>
          <Text style={styles.availTitle}>Availability &amp; pauses</Text>
          <Text style={styles.availSub}>Set your weekly grid, a note, and pause new bookings.</Text>
        </View>
        <Icon name="chevron-right" size={20} color={colors.ink3} />
      </Pressable>

      <ProposeHoursSheet
        booking={proposeFor}
        onClose={() => setProposeFor(null)}
        onProposed={() => {
          setProposeFor(null);
          refetch();
        }}
      />
    </Screen>
  );
}

function confirmThen(title: string, message: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Confirm', style: 'destructive', onPress: onConfirm },
  ]);
}

function ActiveSessionBanner({
  booking,
  nowMs,
  onEnd,
}: {
  booking: CaregiverBooking;
  nowMs: number;
  onEnd: () => void;
}) {
  // No precise session-start timestamp in v1 — the elapsed clock counts from the
  // booked start instant (today + startMin). Precise start capture is a follow-up.
  const startInstant = useMemo(() => {
    const [y, m, d] = booking.scheduledDate.split('-').map(Number);
    const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
    dt.setMinutes(booking.startMin);
    return dt.getTime();
  }, [booking.scheduledDate, booking.startMin]);

  return (
    <View style={styles.banner}>
      <View style={styles.bannerTop}>
        <View style={styles.liveRow}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>In session</Text>
        </View>
        <Text style={styles.timer}>{fmtElapsed(startInstant, nowMs)}</Text>
      </View>
      <Text style={styles.bannerTitle} numberOfLines={1}>
        {booking.parentName ?? 'Family'} · {categoryLabel(booking.category)}
      </Text>
      <Text style={styles.bannerSub}>
        {minutesToClock(booking.startMin)}–{minutesToClock(booking.endMin)} · {hoursOf(booking)}h planned
      </Text>
      <Pressable onPress={onEnd} accessibilityRole="button" style={styles.endBtn}>
        <Text style={styles.endText}>End session &amp; propose hours</Text>
        <Icon name="arrow-right" size={15} color={colors.inkInv} />
      </Pressable>
    </View>
  );
}

function AwardedCard({
  booking,
  busy,
  onAccept,
  onDecline,
}: {
  booking: CaregiverBooking;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const deadline = booking.requestExpiresAt ? respondIn(booking.requestExpiresAt) : null;
  return (
    <View style={styles.actionCard}>
      <View style={styles.actionHead}>
        <CategoryChip category={categoryLabel(booking.category)} />
        {deadline ? <Text style={styles.deadline}>{deadline}</Text> : null}
      </View>
      <Text style={styles.actionTitle}>New booking · {booking.parentName ?? 'Family'}</Text>
      <Text style={styles.actionSub}>
        {dateLabel(booking.scheduledDate)} · {minutesToClock(booking.startMin)} · {subLine(booking)}
      </Text>
      <View style={styles.actionRow}>
        <Pressable onPress={onDecline} disabled={busy} style={[styles.ghostBtn, busy && styles.btnDisabled]}>
          <Text style={styles.ghostText}>Decline</Text>
        </Pressable>
        <Pressable onPress={onAccept} disabled={busy} style={[styles.primaryBtn, busy && styles.btnDisabled]}>
          {busy ? <ActivityIndicator color={colors.inkInv} /> : <Text style={styles.primaryText}>Accept</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function ShortenCard({
  booking,
  busy,
  onApprove,
  onDecline,
}: {
  booking: CaregiverBooking;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const pending = booking.pendingTimeChange;
  return (
    <View style={[styles.actionCard, styles.actionCardWarn]}>
      <View style={styles.actionHead}>
        <View style={styles.warnTag}>
          <Text style={styles.warnTagText}>Shorten request</Text>
        </View>
      </View>
      <Text style={styles.actionTitle}>{booking.parentName ?? 'Family'} asked to shorten</Text>
      <Text style={styles.actionSub}>
        {hoursOf(booking)}h → {pending ? Math.round(pending.proposedDurationHours * 10) / 10 : '?'}h
        {pending?.note ? ` · “${pending.note}”` : ''}
      </Text>
      <View style={styles.actionRow}>
        <Pressable onPress={onDecline} disabled={busy} style={[styles.ghostBtn, busy && styles.btnDisabled]}>
          <Text style={styles.ghostText}>Decline</Text>
        </Pressable>
        <Pressable onPress={onApprove} disabled={busy} style={[styles.primaryBtn, busy && styles.btnDisabled]}>
          {busy ? <ActivityIndicator color={colors.inkInv} /> : <Text style={styles.primaryText}>Approve</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function SessionCard({
  booking,
  showDate,
  busy,
  onStart,
}: {
  booking: CaregiverBooking;
  showDate: boolean;
  busy: boolean;
  onStart?: () => void;
}) {
  const label = minutesToClock(booking.startMin);
  const [time, mer] = label.split(' ');
  return (
    <View style={styles.card}>
      <View style={styles.timeBlock}>
        <Text style={styles.timeNum}>{time}</Text>
        <Text style={styles.timeMeridiem}>{mer}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {booking.parentName ?? 'Family'} · {categoryLabel(booking.category)}
        </Text>
        <Text style={styles.cardSub} numberOfLines={1}>
          {showDate ? `${dateLabel(booking.scheduledDate)} · ` : ''}
          {subLine(booking)}
        </Text>
        <View style={styles.pillRow}>
          <StatusPill state={booking.state} />
        </View>
      </View>
      {onStart ? (
        <Pressable onPress={onStart} disabled={busy} style={[styles.startBtn, busy && styles.btnDisabled]}>
          {busy ? <ActivityIndicator color={colors.inkInv} /> : <Text style={styles.startText}>Start</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return `${WEEKDAYS_LONG[dt.getDay()]?.slice(0, 3)}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}`;
}

function respondIn(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return `Respond in ${h}h`;
  const m = Math.max(1, Math.floor(ms / 60_000));
  return `Respond in ${m}m`;
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },

  banner: {
    backgroundColor: 'rgba(58,111,168,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(58,111,168,0.22)',
    borderRadius: radii.xl,
    padding: 16,
    marginTop: 14,
  },
  bannerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.info },
  liveText: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.info },
  timer: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
  bannerTitle: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.2, color: colors.ink, marginTop: 10 },
  bannerSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 3 },
  endBtn: {
    marginTop: 14,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  endText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkInv },

  attention: { marginTop: 18, gap: 10 },
  attentionTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  actionCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 14, ...shadow.e1 },
  actionCardWarn: { borderWidth: 1, borderColor: 'rgba(201,122,42,0.4)' },
  actionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  deadline: { fontFamily: fonts.semibold, fontSize: 11.5, color: colors.warning },
  warnTag: { paddingHorizontal: 9, height: 20, borderRadius: radii.pill, backgroundColor: 'rgba(201,122,42,0.14)', justifyContent: 'center' },
  warnTagText: { fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 0.3, textTransform: 'uppercase', color: colors.warning },
  actionTitle: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink },
  actionSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 3 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  ghostBtn: {
    flex: 1,
    height: 42,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink2 },
  primaryBtn: {
    flex: 1,
    height: 42,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.inkInv },
  btnDisabled: { opacity: 0.5 },

  tabStrip: { marginTop: 18 },

  list: { marginTop: 14, gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 14, ...shadow.e1 },
  timeBlock: { width: 56, paddingVertical: 8, borderRadius: radii.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
  timeNum: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
  timeMeridiem: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.5, color: colors.ink2, marginTop: 1 },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  cardSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },
  pillRow: { flexDirection: 'row', marginTop: 8 },
  startBtn: { height: 36, paddingHorizontal: 16, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  startText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },

  state: { alignItems: 'center', gap: 12, paddingVertical: 48 },
  stateText: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, textAlign: 'center' },
  retry: { height: 40, paddingHorizontal: 18, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },

  empty: { alignItems: 'center', gap: 8, paddingTop: 40, paddingHorizontal: 24 },
  emptyIcon: { width: 56, height: 56, borderRadius: radii.lg, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.3, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, textAlign: 'center', maxWidth: 280, lineHeight: 19 },

  availCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, marginTop: 22, ...shadow.e1 },
  availIcon: { width: 38, height: 38, borderRadius: radii.pill, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  flexMin: { flex: 1, minWidth: 0 },
  availTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  availSub: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 2 },
});
