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

// Unified Search (OH-201) — one Parent-facing surface across Caregivers + Providers.
export type SearchResponse = paths['/v1/search']['get']['responses'][200]['content']['application/json'];
export type SearchQuery = NonNullable<paths['/v1/search']['get']['parameters']['query']>;
export type SearchResultItem = SearchResponse['results'][number];
export type SearchResultCard = Extract<SearchResultItem, { kind: 'full' }>['card'];
export type SearchBlurredCard = Extract<SearchResultItem, { kind: 'blurred' }>['card'];
export type SearchSupplyRole = SearchResultCard['role'];
export type SearchCta = SearchResultCard['ctas'][number];

// Parent-facing supply profile detail (OH-202) — the destination of a Search tap.
export type SupplyProfile = paths['/v1/supply/{providerId}']['get']['responses'][200]['content']['application/json'];
export type SupplyProfileCategoryRate = SupplyProfile['categoryRates'][number];
export type SupplyProfileCredential = SupplyProfile['credentials'][number];
export type SupplyProfileReview = SupplyProfile['rating']['reviews'][number];
export type SupplyProfileSlot = SupplyProfile['consultationSlots'][number];
export type SupplyProfileProviderCredential = NonNullable<SupplyProfile['providerCredential']>;

// Provider consultation booking (OH-203) — book an open slot; the schedule both
// parties read; cancellation. The POST + list item share one BookingSummary shape.
export type BookingSummary = paths['/v1/bookings']['get']['responses'][200]['content']['application/json']['bookings'][number];

// Parent Subscription (OH-193 server / OH-204 paywall). The summary the demand-side
// paywall reads (`entitled` is the gate); the hosted-checkout link the paywall opens;
// the Billing Portal link the entitled "manage subscription" affordance opens.
export type ParentSubscription = paths['/v1/parents/me/subscription']['get']['responses'][200]['content']['application/json'];
export type ParentSubscriptionStatus = ParentSubscription['status'];
export type ParentCheckoutLink = paths['/v1/parents/me/subscription/checkout-link']['post']['responses'][200]['content']['application/json'];
export type ParentCheckoutLinkBody = NonNullable<paths['/v1/parents/me/subscription/checkout-link']['post']['requestBody']>['content']['application/json'];
export type ParentPortalLink = paths['/v1/parents/me/subscription/portal-link']['post']['responses'][200]['content']['application/json'];

// Provider Subscription (OH-191 server / OH-222 shell). Provider is a Stripe
// Customer (NOT Connect) — the subscription is what makes the practice `listed`
// (search-visible + bookable). The shell reads the status and opens the two
// hosted linkouts (checkout to start, Billing Portal to manage / cancel).
export type ProviderSubscription = paths['/v1/providers/me/subscription']['get']['responses'][200]['content']['application/json'];
export type ProviderSubscriptionStatus = ProviderSubscription['status'];
export type ProviderCheckoutLink = paths['/v1/providers/me/subscription/checkout-link']['post']['responses'][200]['content']['application/json'];
export type ProviderPortalLink = paths['/v1/providers/me/subscription/portal-link']['post']['responses'][200]['content']['application/json'];

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

/**
 * Unified Search (OH-201). One Parent-facing query across both supply roles —
 * filters + the OH-180 hybrid ranking + the blur-to-unblur preview wall. The
 * response carries `entitled` (the Subscription gate) and a rank-ordered
 * `results` list where each item is a `full` SupplyCard or a `blurred` teaser
 * (locked until the Parent subscribes and re-fetches as entitled).
 */
export function getSearch(query: SearchQuery = {}): Promise<SearchResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return get<SearchResponse>(`/v1/search${qs ? `?${qs}` : ''}`);
}

/**
 * Read one listable supply member's Parent-facing profile (OH-202). The
 * destination of a Search result tap: full per-category Rates, availability,
 * ages/behaviour-comfort, badges, APPROVED Credentials only, and public Ratings.
 * `zip` is the viewer's search origin — when supplied (and resolvable), the
 * response carries a `distanceMiles`. 404 when the id is unknown or not listable.
 */
export function getSupplyProfile(providerId: string, zip?: string): Promise<SupplyProfile> {
  const qs = zip && zip.trim().length > 0 ? `?zip=${encodeURIComponent(zip.trim())}` : '';
  return get<SupplyProfile>(`/v1/supply/${providerId}${qs}`);
}

