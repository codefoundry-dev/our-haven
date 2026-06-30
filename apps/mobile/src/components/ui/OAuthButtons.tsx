/**
 * OAuthButtons — Apple / Google sign-in + sign-up (design: signin.jsx / signup.jsx).
 *
 * Wired to Supabase OAuth (OH-199). On a sign-up screen pass `role` so the
 * provider round-trip lands the user on the right onboarding (Parent → straight
 * in; Caregiver/Provider → SupplyOnboarding); the sign-in screens omit it.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { signInWithProvider, type OAuthProvider } from '@/auth/oauth';
import type { Role } from '@/lib/roles';
import { colors, fonts, radii } from '@/theme/tokens';

function OutlineButton({
  label,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.btn, disabled && styles.btnDisabled, pressed && styles.btnPressed]}
    >
      {loading ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.label}>{label}</Text>}
    </Pressable>
  );
}

export function OAuthButtons({ verb = 'continue', role }: { verb?: 'continue' | 'sign up'; role?: Role }) {
  const { configured } = useAuth();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (provider: OAuthProvider) => {
    if (busy || !configured) return;
    setError(null);
    setBusy(provider);
    const result = await signInWithProvider(provider, role ?? null);
    // On web the page navigates away on success and this component unmounts; on
    // native we land back here. A real session change is picked up by the auth
    // gate, so we only need to release the button and surface a failure.
    setBusy(null);
    if (result.error) setError(result.error);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.dividerRow}>
        <View style={styles.line} />
        <Text style={styles.dividerText}>{verb === 'sign up' ? 'OR SIGN UP WITH' : 'OR CONTINUE WITH'}</Text>
        <View style={styles.line} />
      </View>
      <OutlineButton
        label="Continue with Apple"
        loading={busy === 'apple'}
        disabled={!configured || (busy !== null && busy !== 'apple')}
        onPress={() => start('apple')}
      />
      <OutlineButton
        label="Continue with Google"
        loading={busy === 'google'}
        disabled={!configured || (busy !== null && busy !== 'google')}
        onPress={() => start('google')}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 12 },
  line: { flex: 1, height: 1, backgroundColor: colors.hairline },
  dividerText: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.4, color: colors.ink3 },
  btn: {
    height: 52,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: { backgroundColor: colors.canvas },
  btnDisabled: { opacity: 0.5 },
  label: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, textAlign: 'center', marginTop: 2 },
});
