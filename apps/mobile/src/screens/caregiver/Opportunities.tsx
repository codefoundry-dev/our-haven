/**
 * Caregiver Opportunities — the open Jobs feed a Caregiver browses and applies to
 * (port of design screens/provider-opps.jsx · §5.11.1). Search/filter row, filter
 * chips, a monthly application-quota meter, and vertical Job cards (category,
 * distance, posted time, scope, child detail, disclosed Safety Behaviors, budget
 * hint, applicant capacity). Cards tap to /job-detail. Second tab lists the
 * Caregiver's own applications. Caregiver = Babysitter/Tutor/Nanny (ADR-0011).
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { CategoryChip, type Category } from '@/components/ui/CategoryChip';
import { Chip, FilterChip } from '@/components/ui/Chip';
import { SearchBar } from '@/components/ui/SearchBar';
import { TabStrip } from '@/components/ui/TabStrip';
import { useSupplyActivation } from '@/lib/SupplyActivationProvider';
import { CaregiverPreActivation } from '@/screens/caregiver/PreActivation';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const TABS = ['Open Jobs', 'My Applications'] as const;
type Tab = (typeof TABS)[number];

const FILTERS = ['All', 'Tutor', 'Babysitter', 'Nanny', 'Within 5 mi'] as const;

interface OpenJob {
  category: Category;
  posted: string;
  title: string;
  scope: string;
  distance: string;
  child: string;
  behaviors?: string[];
  budget: string;
  apps: number;
}

const OPEN_JOBS: OpenJob[] = [
  {
    category: 'Tutor',
    posted: 'Posted 2h ago',
    title: '5th-grade math support, twice weekly after school',
    scope: 'Eastside · Tue & Thu · afternoons · Recurring',
    distance: '1.8 mi away',
    child: '1 child · age 10',
    budget: '$30–40 / hr',
    apps: 7,
  },
  {
    category: 'Babysitter',
    posted: 'Posted 5h ago',
    title: 'After-school sitter for two, Mon–Wed',
    scope: 'Brickell · 3:30–6:30 PM · Recurring',
    distance: '3.1 mi away',
    child: '2 children · ages 4 & 7',
    behaviors: ['Food allergy · EpiPen', 'ADHD'],
    budget: '$28–34 / hr',
    apps: 3,
  },
  {
    category: 'Tutor',
    posted: 'Posted yesterday',
    title: 'Algebra 1 catch-up for incoming 8th grader',
    scope: 'Westside · Mon/Wed · evenings · 8-week program',
    distance: '4.6 mi away',
    child: '1 child · age 13',
    budget: '$35–45 / hr',
    apps: 4,
  },
  {
    category: 'Babysitter',
    posted: 'Posted 2 days ago',
    title: 'Weekend evening sitter, occasional',
    scope: 'Coral Gables · Sat evenings · As needed',
    distance: '6.2 mi away',
    child: '1 child · age 5',
    behaviors: ['Anxiety'],
    budget: '$26–32 / hr',
    apps: 9,
  },
];

interface Application {
  title: string;
  parent: string;
  offer: string;
  jobState: string;
  appState: string;
  appTone: 'info' | 'warning' | 'success' | 'neutral';
  attention?: boolean;
}

const APPLICATIONS: Application[] = [
  { title: 'Algebra 1 catch-up for incoming 8th grader', parent: 'Priya N.', offer: '76', jobState: 'Open · 7/15', appState: 'Counter sent', appTone: 'warning', attention: true },
  { title: 'Reading + writing tutoring, dyslexia-aware', parent: 'Daniel R.', offer: '60', jobState: 'Open · 11/15', appState: 'Submitted', appTone: 'info' },
  { title: '5th-grade math support, twice weekly', parent: 'Adjei O.', offer: '64', jobState: 'Open · 7/15', appState: 'Submitted', appTone: 'info' },
  { title: 'SAT prep, focus on math', parent: 'Sarah K.', offer: '180', jobState: 'Awarded', appState: 'Awarded', appTone: 'success' },
  { title: 'Geometry weekly tutor for 9th grader', parent: 'Marcus T.', offer: '56', jobState: 'Closed', appState: 'Declined', appTone: 'neutral' },
];

export function CaregiverOpportunities() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Open Jobs');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>('All');
  const { loading, activated, verification, blockingStep } = useSupplyActivation();

  // Pre-activation (PRD story 83): until verification clears, a Caregiver can't
  // browse Jobs — swap the feed for the empty state that names the blocking step.
  // Gate on `loading` first so the feed never flashes during the initial fetch.
  if (loading) {
    return (
      <Screen scroll edges={['top']} contentStyle={styles.content}>
        <AppBar large title="Opportunities" />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </Screen>
    );
  }
  if (!activated) {
    return <CaregiverPreActivation verification={verification} blockingStep={blockingStep} />;
  }

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      <AppBar large title="Opportunities" actions={[{ icon: 'sliders', label: 'Filters' }]} />

      <TabStrip tabs={TABS} value={tab} onChange={setTab} style={styles.tabStrip} />

      {tab === 'Open Jobs' ? (
        <View>
          {/* Search + filter */}
          <SearchBar
            value={query}
            onChangeText={setQuery}
            placeholder="Search open Jobs"
            onFilter={() => {}}
            style={styles.search}
          />

          {/* Filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRail} contentContainerStyle={styles.chipRailContent}>
            {FILTERS.map((f) => (
              <FilterChip key={f} label={f} active={filter === f} onPress={() => setFilter(f)} />
            ))}
          </ScrollView>

          {/* Monthly quota meter */}
          <View style={styles.quota}>
            <Text style={styles.quotaText}>12/30 applications used this month</Text>
            <View style={styles.quotaTrack}>
              <View style={styles.quotaFill} />
            </View>
          </View>

          {/* Job cards */}
          <View style={styles.list}>
            {OPEN_JOBS.map((j, i) => (
              <Pressable key={i} onPress={() => router.push('/job-detail')} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={styles.cardTopLeft}>
                    <CategoryChip category={j.category} />
                    <View style={styles.distance}>
                      <Icon name="pin" size={13} color={colors.ink3} />
                      <Text style={styles.distanceText}>{j.distance}</Text>
                    </View>
                  </View>
                  <Text style={styles.posted}>{j.posted}</Text>
                </View>

                <Text style={styles.title}>{j.title}</Text>
                <Text style={styles.scope}>{j.scope}</Text>

                <Chip label={j.child} tone="child" icon="users" />

                {j.behaviors ? (
                  <View style={styles.chipWrap}>
                    {j.behaviors.map((b) => (
                      <Chip key={b} label={b} tone="safety" icon="shield" />
                    ))}
                  </View>
                ) : null}

                <Text style={styles.budget}>
                  <Text style={styles.budgetHint}>Budget hint · </Text>
                  {j.budget}
                </Text>

                <View style={styles.cardFoot}>
                  <Text style={styles.applied}>{j.apps}/15 applied</Text>
                  <View style={styles.applyInline}>
                    <Text style={styles.applyText}>Apply</Text>
                    <Icon name="arrow-right" size={14} color={colors.ink} />
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.list}>
          {APPLICATIONS.map((a, i) => (
            <Pressable key={i} onPress={() => router.push('/job-detail')} style={[styles.appRow, a.attention ? styles.appRowFlag : null]}>
              <View style={styles.appAvatar}>
                <Text style={styles.appAvatarText}>{a.parent[0]}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.appTitle} numberOfLines={1}>{a.title}</Text>
                <Text style={styles.appSub}>{a.parent} · Offer ${a.offer}</Text>
                <View style={styles.chipWrap}>
                  <Chip label={`Job · ${a.jobState}`} tone="neutral" />
                  <Chip label={`You · ${a.appState}`} tone={a.appTone} />
                </View>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },

  loading: { paddingTop: 96, alignItems: 'center' },

  tabStrip: { marginTop: 14 },
  search: { marginTop: 16, backgroundColor: colors.surface },
  chipRail: { marginHorizontal: -24, marginTop: 14 },
  chipRailContent: { paddingHorizontal: 24, gap: 8 },

  quota: { marginTop: 16 },
  quotaText: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  quotaTrack: { height: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, marginTop: 6, overflow: 'hidden' },
  quotaFill: { width: '40%', height: '100%', borderRadius: radii.pill, backgroundColor: colors.highlight },

  list: { marginTop: 16, gap: 12 },

  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTopLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  distance: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  distanceText: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },
  posted: { fontFamily: fonts.regular, fontSize: 11, letterSpacing: 0.4, color: colors.ink3 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.ink },
  scope: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  budget: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },
  budgetHint: { fontFamily: fonts.regular, color: colors.ink3 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  applied: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },
  applyInline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  applyText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  appRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 14, ...shadow.e1 },
  appRowFlag: { borderLeftWidth: 4, borderLeftColor: colors.highlight },
  appAvatar: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.monoGray, alignItems: 'center', justifyContent: 'center' },
  appAvatarText: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  appTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  appSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2, marginBottom: 8 },
});
