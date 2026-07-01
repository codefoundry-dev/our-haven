/**
 * CaregiverOpportunitiesWeb — Jobs board for caregivers (web only, OH-218).
 *
 * Port of the Claude Design web project (cp-web/cp-opportunities.jsx), wired to
 * live data: the OppTabs segmented control (Open Jobs · My Applications) with the
 * monthly application-quota meter, a filter row (schedule + category, the latter
 * shown only when the Caregiver offers 2+ categories), and the two-column grid of
 * Job cards; plus the date-grouped My Applications list. Content-only — the route
 * dispatcher wraps this in <WebShell>. React Native primitives only (renders via
 * react-native-web).
 *
 * READ-ONLY (OH-218): the Apply CTA opens the composer (OH-219). The exact street
 * address is never shown (reveal-at-accept).
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { MyApplication, Opportunity, OpportunityCategory } from '@/api/client';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { CATEGORY_TONE, CategoryChip } from '@/components/ui/CategoryChip';
import { Chip } from '@/components/ui/Chip';
import { WebPageHeader } from '@/components/web/WebShell';
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
import { behaviourLabel } from '@/lib/supply-profile';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

type Tab = 'Open Jobs' | 'My Applications';

const SCHEDULE_FILTERS = [
  { value: 'any', label: 'Any schedule' },
  { value: 'one-off', label: 'One-off' },
  { value: 'recurring', label: 'Recurring' },
] as const;

const JOB_APPLICATION_CAP = 15;

function quotaPct(used: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((used / cap) * 100));
}

function WebFilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.filterChip, active ? { backgroundColor: colors.ink } : [{ backgroundColor: colors.surface }, shadow.e1]]}
    >
      <Text style={[styles.filterText, { color: active ? colors.inkInv : colors.ink2 }]}>{label}</Text>
    </Pressable>
  );
}

export function CaregiverOpportunitiesWeb() {
  const router = useRouter();
  const openDetail = (id: string) => router.push({ pathname: '/job-detail', params: { jobId: id } });
  const openApply = (id: string) => router.push({ pathname: '/job-apply', params: { jobId: id } });

  const [tab, setTab] = useState<Tab>('Open Jobs');
  const [scheduleFilter, setScheduleFilter] = useState<'any' | 'one-off' | 'recurring'>('any');
  const [categoryFilter, setCategoryFilter] = useState<'all' | OpportunityCategory>('all');

  const offered = useOfferedCategories();
  const feed = useOpportunities({
    category: categoryFilter === 'all' ? undefined : categoryFilter,
    schedule: scheduleFilter === 'any' ? undefined : scheduleFilter,
  });
  const apps = useMyApplications();
  const showCategoryFilter = offered.length >= 2;
  const sections = groupApplications(apps.applications);

  return (
    <View>
      <WebPageHeader greet="Opportunities" title="Open Jobs near you" actions={['bell', 'message']} />

      <View style={styles.body}>
        {/* ── OppTabs + monthly application quota ───────────────── */}
        <View style={styles.tabsRow}>
          <View style={styles.segment}>
            {(['Open Jobs', 'My Applications'] as Tab[]).map((t) => {
              const on = t === tab;
              return (
                <Pressable key={t} onPress={() => setTab(t)} style={[styles.segItem, on ? styles.segItemOn : null]}>
                  <Text style={[styles.segText, { color: on ? colors.inkInv : colors.ink2 }]}>{t}</Text>
                </Pressable>
              );
            })}
          </View>
          {apps.quota ? (
            <View style={styles.quota}>
              <Text style={styles.quotaText}>
                {apps.quota.used} / {apps.quota.cap} applications this month
              </Text>
              <View style={styles.quotaTrack}>
                <View style={[styles.quotaFill, { width: `${quotaPct(apps.quota.used, apps.quota.cap)}%` }]} />
              </View>
            </View>
          ) : null}
        </View>

        {tab === 'Open Jobs' ? (
          <>
            {/* filter row */}
            <View style={styles.filterRow}>
              {SCHEDULE_FILTERS.map((f) => (
                <WebFilterChip
                  key={f.value}
                  label={f.label}
                  active={scheduleFilter === f.value}
                  onPress={() => setScheduleFilter(f.value)}
                />
              ))}
              {showCategoryFilter ? (
                <>
                  <View style={styles.filterDivider} />
                  <WebFilterChip label="All categories" active={categoryFilter === 'all'} onPress={() => setCategoryFilter('all')} />
                  {offered.map((cat) => (
                    <WebFilterChip
                      key={cat}
                      label={categoryChip(cat)}
                      active={categoryFilter === cat}
                      onPress={() => setCategoryFilter(cat)}
                    />
                  ))}
                </>
              ) : null}
              <View style={styles.flex} />
              {!feed.loading && !feed.error ? (
                <Text style={styles.sortText}>
                  {feed.jobs.length} open {feed.jobs.length === 1 ? 'Job' : 'Jobs'} · sorted by best match
                </Text>
              ) : null}
            </View>

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
            ) : feed.jobs.length === 0 ? (
              <View style={styles.centered}>
                <Text style={styles.emptyTitle}>No open Jobs</Text>
                <Text style={styles.emptySub}>
                  {scheduleFilter !== 'any' || categoryFilter !== 'all'
                    ? 'Try clearing your filters.'
                    : 'New Jobs in your categories will show up here.'}
                </Text>
              </View>
            ) : (
              <View style={styles.grid}>
                {feed.jobs.map((j) => (
                  <JobCardWeb key={j.id} job={j} onOpen={() => openDetail(j.id)} onApply={() => openApply(j.id)} />
                ))}
              </View>
            )}
          </>
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
            {sections.map((sec, si) => (
              <View key={sec.title}>
                <Text style={[styles.secHead, si > 0 ? { marginTop: 26 } : null]}>{sec.title}</Text>
                <View style={styles.appsList}>
                  {sec.items.map((a) => (
                    <ApplicationRow key={a.id} app={a} onPress={() => openDetail(a.job.id)} />
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function JobCardWeb({ job, onOpen, onApply }: { job: Opportunity; onOpen: () => void; onApply: () => void }) {
  const distance = distanceLabel(job.location);
  const child = childSummary(job.childCount, job.childAges);
  const budget = budgetLabel(job.budgetHintCents);
  const applied = job.myApplicationState;

  return (
    <Card radius={radii.lg} padding={20} style={styles.jobCard} onPress={onOpen}>
      <View style={styles.jcTop}>
        <View style={styles.jcTopLeft}>
          <CategoryChip category={categoryChip(job.category)} />
          {distance ? (
            <View style={styles.distRow}>
              <Icon name="pin" size={13} color={colors.ink2} />
              <Text style={styles.distText}>{distance}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.posted}>{postedAgo(job.createdAt)}</Text>
      </View>
      <Text style={styles.jcTitle} numberOfLines={2}>
        {job.description}
      </Text>
      <Text style={styles.jcScope}>{jobScheduleLabel(job)}</Text>
      {child || job.safetyBehaviors.length > 0 ? (
        <View style={styles.jcChips}>
          {child ? <Chip label={child} tone="child" /> : null}
          {job.safetyBehaviors.map((b) => (
            <Chip key={b} label={behaviourLabel(b)} tone="safety" icon="shield" />
          ))}
        </View>
      ) : null}
      <View style={styles.jcDivider} />
      <View style={styles.jcFoot}>
        <View style={styles.flexMin}>
          {budget ? (
            <Text style={styles.jcBudget}>
              {budget}
              <Text style={styles.jcBudgetHint}> · budget hint</Text>
            </Text>
          ) : (
            <Text style={styles.jcNoBudget}>No budget hint</Text>
          )}
          <Text style={styles.jcApps}>
            {job.applicantCount}/{JOB_APPLICATION_CAP} applied
          </Text>
        </View>
        {applied ? (
          <View style={[styles.tag, { backgroundColor: applicationStatusStyle(applied).bg }]}>
            <Text style={[styles.tagText, { color: applicationStatusStyle(applied).fg }]}>
              {applicationStatusStyle(applied).label}
            </Text>
          </View>
        ) : (
          <Pressable onPress={onApply} style={styles.applyBtn}>
            <Text style={styles.applyText}>Apply</Text>
            <Icon name="arrow-right" size={14} color={colors.inkInv} />
          </Pressable>
        )}
      </View>
    </Card>
  );
}

function ApplicationRow({ app, onPress }: { app: MyApplication; onPress: () => void }) {
  const jobStyle = jobStatusStyle(app.job.state);
  const youStyle = applicationStatusStyle(app.state);
  return (
    <Card radius={20} padding={18} onPress={onPress} style={styles.appRow}>
      <Avatar label={categoryChip(app.job.category)} size="md" tone={CATEGORY_TONE[categoryChip(app.job.category)]} />
      <View style={styles.flexMin}>
        <Text style={styles.appTitle} numberOfLines={1}>
          {app.job.description}
        </Text>
        <Text style={styles.appSub}>{jobScheduleLabel(app.job)}</Text>
      </View>
      <View style={styles.appTags}>
        <View style={[styles.tag, { backgroundColor: jobStyle.bg }]}>
          <Text style={[styles.tagText, { color: jobStyle.fg }]}>Job · {jobStyle.label}</Text>
        </View>
        <View style={[styles.tag, { backgroundColor: youStyle.bg }]}>
          <Text style={[styles.tagText, { color: youStyle.fg }]}>You · {youStyle.label}</Text>
        </View>
      </View>
      <View style={styles.appChevron}>
        <Icon name="chevron-right" size={18} color={colors.ink2} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flex: { flex: 1 },
  flexMin: { flex: 1, minWidth: 0 },

  centered: { paddingTop: 72, alignItems: 'center', gap: 10 },
  errorText: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, textAlign: 'center' },
  retry: { marginTop: 2, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  retryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, textAlign: 'center', maxWidth: 300 },

  // OppTabs row
  tabsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  segment: { flexDirection: 'row', backgroundColor: colors.surface, padding: 4, borderRadius: radii.pill, ...shadow.e1 },
  segItem: { height: 38, paddingHorizontal: 20, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  segItemOn: { backgroundColor: colors.ink },
  segText: { fontFamily: fonts.semibold, fontSize: 13.5 },
  quota: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, paddingVertical: 8, paddingHorizontal: 16, borderRadius: radii.pill, ...shadow.e1 },
  quotaText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink2 },
  quotaTrack: { width: 90, height: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  quotaFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.highlight },

  // filter row
  filterRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 36, paddingHorizontal: 14, borderRadius: radii.pill },
  filterText: { fontFamily: fonts.semibold, fontSize: 13 },
  filterDivider: { width: 1, height: 22, backgroundColor: colors.hairline, marginHorizontal: 2 },
  sortText: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },

  // grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  jobCard: { flexGrow: 1, flexBasis: '46%', minWidth: 300, gap: 12 },
  jcTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jcTopLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  posted: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink3, letterSpacing: 0.3 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distText: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2 },
  jcTitle: { fontFamily: fonts.bold, fontSize: 16.5, lineHeight: 22, letterSpacing: -0.2, color: colors.ink },
  jcScope: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },
  jcChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  jcDivider: { height: 1, backgroundColor: colors.hairline },
  jcFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  jcBudget: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },
  jcBudgetHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },
  jcNoBudget: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink3 },
  jcApps: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink3, marginTop: 2 },
  applyBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 40, paddingHorizontal: 18, borderRadius: radii.pill, backgroundColor: colors.brand },
  applyText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.inkInv },

  // My Applications
  secHead: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink2, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 12 },
  appsList: { gap: 12 },
  appRow: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  appTitle: { fontFamily: fonts.semibold, fontSize: 15.5, color: colors.ink },
  appSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 2 },
  appTags: { flexDirection: 'row', gap: 8 },
  tag: { height: 26, paddingHorizontal: 12, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  tagText: { fontFamily: fonts.semibold, fontSize: 12 },
  appChevron: { width: 40, height: 40, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
});
