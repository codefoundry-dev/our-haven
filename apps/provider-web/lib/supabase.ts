'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
  }
  cachedClient = createBrowserClient(url, anon);
  return cachedClient;
}

export interface AuthResult {
  user: User;
  session: Session;
}

export async function signUpWithEmailPassword(email: string, password: string): Promise<AuthResult> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.user || !data.session) {
    throw new Error('email confirmation is required — check your inbox before completing sign-up');
  }
  return { user: data.user, session: data.session };
}

export async function signInEmailPassword(email: string, password: string): Promise<AuthResult> {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.user || !data.session) throw new Error('sign-in failed: no session returned');
  return { user: data.user, session: data.session };
}

/**
 * Kick off the Google OAuth redirect. Returns when Supabase has issued the
 * redirect URL — the browser navigation away from the page completes the flow.
 * After the user returns from Google, the active session is available via
 * `getAccessToken()`; the caller is responsible for resuming any partially-
 * filled form (e.g. via localStorage) after redirect.
 */
export async function signInWithGoogle(redirectTo?: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) throw error;
}

export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabaseBrowser();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabaseBrowser();
  await supabase.auth.signOut();
}

/**
 * Add or replace the phone on the authenticated user. Supabase sends an SMS
 * OTP via the configured provider (Twilio in v1 per ADR-0010). The user must
 * then call {@link verifyPhoneOtp}.
 */
export async function startPhoneOtpChange(phoneE164: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.auth.updateUser({ phone: phoneE164 });
  if (error) throw error;
}

export async function verifyPhoneOtp(phoneE164: string, otp: string): Promise<void> {
  const supabase = getSupabaseBrowser();
  const { error } = await supabase.auth.verifyOtp({
    phone: phoneE164,
    token: otp,
    type: 'phone_change',
  });
  if (error) throw error;
}

/**
 * PUT a file directly to a Supabase Storage signed-upload URL (returned by the
 * backend's `/v1/uploads/signed-url`). The browser sends the bytes straight to
 * Storage — the backend never proxies them.
 */
export async function uploadToSignedUrl(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`storage upload failed (${res.status} ${res.statusText})`);
  }
}
