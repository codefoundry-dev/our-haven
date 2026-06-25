/**
 * Typed API client for the Our Haven backend.
 *
 * Request/response shapes come from @our-haven/openapi-types (generated from
 * apps/backend/openapi/openapi.yaml — the source of truth per ADR-0004), so the
 * client can never drift from the spec without a type error.
 *
 * Base URL is EXPO_PUBLIC_API_URL (the Supabase Edge Functions host / backend).
 */
import type { paths } from '@our-haven/openapi-types';

import { supabase } from '@/auth/supabase';

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export type RoleClaimBody = paths['/v1/auth/role-claim']['post']['requestBody']['content']['application/json'];
export type RoleClaimResult = paths['/v1/auth/role-claim']['post']['responses'][200]['content']['application/json'];

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

async function post<T>(path: string, body: unknown): Promise<T> {
  if (!API_URL) {
    throw new ApiError(0, 'EXPO_PUBLIC_API_URL is not set — cannot reach the backend.');
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = (json.reason as string) ?? (json.error as string) ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, message, json.error as string | undefined);
  }
  return json as T;
}

/**
 * Set the permanent role on the authenticated user (M2.2 — POST /v1/auth/role-claim).
 * Idempotent; 409 if a different role was already claimed. The caller must then
 * refresh the session so the new app_metadata.role lands in the access token.
 */
export function roleClaim(body: RoleClaimBody): Promise<RoleClaimResult> {
  return post<RoleClaimResult>('/v1/auth/role-claim', body);
}