/**
 * Book one of a Provider's open consultation slots (OH-203). Creates a per-session
 * Provider Booking born `accepted` with NULL payment (off-platform) and holds the
 * slot. Throws ApiError 402 when the Parent has no active Subscription, 409 when
 * the slot is no longer open.
 */
export function bookConsultation(providerId: string, slotId: string): Promise<BookingSummary> {
  return post<BookingSummary>(`/v1/supply/${providerId}/consultation-bookings`, { slotId });
}

/** The caller's schedule — their consultation Bookings, from the viewer's perspective (OH-203). */
export function getBookings(): Promise<BookingSummary[]> {
  return get<{ bookings: BookingSummary[] }>('/v1/bookings').then((r) => r.bookings);
}

/**
 * Caregiver Booking payment lifecycle (OH-211) — the Parent read/confirm/dispute
 * surface + the cancellation charge. `getBooking` is the detail (payment + schedule
 * + reveal-at-accept address); `getBookingCancelPreview` returns the M2.5 charge
 * split for the CancelSheet; `cancelBooking` executes it (free release / partial
 * capture); `confirmBookingHours` captures + completes inside the ~24h review
 * window; `disputeBooking` holds the payout (in-window) or files an admin
 * escalation (out-of-window). Provider consultations reuse `cancelBooking` (no fee).
 */
export type BookingDetail = paths['/v1/bookings/{bookingId}']['get']['responses'][200]['content']['application/json'];
export type BookingCancelPreview =
  paths['/v1/bookings/{bookingId}/cancel-preview']['get']['responses'][200]['content']['application/json'];
export type BookingCancelResult =
  paths['/v1/bookings/{bookingId}/cancel']['post']['responses'][200]['content']['application/json'];
export type BookingConfirmResult =
  paths['/v1/bookings/{bookingId}/confirm-hours']['post']['responses'][200]['content']['application/json'];
export type BookingDisputeBody =
  paths['/v1/bookings/{bookingId}/dispute']['post']['requestBody']['content']['application/json'];
export type BookingDisputeResult =
  paths['/v1/bookings/{bookingId}/dispute']['post']['responses'][200]['content']['application/json'];
export type BookingDisputeReason = BookingDisputeBody['reason'];
export type BookingPaymentStatus = NonNullable<BookingDetail['paymentStatus']>;
export type CancellationTier = BookingCancelPreview['tier'];

/** One Booking's detail (payment + schedule + counterparty). */
export function getBooking(bookingId: string): Promise<BookingDetail> {
  return get<BookingDetail>(`/v1/bookings/${bookingId}`);
}

/** Preview the cancellation charge (M2.5 calculator) before confirming. */
export function getBookingCancelPreview(bookingId: string): Promise<BookingCancelPreview> {
  return get<BookingCancelPreview>(`/v1/bookings/${bookingId}/cancel-preview`);
}

/** Cancel a Booking — provider (release slot) or caregiver (M2.5 charge). */
export function cancelBooking(bookingId: string): Promise<BookingCancelResult> {
  return post<BookingCancelResult>(`/v1/bookings/${bookingId}/cancel`, {});
}

/** Confirm the session hours within the review window → capture + payout. */
export function confirmBookingHours(bookingId: string): Promise<BookingConfirmResult> {
  return post<BookingConfirmResult>(`/v1/bookings/${bookingId}/confirm-hours`, undefined);
}

/** File a charge dispute (in-window payout hold / out-of-window admin escalation). */
export function disputeBooking(bookingId: string, body: BookingDisputeBody): Promise<BookingDisputeResult> {
  return post<BookingDisputeResult>(`/v1/bookings/${bookingId}/dispute`, body);
}

/**
 * Parent Subscription — the demand-side paywall (OH-204) on top of OH-193's
 * server endpoints. `getParentSubscription` reads the gate state (`entitled`,
 * true iff status is active/trialing); `createParentCheckoutLink` returns the
 * Stripe-hosted Checkout URL the paywall opens (status flips when the billing
 * webhook fires, so the paywall polls the summary on return);
 * `createParentPortalLink` returns the Billing Portal URL for an entitled Parent
 * to manage / cancel. Parent-role-gated server-side (403 for supply roles).
 */

