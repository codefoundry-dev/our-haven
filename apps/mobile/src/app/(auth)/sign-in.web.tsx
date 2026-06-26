/**
 * Sign in (WEB) — split-screen desktop layout (AuthWebShell). Functionally
 * identical to the native screen: same useAuth().signIn, same validation. Metro
 * resolves this over sign-in.tsx on web.
 */
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { AuthWebShell } from '@/components/auth/AuthWebShell';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { OAuthButtons } from '@/components/ui/OAuthButtons';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TextField } from '@/components/ui/TextField';
import { colors, fonts } from '@/theme/tokens';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, configured } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = email.length > 0 && password.length > 0 && configured && !loading;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    const result = await signIn(email, password);
    setLoading(false);
    if (result.error) setError(result.error);
    // On success the root auth gate redirects automatically.
  };

  return (
    <AuthWebShell
      panel={{
        kicker: 'our haven',
        eyebrow: 'Welcome back',
        title: 'Good to see you\nagain.',
        subtitle:
          'Your bookings, messages, payouts and family are right where you left them. Heavy work — verification, documents, profile editing — is easiest here on a real keyboard.',
        features: [
          { icon: 'shield', label: 'Identity & background checks' },
          { icon: 'receipt', label: 'Payouts & tax documents' },
          { icon: 'edit', label: 'Profile & license editing' },
          { icon: 'briefcase', label: 'Manage your listings' },
        ],
      }}
    >
      <Text style={styles.eyebrow}>Sign in</Text>
      <Text style={styles.h2}>Welcome back.</Text>
      <View style={styles.subRow}>
        <Text style={styles.subText}>New to Our Haven? </Text>
        <Pressable onPress={() => router.replace('/(auth)/role-pick' as Href)}>
          <Text style={styles.link}>Sign up →</Text>
        </Pressable>
      </View>

      {!configured ? (
        <View style={styles.notice}>
          <Notice tone="warn">
            Supabase isn&apos;t configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to
            apps/mobile/.env to enable sign-in.
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
          returnKeyType="next"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          rightSlot={
            <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8} accessibilityLabel="Toggle password visibility">
              <Icon name="eye" size={18} color={colors.ink2} />
            </Pressable>
          }
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
        Sign in
      </PrimaryButton>

      <OAuthButtons verb="continue" />
    </AuthWebShell>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2 },
  h2: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 34, letterSpacing: -0.9, color: colors.ink, marginTop: 8 },
  subRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  subText: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  link: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink, textDecorationLine: 'underline' },
  notice: { marginTop: 20 },
  fields: { gap: 12, marginTop: 24 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 12 },
  cta: { marginTop: 18 },
});
