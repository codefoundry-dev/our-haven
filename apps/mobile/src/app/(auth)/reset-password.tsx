/**
 * Reset password — where the recovery link lands. The user arrives here from the
 * email link with a one-time recovery session, then sets a new password.
 *
 * Native: the link is the `ourhaven://reset-password` deep link with the tokens
 * in the fragment (the client's detectSessionInUrl is web-only). We read the
 * incoming URL, exchange the tokens for the recovery session, then show the form
 * — mirroring the OAuth native flow (auth/oauth.ts). The web split (.web.tsx)
 * relies on detectSessionInUrl instead and never parses the URL itself.
 */
import { useRouter, type Href } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { paramsFromRedirect } from '@/auth/oauth';
import { supabase } from '@/auth/supabase';
import { BrandMark } from '@/components/BrandMark';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TextField } from '@/components/ui/TextField';
import { colors, fonts } from '@/theme/tokens';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { session, updatePassword, configured } = useAuth();
  const url = Linking.useURL();

  const [linkError, setLinkError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(true);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Turn the recovery deep link into a session (native equivalent of the web
  // client's detectSessionInUrl). Re-runs if the link arrives after first mount.
  useEffect(() => {
    let active = true;
    (async () => {
      if (url) {
        const params = paramsFromRedirect(url);
        if (params.error_description || params.error) {
          if (active) setLinkError(params.error_description || params.error);
        } else if (params.access_token && params.refresh_token) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          });
          if (active && sessionError) setLinkError(sessionError.message);
        }
      }
      if (active) setExchanging(false);
    })();
    return () => {
      active = false;
    };
  }, [url]);

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

  // Still resolving the link, and no recovery session yet — hold on a spinner.
  if (exchanging && !session) {
    return (
      <Screen contentStyle={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </Screen>
    );
  }

  // Link couldn't be turned into a session (expired, already used, or opened on
  // a different device than it was requested from).
  if (!session) {
    return (
      <Screen scroll contentStyle={styles.content}>
        <BrandMark />
        <Text style={styles.title}>This link has expired.</Text>
        <Text style={styles.subtitle}>
          Password reset links can only be used once and time out quickly. Request a fresh one to continue.
        </Text>
        {linkError ? (
          <View style={styles.notice}>
            <Notice tone="warn">{linkError}</Notice>
          </View>
        ) : null}
        <PrimaryButton
          onPress={() => router.replace('/(auth)/forgot-password' as Href)}
          icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
          style={styles.cta}
        >
          Request a new link
        </PrimaryButton>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen scroll contentStyle={styles.content}>
        <BrandMark />
        <Text style={styles.title}>Password updated.</Text>
        <Text style={styles.subtitle}>You&apos;re signed in with your new password.</Text>
        <PrimaryButton
          onPress={() => router.replace('/' as Href)}
          icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
          style={styles.cta}
        >
          Continue
        </PrimaryButton>
      </Screen>
    );
  }

  return (
    <Screen scroll contentStyle={styles.content}>
      <BrandMark />
      <Text style={styles.title}>Set a new password.</Text>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingTop: 32, paddingBottom: 36 },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.9, color: colors.ink, marginTop: 24 },
  subtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink2, marginTop: 8 },
  notice: { marginTop: 18 },
  fields: { gap: 12, marginTop: 24 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 12 },
  cta: { marginTop: 18 },
});
