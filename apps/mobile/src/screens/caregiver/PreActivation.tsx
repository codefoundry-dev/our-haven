/**
 * Caregiver pre-activation empty state (PRD-0001 story 83, OH-217). While a
 * Caregiver's verification hasn't cleared, the Opportunities tab hides the Jobs
 * feed and shows this instead: the current verification state in plain language
 * plus the single next step that's blocking activation, with a CTA straight to it,
 * so the Caregiver knows exactly what to do next.
 *
 * Data comes from the shared SupplyActivationProvider (verification snapshot +
 * firstActionableStep) — this component is a pure render of what it's handed.
 */
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import type { Verification } from '@/api/client';
import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import type { OnboardingStep } from '@/lib/onboarding';
import { VERIFICATION_STATE_COPY } from '@/lib/verification';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export function CaregiverPreActivation({
  verification,
  blockingStep,
}: {
  verification: Verification | null;
  blockingStep: OnboardingStep | null;
}) {
  const router = useRouter();
  const copy = verification ? VERIFICATION_STATE_COPY[verification.state] : null;

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      <AppBar large title="Opportunities" />

      <View style={styles.card}>
        <View style={styles.lockCircle}>
          <Icon name="lock" size={26} color={colors.brand} />
        </View>

        <Text style={styles.title}>Finish setup to see Jobs</Text>
        <Text style={styles.blurb}>
          {copy?.blurb ?? 'Complete verification to start browsing and applying to Jobs near you.'}
        </Text>

        {blockingStep ? (
          <View style={styles.stepCard}>
            <View style={styles.stepNumWrap}>
              <Text style={styles.stepNum}>{blockingStep.n}</Text>
            </View>
            <View style={styles.stepBody}>
              <Text style={styles.stepEyebrow}>Next step</Text>
              <Text style={styles.stepLabel}>{blockingStep.label}</Text>
              <Text style={styles.stepSub}>{blockingStep.sub}</Text>
            </View>
            <Icon name="arrow-right" size={18} color={colors.ink3} />
          </View>
        ) : (
          <View style={styles.stepCard}>
            <View style={styles.stepIconWrap}>
              <Icon name="clock" size={18} color={colors.warning} />
            </View>
            <View style={styles.stepBody}>
              <Text style={styles.stepEyebrow}>In review</Text>
              <Text style={styles.stepLabel}>{copy?.label ?? 'Verification in progress'}</Text>
              <Text style={styles.stepSub}>No action needed right now — we’ll notify you.</Text>
            </View>
          </View>
        )}

        <PrimaryButton
          onPress={() => router.push(blockingStep?.dest === 'profile' ? '/profile-builder' : '/verification')}
          icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
          style={styles.cta}
        >
          {blockingStep ? 'Continue setup' : 'View verification status'}
        </PrimaryButton>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },

  card: {
    marginTop: 24,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 24,
    alignItems: 'center',
    ...shadow.e1,
  },
  lockCircle: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.4, color: colors.ink, marginTop: 18, textAlign: 'center' },
  blurb: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: colors.ink2, marginTop: 8, textAlign: 'center' },

  stepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    alignSelf: 'stretch',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: 14,
    marginTop: 20,
  },
  stepNumWrap: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNum: { fontFamily: fonts.bold, fontSize: 15, color: colors.inkInv },
  stepIconWrap: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBody: { flex: 1, minWidth: 0 },
  stepEyebrow: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  stepLabel: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink, marginTop: 2 },
  stepSub: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, color: colors.ink2, marginTop: 2 },

  cta: { marginTop: 20 },
});
