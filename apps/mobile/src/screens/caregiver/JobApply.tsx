/**
 * Job apply (Caregiver, OH-219) — file an Application on an open Job: a free-text
 * proposal + a first Offer (the proposed hourly rate). Wired to live data
 * (GET /v1/opportunities/{jobId} for the recap; POST …/apply to file). The rate is
 * optional — left blank it defaults to the Caregiver's published per-category Rate,
 * and it locks to that Rate server-side when the Caregiver is non-negotiable
 * (ADR-0017). Numbers/emails in the proposal are redacted before the Parent sees
 * them. Reached from /job-detail with a `jobId` route param.
 *
 * This is the native (and narrow-web) body; the desktop layout lives in
 * `@/screens/web/cp/JobApply` and is chosen by `job-apply.web.tsx`.
 */
import { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { applyToJob } from '@/api/client';
import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { categoryChip, jobScheduleLabel } from '@/lib/jobsHub';
import {
  applyErrorMessage,
  budgetLabel,
  childSummary,
  opportunityHours,
  useOpportunityDetail,
} from '@/lib/opportunities';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const PROPOSAL_MAX = 2000;
/** The per-Job Application cap (ADR-0006 §7) — Apply is disabled once a Job is full. */
const JOB_APPLICATION_CAP = 15;

export default function JobApplyScreen() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const { job, loading, error, notFound, refetch } = useOpportunityDetail(jobId ?? null);

  const [rate, setRate] = useState('');
  const [proposal, setProposal] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hours = useMemo(() => (job ? opportunityHours(job) : 0), [job]);
  const rateNum = Number(rate);
  const rateValid = rate.length > 0 && !Number.isNaN(rateNum) && rateNum > 0;
  const estTotal = rateValid && hours > 0 ? Math.round(rateNum * hours) : null;

  if (loading) {
    return (
      <Screen edges={['top']}>
        <AppBar onBack={() => router.back()} title="Apply" />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </Screen>
    );
  }

  if (notFound || error || !job) {
    return (
      <Screen edges={['top']}>
        <AppBar onBack={() => router.back()} title="Apply" />
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
        </View>
      </Screen>
    );
  }

  const alreadyApplied = job.myApplicationState != null;
  const jobFull = job.applicantCount >= JOB_APPLICATION_CAP && !alreadyApplied;
  const blocked = alreadyApplied || jobFull;
  const canSubmit = proposal.trim().length > 0 && !submitting && !blocked;
  const child = childSummary(job.childCount, job.childAges);
  const budget = budgetLabel(job.budgetHintCents);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const cents = rateValid ? Math.round(rateNum * 100) : undefined;
      await applyToJob(job.id, {
        proposal: proposal.trim(),
        ...(cents != null ? { proposedRateCents: cents } : {}),
      });
      router.replace('/opportunities');
    } catch (e) {
      setSubmitError(applyErrorMessage(e));
      setSubmitting(false);
    }
  };

  return (
    <Screen edges={['top']}>
      <AppBar onBack={() => router.back()} title="Apply" />

      <ScrollView
        style={styles.bodyWrap}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Job recap */}
        <View style={styles.recap}>
          <CategoryChip category={categoryChip(job.category)} />
          <Text style={styles.recapTitle}>{job.description}</Text>
          <View style={styles.recapMetaRow}>
            <Icon name="clock" size={14} color={colors.ink3} />
            <Text style={styles.recapMeta}>{jobScheduleLabel(job)}</Text>
          </View>
          {child ? <Text style={styles.recapBudget}>{child}</Text> : null}
          {budget ? <Text style={styles.recapBudget}>Budget hint · {budget}</Text> : null}
        </View>

        {/* Blocked banners (already applied / Job full) */}
        {alreadyApplied ? (
          <View style={styles.notice}>
            <Icon name="check-circle" size={16} color={colors.ink2} />
            <Text style={styles.noticeText}>You’ve already applied to this Job.</Text>
          </View>
        ) : jobFull ? (
          <View style={styles.notice}>
            <Icon name="info" size={16} color={colors.ink2} />
            <Text style={styles.noticeText}>This Job has reached its {JOB_APPLICATION_CAP}-application limit.</Text>
          </View>
        ) : null}

        {/* Your rate */}
        <Text style={styles.sectionLabel}>Your rate</Text>
        <View style={styles.rateField}>
          <Text style={styles.rateCurrency}>$</Text>
          <TextInput
            value={rate}
            onChangeText={(v) => setRate(v.replace(/[^\d.]/g, '').slice(0, 6))}
            keyboardType="decimal-pad"
            placeholder="Published rate"
            placeholderTextColor={colors.ink3}
            style={styles.rateInput}
            editable={!blocked}
            accessibilityLabel="Hourly rate"
          />
          <Text style={styles.rateUnit}>/hr</Text>
        </View>
        <Text style={styles.rateHint}>
          Leave blank to use your published rate. If you’ve turned negotiation off, your published rate applies.
        </Text>

        {/* Proposal */}
        <View style={styles.msgHead}>
          <Text style={styles.sectionLabel}>Message to the Parent</Text>
          <Text style={styles.counter}>
            {proposal.length}/{PROPOSAL_MAX}
          </Text>
        </View>
        <TextInput
          value={proposal}
          onChangeText={(v) => setProposal(v.slice(0, PROPOSAL_MAX))}
          placeholder="Introduce yourself and why you’re a fit. Numbers and emails are hidden from the Parent."
          placeholderTextColor={colors.ink3}
          style={styles.msgInput}
          editable={!blocked}
          multiline
          textAlignVertical="top"
        />

        <Text style={styles.credHint}>
          Your approved credentials and background-check status are shared with the Parent when you apply.
        </Text>

        {submitError ? (
          <View style={styles.errorBanner}>
            <Icon name="info" size={16} color={colors.danger} />
            <Text style={styles.errorBannerText}>{submitError}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky Submit CTA */}
      <View style={styles.footer}>
        <View style={styles.footerSummary}>
          <Text style={styles.footerLabel}>{estTotal != null ? 'Est. / session' : 'Your rate'}</Text>
          <Text style={styles.footerValue}>{estTotal != null ? `$${estTotal}` : rateValid ? `$${rate}/hr` : '—'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <PrimaryButton
            icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
            onPress={submit}
            loading={submitting}
            disabled={!canSubmit}
          >
            {alreadyApplied ? 'Already applied' : jobFull ? 'Applications full' : 'Submit application'}
          </PrimaryButton>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bodyWrap: { flex: 1, marginHorizontal: -24 },
  body: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, textAlign: 'center' },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2, textAlign: 'center', maxWidth: 280 },
  retry: { marginTop: 4, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  retryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  recap: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1, gap: 8 },
  recapTitle: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21, color: colors.ink },
  recapMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recapMeta: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  recapBudget: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },

  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, padding: 12, borderRadius: radii.lg, backgroundColor: colors.surfaceAlt },
  noticeText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },

  sectionLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginTop: 24, marginBottom: 10 },

  rateField: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 56, paddingHorizontal: 18, borderRadius: radii.lg, backgroundColor: colors.surfaceAlt },
  rateCurrency: { fontFamily: fonts.bold, fontSize: 20, color: colors.ink2 },
  rateInput: { flex: 1, fontFamily: fonts.bold, fontSize: 22, color: colors.ink, padding: 0, fontVariant: ['tabular-nums'] },
  rateUnit: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
  rateHint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 8 },

  msgHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  counter: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3, marginBottom: 10 },
  msgInput: { minHeight: 110, borderRadius: radii.lg, backgroundColor: colors.surfaceAlt, padding: 14, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.ink },

  credHint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 16 },

  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, padding: 12, borderRadius: radii.lg, backgroundColor: colors.surfaceAlt },
  errorBannerText: { flex: 1, fontFamily: fonts.semibold, fontSize: 13, color: colors.danger },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: -24,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 16,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    ...shadow.e2,
  },
  footerSummary: { minWidth: 80 },
  footerLabel: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink2 },
  footerValue: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, marginTop: 2, fontVariant: ['tabular-nums'] },
});
