/**
 * Subscription gate / paywall (Parent) — OH-204. The functional flow behind the
 * design (Claude project screens/sub-gate.jsx): the gate fires on first attempt to
 * Message, send a Book-request, post a Job, or book a Provider consultation; it
 * collects + verifies phone in the same step, opens the Stripe-hosted web checkout,
 * polls subscription status on return, and resumes the originally-attempted action.
 *
 * Logic lives in `usePaywallFlow` (shared with the desktop-web paywall); this is the
 * native + narrow-web body. "Unlock the marketplace" hero, trust stats, the three
 * checkout steps, the inline phone-verify step, the checkout CTA + polling state.
 */
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { PhoneOtp } from '@/components/PhoneOtp';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { usePaywallFlow } from '@/lib/usePaywallFlow';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const STATS: { n: string; l: string }[] = [
  { n: '300+', l: 'Vetted Providers across all four categories' },
  { n: 'Checkr', l: 'Criminal + sex-offender + SSN screening' },
  { n: 'E2E', l: 'Encrypted, monitored messaging' },
];

type StepState = 'active' | 'pending' | 'done';

export default function PaywallScreen() {
  const { i } = useLocalSearchParams<{ i?: string }>();
  const flow = usePaywallFlow(i);

  // Already subscribed and not resuming an action → the "you're subscribed" view.
  if (flow.manageMode) {
    return (
      <Screen edges={['top']} scroll contentStyle={styles.content}>
        <AppBar onBack={flow.dismiss} />
        <View style={[styles.hero, styles.heroDone]}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>Subscription · active</Text>
          </View>
          <Text style={styles.heroTitle}>You're all set.</Text>
          <Text style={styles.heroSub}>
            Your membership unlocks the full marketplace — message, book, post Jobs, and book consultations.
          </Text>
        </View>
        {flow.error ? <Text style={styles.error}>{flow.error}</Text> : null}
        <PrimaryButton onPress={flow.openPortal} loading={flow.busy} style={styles.cta}>
          Manage subscription
        </PrimaryButton>
        <Pressable accessibilityRole="button" onPress={flow.dismiss} style={styles.tertiary}>
          <Text style={styles.tertiaryText}>Back</Text>
        </Pressable>
        <Text style={styles.fine}>Manage your payment method or cancel any time via Stripe.</Text>
      </Screen>
    );
  }

  const steps: { title: string; sub: string; state: StepState }[] = [
    {
      title: 'Verify your phone',
      sub: flow.phoneSkipped
        ? 'Skipped — add it later from Account.'
        : 'For cancellation SMS and new-device sign-in checks.',
      state: flow.phoneVerified ? 'done' : flow.phoneSkipped ? 'done' : 'active',
    },
    {
      title: 'Add a payment method',
      sub: 'Used for future Bookings only.',
      state: flow.readyForCheckout ? 'active' : 'pending',
    },
    {
      title: 'Start your subscription',
      sub: 'Stripe-hosted checkout in a secure browser.',
      state: flow.readyForCheckout ? 'active' : 'pending',
    },
  ];

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar onBack={flow.dismiss} />

      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>Subscription · $14.99/mo</Text>
        </View>
        <Text style={styles.heroTitle}>Unlock the marketplace.</Text>
        <Text style={styles.heroSub}>Start your subscription and verify your phone in one step. Cancel anytime.</Text>
      </View>

      {/* Stats */}
      <View style={styles.statRow}>
        {STATS.map((s) => (
          <View key={s.n} style={styles.stat}>
            <Text style={styles.statN}>{s.n}</Text>
            <Text style={styles.statL}>{s.l}</Text>
          </View>
        ))}
      </View>

      {/* Steps */}
      <Text style={styles.sectionLabel}>Three quick steps</Text>
      <View style={styles.stepsCard}>
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
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.stepTitle, s.state === 'pending' && { color: colors.ink3 }]}>{s.title}</Text>
                <Text style={styles.stepSub}>{s.sub}</Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Phone step — inline OTP (collected + verified in the paywall) */}
      {flow.phoneStepActive ? (
        <View style={styles.phoneCard}>
          <Text style={styles.phoneHeading}>Verify your phone</Text>
          <Text style={styles.phoneSub}>We text a one-time code. Used for cancellation alerts and new-device checks.</Text>
          <PhoneOtp onVerified={flow.onPhoneVerified} onSendFailed={flow.onPhoneSendFailed} />
          {flow.sendFailed ? (
            <Pressable accessibilityRole="button" onPress={flow.skipPhone} style={styles.skipRow}>
              <Text style={styles.skipText}>Can't receive a text right now? Continue without phone</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Checkout / polling */}
      {flow.readyForCheckout ? (
        flow.phase === 'polling' ? (
          <View style={styles.pollCard}>
            <ActivityIndicator color={colors.brand} />
            <Text style={styles.pollText}>Confirming your subscription…</Text>
            <Pressable accessibilityRole="button" onPress={flow.recheck} disabled={flow.busy} style={styles.recheck}>
              <Text style={styles.recheckText}>I've subscribed</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.note}>
              <Icon name="info" size={14} color={colors.brand} />
              <Text style={styles.noteText}>
                We held onto the action you were doing — once you're subscribed, we'll pick right back up.
              </Text>
            </View>
            <PrimaryButton
              onPress={flow.startCheckout}
              loading={flow.busy}
              style={styles.cta}
              icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
            >
              Start subscription
            </PrimaryButton>
          </>
        )
      ) : null}

      {flow.error ? <Text style={styles.error}>{flow.error}</Text> : null}

      <Pressable accessibilityRole="button" onPress={flow.dismiss} style={styles.tertiary}>
        <Text style={styles.tertiaryText}>Show me the preview</Text>
      </Pressable>

      <Text style={styles.fine}>Billed monthly via Stripe. Cancel any time from Account → Subscription.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },

  hero: { backgroundColor: colors.catTutor, borderRadius: 32, padding: 22, marginTop: 8, minHeight: 200, justifyContent: 'flex-end' },
  heroDone: { backgroundColor: colors.brandSoft },
  heroBadge: { alignSelf: 'flex-start', backgroundColor: colors.brand, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 5 },
  heroBadgeText: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.inkInv },
  heroTitle: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 38, letterSpacing: -0.8, color: colors.ink, marginTop: 14 },
  heroSub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink, opacity: 0.78, marginTop: 8, maxWidth: 290 },

  statRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  stat: { flex: 1, padding: 14, backgroundColor: colors.surface, borderRadius: radii.md, ...shadow.e1 },
  statN: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.4, color: colors.ink, fontVariant: ['tabular-nums'] },
  statL: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15, color: colors.ink2, marginTop: 4 },

  sectionLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2, marginTop: 22, marginBottom: 12 },
  stepsCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 18, gap: 14 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNum: { width: 28, height: 28, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  stepNumActive: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.brand },
  stepNumDone: { backgroundColor: colors.brand },
  stepNumPending: { backgroundColor: colors.surfaceAlt },
  stepNumText: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink3 },
  stepTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  stepSub: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 2 },

  phoneCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 18, marginTop: 14, ...shadow.e1 },
  phoneHeading: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  phoneSub: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink2, marginTop: 4, marginBottom: 12 },
  skipRow: { alignItems: 'center', marginTop: 14 },
  skipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2, textDecorationLine: 'underline' },

  pollCard: { alignItems: 'center', gap: 10, marginTop: 22, padding: 22, backgroundColor: colors.surface, borderRadius: radii.lg, ...shadow.e1 },
  pollText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  recheck: { height: 40, paddingHorizontal: 20, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  recheckText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 16, padding: 12, borderRadius: radii.sm, backgroundColor: colors.brandSoft },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink },

  cta: { marginTop: 18 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, textAlign: 'center', marginTop: 12 },
  tertiary: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  tertiaryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
  fine: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15, color: colors.ink3, textAlign: 'center', marginTop: 8 },
});