export function getParentSubscription(): Promise<ParentSubscription> {
  return get<ParentSubscription>('/v1/parents/me/subscription');
}

export function createParentCheckoutLink(body: ParentCheckoutLinkBody = {}): Promise<ParentCheckoutLink> {
  return post<ParentCheckoutLink>('/v1/parents/me/subscription/checkout-link', body);
}

export function createParentPortalLink(): Promise<ParentPortalLink> {
  return post<ParentPortalLink>('/v1/parents/me/subscription/portal-link', undefined);
}

/**
 * Provider Subscription (OH-191 server / OH-222 shell). `getProviderSubscription`
 * reads the listing state (`listed` is the gate — true iff status is
 * active/trialing — which is what lets a Provider publish bookable slots and show
 * in Search); `createProviderCheckoutLink` returns the Stripe-hosted Checkout URL
 * to start the subscription (the listing flips when the billing webhook fires, so
 * the shell polls the summary on return); `createProviderPortalLink` returns the
 * Billing Portal URL to manage / cancel. Provider-role-gated server-side (403).
 */

export function getProviderSubscription(): Promise<ProviderSubscription> {
  return get<ProviderSubscription>('/v1/providers/me/subscription');
}

export function createProviderCheckoutLink(): Promise<ProviderCheckoutLink> {
  return post<ProviderCheckoutLink>('/v1/providers/me/subscription/checkout-link', undefined);
}

export function createProviderPortalLink(): Promise<ProviderPortalLink> {
  return post<ProviderPortalLink>('/v1/providers/me/subscription/portal-link', undefined);
}

/**
 * In-app Messaging (OH-205). `openThread` is the Parent's idempotent
 * get-or-create of a pre-acceptance Direct-Message thread with a Caregiver
 * (402 when not subscribed, 404 when the Caregiver is not listable); `getThreads`
 * is the caller's inbox (Parent or Caregiver viewer perspective);
 * `getThreadMessages` reads a thread's transcript (bodies already redacted —
 * delivery-safe); `sendMessage` posts a message (redacted at write time, the
 * unredacted original queued for Trust & Safety; a Parent send is
 * Subscription-gated). Live delivery is via Supabase Realtime on the `messages`
 * table (see lib/useMessageThread) — these calls are the initial load + send.
 */

export type MessageThreadSummary = paths['/v1/threads']['get']['responses'][200]['content']['application/json']['threads'][number];
export type ChatMessage = paths['/v1/threads/{threadId}/messages']['get']['responses'][200]['content']['application/json']['messages'][number];
type OpenThreadBody = paths['/v1/threads']['post']['requestBody']['content']['application/json'];
type SendMessageBody = paths['/v1/threads/{threadId}/messages']['post']['requestBody']['content']['application/json'];

export function openThread(providerId: string): Promise<MessageThreadSummary> {
  return post<MessageThreadSummary>('/v1/threads', { providerId } satisfies OpenThreadBody);
}

export function getThreads(): Promise<MessageThreadSummary[]> {
  return get<{ threads: MessageThreadSummary[] }>('/v1/threads').then((r) => r.threads);
}

export function getThreadMessages(threadId: string, limit?: number): Promise<ChatMessage[]> {
  const qs = limit ? `?limit=${limit}` : '';
  return get<{ messages: ChatMessage[] }>(`/v1/threads/${threadId}/messages${qs}`).then((r) => r.messages);
}

export function sendMessage(threadId: string, body: string): Promise<ChatMessage> {
  return post<ChatMessage>(`/v1/threads/${threadId}/messages`, { body } satisfies SendMessageBody);
}

/**
 * Ad-hoc embedded video calls inside a thread (OH-216; ADR-0008). `startThreadCall`
 * creates a short-lived (~30 min) Daily.co private room, logs the link generation
 * for Trust & Safety (no content recorded), and posts a "Join video call" poke the
 * counterparty receives over the messaging Realtime pipe — it returns the
 * initiator's join session (room URL + owner token) plus the poke message so the
 * caller can add the bubble without a refetch. `joinCall` mints a fresh per-user
 * token for a still-live call (throws 410 `call_expired` once it has ended). A
 * Parent start/join is Subscription-gated (402); 503 when video is unconfigured.
 * The room is entered via the Daily SDK on native / an iframe on web.
 */
