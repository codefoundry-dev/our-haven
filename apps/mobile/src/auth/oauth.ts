/**
 * Apple / Google OAuth sign-in + sign-up on the Supabase client (OH-199).
 *
 * Web: a full-page redirect to the provider and back to the app origin. The web
 * client is created with `detectSessionInUrl: true` (see auth/supabase.ts), so
 * the returning hash is exchanged for a session automatically — we only kick off
 * the redirect here.
 *
 * Native: open the provider in an ASWebAuthenticationSession (iOS) / Chrome
 * Custom Tab (Android) via expo-web-browser, then complete the session from the
 * returned deep-link URL. The client defaults to the implicit flow, which lands
 * the tokens in the URL fragment; we keep that default deliberately so the
 * existing email-confirmation links are unaffected.
 *
 * The role chosen on a sign-up screen can't ride in user_metadata the way the
 * password sign-up does (no user exists until the provider returns), so we stash
 * it locally before leaving and the role-claim screen reads it back. See
 * pendingRole.
 */
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { setPendingRole } from '@/auth/pendingRole';
import { supabase } from '@/auth/supabase';
import type { Role } from '@/lib/roles';

export type OAuthProvider = 'apple' | 'google';

export interface OAuthResult {
  /** A surfaced error message, if the attempt failed before a session was set. */
  error?: string;
  /** The user backed out of the provider browser — not an error to show. */
  cancelled?: boolean;
}

/**
 * Pull auth params out of a redirect URL, merging the query string and the
 * fragment. The implicit flow returns the tokens in the `#fragment`; provider
 * errors can arrive in either part. (URLSearchParams is polyfilled app-wide by
 * react-native-url-polyfill, imported from auth/supabase.)
 */
export function paramsFromRedirect(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const absorb = (segment: string) => {
    new URLSearchParams(segment).forEach((value, key) => {
      out[key] = value;
    });
  };
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  if (queryIndex !== -1) absorb(url.slice(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex));
  if (hashIndex !== -1) absorb(url.slice(hashIndex + 1));
  return out;
}

export async function signInWithProvider(provider: OAuthProvider, role: Role | null): Promise<OAuthResult> {
  // Carry the sign-up role choice across the provider round-trip (see module note).
  await setPendingRole(role);

  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    // On success the browser navigates to the provider; we only return on a
    // setup error (e.g. the provider is not enabled in the Supabase dashboard).
    return { error: error?.message };
  }

  // Native: drive the system auth session ourselves and finish from the deep link.
  const redirectTo = Linking.createURL('auth/callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) return { error: error.message };
  if (!data?.url) return { error: 'Could not start sign-in. Please try again.' };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') {
    // 'cancel' / 'dismiss' — the user backed out.
    return { cancelled: true };
  }

  const params = paramsFromRedirect(result.url);
  if (params.error || params.error_description) {
    return { error: params.error_description || params.error };
  }
  const { access_token, refresh_token } = params;
  if (!access_token || !refresh_token) {
    return { error: 'Sign-in did not complete. Please try again.' };
  }
  const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
  return { error: sessionError?.message };
}
