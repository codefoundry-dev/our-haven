/**
 * Provider (clinical) Schedule — the licensed-clinician landing tab (ADR-0011).
 *
 * A day rail + the selected day's live CONSULTATION bookings (GET /v1/bookings via
 * `useBookings`), each as a time card with the family, the slot window, and the
 * lifecycle StatusPill. A consultation happening now shows a Join action into the
 * consult surface. A "Set availability" link jumps to the slot editor.
 *
 * Pre-activation: until the practice is `listed` (active Provider Subscription),
 * the schedule shows a "Go live" checklist (verify → subscribe → publish slots)
 * instead of pretending there's a schedule — a Provider can't take bookings yet.
 *
 * Design reference: Claude design project — screens/provider-schedule.jsx, adapted
 * to the consultation-centric Provider (no Jobs feed, no session timer, no payout).
 */
import { useMemo, useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusPill } from '@/components/ui/StatusPill';
import { RatingValue } from '@/components/ui/StarRating';
import { RatingSheet } from '@/components/RatingSheet';
import { useBookings } from '@/lib/useBookings';
import { useProviderSubscription } from '@/lib/useProviderSubscription';
import { minutesToClock, slotTimeRange } from '@/lib/consultation';
import type { BookingSummary } from '@/api/client';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface DayOption {
  iso: string;
  dow: string;
  dayNum: number;
  label: string;
}

function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildWeek(count: number): DayOption[] {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const out: DayOption[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push({
      iso: localISO(d),
      dow: DOW[d.getDay()] ?? '',
      dayNum: d.getDate(),
      label: `${WEEKDAYS_LONG[d.getDay()] ?? ''}, ${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}`,
    });
  }
  return out;
}

export function ProviderSchedule() {
  const router = useRouter();
  const { data: bookings, loading, error, refetch } = useBookings();
  const sub = useProviderSubscription();

  const days = useMemo(() => buildWeek(7), []);
  const [selectedIso, setSelectedIso] = useState(() => days[0]?.iso ?? '');
  const [ratingFor, setRatingFor] = useState<BookingSummary | null>(null);
  const selected = days.find((d) => d.iso === selectedIso) ?? days[0];

  const now = useMemo(() => new Date(), []);
  const todayIso = localISO(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const daysWithBookings = useMemo(() => {
    const set = new Set<string>();
    for (const b of bookings) if (b.state === 'accepted') set.add(b.scheduledDate);
    return set;
  }, [bookings]);

  const dayBookings = useMemo(
    () =>
      bookings
        .filter((b) => b.scheduledDate === selectedIso)
        .sort((a, b) => a.startMin - b.startMin),
    [bookings, selectedIso],
  );

  const isLive = (b: BookingSummary) =>
    b.scheduledDate === todayIso && b.state === 'accepted' && nowMin >= b.startMin && nowMin < b.endMin;

  const preActivation = !sub.loading && !sub.listed;

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar large title="Schedule" actions={[{ icon: 'bell', badge: true, label: 'Notifications' }]} />

      {/* Pre-activation — a Provider can't take bookings until they're listed. */}
      {preActivation ? (
        <GoLiveCard router={router} />
      ) : null}

      {/* Day selector — horizontal week rail */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.rail}
        contentContainerStyle={styles.railContent}
      >
        {days.map((d) => {
          const active = d.iso === selectedIso;
          const has = daysWithBookings.has(d.iso);
          return (
            <Pressable
              key={d.iso}
              onPress={() => setSelectedIso(d.iso)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.dayPill, active ? styles.dayPillActive : null]}
            >
              <Text style={[styles.dayDow, active && { color: colors.inkInv }]}>{d.dow}</Text>
              <Text style={[styles.dayNum, active && { color: colors.inkInv }]}>{d.dayNum}</Text>
              <View style={[styles.dayDot, { backgroundColor: has ? (active ? colors.highlight : colors.brand) : 'transparent' }]} />
            </Pressable>
          );
        })}
      </ScrollView>

      <SectionHeader
        title={selected?.label ?? 'Schedule'}
        action="Set availability"
        onAction={() => router.push('/availability')}
        size="md"
        style={styles.section}
      />

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
      ) : dayBookings.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Icon name="calendar" size={22} color={colors.brand} />
          </View>
          <Text style={styles.emptyTitle}>No consultations</Text>
          <Text style={styles.emptySub}>
            {preActivation
              ? 'Go live above, then publish open slots for families to book.'
              : 'When a family books one of your open slots, it appears here.'}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {dayBookings.map((b) => (
            <SessionCard
              key={b.id}
              booking={b}
              live={isLive(b)}
              onJoin={() => router.push('/consult')}
              onRate={() => setRatingFor(b)}
            />
          ))}
        </View>
      )}

      <RatingSheet
        visible={ratingFor != null}
        bookingId={ratingFor?.id ?? null}
        subjectName={ratingFor?.counterpartyName ?? null}
        target="parent"
        onClose={() => setRatingFor(null)}
        onRated={() => {
          setRatingFor(null);
          refetch();
        }}
      />
    </Screen>
  );
}

