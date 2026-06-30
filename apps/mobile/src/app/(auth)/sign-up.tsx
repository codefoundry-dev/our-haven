/** §5.1.4 Sign up — role pill carried from role-pick (design: screens/signup.jsx). */
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { BrandMark } from '@/components/BrandMark';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { IconButton } from '@/components/ui/IconButton';
import { OAuthButtons } from '@/components/ui/OAuthButtons';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { RolePill } from '@/components/ui/RolePill';
import { TextField } from '@/components/ui/TextField';
import { isRole, type Role } from '@/lib/roles';
import { colors, fonts } from '@/theme/tokens';

const SUBTITLE: Record<Role, string> = {
  parent: "We'll send a link to confirm your email.",
  caregiver: 'Sign up first — then verify your ID and background before you go live.',
  provider: "Sign up first — then we'll verify your ID, background, and license before you go live.",
};

export default function SignUpScreen() {
  const router = useRouter();
  const { role: roleParam } = useLocalSearchParams<{ role?: string }>();
  const role: Role = isRole(roleParam) ? roleParam : 'parent';
  const { signUp, configured } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const canSubmit =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    configured &&
    !loading;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    const result = await signUp({ email, password, firstName, lastName, role });
    setLoading(false);
    if (result.error) setError(result.error);
    else if (result.needsConfirmation) setSent(true);
    // Otherwise a session now exists; the auth gate routes to /role-claim.
  };

  if (sent) {
    return (
      <Screen scroll contentStyle={styles.content}>
        <View style={styles.topBar}>
          <IconButton name="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
        </View>
        <BrandMark />
        <Text style={styles.title}>Check your email.</Text>
        <Text style={styles.subtitle}>
          We sent a confirmation link to {email.trim()}. Tap it to verify, then sign in.
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
        <IconButton name="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
        <Text style={styles.help}>Help</Text>
      </View>

      <BrandMark />
      <View style={styles.pill}>
        <RolePill role={role} />
      </View>
      <Text style={styles.title}>Create your account.</Text>
      <Text style={styles.subtitle}>{SUBTITLE[role]}</Text>

      {!configured ? (
        <View style={styles.notice}>
          <Notice tone="warn">
            Supabase isn&apos;t configured. Add EXPO_PUBLIC_SUPABASE_* to apps/mobile/.env to enable sign-up.
          </Notice>
        </View>
      ) : null}

      <View style={styles.fields}>
        <View style={styles.nameRow}>
          <View style={styles.flex}>
            <TextField label="First name" value={firstName} onChangeText={setFirstName} autoCapitalize="words" autoComplete="name-given" />
          </View>
          <View style={styles.flex}>
            <TextField label="Last name" value={lastName} onChangeText={setLastName} autoCapitalize="words" autoComplete="name-family" />
          </View>
        </View>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoComplete="new-password"
          textContentType="newPassword"
          helper="At least 8 characters."
          onSubmitEditing={onSubmit}
          returnKeyType="go"
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
        Create account
      </PrimaryButton>

      <OAuthButtons verb="sign up" role={role} />

      <Text style={styles.terms}>By continuing you agree to our Terms and Privacy Policy.</Text>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Already have an account? </Text>
        <Pressable onPress={() => router.replace('/(auth)/sign-in' as Href)}>
          <Text style={styles.link}>Sign in</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 12, paddingBottom: 36 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  help: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink2 },
  pill: { marginTop: 24 },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.9, color: colors.ink, marginTop: 14 },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, marginTop: 6 },
  notice: { marginTop: 18 },
  fields: { gap: 10, marginTop: 22 },
  nameRow: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 12 },
  cta: { marginTop: 16 },
  terms: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink3, textAlign: 'center', marginTop: 16 },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 16 },
  footerText: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, textDecorationLine: 'underline' },
});
