/**
 * Web session handoff consume route (OH-221) — the landing the mobile Caregiver
 * Account tab hands off to for payout-management on the web portal (PRD story
 * 80). The Edge `POST /v1/auth/web-handoff` mints a single-use Supabase
 * magic-link token and sends the in-app browser to `/handoff?token_hash=…&next=…`;
 * this screen exchanges that token for a session (`verifyOtp`) and routes on.
 *
 * It lives in the public `(auth)` group (URL `/handoff`) because the in-app
 * browser tab starts with no session — establishing one is the whole point.
 * Cross-platform file, but only ever reached on web (the in-app browser loads
 * the deployed web app); native never navigates here.
 */
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import type { EmailOtpType } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { supabase } from '@/auth/supabase';
import { Icon } from '@/components/Icon';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { colors, fonts } from '@/theme/tokens';

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Only allow app-relative destinations — never let a crafted `next` bounce off-origin. */
function safeNext(v: string | undefined): string {
  if (v && v.startsWith('/') && !v.startsWith('//')) return v;
  return '/account';
}

export default function HandoffScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token_hash?: string; type?: string; next?: string }>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const tokenHash = firstParam(params.token_hash);
      const type = (firstParam(params.type) ?? 'magiclink') as EmailOtpType;
      const next = safeNext(firstParam(params.next));
      if (!tokenHash) {
        if (alive) setFailed(true);
        return;
      }
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!alive) return;
      if (error) {
        setFailed(true);
        return;
      }
      router.replace(next as Href);
    })();
    return () => {
      alive = false;
    };
    // Run once on mount — the handoff token is single-use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      {failed ? (
        <>
          <Text style={styles.title}>This link has expired.</Text>
          <Text style={styles.sub}>
            Handoff links can only be used once and time out quickly. Head back to the app and try again.
          </Text>
          <PrimaryButton
            onPress={() => router.replace('/(auth)/sign-in' as Href)}
            icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
            style={styles.cta}
          >
            Go to sign in
          </PrimaryButton>
        </>
      ) : (
        <>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.loading}>Signing you in…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: colors.canvas, gap: 12 },
  loading: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, marginTop: 4 },
  title: { fontFamily: fonts.bold, fontSize: 24, letterSpacing: -0.6, color: colors.ink, textAlign: 'center' },
  sub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, textAlign: 'center', maxWidth: 340 },
  cta: { marginTop: 12 },
});
