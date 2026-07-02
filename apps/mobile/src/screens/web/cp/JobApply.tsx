/**
 * CaregiverJobApplyWeb (OH-219) — the Caregiver's apply-to-a-Job flow on desktop
 * web, wired to live data (GET /v1/opportunities/{jobId}; POST …/apply).
 *
 * Two-column desktop layout:
 *  - left  · the Job recap (category, applicant capacity, schedule, child bundle,
 *            budget hint) + the proposal composer (proposed rate + message).
 *  - right · a "Your Offer" card with the live per-session estimated total + Submit.
 *
 * The rate is optional — left blank it defaults to the Caregiver's published
 * per-category Rate, and locks to it server-side when they are non-negotiable
 * (ADR-0017). Numbers/emails in the message are redacted before the Parent sees
 * them; the Parent's identity is never shown to a Caregiver pre-award. Content-only:
 * the route dispatcher wraps this in <WebShell role="caregiver" active="opportunities">.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { applyToJob } from '@/api/client';
import { Icon } from '@/components/Icon';
import { Card } from '@/components/ui/Card';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { WebPageHeader } from '@/components/web/WebShell';
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
const JOB_APPLICATION_CAP = 15;

function money(n: number) {
  return n % 1 === 0
    ? `$${n.toLocaleString('en-US')}`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CaregiverJobApplyWeb() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const { job, loading, error, notFound } = useOpportunityDetail(jobId ?? null);

  const [rate, setRate] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const hours = useMemo(() => (job ? opportunityHours(job) : 0), [job]);
  const rateNum = parseFloat(rate) || 0;
  const rateValid = rate.length > 0 && rateNum > 0;
  const estTotal = rateValid && hours > 0 ? Math.round(rateNum * hours * 100) / 100 : null;

  if (loading || !job) {
    return (
      <View>
        <WebPageHeader greet="Opportunities · Apply" title="Apply to this Job" actions={['bell', 'message']} />
        <View style={styles.stateBox}>
          {notFound || error ? (
            <Text style={styles.stateText}>{notFound ? 'This Job is no longer available.' : (error ?? 'Couldn’t load this Job.')}</Text>
          ) : (
            <ActivityIndicator color={colors.brand} />
          )}
        </View>
      </View>
    );
  }

  const alreadyApplied = job.myApplicationState != null;
  const jobFull = job.applicantCount >= JOB_APPLICATION_CAP && !alreadyApplied;
  const blocked = alreadyApplied || jobFull;
  const canSubmit = message.trim().length > 0 && !submitting && !blocked;
  const child = childSummary(job.childCount, job.childAges);
  const budget = budgetLabel(job.budgetHintCents);

  const submit = () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    const cents = rateValid ? Math.round(rateNum * 100) : undefined;
    applyToJob(job.id, { proposal: message.trim(), ...(cents != null ? { proposedRateCents: cents } : {}) })
      .then(() => router.replace('/opportunities' as never))
      .catch((e: unknown) => {
        setSubmitError(applyErrorMessage(e));
        setSubmitting(false);
      });
  };

  return (
    <View>
      <WebPageHeader greet="Opportunities · Apply" title="Apply to this Job" actions={['bell', 'message']} />

      <View style={styles.body}>
        <View style={styles.layout}>
          {/* ── left · job recap + proposal composer ──────────────── */}
          <View style={styles.mainCol}>
            <Card radius={radii.xl} padding={24} style={styles.recap}>
              <View style={styles.recapTop}>
                <CategoryChip category={categoryChip(job.category)} />
                <Text style={styles.recapPosted}>
                  {job.applicantCount} of {JOB_APPLICATION_CAP} applied
                </Text>
              </View>
              <Text style={styles.recapTitle}>{job.description}</Text>
              <View style={styles.recapMetaRow}>
                <Icon name="clock" size={15} color={colors.ink3} />
                <Text style={styles.recapMeta}>{jobScheduleLabel(job)}</Text>
              </View>
              {child || budget ? (
                <>
                  <View style={styles.recapDivider} />
                  <View style={styles.recapFoot}>
                    {child ? <Text style={styles.recapMeta}>{child}</Text> : null}
                    <View style={styles.flex} />
                    {budget ? (
                      <Text style={styles.recapBudget}>
                        {budget}
                        <Text style={styles.recapBudgetHint}> · budget hint</Text>
                      </Text>
                    ) : null}
                  </View>
                </>
              ) : null}
            </Card>

            <Card radius={radii.xl} padding={28} style={styles.composer}>
              <Text style={styles.composerHead}>Compose your Offer</Text>
              <Text style={styles.composerSub}>
                Set the rate you&rsquo;re proposing and add a short note. Numbers and emails are hidden from the
                Parent.
              </Text>

              {alreadyApplied ? (
                <View style={styles.notice}>
                  <Icon name="check-circle" size={16} color={colors.ink2} />
                  <Text style={styles.noticeText}>You&rsquo;ve already applied to this Job.</Text>
                </View>
              ) : jobFull ? (
                <View style={styles.notice}>
                  <Icon name="info" size={16} color={colors.ink2} />
                  <Text style={styles.noticeText}>
                    This Job has reached its {JOB_APPLICATION_CAP}-application limit.
                  </Text>
                </View>
              ) : null}

              {/* Your rate */}
              <Text style={styles.fieldLabel}>Your rate</Text>
              <View style={styles.rateRow}>
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
                <View style={styles.hint}>
                  <Icon name="info" size={14} color={colors.ink2} />
                  <Text style={styles.hintText}>Leave blank to use your published rate.</Text>
                </View>
              </View>

              {/* Message */}
              <View style={styles.msgHead}>
                <Text style={[styles.fieldLabel, styles.fieldLabelInline]}>Message to the Parent</Text>
                <Text style={styles.counter}>
                  {message.length}/{PROPOSAL_MAX}
                </Text>
              </View>
              <TextInput
                value={message}
                onChangeText={(v) => setMessage(v.slice(0, PROPOSAL_MAX))}
                placeholder="Introduce yourself and why you're a fit. Numbers and emails are hidden."
                placeholderTextColor={colors.ink3}
                style={styles.msgInput}
                editable={!blocked}
                multiline
                textAlignVertical="top"
              />

              <Text style={styles.credHint}>
                Your approved credentials and background-check status are shared with the Parent when you apply.
              </Text>
            </Card>
          </View>

          {/* ── right · the Offer total card + submit ─────────────── */}
          <View style={styles.sideCol}>
            <Card radius={radii.xl} padding={22} style={styles.offerCard}>
              <Text style={styles.offerEyebrow}>Your Offer</Text>

              <Text style={styles.offerTotal}>{estTotal != null ? money(estTotal) : '—'}</Text>
              <Text style={styles.offerTotalLabel}>Estimated per session</Text>

              <View style={styles.offerGrid}>
                <OfferRow label="When" value={jobScheduleLabel(job)} />
                <OfferRow label="Rate" value={rateValid ? `${money(rateNum)} / hr` : 'Published rate'} />
                <OfferRow label="Scope" value={hours > 0 ? `${hours} h / session` : '—'} />
              </View>

              <View style={styles.offerDivider} />

              <Pressable
                onPress={submit}
                disabled={!canSubmit}
                style={[styles.submitBtn, { opacity: canSubmit ? 1 : 0.5 }]}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.inkInv} />
                ) : (
                  <>
                    <Text style={styles.submitText}>
                      {alreadyApplied ? 'Already applied' : jobFull ? 'Applications full' : 'Submit application'}
                    </Text>
                    <Icon name="arrow-right" size={18} color={colors.inkInv} />
                  </>
                )}
              </Pressable>

              {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
            </Card>

            <View style={styles.note}>
              <Icon name="lock" size={18} color={colors.brand} />
              <Text style={styles.noteText}>
                Your contact info stays hidden until the Parent awards the Job. Payment is collected through Our
                Haven once each session ends.
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function OfferRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.offerRow}>
      <Text style={styles.offerRowLabel}>{label}</Text>
      <Text style={styles.offerRowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flex: { flex: 1 },

  stateBox: { paddingHorizontal: 36, paddingTop: 80, alignItems: 'center' },
  stateText: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2 },

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  mainCol: { flexGrow: 1.6, flexBasis: 560, minWidth: 360, gap: 18 },
  sideCol: { flexGrow: 1, flexBasis: 320, minWidth: 280, gap: 16 },

  // job recap
  recap: { ...shadow.e1, gap: 12 },
  recapTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recapPosted: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },
  recapTitle: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: colors.ink },
  recapMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  recapMeta: { fontFamily: fonts.regular, fontSize: 13.5, color: colors.ink2 },
  recapDivider: { height: 1, backgroundColor: colors.hairline },
  recapFoot: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  recapBudget: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },
  recapBudgetHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },

  // composer
  composer: { ...shadow.e1 },
  composerHead: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  composerSub: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 20, color: colors.ink2, marginTop: 6, maxWidth: 540 },

  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, padding: 12, borderRadius: radii.lg, backgroundColor: colors.surfaceAlt },
  noticeText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },

  fieldLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink2,
    marginTop: 24,
    marginBottom: 10,
  },
  fieldLabelInline: { marginTop: 0, marginBottom: 0 },

  rateRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14 },
  rateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 58,
    minWidth: 200,
    paddingHorizontal: 20,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceAlt,
  },
  rateCurrency: { fontFamily: fonts.bold, fontSize: 20, color: colors.ink2 },
  rateInput: { flexGrow: 1, minWidth: 60, fontFamily: fonts.bold, fontSize: 24, color: colors.ink, padding: 0, fontVariant: ['tabular-nums'] },
  rateUnit: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  hintText: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2 },

  msgHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 },
  counter: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink3 },
  msgInput: { minHeight: 120, borderRadius: radii.lg, backgroundColor: colors.surfaceAlt, padding: 16, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.ink },

  credHint: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink2, marginTop: 16 },

  // offer card (right)
  offerCard: { ...shadow.e1, borderWidth: 1, borderColor: colors.hairline },
  offerEyebrow: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2 },
  offerTotal: { fontFamily: fonts.bold, fontSize: 40, letterSpacing: -1.2, color: colors.ink, textAlign: 'center', marginTop: 14, fontVariant: ['tabular-nums'] },
  offerTotalLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, textAlign: 'center', marginTop: 2, marginBottom: 16 },

  offerGrid: { gap: 10 },
  offerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 },
  offerRowLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  offerRowValue: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.ink, textAlign: 'right' },

  offerDivider: { height: 1, backgroundColor: colors.hairline, marginVertical: 18 },

  submitBtn: { height: 52, borderRadius: radii.pill, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
  errorText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.danger, textAlign: 'center', marginTop: 12 },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },
});
