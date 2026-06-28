/**
 * Parent Bookings — the parent's bookings across all Providers
 * (design: screens/bookings.jsx).
 *
 * Month header + week strip, an Upcoming/Past/Disputes TabStrip, a recurring
 * Booking-Series group (materialised sessions, ADR-0014) and one-off bookings
 * laid out on a time rail. Rows tap into the Booking detail. UI scaffold.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { CategoryChip, type Category } from '@/components/ui/CategoryChip';
import { IconButton } from '@/components/ui/IconButton';
import { StatusPill, type BookingState } from '@/components/ui/StatusPill';
import { TabStrip } from '@/components/ui/TabStrip';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

const TABS = ['Upcoming', 'Past', 'Disputes'] as const;
type Tab = (typeof TABS)[number];

const WEEK = [
  { d: 'Mon', n: 8 },
  { d: 'Tue', n: 9 },
  { d: 'Wed', n: 10, sel: true },
  { d: 'Thu', n: 11 },
  { d: 'Fri', n: 12 },
  { d: 'Sat', n: 13 },
  { d: 'Sun', n: 14 },
];

interface SeriesOccurrence {
  date: string;
  time: string;
  state: BookingState;
  label: string;
}

const SERIES = {
  cat: 'Nanny' as Category,
  tone: 'catNanny' as ColorToken,
  prov: 'Rosa Delgado',
  title: 'Tuesdays & Thursdays with Rosa',
  rule: 'Tue & Thu · 3:30–5:00 PM · through Jul 2',
  total: 12,
  done: 0,
  next: [
    { date: 'Tue, May 26', time: '3:30–5:00 PM · ~1.5h', state: 'requested', label: 'Awaiting Provider' },
    { date: 'Thu, May 28', time: '3:30–5:00 PM · ~1.5h', state: 'requested', label: 'Awaiting Provider' },
  ] as SeriesOccurrence[],
};

interface OneOff {
  time: string;
  cat: Category;
  tone: ColorToken;
  prov: string;
  title: string;
  state: BookingState;
  label: string;
}

const ONE_OFFS: OneOff[] = [
  {
    time: '3:00–4:00 PM',
    cat: 'Babysitter',
    tone: 'catBaby',
    prov: 'Lina Park',
    title: 'After-school sitter · Anika',
    state: 'accepted',
    label: 'Accepted',
  },
  {
    time: '4:30–5:00 PM',
    cat: 'Tutor',
    tone: 'catTutor',
    prov: 'Maya Okafor',
    title: 'Math · 4th grade · Anika',
    state: 'awaiting-confirmation',
    label: 'Confirm hours',
  },
];

export function ParentBookings() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Upcoming');

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      {/* Month header */}
      <View style={styles.topBar}>
        <View style={styles.month}>
          <Text style={styles.monthText}>May</Text>
          <Icon name="chevron-down" size={20} color={colors.ink} />
        </View>
        <View style={styles.cluster}>
          <IconButton name="search" onPress={() => router.push('/search')} accessibilityLabel="Search" />
          <IconButton name="plus" dark onPress={() => router.push('/search')} accessibilityLabel="New booking" />
        </View>
      </View>

      {/* Week strip */}
      <View style={styles.week}>
        {WEEK.map((day) => (
          <View key={day.n} style={[styles.dayPill, day.sel && styles.dayPillSel]}>
            <Text style={styles.dayName}>{day.d}</Text>
            <Text style={styles.dayNum}>{day.n}</Text>
          </View>
        ))}
      </View>

      <TabStrip tabs={TABS} value={tab} onChange={setTab} style={styles.tabs} />

      {tab === 'Upcoming' ? (
        <View style={styles.body}>
          {/* Recurring series */}
          <Text style={styles.eyebrow}>Recurring series</Text>
          <View style={styles.seriesCard}>
            <View style={[styles.seriesHead, { backgroundColor: SERIES.tone }]}>
              <View style={styles.seriesHeadTop}>
                <CategoryChip category={SERIES.cat} />
                <View style={styles.seriesPill}>
                  <Icon name="calendar" size={12} color={colors.ink} />
                  <Text style={styles.seriesPillText}>Series · {SERIES.total} sessions</Text>
                </View>
              </View>
              <Text style={styles.seriesTitle}>{SERIES.title}</Text>
              <Text style={styles.seriesRule}>{SERIES.rule}</Text>
              <View style={styles.seriesProvRow}>
                <Avatar label={SERIES.prov} size="xs" tone="monoGray" />
                <Text style={styles.seriesProv}>{SERIES.prov}</Text>
                <Text style={styles.seriesDone}>
                  {SERIES.done}/{SERIES.total} done
                </Text>
              </View>
            </View>

            <View style={styles.seriesBody}>
              <Text style={styles.seriesNextLabel}>Next sessions</Text>
              {SERIES.next.map((occ, i) => (
                <View key={i} style={[styles.occRow, i > 0 && styles.occRowDivider]}>
                  <View style={styles.occIcon}>
                    <Icon name="clock" size={15} color={colors.ink} />
                  </View>
                  <View style={styles.occText}>
                    <Text style={styles.occDate}>{occ.date}</Text>
                    <Text style={styles.occTime}>{occ.time}</Text>
                  </View>
                  <StatusPill state={occ.state} label={occ.label} />
                </View>
              ))}
              <Pressable
                onPress={() => router.push('/booking-detail')}
                accessibilityRole="button"
                style={({ pressed }) => [styles.viewAll, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={styles.viewAllText}>View all {SERIES.total} sessions</Text>
                <Icon name="chevron-right" size={14} color={colors.ink} />
              </Pressable>
            </View>
          </View>

          {/* One-off bookings */}
          <Text style={styles.eyebrow}>Wednesday · May 10</Text>
          {ONE_OFFS.map((b, i) => (
            <View key={i} style={styles.oneOffRow}>
              <View style={styles.rail}>
                <Text style={styles.railTime}>{b.time.split('–')[0]}</Text>
                <View style={styles.railLine} />
              </View>
              <Pressable
                onPress={() => router.push('/booking-detail')}
                accessibilityRole="button"
                style={({ pressed }) => [styles.oneOffCard, { backgroundColor: b.tone, opacity: pressed ? 0.94 : 1 }]}
              >
                <View style={styles.oneOffTop}>
                  <CategoryChip category={b.cat} />
                  <StatusPill state={b.state} label={b.label} />
                </View>
                <Text style={styles.oneOffTitle}>{b.title}</Text>
                <View style={styles.oneOffBottom}>
                  <View style={styles.oneOffProv}>
                    <Avatar label={b.prov} size="xs" tone="monoGray" />
                    <Text style={styles.oneOffProvName}>{b.prov}</Text>
                  </View>
                  <Text style={styles.oneOffTime}>{b.time}</Text>
                </View>
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Icon name={tab === 'Disputes' ? 'shield' : 'receipt'} size={26} color={colors.brand} />
          </View>
          <Text style={styles.emptyTitle}>{tab === 'Disputes' ? 'No disputes' : 'No past bookings'}</Text>
          <Text style={styles.emptySub}>
            {tab === 'Disputes'
              ? 'Reported issues will appear here.'
              : 'Your completed bookings will appear here.'}
          </Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  month: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  monthText: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink },
  cluster: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  week: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 20, paddingBottom: 8 },
  dayPill: { alignItems: 'center', gap: 6, width: 36, paddingVertical: 8, borderRadius: radii.pill },
  dayPillSel: { backgroundColor: colors.catSpec },
  dayName: { fontFamily: fonts.medium, fontSize: 11, color: colors.ink2 },
  dayNum: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] },

  tabs: { marginTop: 12 },
  body: { marginTop: 18 },
  eyebrow: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 12 },

  seriesCard: { backgroundColor: colors.surface, borderRadius: 24, overflow: 'hidden', marginBottom: 20, ...shadow.e1 },
  seriesHead: { padding: 16 },
  seriesHeadTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  seriesPill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: 'rgba(22,21,19,0.12)' },
  seriesPillText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.ink },
  seriesTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21, color: colors.ink, marginTop: 12 },
  seriesRule: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink, opacity: 0.75, marginTop: 3 },
  seriesProvRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  seriesProv: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink },
  seriesDone: { marginLeft: 'auto', fontFamily: fonts.semibold, fontSize: 11.5, color: colors.ink, opacity: 0.7 },

  seriesBody: { paddingHorizontal: 16 },
  seriesNextLabel: { fontFamily: fonts.semibold, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink3, paddingTop: 12, paddingBottom: 6 },
  occRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  occRowDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  occIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  occText: { flex: 1, minWidth: 0 },
  occDate: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },
  occTime: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink2, marginTop: 1 },
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    marginVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  viewAllText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  oneOffRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  rail: { alignItems: 'center', paddingTop: 14, width: 56 },
  railTime: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.2, color: colors.ink2, textAlign: 'center', lineHeight: 13, fontVariant: ['tabular-nums'] },
  railLine: { width: 1, flex: 1, backgroundColor: colors.hairline, marginTop: 8 },
  oneOffCard: { flex: 1, borderRadius: 24, padding: 16 },
  oneOffTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  oneOffTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.ink, marginTop: 12 },
  oneOffBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  oneOffProv: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  oneOffProvName: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink },
  oneOffTime: { fontFamily: fonts.semibold, fontSize: 11.5, color: colors.ink, fontVariant: ['tabular-nums'] },

  empty: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 64 },
  emptyIcon: { width: 64, height: 64, borderRadius: radii.lg, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, textAlign: 'center', maxWidth: 260 },
});
