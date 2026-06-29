/**
 * Parent Home — discovery + Jobs landing (design: screens/home.jsx).
 *
 * Greeting + hero headline, an "Upcoming Bookings" stat card with a nested
 * next-booking row, a "Post a Job" teal CTA, the "My open Jobs" horizontal rail,
 * and a "Find help for your family" 2×2 category grid that routes into search.
 * UI scaffold — inline sample data, no fetching.
 */
import { useRouter, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { AvatarGroup } from '@/components/ui/Avatar';
import { CategoryChip, type Category } from '@/components/ui/CategoryChip';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { usePreview } from '@/preview/PreviewProvider';
import { shapeBrowse, summarizeAnswers } from '@/preview/questionnaire';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

const ADJUST_QUESTIONNAIRE = '/(app)/preview-questionnaire?adjust=1' as Href;

interface OpenJob {
  cat: Category;
  tone: ColorToken;
  desc: string;
  apps: number;
  days: string;
}

const OPEN_JOBS: OpenJob[] = [
  { cat: 'Babysitter', tone: 'catBaby', desc: 'Saturday evening sitter for 2 kids', apps: 4, days: '2 days left' },
  { cat: 'Tutor', tone: 'catTutor', desc: '5th-grade math support, twice weekly after school', apps: 7, days: '6 days left' },
  { cat: 'Nanny', tone: 'catNanny', desc: 'After-school nanny for two kids, ages 4–6', apps: 2, days: '11 days left' },
];

interface CategoryTile {
  name: Category;
  tone: ColorToken;
  count: string;
  icon: IconName;
}

const CATEGORIES: CategoryTile[] = [
  { name: 'Babysitter', tone: 'catBaby', count: '128 nearby', icon: 'person' },
  { name: 'Tutor', tone: 'catTutor', count: '64 nearby', icon: 'graduation' },
  { name: 'Nanny', tone: 'catNanny', count: '47 nearby', icon: 'users' },
  { name: 'Provider', tone: 'catSpec', count: '22 licensed', icon: 'shield' },
];

const APP_TONES: ColorToken[] = ['catTutor', 'catBaby', 'catNanny'];

export function ParentHome() {
  const router = useRouter();
  const { answers } = usePreview();

  // The ephemeral preview answers re-order the category grid so the most relevant
  // care leads the first browse (story 111). No answers → the default order.
  const shape = shapeBrowse(answers);
  const summary = summarizeAnswers(answers);
  const categories = useMemo(() => {
    const byName = new Map(CATEGORIES.map((c) => [c.name, c]));
    const ordered = shape.categories
      .map((name) => byName.get(name))
      .filter((c): c is CategoryTile => Boolean(c));
    // Keep any tiles the shaping didn't mention (defensive — currently none).
    for (const c of CATEGORIES) if (!ordered.includes(c)) ordered.push(c);
    return ordered;
  }, [shape]);

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      {/* App bar */}
      <View style={styles.topBar}>
        <View style={styles.brandAvatar}>
          <Text style={styles.brandAvatarText}>A</Text>
        </View>
        <View style={styles.cluster}>
          <IconButton name="bell" badge accessibilityLabel="Notifications" />
          <IconButton name="message" onPress={() => router.push('/messages')} accessibilityLabel="Messages" />
          <IconButton name="calendar" onPress={() => router.push('/bookings')} accessibilityLabel="Bookings" />
        </View>
      </View>

      {/* Greeting + hero */}
      <Text style={styles.greeting}>Good morning, Adjei</Text>
      <Text style={styles.hero}>Find Trusted Providers Near You.</Text>

      {/* Upcoming Bookings stat card */}
      <Pressable
        onPress={() => router.push('/bookings')}
        accessibilityRole="button"
        accessibilityLabel="Upcoming bookings"
        style={({ pressed }) => [styles.statCard, { opacity: pressed ? 0.92 : 1 }]}
      >
        <View style={styles.statHeader}>
          <View>
            <Text style={styles.statNumber}>3</Text>
            <Text style={styles.statLabel}>Upcoming Bookings</Text>
          </View>
          <View style={styles.statArrow}>
            <Icon name="arrow-up-right" size={20} color={colors.ink} />
          </View>
        </View>

        <View style={styles.nextRow}>
          <View style={styles.nextAvatar}>
            <Text style={styles.nextAvatarText}>MO</Text>
          </View>
          <View style={styles.nextText}>
            <Text style={styles.nextName}>Maya Okafor</Text>
            <Text style={styles.nextMeta}>Tutor · Tomorrow morning</Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.ink2} />
        </View>
      </Pressable>

      {/* Post a Job */}
      <PrimaryButton
        onPress={() => router.push('/post-job')}
        icon={<Icon name="briefcase" size={18} color={colors.inkInv} />}
        style={styles.postBtn}
      >
        Post a Job
      </PrimaryButton>
      <Text style={styles.postHelper}>
        Can&apos;t find the right fit? Describe what you need — Caregivers apply to you.
      </Text>

      {/* My open Jobs rail */}
      <SectionHeader
        title="My open Jobs"
        action="See all"
        size="md"
        onAction={() => router.push('/post-job')}
        style={styles.jobsHeader}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.rail}
        contentContainerStyle={styles.railContent}
      >
        {OPEN_JOBS.map((job, i) => (
          <Pressable
            key={i}
            onPress={() => router.push('/post-job')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.jobCard, { opacity: pressed ? 0.94 : 1 }]}
          >
            <View style={styles.jobTop}>
              <CategoryChip category={job.cat} />
              <Chip tone="info" label={`Open · ${job.apps}/15`} />
            </View>
            <Text style={styles.jobDesc} numberOfLines={2}>
              {job.desc}
            </Text>
            <View style={styles.jobBottom}>
              <AvatarGroup
                items={Array.from({ length: job.apps }, (_, k) => ({ tone: APP_TONES[k % APP_TONES.length] }))}
              />
              <Text style={styles.jobDays}>{job.days}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      {/* Personalised browse banner — shows when the ephemeral preview answers
          actually re-shaped the grid; taps back into the questionnaire. */}
      {summary && shape.shaped ? (
        <Pressable
          onPress={() => router.push(ADJUST_QUESTIONNAIRE)}
          accessibilityRole="button"
          accessibilityLabel="Adjust your browse preferences"
          style={({ pressed }) => [styles.personalBanner, { opacity: pressed ? 0.92 : 1 }]}
        >
          <View style={styles.personalIcon}>
            <Icon name="sparkle" size={16} color={colors.brand} />
          </View>
          <View style={styles.personalText}>
            <Text style={styles.personalTitle}>Personalised for you</Text>
            <Text style={styles.personalMeta} numberOfLines={1}>
              {summary}
            </Text>
          </View>
          <Text style={styles.personalAdjust}>Adjust</Text>
        </Pressable>
      ) : null}

      {/* Find help for your family */}
      <SectionHeader
        title="Find help for your family"
        right={
          <View style={styles.cluster}>
            <IconButton name="search" onPress={() => router.push('/search')} accessibilityLabel="Search" />
            <IconButton name="sliders" onPress={() => router.push('/search')} accessibilityLabel="Filters" />
          </View>
        }
        style={styles.findHeader}
      />
      <View style={styles.grid}>
        {categories.map((cat) => (
          <Pressable
            key={cat.name}
            onPress={() => router.push('/search')}
            accessibilityRole="button"
            accessibilityLabel={`Browse ${cat.name}`}
            style={({ pressed }) => [styles.tile, { backgroundColor: colors[cat.tone], opacity: pressed ? 0.92 : 1 }]}
          >
            <View style={styles.tileIcon}>
              <Icon name={cat.icon} size={36} color={colors.ink} />
            </View>
            <View>
              <Text style={styles.tileName}>{cat.name}</Text>
              <Text style={styles.tileCount}>{cat.count}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  cluster: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandAvatar: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.monoGray,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandAvatarText: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },

  greeting: { fontFamily: fonts.regular, fontSize: 15, color: colors.ink2, marginTop: 20 },
  hero: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, color: colors.ink, marginTop: 8, marginBottom: 18 },

  statCard: { backgroundColor: colors.surface, borderRadius: 28, padding: 18, marginBottom: 14, ...shadow.e1 },
  statHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  statNumber: { fontFamily: fonts.bold, fontSize: 36, lineHeight: 40, letterSpacing: -1.5, color: colors.ink, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 4 },
  statArrow: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: 10,
  },
  nextAvatar: { width: 44, height: 44, borderRadius: radii.pill, backgroundColor: colors.catTutor, alignItems: 'center', justifyContent: 'center' },
  nextAvatarText: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  nextText: { flex: 1, minWidth: 0 },
  nextName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  nextMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },

  postBtn: { marginTop: 0 },
  postHelper: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.ink2, textAlign: 'center', marginTop: 8 },

  jobsHeader: { marginTop: 26, marginBottom: 10 },
  rail: { marginHorizontal: -24 },
  railContent: { paddingHorizontal: 24, gap: 10, paddingBottom: 4 },
  jobCard: { width: 240, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 14, gap: 10, ...shadow.e1 },
  jobTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobDesc: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19, color: colors.ink },
  jobBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' },
  jobDays: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3 },

  personalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 26,
    padding: 12,
    borderRadius: radii.lg,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  personalIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personalText: { flex: 1, minWidth: 0 },
  personalTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  personalMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2, textTransform: 'capitalize' },
  personalAdjust: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brand },

  findHeader: { marginTop: 26, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  tile: { width: '48%', height: 144, borderRadius: 24, padding: 14, justifyContent: 'space-between', overflow: 'hidden' },
  tileIcon: { opacity: 0.75 },
  tileName: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  tileCount: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink, opacity: 0.7, marginTop: 2 },
});
