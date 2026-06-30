/** Forgot password — request a reset link (design: screens/signin.jsx family). */
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { BrandMark } from '@/components/BrandMark';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { IconButton } from '@/components/ui/IconButton';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TextField } from '@/components/ui/TextField';
import { colors, fonts } from '@/theme/tokens';

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
      <Screen scroll contentStyle={styles.content}>
        <View style={styles.topBar}>
          <IconButton name="chevron-left" onPress={() => router.replace('/(auth)/sign-in' as Href)} accessibilityLabel="Back" />
        </View>
        <BrandMark />
        <Text style={styles.title}>Check your email.</Text>
        <Text style={styles.subtitle}>
          If an account exists for {email.trim()}, we&apos;ve sent a link to reset your password. Open it on this
          device to choose a new one.
        </Text>
        <View style={styles.notice}>
          <Notice>Didn&apos;t get it? Check spam — it can take up to a minute to arrive.</Notice>
        </View>
        <PrimaryButton
          onPress={() => router.replace('/(auth)/sign-in' as Href)}
          icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
          style={styles.cta}
        >
          Back to sign in
        </PrimaryButton>
      </Screen>
    );
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.topBar}>
        <IconButton name="chevron-left" onPress={() => router.replace('/(auth)/sign-in' as Href)} accessibilityLabel="Back" />
      </View>

      <BrandMark />
      <Text style={styles.title}>Forgot your password?</Text>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 12, paddingBottom: 36 },
  topBar: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.9, color: colors.ink, marginTop: 20 },
  subtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink2, marginTop: 8 },
  notice: { marginTop: 18 },
  fields: { gap: 12, marginTop: 24 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 12 },
  cta: { marginTop: 18 },
});
