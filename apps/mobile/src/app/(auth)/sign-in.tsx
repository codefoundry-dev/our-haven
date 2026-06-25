/** Sign in — Welcome back (design: screens/signin.jsx). */
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { BrandMark } from '@/components/BrandMark';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { OAuthButtons } from '@/components/ui/OAuthButtons';
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
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.topBar}>
        <Text style={styles.help}>Help</Text>
      </View>

      <BrandMark />
      <Text style={styles.title}>Welcome back.</Text>
      <Text style={styles.subtitle}>
        Pick up where you left off — your providers, bookings and children are right where you left them.
      </Text>

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

      <View style={styles.footer}>
        <Text style={styles.footerText}>New to Our Haven? </Text>
        <Pressable onPress={() => router.replace('/(auth)/role-pick' as Href)}>
          <Text style={styles.link}>Sign up</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 12, paddingBottom: 36 },
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', height: 24 },
  help: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink2 },
  title: { fontFamily: fonts.bold, fontSize: 36, lineHeight: 42, letterSpacing: -1, color: colors.ink, marginTop: 28 },
  subtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink2, marginTop: 8 },
  notice: { marginTop: 20 },
  fields: { gap: 12, marginTop: 28 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 12 },
  cta: { marginTop: 18 },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  footerText: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, textDecorationLine: 'underline' },
});
