/**
 * Parent Subscription — pure-TS deep module (OH-193).
 *
 * The Parent (demand) side is monetized by a **Parent Subscription** (Stripe
 * Billing, the Parent is a Stripe *Customer*; ADR-0011 / CONTEXT.md §
 * Subscription). An *active* subscription is precisely what "unlocks full search
 * (lifting the preview blur), messaging, sending Book-requests, posting Jobs, and
 * booking Provider consultations" (PRD-0001 v1.7 stories 7–9). Without it a
 * Parent has a free browse account (the blur-to-unblur preview) and is walled off
 * those four actions; the gate fires identically on first attempt at any of them.
 *
 * This module is the single source of truth for that derivation: it maps a Stripe
 * subscription `status` into the Parent's **access decision**. Every surface that
 * needs the answer — the Parent's own subscription summary (the state the M3
 * paywall reads), and the (later, M3) search-unblur / messaging / Book-request /
 * Job-posting / consultation gates — reads it from here rather than re-checking
 * the status, so the paywall can never drift between callers.
 *
 * The sibling of the Provider listing gate (packages/domain/src/provider-
 * subscription): same Stripe-billing lifecycle, a different platform meaning
 * ("Parent access" vs "Provider listing"). Kept as its own self-contained module
 * — like caregiver-profile vs provider-profile (OH-188/189) — so the two gates
 * stay independently navigable rather than coupling demand-side access to
 * supply-side listing.
 *
 * Pure + deterministic — no I/O, no clock. The handler supplies the persisted
 * `status` (mirrored from Stripe billing webhooks onto `parent_subscriptions`).
 * Deno-clean (no runtime `@our-haven/*` import, and — deliberately — no relative
 * import of the sibling `provider-subscription` module) so the Edge tree imports
 * it cross-tree via an explicit `.ts` specifier (ADR-0019; OH-184/186/188/189/191).
 * That self-containment is why the Stripe-lifecycle primitives below are mirrored
 * here rather than shared from provider-subscription — the same intentional
 * duplication as `roles.ts` between the backend and Edge trees; the barrel
 * (packages/domain/src/index.ts) re-exports provider-subscription's copies as the
 * single canonical surface for `@our-haven/domain` consumers.
 */

/**
 * The Stripe Billing subscription lifecycle (the `status` field on a Subscription
 * object). Mirrored here so the gate is expressed in domain terms rather than a
 * stringly-typed webhook field. `null` models "no subscription on file yet" (a
 * Parent who has not started checkout — the free browse account).
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
 * The statuses under which a Parent is ENTITLED (the marketplace is unlocked —
 * full search + messaging + Book-requests + Job posting + consultation booking).
 *
 * Tied strictly to "active" per the OH-193 acceptance criterion:
 *   - `active`   — paid + current.
 *   - `trialing` — the trial form of active; access is granted while the trial
 *                  runs (Stripe flips it to `active` or `past_due`/`canceled` at
 *                  trial end), so it is entitled.
 *
 * Everything else walls the Parent back to the free browse account — including
 * `past_due`. Stripe smart-retries a failed renewal over several days while the
 * status sits at `past_due`; we deliberately do NOT grant a grace window here.
 * Keeping the gate to exactly {active, trialing} is the simplest faithful reading
 * of "active subscription" and avoids unlocked surfaces flapping on a transient
 * dunning state. (A future past_due grace window, if the business wants one,
 * belongs as an explicit knob here — not smuggled into the meaning of "active".)
 */
export const ACCESS_GRANTING_STATUSES = ['active', 'trialing'] as const satisfies readonly StripeSubscriptionStatus[];

export function isAccessGrantingStatus(status: StripeSubscriptionStatus | null): boolean {
  return status != null && (ACCESS_GRANTING_STATUSES as readonly string[]).includes(status);
}

/**
 * Why a Parent is or is not entitled — a small closed vocabulary so callers can
 * surface a precise, copy-ready reason (and the paywall the right CTA) without
 * re-deriving it from the raw status.
 *   - `active`     entitled: the subscription is `active`.
 *   - `trialing`   entitled: the subscription is in its trial.
 *   - `none`       not entitled: no subscription on file (free browse account).
 *   - `inactive`   not entitled: a subscription exists but is not current
 *                  (past_due / canceled / unpaid / incomplete* / paused).
 */
export type ParentAccessReason = 'active' | 'trialing' | 'none' | 'inactive';

export interface ParentAccessDecision {
  /** The gate: true iff the marketplace is unlocked for this Parent. */
  entitled: boolean;
  /** The status the decision was derived from (echoed for callers/telemetry). */
  status: StripeSubscriptionStatus | null;
  reason: ParentAccessReason;
}

/**
 * Collapse a persisted subscription status into the Parent access decision. The
 * sole gate for the demand-side paywall: full search, messaging, Book-requests,
 * Job posting, and Provider-consultation booking (OH-193; CONTEXT § Subscription).
 */
export function deriveAccessDecision(input: {
  status: StripeSubscriptionStatus | null;
}): ParentAccessDecision {
  const { status } = input;
  if (status === 'active') return { entitled: true, status, reason: 'active' };
  if (status === 'trialing') return { entitled: true, status, reason: 'trialing' };
  if (status == null) return { entitled: false, status, reason: 'none' };
  return { entitled: false, status, reason: 'inactive' };
}

export const PARENT_SUBSCRIPTION_MODULE_VERSION = '0.1.0-OH-193';
