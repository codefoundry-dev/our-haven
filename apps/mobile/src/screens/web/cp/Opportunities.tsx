/**
 * CaregiverOpportunitiesWeb — Jobs board for caregivers (web only).
 *
 * Faithful port of the Claude Design web project (cp-web/cp-opportunities.jsx):
 * the OppTabs segmented control (Open Jobs · My Applications) with a monthly
 * application-quota meter, a filter row, and the two-column grid of Job cards;
 * plus the My Applications list. Content-only — the route dispatcher wraps this
 * in <WebShell>. React Native primitives only (renders via react-native-web).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { CategoryChip, type Category } from '@/components/ui/CategoryChip';
import { Chip } from '@/components/ui/Chip';
import { WebPageHeader } from '@/components/web/WebShell';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

type Tab = 'Open Jobs' | 'My Applications';

interface Job {
  cat: Category;
  posted: string;
  title: string;
  scope: string;
  dist: string;
  child?: string;
  behaviors?: string[];
  budget?: string;
  apps: number;
  parent: string;
  rating: string;
}

const JOBS: Job[] = [
  { cat: 'Tutor', posted: 'Posted 2h ago', title: '5th-grade math support, twice weekly after school', scope: 'Eastside · Tue & Thu afternoons · Recurring', dist: '1.8 mi away', child: '1 child · age 10', budget: '$30–40 / hr', apps: 7, parent: 'Adjei O.', rating: '4.8' },
  { cat: 'Babysitter', posted: 'Posted 5h ago', title: 'After-school sitter for two, Mon–Wed', scope: 'Brickell · 3:30–6:30pm · Recurring', dist: '3.1 mi away', child: '2 children · ages 4 & 7', behaviors: ['Food allergy · EpiPen', 'ADHD'], budget: '$28–34 / hr', apps: 3, parent: 'Priya N.', rating: '4.9' },
  { cat: 'Tutor', posted: 'Posted yesterday', title: 'Algebra 1 catch-up for incoming 8th grader', scope: 'Westside · Mon/Wed evenings · 8-week program', dist: '4.6 mi away', child: '1 child · age 13', budget: '$35–45 / hr', apps: 4, parent: 'Daniel R.', rating: '4.7' },
  { cat: 'Babysitter', posted: 'Posted 2 days ago', title: 'Weekend evening sitter, occasional', scope: 'Coral Gables · Sat evenings · As needed', dist: '6.2 mi away', child: '1 child · age 5', behaviors: ['Anxiety'], budget: '$26–32 / hr', apps: 9, parent: 'Rosa D.', rating: '4.9' },
  { cat: 'Tutor', posted: 'Posted 4 days ago', title: 'SAT prep for high-school junior, focus on math', scope: 'Coconut Grove · 2×/week · Through Oct', dist: '7.0 mi away', child: '1 child · age 16', budget: '$45–60 / hr', apps: 2, parent: 'Sarah K.', rating: '5.0' },
  { cat: 'Babysitter', posted: 'Posted 6 days ago', title: 'Morning care, camp drop-off included', scope: 'Wynwood · 8am–1pm · As needed', dist: '5.4 mi away', child: '2 children · ages 5 & 8', budget: '$28–34 / hr', apps: 5, parent: 'Marcus T.', rating: '4.6' },
];

const FILTERS = ['All categories', 'Tutor', 'Babysitter', 'Within 5 mi', 'Recurring'];

type TagKey = 'info' | 'warn' | 'good' | 'dead' | 'dang';
const TAGS: Record<TagKey, { bg: string; fg: string }> = {
  info: { bg: 'rgba(58,111,168,0.12)', fg: colors.info },
  warn: { bg: 'rgba(201,122,42,0.12)', fg: colors.warning },
  good: { bg: 'rgba(47,122,77,0.12)', fg: colors.success },
  dead: { bg: colors.surfaceAlt, fg: colors.ink2 },
  dang: { bg: 'rgba(178,58,47,0.12)', fg: colors.danger },
};

interface AppRow {
  title: string;
  parent: string;
  offer: string;
  tone: ColorToken;
  job: string;
  jobTag: TagKey;
  you: string;
  youTag: TagKey;
  attention?: boolean;
}

const APPS_THIS_WEEK: AppRow[] = [
  { title: 'Algebra 1 catch-up for incoming 8th grader', parent: 'Priya N.', offer: '76', tone: 'catTutor', job: 'Open · 7/15', jobTag: 'info', you: 'Counter sent', youTag: 'warn', attention: true },
  { title: 'Reading + writing tutoring, dyslexia-aware', parent: 'Daniel R.', offer: '60', tone: 'catTutor', job: 'Open · 11/15', jobTag: 'info', you: 'Submitted', youTag: 'info' },
  { title: '5th-grade math support, twice weekly', parent: 'Adjei O.', offer: '64', tone: 'monoGray', job: 'Open · 7/15', jobTag: 'info', you: 'Submitted', youTag: 'info' },
];

const APPS_EARLIER: AppRow[] = [
  { title: 'SAT prep, focus on math', parent: 'Sarah K.', offer: '180', tone: 'catTutor', job: 'Awarded', jobTag: 'good', you: 'Awarded', youTag: 'good' },
  { title: 'Geometry weekly tutor for 9th grader', parent: 'Marcus T.', offer: '56', tone: 'monoGray', job: 'Closed', jobTag: 'dead', you: 'Declined', youTag: 'dang' },
];

function DistanceLine({ children }: { children: string }) {
  return (
    <View style={styles.distRow}>
      <Icon name="pin" size={13} color={colors.ink2} />
      <Text style={styles.distText}>{children}</Text>
    </View>
  );
}

export function CaregiverOpportunitiesWeb() {
  const router = useRouter();
  const go = (r: string) => router.push(r as never);
  const [tab, setTab] = useState<Tab>('Open Jobs');

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
          <View style={styles.quota}>
            <Text style={styles.quotaText}>12 / 30 applications this month</Text>
            <View style={styles.quotaTrack}>
              <View style={styles.quotaFill} />
            </View>
          </View>
        </View>

        {tab === 'Open Jobs' ? (
          <>
            {/* filter row */}
            <View style={styles.filterRow}>
              {FILTERS.map((f, i) => {
                const on = i === 0;
                return (
                  <View
                    key={f}
                    style={[styles.filterChip, on ? { backgroundColor: colors.ink } : [{ backgroundColor: colors.surface }, shadow.e1]]}
                  >
                    {f === 'Within 5 mi' ? <Icon name="pin" size={13} color={on ? colors.inkInv : colors.ink2} /> : null}
                    <Text style={[styles.filterText, { color: on ? colors.inkInv : colors.ink2 }]}>{f}</Text>
                    {on ? <Icon name="chevron-down" size={14} color={colors.inkInv} /> : null}
                  </View>
                );
              })}
              <View style={styles.flex} />
              <Text style={styles.sortText}>18 open Jobs · sorted by newest</Text>
            </View>

            {/* two-column grid of Job cards */}
            <View style={styles.grid}>
              {JOBS.map((j, i) => (
                <Card key={i} radius={radii.lg} padding={20} style={styles.jobCard} onPress={() => go('/job-detail')}>
                  <View style={styles.jcTop}>
                    <View style={styles.jcTopLeft}>
                      <CategoryChip category={j.cat} />
                      <DistanceLine>{j.dist}</DistanceLine>
                    </View>
                    <Text style={styles.posted}>{j.posted}</Text>
                  </View>
                  <Text style={styles.jcTitle}>{j.title}</Text>
                  <Text style={styles.jcScope}>{j.scope}</Text>
                  {j.child || j.behaviors ? (
                    <View style={styles.jcChips}>
                      {j.child ? <Chip label={j.child} tone="child" /> : null}
                      {j.behaviors?.map((b) => <Chip key={b} label={b} tone="safety" icon="shield" />)}
                    </View>
                  ) : null}
                  <View style={styles.jcParent}>
                    <Avatar label={j.parent} size="sm" tone="monoGray" />
                    <Text style={styles.jcParentName}>{j.parent}</Text>
                    <View style={styles.jcRating}>
                      <Icon name="star" size={12} color={colors.highlight} />
                      <Text style={styles.jcRatingText}>{j.rating}</Text>
                    </View>
                  </View>
                  <View style={styles.jcDivider} />
                  <View style={styles.jcFoot}>
                    <View style={styles.flexMin}>
                      {j.budget ? (
                        <Text style={styles.jcBudget}>
                          {j.budget}
                          <Text style={styles.jcBudgetHint}> · budget hint</Text>
                        </Text>
                      ) : (
                        <Text style={styles.jcNoBudget}>No budget hint</Text>
                      )}
                      <Text style={styles.jcApps}>{j.apps}/15 applied</Text>
                    </View>
                    <Pressable onPress={() => go('/job-apply')} style={styles.applyBtn}>
                      <Text style={styles.applyText}>Apply</Text>
                      <Icon name="arrow-right" size={14} color={colors.inkInv} />
                    </Pressable>
                  </View>
                </Card>
              ))}
            </View>
          </>
        ) : (
          /* ── My Applications ──────────────────────────────────── */
          <View>
            <Text style={styles.secHead}>This week · awaiting decision</Text>
            <View style={styles.appsList}>
              {APPS_THIS_WEEK.map((a) => (
                <ApplicationRow key={a.title} a={a} onPress={() => go('/job-detail')} />
              ))}
            </View>
            <Text style={[styles.secHead, { marginTop: 26 }]}>Earlier</Text>
            <View style={styles.appsList}>
              {APPS_EARLIER.map((a) => (
                <ApplicationRow key={a.title} a={a} onPress={() => go('/job-detail')} />
              ))}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function ApplicationRow({ a, onPress }: { a: AppRow; onPress?: () => void }) {
  return (
    <Card
      radius={20}
      padding={18}
      onPress={onPress}
      style={StyleSheet.flatten([styles.appRow, { borderLeftWidth: 4, borderLeftColor: a.attention ? colors.highlight : 'transparent' }])}
    >
      <Avatar label={a.parent} size="md" tone={a.tone} />
      <View style={styles.flexMin}>
        <Text style={styles.appTitle} numberOfLines={1}>{a.title}</Text>
        <Text style={styles.appSub}>
          {a.parent} · your Offer ${a.offer}
        </Text>
      </View>
      <View style={styles.appTags}>
        <View style={[styles.tag, { backgroundColor: TAGS[a.jobTag].bg }]}>
          <Text style={[styles.tagText, { color: TAGS[a.jobTag].fg }]}>Job · {a.job}</Text>
        </View>
        <View style={[styles.tag, { backgroundColor: TAGS[a.youTag].bg }]}>
          <Text style={[styles.tagText, { color: TAGS[a.youTag].fg }]}>You · {a.you}</Text>
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

  // OppTabs row
  tabsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  segment: { flexDirection: 'row', backgroundColor: colors.surface, padding: 4, borderRadius: radii.pill, ...shadow.e1 },
  segItem: { height: 38, paddingHorizontal: 20, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  segItemOn: { backgroundColor: colors.ink },
  segText: { fontFamily: fonts.semibold, fontSize: 13.5 },
  quota: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, paddingVertical: 8, paddingHorizontal: 16, borderRadius: radii.pill, ...shadow.e1 },
  quotaText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink2 },
  quotaTrack: { width: 90, height: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  quotaFill: { width: '40%', height: '100%', borderRadius: radii.pill, backgroundColor: colors.highlight },

  // filter row
  filterRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 36, paddingHorizontal: 14, borderRadius: radii.pill },
  filterText: { fontFamily: fonts.semibold, fontSize: 13 },
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
  jcParent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  jcParentName: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2 },
  jcRating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  jcRatingText: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2 },
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
