/**
 * Typed API client for the Our Haven backend.
 *
 * Request/response shapes come from @our-haven/openapi-types (generated from
 * supabase/functions/api/openapi/openapi.yaml — the live Hono Edge Function spec
 * and source of truth per ADR-0004/0019), so the client can never drift from the
 * spec without a type error.
 *
 * Base URL is EXPO_PUBLIC_API_URL (the Supabase Edge Functions host).
 */
import type { paths } from '@our-haven/openapi-types';

import { supabase } from '@/auth/supabase';

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export type RoleClaimBody = paths['/v1/auth/role-claim']['post']['requestBody']['content']['application/json'];
export type RoleClaimResult = paths['/v1/auth/role-claim']['post']['responses'][200]['content']['application/json'];

export type Verification = paths['/v1/providers/me/verification']['get']['responses'][200]['content']['application/json'];
export type VerificationState = Verification['state'];
export type VerificationFacts = Verification['facts'];
export type UploadKind = paths['/v1/uploads/signed-url']['post']['requestBody']['content']['application/json']['kind'];
export type SignedUploadUrl = paths['/v1/uploads/signed-url']['post']['responses'][200]['content']['application/json'];
type IdDocBody = paths['/v1/providers/me/verification/id-doc']['post']['requestBody']['content']['application/json'];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!API_URL) {
    throw new ApiError(0, 'EXPO_PUBLIC_API_URL is not set — cannot reach the backend.');
  }
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(await authHeaders()),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = (json.reason as string) ?? (json.error as string) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, json.error as string | undefined);
  }
  return json as T;
}

const get = <T>(path: string): Promise<T> => request<T>('GET', path);
const post = <T>(path: string, body: unknown): Promise<T> => request<T>('POST', path, body);

/**
 * Set the permanent role on the authenticated user (M2.2 — POST /v1/auth/role-claim).
 * Idempotent; 409 if a different role was already claimed. The caller must then
 * refresh the session so the new app_metadata.role lands in the access token.
 */
export function roleClaim(body: RoleClaimBody): Promise<RoleClaimResult> {
  return post<RoleClaimResult>('/v1/auth/role-claim', body);
}

/**
 * Supply Verification flow (OH-184). The state machine is server-owned
 * (@our-haven/domain); these calls read the computed state + checklist facts and
 * record the two applicant-driven facts (ID upload, phone confirmation).
 */

/** Read the current verification state + per-step facts. */
export function getVerification(): Promise<Verification> {
  return get<Verification>('/v1/providers/me/verification');
}

/** Mint a one-time signed upload URL for a private-bucket object (e.g. an ID doc). */
export function requestUploadUrl(kind: UploadKind): Promise<SignedUploadUrl> {
  return post<SignedUploadUrl>('/v1/uploads/signed-url', { kind });
}

/** Record a completed government-ID upload by its (uid-namespaced) object path. */
export function recordIdDoc(objectPath: string): Promise<Verification> {
  return post<Verification>('/v1/providers/me/verification/id-doc', { objectPath } satisfies IdDocBody);
}

/** Mirror a completed Supabase phone OTP into the verification facts (hard activation gate). */
export function confirmPhone(): Promise<Verification> {
  return post<Verification>('/v1/providers/me/verification/phone-confirm', {});
}
