/**
 * Reset password (WEB) — split-screen desktop layout (AuthWebShell). The web
 * client is created with detectSessionInUrl:true (auth/supabase.ts), so the
 * recovery link's hash is exchanged for a session automatically; this screen
 * only reads that session and drives updatePassword. Metro resolves this over
 * reset-password.tsx on web.
 */
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { AuthWebShell, type AuthPanelCopy } from '@/components/auth/AuthWebShell';
import { Icon } from '@/components/Icon';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TextField } from '@/components/ui/TextField';
import { colors, fonts } from '@/theme/tokens';

const PANEL: AuthPanelCopy = {
  kicker: 'our haven',
  eyebrow: 'Account recovery',
  title: 'One more step\nand you’re back in.',
  subtitle:
    'Pick a new password below. Once it’s saved you’ll stay signed in on this device — no need to enter the old one.',
  features: [
    { icon: 'lock', label: 'Choose something only you know' },
    { icon: 'shield', label: 'Your new password is encrypted at rest' },
  ],
};

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { status, session, updatePassword, configured } = useAuth();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const canSubmit =
    password.length >= 8 && confirm.length > 0 && configured && !loading && Boolean(session);

  const onSubmit = async () => {
    if (!canSubmit) return;
    if (password !== confirm) {
      setError('Passwords don’t match.');
      return;
    }
    setError(null);
    setLoading(true);
    const result = await updatePassword(password);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDone(true);
  };

  // Still detecting the recovery session from the link's hash.
  if (status === 'loading') {
    return (
      <AuthWebShell panel={PANEL}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </AuthWebShell>
    );
  }

  // No recovery session — the link expired, was already used, or was opened in a
  // different browser than it was requested from.
  if (!session) {
    return (
      <AuthWebShell panel={PANEL}>
        <Text style={styles.eyebrow}>Reset password</Text>
        <Text style={styles.h2}>This link has expired.</Text>
        <Text style={styles.subtitle}>
          Password reset links can only be used once and time out quickly. Request a fresh one to continue.
        </Text>
        <PrimaryButton
          onPress={() => router.replace('/(auth)/forgot-password' as Href)}
          icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
          style={styles.cta}
        >
          Request a new link
        </PrimaryButton>
      </AuthWebShell>
    );
  }

  if (done) {
    return (
      <AuthWebShell panel={PANEL}>
        <Text style={styles.eyebrow}>All set</Text>
        <Text style={styles.h2}>Password updated.</Text>
        <Text style={styles.subtitle}>You&apos;re signed in with your new password.</Text>
        <PrimaryButton
          onPress={() => router.replace('/' as Href)}
          icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
          style={styles.cta}
        >
          Continue
        </PrimaryButton>
      </AuthWebShell>
    );
  }

  return (
    <AuthWebShell panel={PANEL}>
      <Text style={styles.eyebrow}>Reset password</Text>
      <Text style={styles.h2}>Set a new password.</Text>
      <Text style={styles.subtitle}>Choose a new password for your account. You&apos;ll stay signed in.</Text>

      <View style={styles.fields}>
        <TextField
          label="New password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoComplete="new-password"
          textContentType="newPassword"
          helper="At least 8 characters."
          rightSlot={
            <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8} accessibilityLabel="Toggle password visibility">
              <Icon name="eye" size={18} color={colors.ink2} />
            </Pressable>
          }
        />
        <TextField
          label="Confirm password"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry={!showPassword}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <PrimaryButton
        onPress={onSubmit}
        loading={loading}
        disabled={!canSubmit}
        icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
        style={styles.cta}
      >
        Update password
      </PrimaryButton>
    </AuthWebShell>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: 48, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2 },
  h2: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 34, letterSpacing: -0.9, color: colors.ink, marginTop: 8 },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, marginTop: 8 },
  fields: { gap: 12, marginTop: 22 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 12 },
  cta: { marginTop: 18 },
});
