/**
 * Caregiver Home — supply-side dashboard (synthesised from the design language of
 * web-screens/provider-dashboard + screens/provider-dashboard.jsx). Greeting +
 * AppBar, a this-week earnings hero with a payout chip, an Upcoming bookings rail,
 * an "Open Jobs for you" rail (reuses the job-card look), and a profile/availability
 * nudge. Caregiver = Babysitter/Tutor/Nanny on the Jobs payment-rail (ADR-0011).
 */
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { CategoryChip, type Category } from '@/components/ui/CategoryChip';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const TODAY_LABEL = 'Wednesday, May 13';

const WEEK = [
  { d: 'M', n: 11, jobs: 3, today: false },
  { d: 'T', n: 12, jobs: 2, today: false },
  { d: 'W', n: 13, jobs: 2, today: true },
  { d: 'T', n: 14, jobs: 2, today: false },
  { d: 'F', n: 15, jobs: 1, today: false },
  { d: 'S', n: 16, jobs: 0, today: false },
  { d: 'S', n: 17, jobs: 0, today: false },
] as const;

interface Booking {
  time: string;
  band: string;
  category: Category;
  title: string;
  sub: string;
}

const UPCOMING: Booking[] = [
  { time: '3:30', band: 'PM', category: 'Tutor', title: 'Math review · Anika P.', sub: '1h · $35 · accepted' },
  { time: '5:00', band: 'PM', category: 'Babysitter', title: 'After-school · Mateo & Lia', sub: '2h · $61 · accepted' },
  { time: '9:00', band: 'AM', category: 'Nanny', title: 'Morning care · Delgado', sub: '4h · $128 · tomorrow' },
];

interface OpenJob {
  category: Category;
  posted: string;
  title: string;
  scope: string;
  distance: string;
  budget: string;
  apps: number;
}

const OPEN_JOBS: OpenJob[] = [
  {
    category: 'Tutor',
    posted: '2h ago',
    title: '5th-grade math support, twice weekly',
    scope: 'Eastside · Tue & Thu afternoons',
    distance: '1.8 mi',
    budget: '$30–40 / hr',
    apps: 7,
  },
  {
    category: 'Babysitter',
    posted: '5h ago',
    title: 'After-school sitter for two, Mon–Wed',
    scope: 'Brickell · 3:30–6:30 PM · Recurring',
    distance: '3.1 mi',
    budget: '$28–34 / hr',
    apps: 3,
  },
];

