import type {
  AvailabilityGrid,
  CaregiverCategory,
  Specialty,
  SupplyRole,
  UsState,
} from '@our-haven/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8080';

export type ProviderSignupRequest =
  | { role: 'caregiver'; categories: CaregiverCategory[]; state: UsState }
  | { role: 'provider'; specialty: Specialty; state: UsState };

export interface ProviderSignupResponse {
  id: string;
  uid: string;
  role: SupplyRole;
  categories: CaregiverCategory[] | null;
  specialty: Specialty | null;
  state: UsState;
  createdAt: string;
}

export interface ApiError {
  status: number;
  error: string;
  reason?: string;
}

async function request<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (body ?? {}) as { error?: string; reason?: string };
    throw {
      status: res.status,
      error: err.error ?? 'unknown_error',
      reason: err.reason,
    } satisfies ApiError;
  }
  return body as T;
}

export async function postProviderSignup(
  accessToken: string,
  payload: ProviderSignupRequest,
): Promise<ProviderSignupResponse> {
  return request<ProviderSignupResponse>(accessToken, '/v1/providers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export type VerificationState =
  | 'unverified'
  | 'email-verified'
  | 'phone-verified'
  | 'id-uploaded'
  | 'screening-initiated'
  | 'screening-passed'
  | 'license-pending'
  | 'license-verified'
  | 'connect-pending'
  | 'activated'
  | 'rejected'
  | 'holding-state-not-supported';

export interface VerificationResponse {
  state: VerificationState;
  role: SupplyRole;
  residentState: UsState;
  licenseBoardSupported: boolean;
  facts: {
    emailConfirmedAt: string | null;
    phoneConfirmedAt: string | null;
    idDocUploadedAt: string | null;
    idDocObjectPath: string | null;
    screeningInitiatedAt: string | null;
    screeningPassedAt: string | null;
    licenseVerifiedAt: string | null;
    connectAccountReadyAt: string | null;
    connectChargesEnabled: boolean;
    connectPayoutsEnabled: boolean;
    rejectedAt: string | null;
    rejectionReason: string | null;
  };
}

export interface StripeConnectSummary {
  hasAccount: boolean;
  stripeAccountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
  accountReady: boolean;
  accountReadyAt: string | null;
  requirementsCurrentlyDue: string[];
  requirementsPastDue: string[];
  requirementsPendingVerification: string[];
  lastWebhookAt: string | null;
}

export interface StripeOnboardingLink {
  stripeAccountId: string;
  url: string;
  expiresAt: string;
}

export interface StripeDashboardLink {
  url: string;
  createdAt: string;
}

export async function getStripeConnectSummary(accessToken: string): Promise<StripeConnectSummary> {
  return request<StripeConnectSummary>(accessToken, '/v1/providers/me/stripe-connect/summary', {
    method: 'GET',
  });
}

export async function requestStripeConnectOnboardingLink(
  accessToken: string,
): Promise<StripeOnboardingLink> {
  return request<StripeOnboardingLink>(accessToken, '/v1/providers/me/stripe-connect/onboarding-link', {
    method: 'POST',
  });
}

export async function requestStripeConnectDashboardLink(
  accessToken: string,
): Promise<StripeDashboardLink> {
  return request<StripeDashboardLink>(accessToken, '/v1/providers/me/stripe-connect/dashboard-link', {
    method: 'POST',
  });
}

export interface SignedUploadResponse {
  uploadUrl: string;
  uploadToken: string;
  objectPath: string;
  expiresAt: string;
}

export async function getVerification(accessToken: string): Promise<VerificationResponse> {
  return request<VerificationResponse>(accessToken, '/v1/providers/me/verification', {
    method: 'GET',
  });
}

export async function confirmPhoneVerification(accessToken: string): Promise<VerificationResponse> {
  return request<VerificationResponse>(accessToken, '/v1/providers/me/verification/phone-confirm', {
    method: 'POST',
  });
}

export async function confirmIdDocUpload(
  accessToken: string,
  objectPath: string,
): Promise<VerificationResponse> {
  return request<VerificationResponse>(accessToken, '/v1/providers/me/verification/id-doc', {
    method: 'POST',
    body: JSON.stringify({ objectPath }),
  });
}

export async function requestIdDocSignedUrl(
  accessToken: string,
  contentType: 'image/jpeg' | 'image/png' | 'application/pdf',
  contentLengthBytes: number,
): Promise<SignedUploadResponse> {
  return request<SignedUploadResponse>(accessToken, '/v1/uploads/signed-url', {
    method: 'POST',
    body: JSON.stringify({ kind: 'id-doc', contentType, contentLengthBytes }),
  });
}

export type UploadKind = 'license-doc' | 'insurance-doc' | 'id-doc' | 'avatar' | 'state-childcare-registration';

export async function requestSignedUploadUrl(
  accessToken: string,
  kind: UploadKind,
  contentType: 'image/jpeg' | 'image/png' | 'application/pdf',
  contentLengthBytes: number,
): Promise<SignedUploadResponse> {
  return request<SignedUploadResponse>(accessToken, '/v1/uploads/signed-url', {
    method: 'POST',
    body: JSON.stringify({ kind, contentType, contentLengthBytes }),
  });
}

export interface LicenseBoardInfo {
  state: UsState;
  specialty: Specialty;
  boardName: string;
  registerUrl: string;
  mode: 'api' | 'portal-only';
  hint?: string;
}

export interface SpecialistCredentials {
  providerId: string;
  role: SupplyRole;
  residentState: UsState;
  specialty: Specialty | null;
  licenseBoardSupported: boolean;
  defaultBoard: LicenseBoardInfo | null;
  altBoardsInState: LicenseBoardInfo[];
  licenseBoardState: UsState | null;
  licenseNumber: string | null;
  licenseDocObjectPath: string | null;
  licenseUploadedAt: string | null;
  insuranceDocObjectPath: string | null;
  insuranceUploadedAt: string | null;
  decision: 'verified' | 'rejected' | null;
  decisionAt: string | null;
  decisionByAdminUid: string | null;
  decisionNotes: string | null;
}

export async function getSpecialistCredentials(accessToken: string): Promise<SpecialistCredentials> {
  return request<SpecialistCredentials>(accessToken, '/v1/providers/me/credentials', {
    method: 'GET',
  });
}

export async function confirmLicenseDocUpload(
  accessToken: string,
  payload: { objectPath: string; licenseNumber?: string | null; licenseBoardState?: UsState | null },
): Promise<SpecialistCredentials> {
  return request<SpecialistCredentials>(accessToken, '/v1/providers/me/credentials/license', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function confirmInsuranceDocUpload(
  accessToken: string,
  objectPath: string,
): Promise<SpecialistCredentials> {
  return request<SpecialistCredentials>(accessToken, '/v1/providers/me/credentials/insurance', {
    method: 'POST',
    body: JSON.stringify({ objectPath }),
  });
}

export interface ProviderProfile {
  providerId: string;
  role: SupplyRole;
  categories: CaregiverCategory[] | null;
  specialty: Specialty | null;
  displayName: string | null;
  headline: string | null;
  bio: string | null;
  languages: string[];
  specialtyTags: string[];
  photoObjectPath: string | null;
  publishedRateCents: number | null;
  perChildSurchargeCents: number | null;
  availabilityGrid: AvailabilityGrid;
  availabilityNote: string | null;
  paused: boolean;
  w10TaxCreditFriendly: boolean;
  rateUnit: 'hour' | 'session';
  multiChildSurchargeEligible: boolean;
  w10Eligible: boolean;
}

export interface ProviderProfilePatch {
  displayName?: string | null;
  headline?: string | null;
  bio?: string | null;
  languages?: string[];
  specialtyTags?: string[];
  photoObjectPath?: string | null;
  publishedRateCents?: number | null;
  perChildSurchargeCents?: number | null;
  availabilityGrid?: AvailabilityGrid;
  availabilityNote?: string | null;
  paused?: boolean;
  w10TaxCreditFriendly?: boolean;
}

export async function getProviderProfile(accessToken: string): Promise<ProviderProfile> {
  return request<ProviderProfile>(accessToken, '/v1/providers/me/profile', { method: 'GET' });
}

export async function patchProviderProfile(
  accessToken: string,
  payload: ProviderProfilePatch,
): Promise<ProviderProfile> {
  return request<ProviderProfile>(accessToken, '/v1/providers/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
