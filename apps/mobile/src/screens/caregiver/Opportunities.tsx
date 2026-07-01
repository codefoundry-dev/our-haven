/**
 * Caregiver Opportunities (OH-218) — the open Jobs feed a Caregiver browses (port
 * of design screens/provider-opps.jsx · §5.11.1), wired to live data. Search + a
 * schedule filter (one-off/recurring) + a category filter (shown only when the
 * Caregiver offers 2+ categories), a monthly application-quota meter (N/30), and
 * vertical Job cards (category, approximate distance, posted time, schedule, child
 * bundle, disclosed Safety Behaviors, budget hint, applicant capacity). Cards tap
 * to /job-detail with the Job id. The second tab lists the Caregiver's own
 * Applications, date-grouped. Caregiver = Babysitter/Tutor/Nanny (ADR-0011).
 *
 * READ-ONLY: applying (the write path) is the composer, OH-219 — the Job-detail
 * Apply CTA leads there.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { MyApplication, Opportunity, OpportunityCategory } from '@/api/client';
import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { Chip, FilterChip } from '@/components/ui/Chip';
import { SearchBar } from '@/components/ui/SearchBar';
import { TabStrip } from '@/components/ui/TabStrip';
import { applicationStatusStyle, categoryChip, jobScheduleLabel, jobStatusStyle } from '@/lib/jobsHub';
import {
  budgetLabel,
  childSummary,
  distanceLabel,
  groupApplications,
  postedAgo,
  useMyApplications,
  useOfferedCategories,
  useOpportunities,
} from '@/lib/opportunities';
import { useSupplyActivation } from '@/lib/SupplyActivationProvider';
import { behaviourLabel } from '@/lib/supply-profile';
import { CaregiverPreActivation } from '@/screens/caregiver/PreActivation';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const TABS = ['Open Jobs', 'My Applications'] as const;
type Tab = (typeof TABS)[number];

const SCHEDULE_FILTERS = [
  { value: 'any', label: 'Any' },
  { value: 'one-off', label: 'One-off' },
  { value: 'recurring', label: 'Recurring' },
] as const;

/** The per-Job Application cap (ADR-0006 §7) — the "N/15 applied" denominator. */
const JOB_APPLICATION_CAP = 15;

function quotaPct(used: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((used / cap) * 100));
}

