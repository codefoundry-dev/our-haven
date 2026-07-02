/**
 * AuthProvider — owns the Supabase session and exposes auth actions + the
 * derived permanent role (read from the access token's app_metadata, ADR-0011).
 */
import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { isSupabaseConfigured, supabase } from '@/auth/supabase';
// Platform-resolved (notifications.ts native / notifications.web.ts web).
import { unregisterForPush } from '@/lib/notifications';
import { isRole, type Role } from '@/lib/roles';

const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';

/**
 * Where the email-confirmation link returns the user. On web, back to the
 * running origin (localhost in dev, the deployed domain in prod) so the auth
 * gate picks up the new session and routes to role-claim. Native uses the Site
 * URL default (deep-link handling lands with the mobile confirmation ticket).
 * NOTE: every origin used here must be in Supabase Auth → URL Configuration →
 * Redirect URLs, or GoTrue ignores it and falls back to the Site URL.
 */
const emailRedirectTo = isWeb ? window.location.origin : undefined;

/**
 * Where the password-reset email returns the user — the dedicated reset-password
 * route, so the recovery session lands on the "set a new password" form. On web
 * that's an absolute origin URL; on native it's the `ourhaven://reset-password`
 * deep link (the screen exchanges the link's tokens for the recovery session).
 * Like emailRedirectTo, this URL must be allow-listed in Supabase Auth → URL
 * Configuration → Redirect URLs.
 */
const recoveryRedirectTo = isWeb
  ? `${window.location.origin}/reset-password`
  : Linking.createURL('reset-password');

type Status = 'loading' | 'authed' | 'anon';

interface SignUpArgs {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /** The role chosen on role-pick. Stored in user_metadata so the role-claim
   *  screen can resume it after the session exists (the claim itself is a
   *  separate authenticated call — see api/client roleClaim). */
  role: Role;
}

interface AuthValue {
  status: Status;
  session: Session | null;
  role: Role | null;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (args: SignUpArgs) => Promise<{ error?: string; needsConfirmation?: boolean }>;
  signOut: () => Promise<void>;
  /** Email a password-reset link (no-op for the caller if the address is unknown — GoTrue
   *  never reveals whether an account exists, so success here just means "the email was sent
   *  if it matched an account"). The link returns to the reset-password screen. */
  resetPassword: (email: string) => Promise<{ error?: string }>;
  /** Set a new password for the user in the active (recovery) session. */
  updatePassword: (password: string) => Promise<{ error?: string }>;
  /** Pull a fresh access token — call after role-claim so app_metadata.role lands in the JWT. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setStatus(data.session ? 'authed' : 'anon');
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setStatus(next ? 'authed' : 'anon');
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const role = useMemo<Role | null>(() => {
    const raw = session?.user?.app_metadata?.role;
    return isRole(raw) ? raw : null;
  }, [session]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      session,
      role,
      configured: isSupabaseConfigured,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        return { error: error?.message };
      },
      async signUp({ email, password, firstName, lastName, role: chosenRole }) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { first_name: firstName.trim(), last_name: lastName.trim(), intended_role: chosenRole },
            emailRedirectTo,
          },
        });
        if (error) return { error: error.message };
        // No session means email confirmation is required before first sign-in.
        return { needsConfirmation: !data.session };
      },
      async signOut() {
        // Drop this device's push destination FIRST — the authenticated DELETE
        // needs the still-live session (OH-223). Best-effort: a stale row is
        // also pruned server-side when the push service reports it dead.
        await unregisterForPush().catch(() => {});
        await supabase.auth.signOut();
      },
      async resetPassword(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: recoveryRedirectTo,
        });
        return { error: error?.message };
      },
      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password });
        return { error: error?.message };
      },
      async refresh() {
        const { data } = await supabase.auth.refreshSession();
        if (data.session) setSession(data.session);
      },
    }),
    [status, session, role],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
