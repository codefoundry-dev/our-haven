/**
 * ParentPaywallWeb — the Parent subscription gate / checkout on desktop web (OH-204).
 * Content-only: the dispatcher wraps this in <ParentWebShell>.
 *
 * Two-column desktop layout — left is the value prop (hero, trust stats,
 * what's-included); right is the checkout card with a price summary, the three
 * steps, the inline phone-verify step, and the Start-subscription CTA. The flow
 * logic (intent resolve, phone, checkout, status-poll, resume) is shared with the
 * native paywall via `usePaywallFlow`; on web checkout opens in a new tab and this
 * tab polls until `entitled`, then resumes the originally-attempted action.
 */
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { WebPageHeader } from '@/components/web/ParentWebShell';
import { Icon } from '@/components/Icon';
import { PhoneOtp } from '@/components/PhoneOtp';
import { PricingSummary } from '@/components/ui/PricingSummary';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { usePaywallFlow } from '@/lib/usePaywallFlow';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const STATS: { n: string; l: string }[] = [
  { n: '300+', l: 'Vetted Providers across all four categories' },
  { n: 'Checkr', l: 'Criminal + sex-offender + SSN screening' },
  { n: 'E2E', l: 'Encrypted, monitored messaging' },
];

const INCLUDED: string[] = [
  'Message and book any Caregiver or licensed Provider',
  'Post unlimited Jobs and receive applications',
  'Recurring Booking Series with per-session pricing',
  'Trust & Safety dispute resolution and refunds',
  'Tax-credit-friendly receipts for eligible care',
];

type StepState = 'active' | 'pending' | 'done';

