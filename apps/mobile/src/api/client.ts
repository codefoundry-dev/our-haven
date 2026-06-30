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

// Caregiver profile builder (OH-188).
export type CaregiverProfile = paths['/v1/providers/me/profile']['get']['responses'][200]['content']['application/json'];
export type CaregiverProfilePatch = paths['/v1/providers/me/profile']['patch']['requestBody']['content']['application/json'];
export type CaregiverCategoryRate = CaregiverProfile['categoryRates'][number];
export type CaregiverCredential = CaregiverProfile['credentials'][number];
export type CredentialCreateBody = paths['/v1/providers/me/credentials']['post']['requestBody']['content']['application/json'];

// Caregiver Stripe Connect Express (OH-190) — the Bank & payouts onboarding step.
export type CaregiverConnectSummary = paths['/v1/caregiver/connect/summary']['get']['responses'][200]['content']['application/json'];
export type CaregiverConnectOnboardingLink = paths['/v1/caregiver/connect/onboarding-link']['post']['responses'][200]['content']['application/json'];

// Parent profile (OH-200) — family-level Bio + Preferences + consent-gated Safety
// Behaviors + default service address.
export type ParentProfile = paths['/v1/parents/me/profile']['get']['responses'][200]['content']['application/json'];
export type ParentProfilePatch = paths['/v1/parents/me/profile']['patch']['requestBody']['content']['application/json'];
export type ParentPreference = NonNullable<ParentProfilePatch['preferences']>[number];
export type ParentSafetyBehavior = ParentProfile['safetyBehaviors'][number];
export type ParentDefaultAddress = ParentProfile['defaultAddress'];
export type ParentSafetyBehaviorsBody = paths['/v1/parents/me/profile/safety-behaviors']['put']['requestBody']['content']['application/json'];

// Provider (clinical) profile builder (OH-189).
export type ProviderClinicalProfile = paths['/v1/providers/me/clinical-profile']['get']['responses'][200]['content']['application/json'];
export type ProviderClinicalProfilePatch = paths['/v1/providers/me/clinical-profile']['patch']['requestBody']['content']['application/json'];
export type ProviderSpecialty = NonNullable<ProviderClinicalProfile['specialty']>;
export type ProviderCredentialStatus = ProviderClinicalProfile['credentialStatus'];
export type ConsultationSlot = paths['/v1/providers/me/consultation-slots']['get']['responses'][200]['content']['application/json']['slots'][number];
export type ConsultationSlotCreateBody = paths['/v1/providers/me/consultation-slots']['post']['requestBody']['content']['application/json'];

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

async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
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
const patchJson = <T>(path: string, body: unknown): Promise<T> => request<T>('PATCH', path, body);
const putJson = <T>(path: string, body: unknown): Promise<T> => request<T>('PUT', path, body);
const del = <T>(path: string): Promise<T> => request<T>('DELETE', path);

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

/**
 * Caregiver profile builder (OH-188). Read the editable profile, save a partial
 * update (per-category rates, availability, negotiable, ages/behaviour), and
 * add/remove Credentials (admin-reviewed, hidden until approved).
 */

export function getCaregiverProfile(): Promise<CaregiverProfile> {
  return get<CaregiverProfile>('/v1/providers/me/profile');
}

export function patchCaregiverProfile(patch: CaregiverProfilePatch): Promise<CaregiverProfile> {
  return patchJson<CaregiverProfile>('/v1/providers/me/profile', patch);
}

export function addCaregiverCredential(body: CredentialCreateBody): Promise<{ credential: CaregiverCredential }> {
  return post<{ credential: CaregiverCredential }>('/v1/providers/me/credentials', body);
}

export function deleteCaregiverCredential(credentialId: string): Promise<{ deleted: true }> {
  return del<{ deleted: true }>(`/v1/providers/me/credentials/${credentialId}`);
}

/**
 * Caregiver Stripe Connect Express (OH-190) — the Bank & payouts onboarding step.
 * `summary` mirrors the account's capability state (from account.updated webhooks);
 * `onboarding-link` creates/reuses the Express account and returns a Stripe-hosted
 * KYC URL to open. Precondition (enforced server-side): Checkr screening cleared.
 */

export function getConnectSummary(): Promise<CaregiverConnectSummary> {
  return get<CaregiverConnectSummary>('/v1/caregiver/connect/summary');
}

export function createConnectOnboardingLink(): Promise<CaregiverConnectOnboardingLink> {
  return post<CaregiverConnectOnboardingLink>('/v1/caregiver/connect/onboarding-link', undefined);
}

/**
 * Parent profile (OH-200). The family-level profile: Bio + Preferences + the
 * optional default service address (`patchParentProfile`), and the consent-gated
 * Safety-Behaviors checklist — `grantSafetyConsent` stamps the explicit consent
 * that unlocks `putSafetyBehaviors`; `withdrawSafetyConsent` erases the behaviours
 * + timestamp (Bio + Preferences survive). Saving behaviours without consent 403s.
 */

export function getParentProfile(): Promise<ParentProfile> {
  return get<ParentProfile>('/v1/parents/me/profile');
}

export function patchParentProfile(patch: ParentProfilePatch): Promise<ParentProfile> {
  return patchJson<ParentProfile>('/v1/parents/me/profile', patch);
}

export function grantSafetyConsent(): Promise<ParentProfile> {
  return post<ParentProfile>('/v1/parents/me/profile/consent', undefined);
}

export function withdrawSafetyConsent(): Promise<ParentProfile> {
  return del<ParentProfile>('/v1/parents/me/profile/consent');
}

export function putSafetyBehaviors(safetyBehaviors: ParentSafetyBehavior[]): Promise<ParentProfile> {
  return putJson<ParentProfile>('/v1/parents/me/profile/safety-behaviors', {
    safetyBehaviors,
  } satisfies ParentSafetyBehaviorsBody);
}

/**
 * Provider (clinical) profile builder (OH-189). Read/update the clinical profile
 * (specialty + per-session display Rate + identity + read-only credential status),
 * and publish/list/withdraw consultation slots the M2.7 scheduler consumes.
 */

export function getProviderProfile(): Promise<ProviderClinicalProfile> {
  return get<ProviderClinicalProfile>('/v1/providers/me/clinical-profile');
}

export function patchProviderProfile(patch: ProviderClinicalProfilePatch): Promise<ProviderClinicalProfile> {
  return patchJson<ProviderClinicalProfile>('/v1/providers/me/clinical-profile', patch);
}

export function listConsultationSlots(): Promise<{ slots: ConsultationSlot[] }> {
  return get<{ slots: ConsultationSlot[] }>('/v1/providers/me/consultation-slots');
}

export function publishConsultationSlot(body: ConsultationSlotCreateBody): Promise<ConsultationSlot> {
  return post<ConsultationSlot>('/v1/providers/me/consultation-slots', body);
}

export function withdrawConsultationSlot(slotId: string): Promise<{ withdrawn: true }> {
  return del<{ withdrawn: true }>(`/v1/providers/me/consultation-slots/${slotId}`);
}
