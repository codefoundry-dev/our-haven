/**
 * role-claim — authenticated screen that sets the user's permanent role via the
 * M2.2 API (POST /v1/auth/role-claim), then refreshes the session so the new
 * app_metadata.role lands in the access token and the gate routes into the app.
 *
 * Reached when a session exists but has no role yet:
 *   - right after sign-up (intended role carried in user_metadata), or
 *   - an existing role-less account signs in (shows the role cards).
 *
 * Skeleton scope: Parent claims end-to-end (no extra permanent data). Caregiver
 * and Provider need permanent categories/specialty collected in downstream M2
 * onboarding, so they stop at DeferredOnboarding instead of claiming here.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, roleClaim } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { DeferredOnboarding } from '@/components/DeferredOnboarding';
import { RolePickCards } from '@/components/RolePickCards';
import { Screen } from '@/components/Screen';
import { isRole, type Role } from '@/lib/roles';
import { colors, fonts } from '@/theme/tokens';

export default function RoleClaimScreen() {
  const { session, refresh, signOut } = useAuth();
  const intendedRaw = session?.user?.user_metadata?.intended_role;
  const intended = isRole(intendedRaw) ? intendedRaw : null;

  const [picked, setPicked] = useState<Role | null>(intended);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Parent is the only role with no extra permanent data — claim it directly.
  useEffect(() => {
    if (picked !== 'parent') return;
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        await roleClaim({ role: 'parent' });
        if (!cancelled) await refresh(); // gate then redirects into (app)
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof ApiError
              ? e.status === 0
                ? 'Set EXPO_PUBLIC_API_URL in apps/mobile/.env to reach the backend.'
                : e.message
              : 'Could not set your role. Please try again.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [picked, attempt, refresh]);

  if (picked === 'caregiver' || picked === 'provider') {
    return (
      <Screen scroll>
        <DeferredOnboarding role={picked} />
      </Screen>
    );
  }

  if (picked === 'parent') {
    return (
      <Screen>
        <View style={styles.center}>
          {error ? (
            <>
              <Text style={styles.error}>{error}</Text>
              <Pressable onPress={() => setAttempt((a) => a + 1)} style={styles.retry}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
              <Pressable onPress={signOut} hitSlop={8}>
                <Text style={styles.signOut}>Sign out</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator color={colors.brand} />
              <Text style={styles.loading}>Setting up your account…</Text>
            </>
          )}
        </View>
      </Screen>
    );
  }

  // Authenticated but no intended role (e.g. legacy account) — choose one.
  return (
    <Screen scroll contentStyle={styles.content}>
      <Text style={styles.title}>One more thing.</Text>
      <Text style={styles.subtitle}>Who are you on Our Haven? This is permanent.</Text>
      <View style={styles.cards}>
        <RolePickCards onPick={setPicked} />
      </View>
      <Pressable onPress={signOut} hitSlop={8} style={styles.signOutRow}>
        <Text style={styles.signOut}>Sign out</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 28, paddingBottom: 28 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loading: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink2 },
  error: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.danger, textAlign: 'center' },
  retry: { backgroundColor: colors.brand, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 14 },
  retryText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, color: colors.ink },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, marginTop: 10, marginBottom: 22 },
  cards: { marginBottom: 18 },
  signOutRow: { alignItems: 'center', marginTop: 4 },
  signOut: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2, textDecorationLine: 'underline' },
});