export function CaregiverHome() {
  const router = useRouter();

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      {/* Header — greeting + bell/calendar actions */}
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.eyebrow}>{TODAY_LABEL}</Text>
          <Text style={styles.greeting}>Good morning, Maya</Text>
        </View>
        <View style={styles.headerActions}>
          <IconButton name="calendar" onPress={() => router.push('/schedule')} accessibilityLabel="Schedule" />
          <IconButton name="bell" badge accessibilityLabel="Notifications" />
        </View>
      </View>

      {/* This-week earnings hero */}
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>Earned this week</Text>
        <Text style={styles.heroAmount}>$420</Text>
        <Text style={styles.heroSub}>Next payout Fri, May 23</Text>
        <View style={styles.heroChips}>
          <View style={styles.heroChip}>
            <Icon name="dollar" size={12} color={colors.inkInv} />
            <Text style={styles.heroChipText}>Tutor · $268</Text>
          </View>
          <View style={styles.heroChip}>
            <Icon name="dollar" size={12} color={colors.inkInv} />
            <Text style={styles.heroChipText}>Sitter · $152</Text>
          </View>
        </View>
      </View>

      {/* This week strip */}
      <SectionHeader title="This week" size="md" action="Schedule" onAction={() => router.push('/schedule')} style={styles.section} />
      <View style={styles.weekRow}>
        {WEEK.map((w, i) => (
          <Pressable
            key={i}
            onPress={() => router.push('/schedule')}
            accessibilityLabel={`${w.d} ${w.n}`}
            style={[styles.weekCell, w.today ? styles.weekCellToday : null]}
          >
            <Text style={[styles.weekDay, w.today ? styles.weekDayToday : null]}>{w.d}</Text>
            <Text style={[styles.weekNum, w.today ? styles.weekNumToday : null]}>{w.n}</Text>
            <View style={styles.weekDots}>
              {w.jobs > 0 ? (
                Array.from({ length: Math.min(w.jobs, 3) }).map((_, k) => (
                  <View key={k} style={[styles.weekDot, { backgroundColor: w.today ? colors.highlight : colors.brand }]} />
                ))
              ) : (
                <View style={[styles.weekDot, { backgroundColor: w.today ? 'rgba(251,247,239,0.3)' : colors.hairline }]} />
              )}
            </View>
          </Pressable>
        ))}
      </View>

      {/* Upcoming bookings rail */}
      <SectionHeader title="Upcoming bookings" size="md" action="See all" onAction={() => router.push('/schedule')} style={styles.section} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.rail}
        contentContainerStyle={styles.railContent}
      >
        {UPCOMING.map((b, i) => (
          <Pressable key={i} onPress={() => router.push('/schedule')} style={styles.bookingCard}>
            <View style={styles.timeChip}>
              <Text style={styles.timeChipNum}>{b.time}</Text>
              <Text style={styles.timeChipBand}>{b.band}</Text>
            </View>
            <CategoryChip category={b.category} style={{ marginTop: 12 }} />
            <Text style={styles.bookingTitle} numberOfLines={2}>{b.title}</Text>
            <Text style={styles.bookingSub}>{b.sub}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Open Jobs for you rail */}
      <SectionHeader title="Open Jobs for you" size="md" action="See all" onAction={() => router.push('/opportunities')} style={styles.section} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.rail}
        contentContainerStyle={styles.railContent}
      >
        {OPEN_JOBS.map((j, i) => (
          <Pressable key={i} onPress={() => router.push('/job-detail')} style={styles.jobCard}>
            <View style={styles.jobTop}>
              <CategoryChip category={j.category} />
              <Text style={styles.posted}>{j.posted}</Text>
            </View>
            <Text style={styles.jobTitle} numberOfLines={2}>{j.title}</Text>
            <Text style={styles.jobScope} numberOfLines={1}>{j.scope}</Text>
            <View style={styles.jobMetaRow}>
              <Icon name="pin" size={13} color={colors.ink3} />
              <Text style={styles.jobMetaText}>{j.distance}</Text>
              <Text style={styles.jobDot}>·</Text>
              <Text style={styles.jobMetaText}>{j.budget}</Text>
            </View>
            <View style={styles.jobFoot}>
              <Text style={styles.applied}>{j.apps}/15 applied</Text>
              <View style={styles.applyInline}>
                <Text style={styles.applyText}>Apply</Text>
                <Icon name="arrow-right" size={14} color={colors.ink} />
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {/* Complete-your-profile nudge */}
      <Pressable onPress={() => router.push('/profile-builder')} style={[styles.nudge, styles.section]}>
        <View style={styles.nudgeIcon}>
          <Icon name="sparkle" size={18} color={colors.brand} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.nudgeTitle}>Complete your profile</Text>
          <Text style={styles.nudgeSub}>You're 80% done — add availability to surface in more Jobs.</Text>
          <View style={styles.progressTrack}>
            <View style={styles.progressFill} />
          </View>
        </View>
        <Icon name="chevron-right" size={20} color={colors.ink3} />
      </Pressable>

      {/* Availability nudge */}
      <Pressable onPress={() => router.push('/schedule')} style={styles.availRow}>
        <Icon name="clock" size={18} color={colors.ink} />
        <Text style={styles.availText}>Set your weekly availability</Text>
        <Chip label="Open" tone="success" />
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 },
  eyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2 },
  greeting: { fontFamily: fonts.bold, fontSize: 24, letterSpacing: -0.5, color: colors.ink, marginTop: 3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  hero: { backgroundColor: colors.ink, borderRadius: 28, padding: 20, marginTop: 18 },
  heroEyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.inkInv, opacity: 0.6 },
  heroAmount: { fontFamily: fonts.mono, fontSize: 40, lineHeight: 44, color: colors.inkInv, fontVariant: ['tabular-nums'], letterSpacing: -1, marginTop: 4 },
  heroSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.inkInv, opacity: 0.6, marginTop: 4 },
  heroChips: { flexDirection: 'row', gap: 8, marginTop: 12 },
  heroChip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 26, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: 'rgba(251,247,239,0.12)' },
  heroChipText: { fontFamily: fonts.semibold, fontSize: 11.5, color: colors.inkInv },

  section: { marginTop: 24 },

  weekRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  weekCell: { flex: 1, borderRadius: 16, paddingVertical: 10, alignItems: 'center', backgroundColor: colors.surface, ...shadow.e1 },
  weekCellToday: { backgroundColor: colors.ink },
  weekDay: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.3, color: colors.ink3 },
  weekDayToday: { color: 'rgba(251,247,239,0.6)' },
  weekNum: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink, marginTop: 2, fontVariant: ['tabular-nums'] },
  weekNumToday: { color: colors.inkInv },
  weekDots: { flexDirection: 'row', gap: 2, marginTop: 6, height: 5, alignItems: 'center' },
  weekDot: { width: 4, height: 4, borderRadius: radii.pill },

  rail: { marginHorizontal: -24, marginTop: 12 },
  railContent: { paddingHorizontal: 24, gap: 10 },

  bookingCard: { width: 210, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1 },
  timeChip: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
  timeChipNum: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] },
  timeChipBand: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.5, color: colors.ink2 },
  bookingTitle: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: colors.ink, marginTop: 10 },
  bookingSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 4 },

  jobCard: { width: 264, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1, gap: 8 },
  jobTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  posted: { fontFamily: fonts.regular, fontSize: 11, letterSpacing: 0.4, color: colors.ink3 },
  jobTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.ink },
  jobScope: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  jobMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  jobMetaText: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  jobDot: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },
  jobFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  applied: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },
  applyInline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  applyText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  nudge: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1 },
  nudgeIcon: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  nudgeTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  nudgeSub: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, color: colors.ink2, marginTop: 2 },
  progressTrack: { height: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, marginTop: 10, overflow: 'hidden' },
  progressFill: { width: '80%', height: '100%', borderRadius: radii.pill, backgroundColor: colors.brand },

  availRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surfaceAlt, borderRadius: radii.lg, paddingHorizontal: 16, paddingVertical: 14, marginTop: 12 },
  availText: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
});
