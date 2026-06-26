/**
 * Onboarding hub (native base). On web, Metro resolves onboarding.web.tsx — the
 * two-pane desktop hub the auth gate routes Caregivers/Providers to after they
 * claim their role. On native, supply onboarding stays inline (role-claim →
 * SupplyOnboarding) and the gate routes claimers straight to their dashboard, so
 * this screen is reached only if navigated to explicitly. It renders the same live
 * checklist in a phone column from the shared lib/onboarding derivation.
 */
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, getVerification, type Verification } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import {
  firstActionableStep,
  onboardingProgress,
  onboardingSteps,
  type OnboardingDest,
  type OnboardingStep,
} from '@/lib/onboarding';
import { landingTab } from '@/lib/roles';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

function humanize(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'Set EXPO_PUBLIC_API_URL in apps/mobile/.env to reach the backend.';
    if (e.status === 404) return 'Finish choosing your role before setting up.';
    return e.message;
  }
  return 'Could not load your setup status.';
}

export default function OnboardingHubScreen() {
  const router = useRouter();
  const { role } = useAuth();

  const [data, setData] = useState<Verification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getVerification());
    } catch (e) {
      setError(humanize(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const supplyRole: 'caregiver' | 'provider' = role === 'provider' ? 'provider' : 'caregiver';
  const steps = data ? onboardingSteps(data) : [];
  const progress = onboardingProgress(steps);
  const activated = data?.state === 'activated';
  const next = firstActionableStep(steps);

  const destHref = (dest: OnboardingDest): Href | null => {
    if (dest === 'verification') return '/(app)/verification' as Href;
    if (dest === 'profile') return (supplyRole === 'provider' ? '/(app)/provider-profile' : '/(app)/profile-builder') as Href;
    return null;
  };
  const goDashboard = () => router.replace(`/(app)/${landingTab(supplyRole)}` as Href);
  const openStep = (s: OnboardingStep) => {
    const href = destHref(s.dest);
    if (href) router.push(href);
  };

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      <Text style={styles.kicker}>{supplyRole === 'provider' ? 'Provider onboarding' : 'Caregiver onboarding'}</Text>
      <Text style={styles.title}>Your setup</Text>

      {loading && !data ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : error && !data ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={load} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
          <Pressable onPress={goDashboard} hitSlop={8}>
            <Text style={styles.skip}>Skip to dashboard</Text>
          </Pressable>
        </View>
      ) : data ? (
        <>
          <Text style={styles.sub}>
            {activated ? 'You’re verified and ready to go.' : `${progress.done} of ${progress.total} complete · ${progress.pct}%`}
          </Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${progress.pct}%` }]} />
          </View>

          <View style={styles.steps}>
            {steps.map((s) => {
              const done = s.status === 'done';
              const active = s.status === 'in-progress';
              const tappable = s.dest !== null && s.status !== 'blocked';
              return (
                <Pressable
                  key={s.key}
                  onPress={tappable ? () => openStep(s) : undefined}
                  disabled={!tappable}
                  style={[styles.row, active && styles.rowActive]}
                >
                  <View
                    style={[
                      styles.rowNum,
                      { backgroundColor: done ? colors.catSpec : active ? colors.highlight : colors.surfaceAlt },
                    ]}
                  >
                    {done ? <Icon name="check" size={14} color={colors.ink} /> : <Text style={styles.rowNumText}>{s.n}</Text>}
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowLabel}>{s.label}</Text>
                    <Text style={styles.rowSub}>{s.sub}</Text>
                  </View>
                  {tappable ? <Icon name="chevron-right" size={18} color={colors.ink3} /> : null}
                </Pressable>
              );
            })}
          </View>

          <Pressable onPress={activated || !next ? goDashboard : () => openStep(next)} style={styles.cta}>
            <Text style={styles.ctaText}>
              {activated || !next ? 'Go to dashboard' : `Continue · ${next.label}`}
            </Text>
            <Icon name="arrow-right" size={16} color={colors.inkInv} />
          </Pressable>

          {!activated ? (
            <Pressable onPress={goDashboard} hitSlop={8} style={styles.skipRow}>
              <Text style={styles.skip}>Skip for now — go to dashboard</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 16, paddingBottom: 40 },
  kicker: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2 },
  title: { fontFamily: fonts.bold, fontSize: 28, letterSpacing: -0.8, color: colors.ink, marginTop: 6 },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, marginTop: 8 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 14 },

  track: { marginTop: 14, height: 8, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radii.pill, backgroundColor: colors.brand },

  steps: { marginTop: 22, gap: 10 },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
    ...shadow.e1,
  },
  rowActive: { borderColor: colors.brand },
  rowNum: { width: 30, height: 30, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  rowNumText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  rowCopy: { flex: 1, minWidth: 0 },
  rowLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  rowSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 1 },

  cta: {
    marginTop: 22,
    height: 52,
    paddingHorizontal: 24,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaText: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: -0.2, color: colors.inkInv },
  skipRow: { marginTop: 14, alignItems: 'center' },
  skip: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2, textDecorationLine: 'underline' },

  error: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.danger, textAlign: 'center' },
  retry: { backgroundColor: colors.brand, borderRadius: radii.pill, paddingHorizontal: 24, paddingVertical: 14 },
  retryText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
});
