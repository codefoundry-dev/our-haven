/**
 * Provider Subscription — pure-TS deep module (OH-191).
 *
 * The clinical tier is monetized by a **Provider Subscription** (Stripe billing,
 * the Provider is a Stripe *Customer* — NOT a Connect account; ADR-0011 /
 * CONTEXT.md § Subscription). An *active* subscription is precisely what "lists
 * the Provider in search and enables consultation Bookings"; everything else
 * (lapsed, cancelled, never-started) hides the listing.
 *
 * This module is the single source of truth for that derivation: it maps a
 * Stripe subscription `status` into the platform's **listing decision**. Every
 * surface that needs the answer — the Provider's own subscription summary, the
 * clinical-profile projection, the consultation-slot publish gate, and the
 * (later) Parent-facing search query — reads it from here rather than
 * re-implementing the status check, so the gate can never drift between callers.
 *
 * Pure + deterministic — no I/O, no clock. The handler supplies the persisted
 * `status` (mirrored from Stripe billing webhooks onto `provider_subscriptions`).
 * Deno-clean (no runtime `@our-haven/*` import) so the Edge tree imports it
 * cross-tree via an explicit `.ts` specifier (ADR-0019; OH-184/186/188/189).
 */

/**
 * The Stripe Billing subscription lifecycle (the `status` field on a
 * Subscription object). Mirrored here so the gate is expressed in domain terms
 * rather than a stringly-typed webhook field. `null` models "no subscription on
 * file yet" (a Provider who has not started checkout).
 */
export type StripeSubscriptionStatus =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused';

export const STRIPE_SUBSCRIPTION_STATUSES: readonly StripeSubscriptionStatus[] = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
] as const;

export function isStripeSubscriptionStatus(value: string): value is StripeSubscriptionStatus {
  return (STRIPE_SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/**
 * The statuses under which a Provider is LISTED (search-visible + bookable).
 *
 * Tied strictly to "active" per the OH-191 acceptance criterion ("Listing gated
 * on active subscription"):
 *   - `active`   — paid + current.
 *   - `trialing` — the trial form of active; access is granted while the trial
 *                  runs (Stripe flips it to `active` or `past_due`/`canceled` at
 *                  trial end), so it is listed.
 *
 * Everything else hides the listing — including `past_due`. Stripe smart-retries
 * a failed renewal over several days while the status sits at `past_due`; we
 * deliberately do NOT grant a grace listing here. Keeping the gate to exactly
 * {active, trialing} is the simplest faithful reading of "active subscription"
 * and avoids a paid surface flapping on a transient dunning state. (A future
 * past_due grace window, if the business wants one, belongs as an explicit knob
 * here — not smuggled into the definition of "active".)
 */
export const LISTED_SUBSCRIPTION_STATUSES = ['active', 'trialing'] as const satisfies readonly StripeSubscriptionStatus[];

export function isListedStatus(status: StripeSubscriptionStatus | null): boolean {
  return status != null && (LISTED_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

/**
 * Why a Provider is or is not listed — a small closed vocabulary so callers can
 * surface a precise, copy-ready reason without re-deriving it from the raw
 * status.
 *   - `active`     listed: the subscription is `active`.
 *   - `trialing`   listed: the subscription is in its trial.
 *   - `none`       not listed: no subscription on file (never checked out).
 *   - `inactive`   not listed: a subscription exists but is not current
 *                  (past_due / canceled / unpaid / incomplete* / paused).
 */
export type ProviderListingReason = 'active' | 'trialing' | 'none' | 'inactive';

export interface ProviderListingDecision {
  /** The gate: true iff the Provider appears in search + can take consultation Bookings. */
  listed: boolean;
  /** The status the decision was derived from (echoed for callers/telemetry). */
  status: StripeSubscriptionStatus | null;
  reason: ProviderListingReason;
}

/**
 * Collapse a persisted subscription status into the listing decision. The sole
 * gate for Provider search-visibility + consultation bookability (OH-191 AC #2).
 */
export function deriveListingDecision(input: {
  status: StripeSubscriptionStatus | null;
}): ProviderListingDecision {
  const { status } = input;
  if (status === 'active') return { listed: true, status, reason: 'active' };
  if (status === 'trialing') return { listed: true, status, reason: 'trialing' };
  if (status == null) return { listed: false, status, reason: 'none' };
  return { listed: false, status, reason: 'inactive' };
}

export const PROVIDER_SUBSCRIPTION_MODULE_VERSION = '0.1.0-OH-191';