export type VideoCallSession =
  paths['/v1/calls/{callId}/join']['post']['responses'][200]['content']['application/json'];
export type StartVideoCallResult =
  paths['/v1/threads/{threadId}/calls']['post']['responses'][201]['content']['application/json'];

export function startThreadCall(threadId: string): Promise<StartVideoCallResult> {
  return post<StartVideoCallResult>(`/v1/threads/${threadId}/calls`, undefined);
}

export function joinCall(callId: string): Promise<VideoCallSession> {
  return post<VideoCallSession>(`/v1/calls/${callId}/join`, undefined);
}

/**
 * Structured Offers / Book-requests inside a thread (OH-206). `getThreadOffers`
 * lists a thread's Offers (the exact service address is projected per viewer +
 * status — hidden from the Caregiver until accept); `sendOffer` composes one
 * (a Parent send is Subscription-gated; the rate locks to the published Rate when
 * the Caregiver is non-negotiable; the Safety-Behaviors disclosure is required).
 * accept / decline / withdraw / counter drive the Offer state machine — Counter is
 * unavailable against a non-negotiable Caregiver. The sender may also edit (PATCH)
 * or delete (DELETE) their OWN Offer while it is still pending (OH-208). Offers are
 * read through the Edge (never direct/Realtime); the thread refetches them on a
 * messages poke + focus.
 */
export type Offer = paths['/v1/threads/{threadId}/offers']['get']['responses'][200]['content']['application/json']['offers'][number];
export type OfferStatus = Offer['status'];
export type OfferServiceAddress = Offer['serviceAddress'];
export type OfferSlot = Offer['slots'][number];
export type ComposeOfferBody = paths['/v1/threads/{threadId}/offers']['post']['requestBody']['content']['application/json'];
export type OfferSchedule = ComposeOfferBody['schedule'];
export type CounterOfferBody = paths['/v1/offers/{offerId}/counter']['post']['requestBody']['content']['application/json'];
/** An edit revises the same fields as a compose (the Edge re-runs the full pipeline). */
export type EditOfferBody = paths['/v1/offers/{offerId}']['patch']['requestBody']['content']['application/json'];

export function getThreadOffers(threadId: string): Promise<Offer[]> {
  return get<{ offers: Offer[] }>(`/v1/threads/${threadId}/offers`).then((r) => r.offers);
}

export function sendOffer(threadId: string, body: ComposeOfferBody): Promise<Offer> {
  return post<Offer>(`/v1/threads/${threadId}/offers`, body);
}

export function acceptOffer(offerId: string): Promise<Offer> {
  return post<Offer>(`/v1/offers/${offerId}/accept`, undefined);
}

export function declineOffer(offerId: string): Promise<Offer> {
  return post<Offer>(`/v1/offers/${offerId}/decline`, undefined);
}

export function withdrawOffer(offerId: string): Promise<Offer> {
  return post<Offer>(`/v1/offers/${offerId}/withdraw`, undefined);
}

export function counterOffer(offerId: string, body: CounterOfferBody): Promise<Offer> {
  return post<Offer>(`/v1/offers/${offerId}/counter`, body);
}

/** Edit a still-pending Offer in place (sender only) — returns the revised Offer. */
export function editOffer(offerId: string, body: EditOfferBody): Promise<Offer> {
  return patchJson<Offer>(`/v1/offers/${offerId}`, body);
}

/** Hard-delete a still-pending Offer (sender only). */
export function deleteOffer(offerId: string): Promise<{ deleted: true }> {
  return del<{ deleted: true }>(`/v1/offers/${offerId}`);
}

// ── Posted Jobs (OH-209) ─────────────────────────────────────────────────────
export type CreateJobBody = paths['/v1/jobs']['post']['requestBody']['content']['application/json'];
export type CreateJobResult = paths['/v1/jobs']['post']['responses'][201]['content']['application/json'];
export type PostedJob = CreateJobResult['jobs'][number];
export type JobSchedule = CreateJobBody['schedule'];
export type JobServiceAddress = CreateJobBody['serviceAddress'];

