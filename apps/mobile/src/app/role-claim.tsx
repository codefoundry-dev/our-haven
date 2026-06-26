/**
 * role-claim — authenticated screen that sets the user's permanent role via the
 * M2.2 API (POST /v1/auth/role-claim), then refreshes the session so the new
 * app_metadata.role lands in the access token and the gate routes into the app.
 *
 * The role is INFERRED FROM AUTH: it's the role the user chose on role-pick,
 * carried in user_metadata.intended_role from sign-up. The view shown is the
 * pure derivation in lib/roleClaim → resolveRoleClaimView. A Parent claims
 * directly; Caregiver and Provider collect their permanent categories/specialty
 * + resident state in SupplyOnboarding (OH-183) before claiming. The role-pick
 * cards only appear for a legacy account that has no intended role at all.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, roleClaim } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { RolePickCards } from '@/components/RolePickCards';
import { Screen } from '@/components/Screen';
import { SupplyOnboarding } from '@/components/SupplyOnboarding';
import { resolveRoleClaimView } from '@/lib/roleClaim';
import { isRole, type Role } from '@/lib/roles';
import { colors, fonts } from '@/theme/tokens';

export default function RoleClaimScreen() {
  const { status, session, refresh, signOut } = useAuth();

  // The role comes from auth — the choice made at sign-up. Deriving it from the
  // live session each render (not a one-time useState capture) means a page
  // refresh / late session hydration on web still resolves to the right
  // onboarding instead of flashing the role picker.
  const intendedRaw = session?.user?.user_metadata?.intended_role;
  const intended = isRole(intendedRaw) ? intendedRaw : null;

  // `override` only applies to a legacy account with no intended role that must
  // pick one from the cards below.
  const [override, setOverride] = useState<Role | null>(null);
  const view = resolveRoleClaimView({ status, intended, override });

  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Parent is the only role with no extra permanent data — claim it directly.
  const claimingParent = view.kind === 'claim-parent';
  useEffect(() => {
    if (!claimingParent) return;
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
  }, [claimingParent, attempt, refresh]);

  // SupplyOnboarding owns its own page shell so the web variant can render the
  // full-viewport two-pane desktop layout (not the phone-width Screen column).
  if (view.kind === 'onboarding') {
    return <SupplyOnboarding role={view.role} />;
  }

  if (view.kind === 'claim-parent') {
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

  // Session still resolving — show a spinner rather than flashing the picker at
  // a user who already has a role.
  if (view.kind === 'loading') {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </Screen>
    );
  }

  // Authenticated but genuinely no intended role (e.g. legacy account) — choose one.
  return (
    <Screen scroll contentStyle={styles.content}>
      <Text style={styles.title}>One more thing.</Text>
      <Text style={styles.subtitle}>Who are you on Our Haven? This is permanent.</Text>
      <View style={styles.cards}>
        <RolePickCards onPick={setOverride} />
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