export function CaregiverOpportunities() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Open Jobs');
  const [query, setQuery] = useState('');
  const [scheduleFilter, setScheduleFilter] = useState<'any' | 'one-off' | 'recurring'>('any');
  const [categoryFilter, setCategoryFilter] = useState<'all' | OpportunityCategory>('all');
  const { loading: activationLoading, activated, verification, blockingStep } = useSupplyActivation();

  // Hooks run unconditionally (Rules of Hooks); `activated` gates the fetch so an
  // un-activated Caregiver never hits the endpoints behind the empty state.
  const offered = useOfferedCategories(activated);
  const feed = useOpportunities(
    {
      category: categoryFilter === 'all' ? undefined : categoryFilter,
      schedule: scheduleFilter === 'any' ? undefined : scheduleFilter,
    },
    activated,
  );
  const apps = useMyApplications(activated);

  // Pre-activation (PRD story 83): until verification clears, a Caregiver can't
  // browse Jobs — swap the feed for the empty state naming the blocking step.
  // Gate on `loading` first so the feed never flashes during the initial fetch.
  if (activationLoading) {
    return (
      <Screen scroll edges={['top']} contentStyle={styles.content}>
        <AppBar large title="Opportunities" />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </Screen>
    );
  }
  if (!activated) {
    return <CaregiverPreActivation verification={verification} blockingStep={blockingStep} />;
  }

  const q = query.trim().toLowerCase();
  const visibleJobs = q
    ? feed.jobs.filter((j) => `${j.description} ${j.location.areaLabel ?? ''}`.toLowerCase().includes(q))
    : feed.jobs;
  const filtersActive = q.length > 0 || scheduleFilter !== 'any' || categoryFilter !== 'all';
  const showCategoryFilter = offered.length >= 2;
  const sections = groupApplications(apps.applications);

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      <AppBar large title="Opportunities" actions={[{ icon: 'sliders', label: 'Filters' }]} />

      <TabStrip tabs={TABS} value={tab} onChange={setTab} style={styles.tabStrip} />

      {tab === 'Open Jobs' ? (
        <View>
          <SearchBar
            value={query}
            onChangeText={setQuery}
            placeholder="Search open Jobs"
            onFilter={() => {}}
            style={styles.search}
          />

          {/* Schedule filter (one-off / recurring) */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipRail}
            contentContainerStyle={styles.chipRailContent}
          >
            {SCHEDULE_FILTERS.map((f) => (
              <FilterChip
                key={f.value}
                label={f.label}
                active={scheduleFilter === f.value}
                onPress={() => setScheduleFilter(f.value)}
              />
            ))}
          </ScrollView>

          {/* Category filter — only when the Caregiver offers 2+ categories (story 96) */}
          {showCategoryFilter ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.catRail}
              contentContainerStyle={styles.chipRailContent}
            >
              <FilterChip label="All" active={categoryFilter === 'all'} onPress={() => setCategoryFilter('all')} />
              {offered.map((cat) => (
                <FilterChip
                  key={cat}
                  label={categoryChip(cat)}
                  active={categoryFilter === cat}
                  onPress={() => setCategoryFilter(cat)}
                />
              ))}
            </ScrollView>
          ) : null}

          {/* Monthly quota meter (N/30) */}
          {apps.quota ? (
            <View style={styles.quota}>
              <Text style={styles.quotaText}>
                {apps.quota.used}/{apps.quota.cap} applications used this month
              </Text>
              <View style={styles.quotaTrack}>
                <View style={[styles.quotaFill, { width: `${quotaPct(apps.quota.used, apps.quota.cap)}%` }]} />
              </View>
            </View>
          ) : null}

          {/* Feed */}
          {feed.loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : feed.error ? (
            <View style={styles.centered}>
              <Text style={styles.errorText}>{feed.error}</Text>
              <Pressable onPress={feed.refetch} style={styles.retry}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : visibleJobs.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>No open Jobs</Text>
              <Text style={styles.emptySub}>
                {filtersActive ? 'Try clearing your filters.' : 'New Jobs in your categories will show up here.'}
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {visibleJobs.map((j) => (
                <OpportunityCard
                  key={j.id}
                  job={j}
                  onPress={() => router.push({ pathname: '/job-detail', params: { jobId: j.id } })}
                />
              ))}
            </View>
          )}
        </View>
      ) : apps.loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : apps.error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{apps.error}</Text>
          <Pressable onPress={apps.refetch} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : apps.applications.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No applications yet</Text>
          <Text style={styles.emptySub}>Apply to an open Job and it’ll show up here.</Text>
        </View>
      ) : (
        <View>
          {sections.map((sec) => (
            <View key={sec.title}>
              <Text style={styles.sectionHeader}>{sec.title}</Text>
              <View style={styles.list}>
                {sec.items.map((a) => (
                  <ApplicationRow
                    key={a.id}
                    app={a}
                    onPress={() => router.push({ pathname: '/job-detail', params: { jobId: a.job.id } })}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

function OpportunityCard({ job, onPress }: { job: Opportunity; onPress: () => void }) {
  const distance = distanceLabel(job.location);
  const child = childSummary(job.childCount, job.childAges);
  const budget = budgetLabel(job.budgetHintCents);

  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardTopLeft}>
          <CategoryChip category={categoryChip(job.category)} />
          {distance ? (
            <View style={styles.distance}>
              <Icon name="pin" size={13} color={colors.ink3} />
              <Text style={styles.distanceText}>{distance}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.posted}>{postedAgo(job.createdAt)}</Text>
      </View>

      <Text style={styles.title} numberOfLines={2}>
        {job.description}
      </Text>
      <Text style={styles.scope}>{jobScheduleLabel(job)}</Text>

      {child ? <Chip label={child} tone="child" icon="users" /> : null}

      {job.safetyBehaviors.length > 0 ? (
        <View style={styles.chipWrap}>
          {job.safetyBehaviors.map((b) => (
            <Chip key={b} label={behaviourLabel(b)} tone="safety" icon="shield" />
          ))}
        </View>
      ) : null}

      {budget ? (
        <Text style={styles.budget}>
          <Text style={styles.budgetHint}>Budget hint · </Text>
          {budget}
        </Text>
      ) : null}

      <View style={styles.cardFoot}>
        <Text style={styles.applied}>
          {job.applicantCount}/{JOB_APPLICATION_CAP} applied
        </Text>
        {job.myApplicationState ? (
          <StatusPill label={`You · ${applicationStatusStyle(job.myApplicationState).label}`} state={job.myApplicationState} />
        ) : (
          <View style={styles.applyInline}>
            <Text style={styles.applyText}>View</Text>
            <Icon name="arrow-right" size={14} color={colors.ink} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

function ApplicationRow({ app, onPress }: { app: MyApplication; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.appRow}>
      <View style={styles.appAvatar}>
        <Icon name="briefcase" size={18} color={colors.ink2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.appTitle} numberOfLines={1}>
          {app.job.description}
        </Text>
        <Text style={styles.appSub}>{jobScheduleLabel(app.job)}</Text>
        <View style={styles.chipWrap}>
          <Chip label={`Job · ${jobStatusStyle(app.job.state).label}`} tone="neutral" />
          <StatusPill label={`You · ${applicationStatusStyle(app.state).label}`} state={app.state} />
        </View>
      </View>
    </Pressable>
  );
}

function StatusPill({ label, state }: { label: string; state: MyApplication['state'] }) {
  const s = applicationStatusStyle(state);
  return (
    <View style={[styles.pill, { backgroundColor: s.bg }]}>
      <Text style={[styles.pillText, { color: s.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },

  centered: { paddingTop: 72, alignItems: 'center', gap: 10 },
  errorText: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, textAlign: 'center' },
  retry: { marginTop: 2, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  retryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, textAlign: 'center', maxWidth: 260 },

  tabStrip: { marginTop: 14 },
  search: { marginTop: 16, backgroundColor: colors.surface },
  chipRail: { marginHorizontal: -24, marginTop: 14 },
  catRail: { marginHorizontal: -24, marginTop: 8 },
  chipRailContent: { paddingHorizontal: 24, gap: 8 },

  quota: { marginTop: 16 },
  quotaText: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  quotaTrack: { height: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, marginTop: 6, overflow: 'hidden' },
  quotaFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.highlight },

  list: { marginTop: 16, gap: 12 },

  sectionHeader: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginTop: 20 },

  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTopLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  distance: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
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

  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  pillText: { fontFamily: fonts.semibold, fontSize: 11 },

  appRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 14, ...shadow.e1 },
  appAvatar: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.monoGray, alignItems: 'center', justifyContent: 'center' },
  appTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  appSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2, marginBottom: 8 },
});
