/**
 * Caregiver Schedule — the Caregiver's booking calendar + availability (synthesised
 * from the design's date-rail/day-selector + the dashboard time-slot booking cards,
 * plus an availability section). A horizontal week/day selector drives the day's
 * bookings; an Availability card toggles whether new requests are accepted and links
 * to the weekly-availability editor. Caregiver = Babysitter/Tutor/Nanny (ADR-0011).
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { CategoryChip, type Category } from '@/components/ui/CategoryChip';
import { StatusPill, type BookingState } from '@/components/ui/StatusPill';
import { Toggle } from '@/components/ui/Toggle';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Day {
  dow: string;
  date: number;
  jobs: number;
}

const DAYS: Day[] = [
  { dow: 'Mon', date: 11, jobs: 3 },
  { dow: 'Tue', date: 12, jobs: 2 },
  { dow: 'Wed', date: 13, jobs: 2 },
  { dow: 'Thu', date: 14, jobs: 2 },
  { dow: 'Fri', date: 15, jobs: 1 },
  { dow: 'Sat', date: 16, jobs: 0 },
  { dow: 'Sun', date: 17, jobs: 0 },
];

interface Slot {
  time: string;
  band: string;
  category: Category;
  title: string;
  sub: string;
  state: BookingState;
}

const SLOTS: Slot[] = [
  { time: '3:30', band: 'PM', category: 'Tutor', title: 'Math review · Anika P.', sub: '1h · $35 · 1 child', state: 'accepted' },
  { time: '5:00', band: 'PM', category: 'Babysitter', title: 'After-school sitter · Mateo & Lia', sub: '2h · $61 · 2 children', state: 'accepted' },
  { time: '7:30', band: 'PM', category: 'Nanny', title: 'Evening care · Delgado', sub: '2h · $58 · confirm hours', state: 'awaiting-confirmation' },
];

export function CaregiverSchedule() {
  const router = useRouter();
  const [selected, setSelected] = useState(2); // Wed
  const [accepting, setAccepting] = useState(true);

  const day = DAYS[selected];

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      <AppBar large title="Schedule" actions={[{ icon: 'calendar', label: 'Month view' }]} />

      <Text style={styles.monthLabel}>May 2026</Text>

      {/* Week / day selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rail} contentContainerStyle={styles.railContent}>
        {DAYS.map((d, i) => {
          const on = i === selected;
          return (
            <Pressable
              key={i}
              onPress={() => setSelected(i)}
              accessibilityLabel={`${d.dow} ${d.date}`}
              style={[styles.datePill, on ? styles.datePillOn : null]}
            >
              <Text style={[styles.datePillDow, on ? styles.datePillTextOn : null]}>{d.dow}</Text>
              <Text style={[styles.datePillNum, on ? styles.datePillTextOn : null]}>{d.date}</Text>
              <View style={styles.dot}>
                {d.jobs > 0 ? (
                  <View style={[styles.dotMark, { backgroundColor: on ? colors.highlight : colors.brand }]} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* The selected day's bookings */}
      <Text style={styles.dayHeading}>
        {DOW[selected]} · {day.jobs} {day.jobs === 1 ? 'booking' : 'bookings'}
      </Text>

      {day.jobs > 0 ? (
        <View style={styles.list}>
          {SLOTS.slice(0, day.jobs).map((s, i) => (
            <Pressable key={i} onPress={() => router.push('/booking-detail')} style={styles.slot}>
              <View style={styles.timeChip}>
                <Text style={styles.timeNum}>{s.time}</Text>
                <Text style={styles.timeBand}>{s.band}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <CategoryChip category={s.category} />
                <Text style={styles.slotTitle}>{s.title}</Text>
                <Text style={styles.slotSub}>{s.sub}</Text>
              </View>
              <View style={styles.slotRight}>
                <StatusPill state={s.state} />
                <Icon name="chevron-right" size={16} color={colors.ink3} />
              </View>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Icon name="calendar" size={22} color={colors.ink3} />
          <Text style={styles.emptyText}>No bookings this day.</Text>
        </View>
      )}

      {/* Availability section */}
      <Text style={styles.sectionTitle}>Availability</Text>
      <View style={styles.availCard}>
        <View style={styles.availRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.availTitle}>Accepting new bookings</Text>
            <Text style={styles.availSub}>When off, your profile is hidden from new Job matches.</Text>
          </View>
          <Toggle on={accepting} onPress={() => setAccepting((v) => !v)} />
        </View>

        <View style={styles.divider} />

        <Pressable onPress={() => router.push('/availability')} style={styles.availLink}>
          <View style={styles.availLinkIcon}>
            <Icon name="clock" size={18} color={colors.brand} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.availTitle}>Weekly availability</Text>
            <Text style={styles.availSub}>Mon–Fri afternoons · Sat evenings</Text>
          </View>
          <Icon name="chevron-right" size={20} color={colors.ink3} />
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },

  monthLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, marginTop: 8 },

  rail: { marginHorizontal: -24, marginTop: 12 },
  railContent: { paddingHorizontal: 24, gap: 8 },
  datePill: { width: 52, paddingVertical: 10, borderRadius: 16, alignItems: 'center', gap: 3, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  datePillOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  datePillDow: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.3, textTransform: 'uppercase', color: colors.ink3 },
  datePillNum: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, fontVariant: ['tabular-nums'] },
  datePillTextOn: { color: colors.inkInv },
  dot: { height: 6, justifyContent: 'center' },
  dotMark: { width: 5, height: 5, borderRadius: radii.pill },

  dayHeading: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2, marginTop: 18 },

  list: { marginTop: 10, gap: 8 },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 14, ...shadow.e1 },
  timeChip: { width: 52, paddingVertical: 8, borderRadius: 14, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
  timeNum: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 17, color: colors.ink, fontVariant: ['tabular-nums'] },
  timeBand: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.5, color: colors.ink2 },
  slotTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink, marginTop: 6 },
  slotSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },
  slotRight: { alignItems: 'flex-end', gap: 8 },

  empty: { marginTop: 12, alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radii.lg, paddingVertical: 28, ...shadow.e1 },
  emptyText: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },

  sectionTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink, marginTop: 28 },
  availCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, marginTop: 10, ...shadow.e1 },
  availRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  availTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  availSub: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: 14 },
  availLink: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  availLinkIcon: { width: 38, height: 38, borderRadius: radii.pill, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
});
