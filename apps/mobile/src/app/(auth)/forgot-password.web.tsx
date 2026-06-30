/**
 * Forgot password (WEB) — split-screen desktop layout (AuthWebShell). Same
 * useAuth().resetPassword + validation as the native screen; only the layout
 * differs. Metro resolves this over forgot-password.tsx on web.
 */
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { AuthWebShell } from '@/components/auth/AuthWebShell';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TextField } from '@/components/ui/TextField';
import { colors, fonts } from '@/theme/tokens';

const PANEL = {
  kicker: 'our haven',
  eyebrow: 'Account recovery',
  title: 'Locked out?\nWe’ll get you back in.',
  subtitle:
    'We’ll email you a secure link to set a new password. For your safety the link expires shortly and can only be used once.',
  features: [
    { icon: 'lock' as const, label: 'One-time, expiring link' },
    { icon: 'shield' as const, label: 'We never email your password' },
    { icon: 'message' as const, label: 'Check spam if it’s slow to arrive' },
  ],
};

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { resetPassword, configured } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const canSubmit = email.trim().length > 0 && configured && !loading;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    const result = await resetPassword(email);
    setLoading(false);
    if (result.error) setError(result.error);
    else setSent(true);
  };

  if (sent) {
    return (
      <AuthWebShell panel={PANEL}>
        <Text style={styles.eyebrow}>Almost there</Text>
        <Text style={styles.h2}>Check your email.</Text>
        <Text style={styles.subtitle}>
          If an account exists for {email.trim()}, we&apos;ve sent a link to reset your password. Open it and
          you&apos;ll be able to choose a new one right away.
        </Text>
        <View style={styles.notice}>
          <Notice>Didn&apos;t get it? Check spam — it can take up to a minute to arrive.</Notice>
        </View>
        <Pressable onPress={() => router.replace('/(auth)/sign-in' as Href)} hitSlop={8} style={styles.backLink}>
          <Text style={styles.link}>Back to sign in</Text>
        </Pressable>
      </AuthWebShell>
    );
  }

  return (
    <AuthWebShell panel={PANEL}>
      <Text style={styles.eyebrow}>Reset password</Text>
      <Text style={styles.h2}>Forgot your password?</Text>
      <View style={styles.subRow}>
        <Text style={styles.subText}>Remembered it? </Text>
        <Pressable onPress={() => router.replace('/(auth)/sign-in' as Href)}>
          <Text style={styles.link}>Sign in →</Text>
        </Pressable>
      </View>
      <Text style={styles.subtitle}>
        Enter the email you signed up with and we&apos;ll send you a link to set a new password.
      </Text>

      {!configured ? (
        <View style={styles.notice}>
          <Notice tone="warn">
            Supabase isn&apos;t configured. Add EXPO_PUBLIC_SUPABASE_* to apps/mobile/.env to enable password resets.
          </Notice>
        </View>
      ) : null}

      <View style={styles.fields}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@email.com"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
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
        Send reset link
      </PrimaryButton>
    </AuthWebShell>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2 },
  h2: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 34, letterSpacing: -0.9, color: colors.ink, marginTop: 8 },
  subRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  subText: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, marginTop: 8 },
  link: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink, textDecorationLine: 'underline' },
  notice: { marginTop: 18 },
  fields: { gap: 12, marginTop: 22 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 12 },
  cta: { marginTop: 18 },
  backLink: { marginTop: 20, alignItems: 'center' },
});
