/**
 * AuthProvider — owns the Supabase session and exposes auth actions + the
 * derived permanent role (read from the access token's app_metadata, ADR-0011).
 */
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { isSupabaseConfigured, supabase } from '@/auth/supabase';
import { isRole, type Role } from '@/lib/roles';

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
          },
        });
        if (error) return { error: error.message };
        // No session means email confirmation is required before first sign-in.
        return { needsConfirmation: !data.session };
      },
      async signOut() {
        await supabase.auth.signOut();
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
