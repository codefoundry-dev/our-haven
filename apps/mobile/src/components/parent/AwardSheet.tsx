/**
 * AwardSheet (OH-210 / OH-211) — the Award confirmation step (PRD story 90).
 * Awarding a Job to a Caregiver reviews the standing Offer + the child detail /
 * address the Parent set at compose (v1.6 moved child capture off Award) and
 * creates the Booking `requested` (or a Booking Series for a recurring Job) —
 * auto-declining the other Applications.
 *
 * Payment (OH-211): the card is the Parent's saved subscription card, resolved
 * server-side. A near-term one-off is **authorized** at Award; if Stripe raises an
 * opportunistic 3DS challenge (`requires_action`), the client completes it via the
 * Stripe SDK before surfacing success. Series / far-future occurrences are
 * authorized ~48h before each session (no hold placed now).
 *
 * Shared by the native applicant-review screen + the web two-pane (RN Modal works
 * on RN-web). `onAwarded` fires with the created Booking id(s) so the caller can
 * refetch + surface the success.
 */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { ApiError, awardApplication, type AwardResult, type JobApplication, type MyJob } from '@/api/client';
import { formatMoney } from '@/lib/offerCopy';
import { jobScheduleLabel } from '@/lib/jobsHub';
import { usePaymentAuthenticator } from '@/lib/stripeClient';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export interface AwardSheetProps {
  visible: boolean;
  job: MyJob | null;
  application: JobApplication | null;
  onClose: () => void;
  onAwarded: (result: AwardResult) => void;
}

export function AwardSheet({ visible, job, application, onClose, onAwarded }: AwardSheetProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { authenticate } = usePaymentAuthenticator();

  const offer = application?.offer ?? null;
  const caregiverName = application?.caregiver.name ?? 'this caregiver';
  const recurring = job?.scheduleKind === 'recurring';
  const childAges = job?.childAges ?? [];
  const childLine =
    job && job.childCount != null
      ? `${job.childCount} ${job.childCount === 1 ? 'child' : 'children'}${childAges.length ? ` · ages ${childAges.join(', ')}` : ''}`
      : null;
  const addressLine = job?.serviceAddress
    ? [job.serviceAddress.line1, job.serviceAddress.city, job.serviceAddress.state]
        .filter(Boolean)
        .join(', ')
    : null;

  const submit = async () => {
    if (!application || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await awardApplication(application.id);
      // Opportunistic 3DS (story 33): complete any authorization that needs a
      // step-up before surfacing success. The Booking(s) already exist; a failed
      // challenge leaves them `requested` with the hold pending (retryable).
      const needsAction = result.payments.filter(
        (p) => p.status === 'requires_action' && p.clientSecret,
      );
      for (const p of needsAction) {
        const auth = await authenticate(p.clientSecret as string);
        if (!auth.ok) {
          setError(auth.error ?? 'We couldn’t confirm your card. Please try again.');
          setSubmitting(false);
          return;
        }
      }
      onAwarded(result);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === 'caregiver_payout_unavailable') {
        setError('This caregiver hasn’t finished setting up payouts yet, so they can’t be awarded.');
      } else if (e instanceof ApiError && e.status === 409 && e.code === 'payment_method_required') {
        setError('Add a payment method to your account before awarding a Job.');
      } else if (e instanceof ApiError && e.status === 409) {
        setError('This Job can no longer be awarded — it may already be awarded or closed.');
      } else if (e instanceof ApiError && e.status === 402) {
        setError(
          e.code === 'payment_failed'
            ? 'Your card was declined. Update your payment method and try again.'
            : 'An active membership is required to award a Job.',
        );
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not complete the award.');
      }
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.sheet}>
        <View style={styles.handleRow}>
          <Text style={styles.heading}>Award this Job</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close} hitSlop={8}>
            <Icon name="x" size={20} color={colors.ink2} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.lead}>
            You&apos;re awarding this Job to <Text style={styles.strong}>{caregiverName}</Text>. They&apos;ll have
            24 hours to confirm{recurring ? ' — every session in the series is created up front' : ''}.
          </Text>

          {/* Standing offer total */}
          {offer ? (
            <View style={styles.totalCard}>
              <View>
                <Text style={styles.totalLabel}>Agreed total{recurring ? ' · per session' : ''}</Text>
                <Text style={styles.totalSub}>
                  {formatMoney(offer.proposedRateCents)}/hr · {Math.round((offer.scopeMinutes / 60) * 10) / 10}h
                </Text>
              </View>
              <Text style={styles.totalValue}>{formatMoney(offer.computedTotalCents)}</Text>
            </View>
          ) : null}

          {/* Review — carried from the Job (set at compose) */}
          <Text style={styles.sectionLabel}>Booking details</Text>
          <View style={styles.reviewCard}>
            {job ? (
              <ReviewRow icon="calendar" text={jobScheduleLabel(job)} />
            ) : null}
            {childLine ? <ReviewRow icon="users" text={childLine} /> : null}
            {addressLine ? <ReviewRow icon="pin" text={addressLine} /> : null}
          </View>

          {/* Payment — the saved subscription card is authorized (held), not charged */}
          <Text style={styles.sectionLabel}>Payment method</Text>
          <View style={styles.payRow}>
            <View style={styles.payIcon}>
              <Icon name="dollar" size={16} color={colors.ink} />
            </View>
            <View style={styles.flexMin}>
              <Text style={styles.payName}>Your card on file</Text>
              <Text style={styles.payNote}>
                {recurring
                  ? 'Each session is authorized shortly before it starts, and charged only after it completes.'
                  : 'We place a hold now and only charge after the session completes.'}
              </Text>
            </View>
            <Icon name="check-circle" size={20} color={colors.success} />
          </View>

          {error ? <Text style={styles.err}>{error}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={submitting || !application}
            style={[styles.submit, (submitting || !application) && styles.submitDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.inkInv} />
            ) : (
              <Text style={styles.submitText}>Confirm &amp; award</Text>
            )}
          </Pressable>
          <Text style={styles.finePrint}>Awarding declines the other applicants on this Job.</Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function ReviewRow({ icon, text }: { icon: 'calendar' | 'users' | 'pin'; text: string }) {
  return (
    <View style={styles.reviewRow}>
      <Icon name={icon} size={16} color={colors.ink2} />
      <Text style={styles.reviewText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.canvas },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  heading: { flex: 1, fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  close: { padding: 4 },
  body: { padding: 20, gap: 12, paddingBottom: 40 },
  flexMin: { flex: 1, minWidth: 0 },
  lead: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2 },
  strong: { fontFamily: fonts.semibold, color: colors.ink },

  totalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 16,
    ...shadow.e1,
  },
  totalLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  totalSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },
  totalValue: { fontFamily: fonts.bold, fontSize: 24, color: colors.brand, fontVariant: ['tabular-nums'] },

  sectionLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.ink2,
    marginTop: 6,
  },
  reviewCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 14, gap: 12, ...shadow.e1 },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewText: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 14, color: colors.ink },

  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 14,
    ...shadow.e1,
  },
  payIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  payNote: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, color: colors.ink2, marginTop: 2 },

  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, textAlign: 'center' },
  submit: {
    backgroundColor: colors.brand,
    borderRadius: radii.lg,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
    ...shadow.e1,
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
  finePrint: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink3, textAlign: 'center' },
});
