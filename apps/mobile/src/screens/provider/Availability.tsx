/**
 * Consultation availability editor (OH-222) — where the Provider publishes the
 * open slots Parents can book (ADR-0011: Providers are consultation-centric, no
 * Jobs). Pick a date + session length, then tap a time to publish a bookable slot
 * (POST /v1/providers/me/consultation-slots) or tap an open slot to withdraw it
 * (DELETE …/{slotId}). A booked (held) slot is locked — its Parent must cancel
 * first. Publishing requires an active Provider Subscription (`listed`); when the
 * practice isn't listed the editor shows a gate that links to Subscription (the
 * POST is 402-gated server-side regardless).
 *
 * Design reference: Claude design project — screens/provider-availability-tab.jsx,
 * reframed as the editable, backend-wired slot picker (OH-189 slots API).
 *
 * This is the native (and narrow-web) body; the desktop layout lives in
 * `@/screens/web/cp/Availability` and is chosen by `availability.web.tsx`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import {
  ApiError,
  getProviderSubscription,
  listConsultationSlots,
  publishConsultationSlot,
  withdrawConsultationSlot,
  type ConsultationSlot,
} from '@/api/client';
import { minutesToClock } from '@/lib/consultation';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DURATIONS = [30, 45, 60] as const;

/** Candidate slot starts — 8:00 AM … 6:00 PM at 30-min steps (each fits a 60-min session by 7 PM). */
const CANDIDATE_STARTS: readonly number[] = (() => {
  const out: number[] = [];
  for (let m = 8 * 60; m <= 18 * 60; m += 30) out.push(m);
  return out;
})();

interface DayOption {
  iso: string; // YYYY-MM-DD (the Provider's local calendar day)
  dow: string;
  dayNum: number;
}

function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDays(count: number): DayOption[] {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const out: DayOption[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push({ iso: localISO(d), dow: DOW[d.getDay()] ?? '', dayNum: d.getDate() });
  }
  return out;
}

const overlaps = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;