function GoLiveCard({ router }: { router: ReturnType<typeof useRouter> }) {
  const steps: { icon: IconName; title: string; sub: string; href: string }[] = [
    { icon: 'shield', title: 'Verify your practice', sub: 'License, insurance & ID review.', href: '/verification' },
    { icon: 'dollar', title: 'Start your subscription', sub: 'List in Search and take bookings.', href: '/subscription' },
    { icon: 'calendar', title: 'Publish availability', sub: 'Open the slots families can book.', href: '/availability' },
  ];
  return (
    <View style={styles.goLive}>
      <Text style={styles.goLiveTitle}>Go live</Text>
      <Text style={styles.goLiveSub}>Finish these to start taking consultation bookings.</Text>
      <View style={styles.goLiveSteps}>
        {steps.map((s) => (
          <Pressable
            key={s.href}
            onPress={() => router.push(s.href as Href)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.goLiveRow, { opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={styles.goLiveIcon}>
              <Icon name={s.icon} size={16} color={colors.brand} />
            </View>
            <View style={styles.goLiveText}>
              <Text style={styles.goLiveRowTitle}>{s.title}</Text>
              <Text style={styles.goLiveRowSub}>{s.sub}</Text>
            </View>
            <Icon name="chevron-right" size={18} color={colors.ink3} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function SessionCard({
  booking,
  live,
  onJoin,
  onRate,
}: {
  booking: BookingSummary;
  live: boolean;
  onJoin: () => void;
  onRate: () => void;
}) {
  const label = minutesToClock(booking.startMin);
  const [time, mer] = label.split(' ');
  const name = booking.counterpartyName ?? 'Family';
  const { rating, counterpartyRating } = booking;

  return (
    <Card padding={14} radius={radii.lg} style={styles.card}>
      <View style={styles.timeBlock}>
        <Text style={styles.timeNum}>{time}</Text>
        <Text style={styles.timeMeridiem}>{mer}</Text>
      </View>

      <View style={styles.cardBody}>
        {live ? (
          <View style={styles.liveRow}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live now</Text>
          </View>
        ) : null}
        <View style={styles.titleRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {name}
          </Text>
          {/* The family's standing (aggregate, no text — the asymmetric parent projection). */}
          {counterpartyRating && counterpartyRating.count > 0 && counterpartyRating.averageStars != null ? (
            <RatingValue value={counterpartyRating.averageStars} count={counterpartyRating.count} size={13} />
          ) : null}
        </View>
        <Text style={styles.cardSub} numberOfLines={1}>
          Consultation · {slotTimeRange(booking)}
        </Text>
        <View style={styles.pillRow}>
          <StatusPill state={booking.state} />
        </View>
        {rating.mine ? (
          <View style={styles.ratedRow}>
            <Text style={styles.ratedText}>You rated</Text>
            <RatingValue value={rating.mine.stars} size={13} />
          </View>
        ) : null}
      </View>

      {live ? (
        <Pressable
          onPress={onJoin}
          accessibilityRole="button"
          style={({ pressed }) => [styles.joinBtn, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={styles.joinText}>Join</Text>
        </Pressable>
      ) : rating.canRate ? (
        <Pressable
          onPress={onRate}
          accessibilityRole="button"
          style={({ pressed }) => [styles.joinBtn, styles.rateBtn, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Icon name="star" size={14} color={colors.inkInv} />
          <Text style={styles.joinText}>Rate</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },

  goLive: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 18, marginTop: 16, ...shadow.e1 },
  goLiveTitle: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.4, color: colors.ink },
  goLiveSub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2, marginTop: 4 },
  goLiveSteps: { marginTop: 14, gap: 10 },
  goLiveRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  goLiveIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goLiveText: { flex: 1, minWidth: 0 },
  goLiveRowTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  goLiveRowSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 1 },

  rail: { marginHorizontal: -24, marginTop: 14 },
  railContent: { paddingHorizontal: 24, gap: 8 },
  dayPill: {
    width: 52,
    height: 68,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    ...shadow.e1,
  },
  dayPillActive: { backgroundColor: colors.ink },
  dayDow: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.4, color: colors.ink3 },
  dayNum: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, fontVariant: ['tabular-nums'] },
  dayDot: { width: 6, height: 6, borderRadius: radii.pill },

  section: { marginTop: 22, marginBottom: 12 },
  list: { gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeBlock: {
    width: 56,
    paddingVertical: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
  },
  timeNum: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
  timeMeridiem: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.5, color: colors.ink2, marginTop: 1 },
  cardBody: { flex: 1, minWidth: 0 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  liveDot: { width: 7, height: 7, borderRadius: radii.pill, backgroundColor: colors.info },
  liveText: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.info },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  cardSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },
  pillRow: { flexDirection: 'row', marginTop: 8 },
  ratedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  ratedText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },
  joinBtn: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rateBtn: { flexDirection: 'row', gap: 6 },
  joinText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },

  state: { alignItems: 'center', gap: 12, paddingVertical: 48 },
  stateText: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, textAlign: 'center' },
  retry: { height: 40, paddingHorizontal: 18, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },

  empty: { alignItems: 'center', gap: 8, paddingTop: 40, paddingHorizontal: 24 },
  emptyIcon: { width: 56, height: 56, borderRadius: radii.lg, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.3, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, textAlign: 'center', maxWidth: 280, lineHeight: 19 },
});