/** Compose + PUBLISH a posted Job. Publishing is Parent-Subscription-gated (402);
 *  a multi-day one-off returns one Job per date (ADR-0014). */
export function postJob(body: CreateJobBody): Promise<CreateJobResult> {
  return post<CreateJobResult>('/v1/jobs', body);
}

// ── My Jobs hub + Applications review + Award (OH-210) ────────────────────────
/**
 * The Parent-facing read/award surface over posted Jobs. `getJobs` powers the My
 * Jobs hub (the client buckets by `state` into Open / Awarded / Past / Drafts);
 * `getJob` + `getJobApplications` power Job detail; `getApplication` powers the
 * Application detail (caregiver + live Offer). `editJob` / `closeJob` manage a
 * pre-award Job (both gated / confirm-gated). `awardApplication` awards the Job to
 * a Caregiver (mock payment → Booking `requested` / Series + auto-declines others);
 * `declineApplication` / `counterApplication` are the other Offer-card actions
 * (Counter is negotiable-gated — hidden client-side when `caregiver.negotiable`).
 */
export type MyJob = paths['/v1/jobs']['get']['responses'][200]['content']['application/json']['jobs'][number];
export type JobApplication =
  paths['/v1/jobs/{jobId}/applications']['get']['responses'][200]['content']['application/json']['applications'][number];
export type ApplicationOffer = NonNullable<JobApplication['offer']>;
export type ApplicationCaregiver = JobApplication['caregiver'];
export type ApplicationState = JobApplication['state'];
export type AwardResult =
  paths['/v1/applications/{applicationId}/award']['post']['responses'][200]['content']['application/json'];
/** Per-Booking authorize outcome (OH-211) — the client runs 3DS on `requires_action`. */
export type AwardPayment = AwardResult['payments'][number];
export type CounterApplicationBody =
  paths['/v1/applications/{applicationId}/counter']['post']['requestBody']['content']['application/json'];
export type CounterApplicationResult =
  paths['/v1/applications/{applicationId}/counter']['post']['responses'][200]['content']['application/json'];

/** The Parent's posted Jobs for the My Jobs hub (newest first; client buckets by state). */
export function getJobs(): Promise<MyJob[]> {
  return get<{ jobs: MyJob[] }>('/v1/jobs').then((r) => r.jobs);
}

export function getJob(jobId: string): Promise<MyJob> {
  return get<MyJob>(`/v1/jobs/${jobId}`);
}

/** Edit a still-open Job in place (re-runs the compose pipeline; Subscription-gated). */
export function editJob(jobId: string, body: CreateJobBody): Promise<MyJob> {
  return patchJson<MyJob>(`/v1/jobs/${jobId}`, body);
}

/** Close a Job — withdraws its open Applications (surfaces a confirm modal client-side). */
export function closeJob(jobId: string): Promise<MyJob> {
  return post<MyJob>(`/v1/jobs/${jobId}/close`, undefined);
}

export function getJobApplications(jobId: string): Promise<JobApplication[]> {
  return get<{ applications: JobApplication[] }>(`/v1/jobs/${jobId}/applications`).then((r) => r.applications);
}

export function getApplication(applicationId: string): Promise<JobApplication> {
  return get<JobApplication>(`/v1/applications/${applicationId}`);
}

/**
 * Award the Job to this Application's Caregiver (OH-211). The card is resolved
 * server-side from the Parent's subscription; a near-term one-off is authorized
 * immediately (the response's `payments[]` carry a `clientSecret` the client uses
 * to run opportunistic 3DS on `requires_action`), Series/far-future occurrences
 * are `scheduled`. Booking(s) born `requested`; the other applicants auto-decline.
 */
export function awardApplication(applicationId: string): Promise<AwardResult> {
  return post<AwardResult>(`/v1/applications/${applicationId}/award`, {});
}

export function declineApplication(applicationId: string): Promise<{ applicationId: string; state: 'declined' }> {
  return post<{ applicationId: string; state: 'declined' }>(`/v1/applications/${applicationId}/decline`, undefined);
}

/** Parent counter-Offer on an Application (revised rate + optional note; gated). */
export function counterApplication(
  applicationId: string,
  body: CounterApplicationBody,
): Promise<CounterApplicationResult> {
  return post<CounterApplicationResult>(`/v1/applications/${applicationId}/counter`, body);
}
