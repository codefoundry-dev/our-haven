/**
 * DeferredOnboarding — shown when a Caregiver/Provider has an account but no
 * claimed role yet. Their role-claim needs permanent extra data (caregiver
 * categories / provider specialty) collected in downstream M2 onboarding
 * tickets, so the skeleton stops honestly here rather than claiming a permanent
 * role with placeholder data.
 */
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { ROLE_CARDS, type Role } from '@/lib/roles';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const NEXT_STEPS: Record<Exclude<Role, 'parent'>, string[]> = {
  caregiver: ['Pick your categories (Babysitter / Tutor / Nanny) & rate', 'ID + background check', 'Connect a bank for same-day payouts'],
  provider: ['Choose your specialty (SLP / OT / ABA / Psychology)', 'ID + license verification', 'List your practice & subscribe'],
};

export function DeferredOnboarding({ role }: { role: Role }) {
  const { signOut } = useAuth();
  const label = role.charAt(0).toUpperCase() + role.slice(1);
  const steps = role === 'parent' ? [] : NEXT_STEPS[role];

  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Icon name={ROLE_CARDS[role].icon} size={28} color={colors.ink} />
      </View>
      <Text style={styles.title}>Account created.</Text>
      <Text style={styles.subtitle}>
        Setting up your {label} profile is the next milestone — it isn&apos;t wired up in this build yet.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>What&apos;s next</Text>
        {steps.map((step, i) => (
          <View key={step} style={styles.stepRow}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </View>

      <PrimaryButton onPress={signOut} style={styles.cta}>
        Sign out
      </PrimaryButton>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center' },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, color: colors.ink, marginTop: 24 },
  subtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink2, marginTop: 10 },
  card: { marginTop: 26, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 18, ...shadow.e1 },
  cardLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.ink2,
    marginBottom: 8,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { fontFamily: fonts.bold, fontSize: 11, color: colors.ink },
  stepText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.ink },
  cta: { marginTop: 28 },
});