export default function AvailabilityScreen() {
  const router = useRouter();
  const days = useMemo(() => buildDays(14), []);

  const [dateIso, setDateIso] = useState(() => days[0]?.iso ?? '');
  const [duration, setDuration] = useState<number>(45);
  const [slots, setSlots] = useState<ConsultationSlot[]>([]);
  const [listed, setListed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyStart, setBusyStart] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [sub, list] = await Promise.all([getProviderSubscription(), listConsultationSlots()]);
      setListed(sub.listed);
      setSlots(list.slots);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your availability.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refetchSlots = useCallback(async () => {
    try {
      const list = await listConsultationSlots();
      setSlots(list.slots);
    } catch {
      // keep the last-known slots; the mutation error (if any) is already surfaced
    }
  }, []);

  // Live view of the selected day.
  const daySlots = useMemo(() => slots.filter((s) => s.date === dateIso), [slots, dateIso]);
  const openByStart = useMemo(() => {
    const m = new Map<number, ConsultationSlot>();
    for (const s of daySlots) if (s.state === 'open') m.set(s.startMin, s);
    return m;
  }, [daySlots]);
  const heldStarts = useMemo(
    () => new Set(daySlots.filter((s) => s.state === 'held').map((s) => s.startMin)),
    [daySlots],
  );
  const openCount = openByStart.size;
  const dayHasOpen = useMemo(() => {
    const set = new Set<string>();
    for (const s of slots) if (s.state === 'open') set.add(s.date);
    return set;
  }, [slots]);

  const humanizeMutation = (e: unknown): string => {
    if (e instanceof ApiError) {
      if (e.status === 402) return 'Start your subscription to publish consultation slots.';
      if (e.status === 409) return 'That overlaps a slot you already published. Pick another time.';
      return e.message;
    }
    return 'Could not save that slot. Please try again.';
  };

  const publish = useCallback(
    async (start: number) => {
      setActionError(null);
      setBusyStart(start);
      try {
        await publishConsultationSlot({ date: dateIso, startMin: start, endMin: start + duration });
        await refetchSlots();
      } catch (e) {
        setActionError(humanizeMutation(e));
      } finally {
        setBusyStart(null);
      }
    },
    [dateIso, duration, refetchSlots],
  );

  const withdraw = useCallback(
    async (slot: ConsultationSlot) => {
      setActionError(null);
      setBusyStart(slot.startMin);
      try {
        await withdrawConsultationSlot(slot.id);
        await refetchSlots();
      } catch (e) {
        setActionError(humanizeMutation(e));
      } finally {
        setBusyStart(null);
      }
    },
    [refetchSlots],
  );

  const onCell = (start: number) => {
    if (heldStarts.has(start)) return; // booked — locked
    const open = openByStart.get(start);
    if (open) {
      void withdraw(open);
      return;
    }
    if (!listed) {
      setActionError('Start your subscription to publish consultation slots.');
      return;
    }
    void publish(start);
  };

  return (
    <Screen edges={['top']} contentStyle={styles.content}>
      <AppBar onBack={() => router.back()} title="Availability" />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void load()} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.headline}>When can parents book consultations?</Text>
            <Text style={styles.sub}>
              Pick a date and session length, then tap the times you&apos;re open for. Parents book an open slot directly —
              clinical discussion and payment happen off-platform.
            </Text>

            {/* Subscription gate */}
            {!listed ? (
              <Pressable
                onPress={() => router.push('/subscription' as Href)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.gate, { opacity: pressed ? 0.9 : 1 }]}
              >
                <View style={styles.gateIcon}>
                  <Icon name="lock" size={16} color={colors.warning} />
                </View>
                <View style={styles.gateText}>
                  <Text style={styles.gateTitle}>Not listed yet</Text>
                  <Text style={styles.gateSub}>Start your subscription to publish bookable slots.</Text>
                </View>
                <Icon name="chevron-right" size={20} color={colors.ink3} />
              </Pressable>
            ) : null}

            {/* Date pills */}
            <Text style={styles.fieldLabel}>Date</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.rail}
              contentContainerStyle={styles.railContent}
            >
              {days.map((d) => {
                const active = d.iso === dateIso;
                const has = dayHasOpen.has(d.iso);
                return (
                  <Pressable
                    key={d.iso}
                    onPress={() => setDateIso(d.iso)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.datePill, active ? styles.datePillActive : null]}
                  >
                    <Text style={[styles.dateDow, active && { color: colors.inkInv }]}>{d.dow}</Text>
                    <Text style={[styles.dateNum, active && { color: colors.inkInv }]}>{d.dayNum}</Text>
                    <View
                      style={[
                        styles.dateDot,
                        { backgroundColor: has ? (active ? colors.highlight : colors.brand) : 'transparent' },
                      ]}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Session duration */}
            <Text style={styles.fieldLabel}>Session length</Text>
            <View style={styles.durationRow}>
              {DURATIONS.map((d) => {
                const active = d === duration;
                return (
                  <Pressable
                    key={d}
                    onPress={() => setDuration(d)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.durationPill, active ? styles.durationPillActive : styles.durationPillIdle]}
                  >
                    <Text style={[styles.durationText, active && { color: colors.inkInv }]}>{d} min</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Time-slot grid */}
            <View style={styles.slotHeader}>
              <Text style={styles.fieldLabel}>Open slots</Text>
              <Text style={styles.slotCount}>{openCount} open</Text>
            </View>
            <View style={styles.grid}>
              {CANDIDATE_STARTS.map((start) => {
                const booked = heldStarts.has(start);
                const open = openByStart.has(start);
                const conflict =
                  !open &&
                  !booked &&
                  daySlots.some((s) => s.startMin !== start && overlaps(start, start + duration, s.startMin, s.endMin));
                const busy = busyStart === start;
                const disabled = booked || conflict || busy;

                return (
                  <Pressable
                    key={start}
                    onPress={() => onCell(start)}
                    disabled={disabled}
                    accessibilityRole="button"
                    accessibilityState={{ selected: open, disabled }}
                    style={[
                      styles.slot,
                      booked
                        ? styles.slotBooked
                        : open
                          ? styles.slotOn
                          : conflict
                            ? styles.slotConflict
                            : styles.slotOff,
                    ]}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={colors.brand} />
                    ) : (
                      <>
                        {booked ? (
                          <Icon name="lock" size={13} color={colors.ink3} />
                        ) : open ? (
                          <Icon name="check" size={14} color={colors.brand} />
                        ) : null}
                        <Text
                          style={[
                            styles.slotText,
                            open && { color: colors.ink },
                            (booked || conflict) && { color: colors.ink3 },
                          ]}
                        >
                          {minutesToClock(start)}
                        </Text>
                      </>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

            <View style={styles.note}>
              <Icon name="info" size={15} color={colors.ink3} />
              <Text style={styles.noteText}>
                Booking a slot holds your time and notifies you. A booked slot is locked — the family cancels it to free
                the time.
              </Text>
            </View>
          </ScrollView>

          {/* Sticky done */}
          <View style={styles.footer}>
            <PrimaryButton
              onPress={() => router.back()}
              icon={<Icon name="check" size={18} color={colors.inkInv} />}
            >
              Done
            </PrimaryButton>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  errorText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.danger, textAlign: 'center' },
  retry: { backgroundColor: colors.brand, borderRadius: radii.pill, paddingHorizontal: 24, paddingVertical: 14 },
  retryText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 24 },
  headline: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.4, color: colors.ink, marginTop: 12 },
  sub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2, marginTop: 6 },

  gate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(201,122,42,0.35)',
    ...shadow.e1,
  },
  gateIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(201,122,42,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gateText: { flex: 1, minWidth: 0 },
  gateTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  gateSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 2 },

  fieldLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink2,
    marginTop: 22,
    marginBottom: 10,
  },
  rail: { marginHorizontal: -24 },
  railContent: { paddingHorizontal: 24, gap: 8 },
  datePill: {
    width: 56,
    height: 72,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    ...shadow.e1,
  },
  datePillActive: { backgroundColor: colors.ink },
  dateDow: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.4, color: colors.ink3 },
  dateNum: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, fontVariant: ['tabular-nums'] },
  dateDot: { width: 6, height: 6, borderRadius: radii.pill },

  durationRow: { flexDirection: 'row', gap: 10 },
  durationPill: {
    flex: 1,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  durationPillActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  durationPillIdle: { backgroundColor: colors.surface, borderColor: colors.hairline },
  durationText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  slotHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  slotCount: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink3, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  slot: {
    width: '31%',
    height: 46,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1.5,
  },
  slotOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  slotOff: { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline },
  slotBooked: { backgroundColor: colors.surface, borderColor: colors.hairline },
  slotConflict: { backgroundColor: colors.surface, borderColor: colors.hairline, opacity: 0.5 },
  slotText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2, fontVariant: ['tabular-nums'] },

  actionError: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 16 },

  note: { flexDirection: 'row', gap: 10, marginTop: 22, alignItems: 'flex-start' },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.ink2 },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 28,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    ...shadow.e2,
  },
});