export function ParentPaywallWeb() {
  const { i } = useLocalSearchParams<{ i?: string }>();
  const flow = usePaywallFlow(i);

  if (flow.manageMode) {
    return (
      <View>
        <WebPageHeader greet="Membership" title="You're subscribed" actions={['help']} />
        <View style={styles.body}>
          <View style={styles.manageCard}>
            <View style={styles.checkIcon}>
              <Icon name="check" size={16} color={colors.success} />
            </View>
            <Text style={styles.manageTitle}>Your membership is active</Text>
            <Text style={styles.manageSub}>
              You can message, book, post Jobs, and book consultations across the full marketplace.
            </Text>
            {flow.error ? <Text style={styles.error}>{flow.error}</Text> : null}
            <PrimaryButton onPress={flow.openPortal} loading={flow.busy} style={styles.manageCta}>
              Manage subscription
            </PrimaryButton>
            <Pressable onPress={flow.dismiss} style={styles.tertiary}>
              <Text style={styles.tertiaryText}>Back</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  const steps: { title: string; sub: string; state: StepState }[] = [
    {
      title: 'Verify your phone',
      sub: flow.phoneSkipped
        ? 'Skipped — add it later from Account.'
        : 'For cancellation SMS and new-device sign-in checks.',
      state: flow.phoneVerified || flow.phoneSkipped ? 'done' : 'active',
    },
    { title: 'Add a payment method', sub: 'Used for future Bookings only.', state: flow.readyForCheckout ? 'active' : 'pending' },
    { title: 'Start your subscription', sub: 'Stripe-hosted checkout in a secure window.', state: flow.readyForCheckout ? 'active' : 'pending' },
  ];

  return (
    <View>
      <WebPageHeader greet="Membership" title="Unlock the marketplace" actions={['help']} />

      <View style={styles.body}>
        <View style={styles.columns}>
          {/* ── left: value prop ─────────────────────────── */}
          <View style={styles.main}>
            <View style={styles.hero}>
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeText}>Subscription · $14.99/mo</Text>
              </View>
              <Text style={styles.heroTitle}>One membership. The whole network.</Text>
              <Text style={styles.heroSub}>
                Start your subscription and verify your phone in one step. Cancel anytime — Bookings are billed separately,
                only when you book.
              </Text>
            </View>

            <View style={styles.statRow}>
              {STATS.map((s) => (
                <View key={s.n} style={styles.stat}>
                  <Text style={styles.statN}>{s.n}</Text>
                  <Text style={styles.statL}>{s.l}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.sectionLabel}>What's included</Text>
            <View style={styles.includedCard}>
              {INCLUDED.map((f) => (
                <View key={f} style={styles.includedRow}>
                  <View style={styles.checkIcon}>
                    <Icon name="check" size={14} color={colors.success} />
                  </View>
                  <Text style={styles.includedText}>{f}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── right: checkout ──────────────────────────── */}
          <View style={styles.aside}>
            <View style={styles.checkout}>
              <Text style={styles.planLabel}>Our Haven membership</Text>
              <Text style={styles.planPrice}>
                $14.99
                <Text style={styles.planPer}> /month</Text>
              </Text>

              <View style={styles.summaryCard}>
                <PricingSummary
                  lines={[
                    { label: 'Monthly subscription', value: '$14.99' },
                    { label: 'Est. tax', value: '$1.31', helper: 'Beverly Hills, CA', muted: true },
                  ]}
                  total={{ label: 'Due today', value: '$16.30' }}
                />
              </View>

              <Text style={styles.stepsLabel}>Three quick steps</Text>
              <View style={styles.steps}>
                {steps.map((s, idx) => {
                  const active = s.state === 'active';
                  const done = s.state === 'done';
                  return (
                    <View key={s.title} style={styles.step}>
                      <View
                        style={[
                          styles.stepNum,
                          active && styles.stepNumActive,
                          done && styles.stepNumDone,
                          s.state === 'pending' && styles.stepNumPending,
                        ]}
                      >
                        {done ? (
                          <Icon name="check" size={14} color={colors.inkInv} />
                        ) : (
                          <Text style={[styles.stepNumText, active && { color: colors.brand }]}>{idx + 1}</Text>
                        )}
                      </View>
                      <View style={styles.flexMin}>
                        <Text style={[styles.stepTitle, s.state === 'pending' && { color: colors.ink3 }]}>{s.title}</Text>
                        <Text style={styles.stepSub}>{s.sub}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Phone step — inline OTP */}
              {flow.phoneStepActive ? (
                <View style={styles.phoneBlock}>
                  <PhoneOtp onVerified={flow.onPhoneVerified} onSendFailed={flow.onPhoneSendFailed} />
                  {flow.sendFailed ? (
                    <Pressable onPress={flow.skipPhone} style={styles.skipRow}>
                      <Text style={styles.skipText}>Can't receive a text? Continue without phone</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {/* Checkout / polling */}
              {flow.readyForCheckout ? (
                flow.phase === 'polling' ? (
                  <View style={styles.pollBlock}>
                    <ActivityIndicator color={colors.brand} />
                    <Text style={styles.pollText}>Confirming your subscription…</Text>
                    <Pressable onPress={flow.recheck} disabled={flow.busy} style={styles.recheck}>
                      <Text style={styles.recheckText}>I've subscribed</Text>
                    </Pressable>
                  </View>
                ) : (
                  <PrimaryButton
                    onPress={flow.startCheckout}
                    loading={flow.busy}
                    style={styles.cta}
                    icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
                  >
                    Start subscription
                  </PrimaryButton>
                )
              ) : null}

              {flow.error ? <Text style={styles.error}>{flow.error}</Text> : null}

              <Pressable onPress={flow.dismiss} style={styles.tertiary}>
                <Text style={styles.tertiaryText}>Show me the preview</Text>
              </Pressable>
              <Text style={styles.fine}>Billed monthly via Stripe. Cancel any time from Account → Subscription.</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flexMin: { flex: 1, minWidth: 0 },
  columns: { flexDirection: 'row', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' },
  main: { flex: 1, minWidth: 420 },
  aside: { width: 360 },

  hero: { backgroundColor: colors.catTutor, borderRadius: 28, padding: 26, minHeight: 200, justifyContent: 'flex-end' },
  heroBadge: { alignSelf: 'flex-start', backgroundColor: colors.brand, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 5 },
  heroBadgeText: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.inkInv },
  heroTitle: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 38, letterSpacing: -0.8, color: colors.ink, marginTop: 16 },
  heroSub: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 21, color: colors.ink, opacity: 0.8, marginTop: 10, maxWidth: 460 },

  statRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
  stat: { flex: 1, padding: 16, backgroundColor: colors.surface, borderRadius: radii.md, ...shadow.e1 },
  statN: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.4, color: colors.ink, fontVariant: ['tabular-nums'] },
  statL: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.ink2, marginTop: 4 },

  sectionLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2, marginTop: 28, marginBottom: 12 },
  includedCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 20, gap: 14, ...shadow.e1 },
  includedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkIcon: { width: 26, height: 26, borderRadius: radii.pill, backgroundColor: 'rgba(47,122,77,0.14)', alignItems: 'center', justifyContent: 'center' },
  includedText: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 20, color: colors.ink },

  checkout: { backgroundColor: colors.surface, borderRadius: 24, padding: 22, ...shadow.e2 },
  planLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
  planPrice: { fontFamily: fonts.bold, fontSize: 36, lineHeight: 40, letterSpacing: -1.2, color: colors.ink, fontVariant: ['tabular-nums'], marginTop: 4 },
  planPer: { fontFamily: fonts.regular, fontSize: 15, letterSpacing: 0, color: colors.ink2 },
  summaryCard: { marginTop: 18, padding: 16, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },

  stepsLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginTop: 22, marginBottom: 12 },
  steps: { gap: 14 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNum: { width: 28, height: 28, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  stepNumActive: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.brand },
  stepNumDone: { backgroundColor: colors.brand },
  stepNumPending: { backgroundColor: colors.surfaceAlt },
  stepNumText: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink3 },
  stepTitle: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink },
  stepSub: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 2 },

  phoneBlock: { marginTop: 18, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.hairline },
  skipRow: { alignItems: 'center', marginTop: 14 },
  skipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2, textDecorationLine: 'underline' },

  pollBlock: { alignItems: 'center', gap: 10, marginTop: 22 },
  pollText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  recheck: { height: 40, paddingHorizontal: 20, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  recheckText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  cta: { marginTop: 22 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, textAlign: 'center', marginTop: 12 },
  tertiary: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  tertiaryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
  fine: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15, color: colors.ink3, textAlign: 'center', marginTop: 8 },

  manageCard: { backgroundColor: colors.surface, borderRadius: 24, padding: 28, maxWidth: 440, alignItems: 'flex-start', gap: 6, ...shadow.e2 },
  manageTitle: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink, marginTop: 8 },
  manageSub: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 21, color: colors.ink2 },
  manageCta: { marginTop: 16, alignSelf: 'stretch' },
});
