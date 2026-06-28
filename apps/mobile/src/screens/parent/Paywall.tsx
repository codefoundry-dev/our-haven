/**
 * Subscription gate / paywall (Parent) — ported from the Claude design project
 * (screens/sub-gate.jsx). Fired the first time a Parent tries to message, send a
 * Booking request, or post a Job. "Unlock the marketplace" hero, trust stats,
 * the three checkout steps, a "Start subscription" CTA and a preview tertiary.
 * UI-only skeleton; the CTAs are inert.
 */
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const STATS: { n: string; l: string }[] = [
  { n: '300+', l: 'Vetted Providers across all four categories' },
  { n: 'Checkr', l: 'Criminal + sex-offender + SSN screening' },
  { n: 'E2E', l: 'Encrypted, monitored messaging' },
];

const STEPS: { title: string; sub: string; state: 'active' | 'pending' }[] = [
  { title: 'Verify your phone', sub: 'For cancellation SMS and new-device sign-in checks.', state: 'active' },
  { title: 'Add a payment method', sub: 'Used for future Bookings only.', state: 'pending' },
  { title: 'Start your subscription', sub: 'Stripe-hosted checkout in a secure in-app browser.', state: 'pending' },
];

export default function PaywallScreen() {
  const router = useRouter();

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar onBack={() => router.back()} />

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
        {STEPS.map((s, i) => {
          const active = s.state === 'active';
          return (
            <View key={s.title} style={styles.step}>
              <View style={[styles.stepNum, active ? styles.stepNumActive : styles.stepNumPending]}>
                <Text style={[styles.stepNumText, active && { color: colors.brand }]}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.stepTitle, !active && { color: colors.ink3 }]}>{s.title}</Text>
                <Text style={styles.stepSub}>{s.sub}</Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.note}>
        <Icon name="info" size={14} color={colors.brand} />
        <Text style={styles.noteText}>We held onto the action you were doing — once you're subscribed, we'll pick right back up.</Text>
      </View>

      <PrimaryButton style={styles.cta} icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}>
        Start subscription
      </PrimaryButton>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.tertiary}>
        <Text style={styles.tertiaryText}>Show me the preview</Text>
      </Pressable>

      <Text style={styles.fine}>Billed monthly via Stripe. Cancel any time from Account → Subscription.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },

  hero: { backgroundColor: colors.catTutor, borderRadius: 32, padding: 22, marginTop: 8, minHeight: 200, justifyContent: 'flex-end' },
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
  stepNumPending: { backgroundColor: colors.surfaceAlt },
  stepNumText: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink3 },
  stepTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  stepSub: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 2 },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12, padding: 12, borderRadius: radii.sm, backgroundColor: colors.brandSoft },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink },

  cta: { marginTop: 22 },
  tertiary: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  tertiaryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
  fine: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15, color: colors.ink3, textAlign: 'center', marginTop: 8 },
});
