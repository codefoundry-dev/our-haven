/**
 * Job detail (Caregiver view, OH-218) — one open Job a Caregiver can apply to,
 * wired to live data (GET /v1/opportunities/{jobId}). Info banner (category,
 * applicant capacity, approximate distance, my application state), concrete
 * schedule, budget hint, disclosed child bundle + Safety Behaviors, and a sticky
 * Apply CTA → /job-apply (the composer, OH-219). Reached from the Opportunities
 * feed / My Applications with a `jobId` route param. The exact street address is
 * never shown here (reveal-at-accept).
 *
 * This is the native (and narrow-web) body; the desktop layout lives in
 * `@/screens/web/cp/JobDetail` and is chosen by `job-detail.web.tsx`.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { Chip } from '@/components/ui/Chip';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { applicationStatusStyle, categoryChip, jobScheduleLabel } from '@/lib/jobsHub';
import { budgetLabel, childSummary, distanceLabel, postedAgo, useOpportunityDetail } from '@/lib/opportunities';
import { behaviourLabel } from '@/lib/supply-profile';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export default function JobDetailScreen() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const { job, loading, error, notFound, refetch } = useOpportunityDetail(jobId ?? null);

  if (loading) {
    return (
      <Screen edges={['top']}>
        <AppBar onBack={() => router.back()} title="Job detail" />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </Screen>
    );
  }

  if (notFound || error || !job) {
    return (
      <Screen edges={['top']}>
        <AppBar onBack={() => router.back()} title="Job detail" />
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>{notFound ? 'Job not available' : 'Couldn’t load this Job'}</Text>
          <Text style={styles.emptySub}>
            {notFound ? 'This Job may have been closed or is no longer open.' : (error ?? 'Please try again.')}
          </Text>
          {notFound ? null : (
            <Pressable onPress={refetch} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          )}
          <Pressable onPress={() => router.back()} style={styles.ghostPill}>
            <Text style={styles.retryText}>Back</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const distance = distanceLabel(job.location);
  const child = childSummary(job.childCount, job.childAges);
  const budget = budgetLabel(job.budgetHintCents);
  const applied = job.myApplicationState;

  return (
    <Screen edges={['top']}>
      <AppBar onBack={() => router.back()} title="Job detail" actions={[{ icon: 'bookmark', label: 'Save' }]} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Info banner */}
        <View style={styles.banner}>
          <View style={styles.bannerTop}>
            <CategoryChip category={categoryChip(job.category)} />
            <Chip label={`${job.applicantCount}/15 applied`} tone="info" />
          </View>
          <Text style={styles.title}>{job.description}</Text>
          {distance ? (
            <View style={styles.metaRow}>
              <Icon name="pin" size={14} color={colors.ink3} />
              <Text style={styles.metaText}>{distance}</Text>
            </View>
          ) : null}
          {applied ? (
            <View style={styles.metaRow}>
              <Chip label={`You · ${applicationStatusStyle(applied).label}`} tone="info" />
            </View>
          ) : null}
        </View>

        {/* Schedule */}
        <Text style={styles.sectionLabel}>Schedule</Text>
        <View style={styles.card}>
          <Text style={styles.scheduleText}>{jobScheduleLabel(job)}</Text>
        </View>

        {/* Pay */}
        {budget ? (
          <>
            <Text style={styles.sectionLabel}>Pay</Text>
            <View style={styles.payCard}>
              <Text style={styles.payHint}>Budget hint</Text>
              <Text style={styles.payAmount}>{budget}</Text>
            </View>
          </>
        ) : null}

        {/* Child details */}
        {child ? (
          <>
            <Text style={styles.sectionLabel}>Child</Text>
            <Chip label={child} tone="child" icon="users" />
          </>
        ) : null}

        {/* Disclosed Safety Behaviors */}
        {job.safetyBehaviors.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>Disclosed Safety Behaviors</Text>
            <View style={styles.chipWrap}>
              {job.safetyBehaviors.map((b) => (
                <Chip key={b} label={behaviourLabel(b)} tone="safety" icon="shield" />
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.posted}>{postedAgo(job.createdAt)}</Text>
      </ScrollView>

      {/* Sticky Apply CTA (the composer is OH-219) */}
      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          <PrimaryButton
            icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
            onPress={() => router.push({ pathname: '/job-apply', params: { jobId: job.id } })}
          >
            {applied ? 'View my application' : 'Apply to this Job'}
          </PrimaryButton>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, marginHorizontal: -24 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, textAlign: 'center' },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2, textAlign: 'center', maxWidth: 280 },
  retry: { marginTop: 4, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  retryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  ghostPill: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink },

  banner: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 20, ...shadow.e1 },
  bannerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 27, letterSpacing: -0.3, color: colors.ink, marginTop: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  metaText: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },

  sectionLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginTop: 24, marginBottom: 10 },

  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1 },
  scheduleText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.ink },

  payCard: { backgroundColor: colors.surfaceAlt, borderRadius: radii.lg, padding: 16 },
  payHint: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  payAmount: { fontFamily: fonts.bold, fontSize: 26, letterSpacing: -0.6, color: colors.ink, marginTop: 4, fontVariant: ['tabular-nums'] },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  posted: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3, marginTop: 20 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: -24,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 16,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    ...shadow.e2,
  },
});
