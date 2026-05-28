/**
 * Cancellation policy calculator (OH-112).
 *
 * Pure-TS deep module per ADR-0004. Encodes the v1 platform-wide cancellation
 * rule from CONTEXT.md § Cancellation policy:
 *
 *   - Parent-initiated, ≥24h before start → free (full refund)
 *   - Parent-initiated, <24h and ≥2h      → 50% charge
 *   - Parent-initiated, <2h or after start → 100% charge
 *   - Provider-initiated                  → free in v1 (Provider tracked
 *     for admin review at the state-machine layer, not here)
 *
 * The arithmetic operates on the Booking's `agreed_rate × scope` original
 * authorized amount (in integer cents). The split returned satisfies the
 * invariant `chargeCents + refundCents = originalAuthorizedCents` for every
 * input.
 *
 * Per-Provider cancellation policies are deferred past v1 — this module is
 * intentionally policy-table-free.
 */

export const CANCELLATION_PARTIES = ['parent', 'provider'] as const;
export type CancellationParty = (typeof CANCELLATION_PARTIES)[number];

export const CANCELLATION_TIERS = ['free', 'half', 'full'] as const;
export type CancellationTier = (typeof CANCELLATION_TIERS)[number];

export interface CancellationInput {
  /** The originally authorized amount on the Parent's payment intent, in cents. Integer ≥ 0. */
  originalAuthorizedCents: number;
  /** The Booking's planned start time. */
  bookingStartAt: Date;
  /** The wall-clock time at which the cancellation was filed. */
  cancellationAt: Date;
  /** Which party initiated the cancellation. */
  cancelledBy: CancellationParty;
}

export interface CancellationResult {
  /** Amount captured from the Parent (flows to Provider less Commission downstream). */
  chargeCents: number;
  /** Amount refunded to the Parent. */
  refundCents: number;
  /** Which tier of the policy table this cancellation landed in. */
  tier: CancellationTier;
}

export const CANCELLATION_FREE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
export const CANCELLATION_HALF_THRESHOLD_MS = 2 * 60 * 60 * 1000;

/**
 * Compute the refund/charge split for a cancellation.
 *
 * Pure + deterministic. Inputs in integer cents → outputs in integer cents
 * with the invariant `chargeCents + refundCents = originalAuthorizedCents`.
 *
 * Rounding: when the 50% tier produces a half-cent split (original is odd),
 * the charge is floored and the refund absorbs the spare cent — the Parent
 * is never overcharged by rounding.
 *
 * Throws on invalid inputs (negative / non-integer cents). Bad inputs are a
 * caller bug — the handler must validate before invoking.
 */
export function calculateCancellation(input: CancellationInput): CancellationResult {
  const { originalAuthorizedCents, bookingStartAt, cancellationAt, cancelledBy } = input;

  if (!Number.isInteger(originalAuthorizedCents) || originalAuthorizedCents < 0) {
    throw new Error(
      `originalAuthorizedCents must be a non-negative integer (got ${originalAuthorizedCents})`,
    );
  }
  if (Number.isNaN(bookingStartAt.getTime()) || Number.isNaN(cancellationAt.getTime())) {
    throw new Error('bookingStartAt and cancellationAt must be valid Dates');
  }

  if (cancelledBy === 'provider') {
    return {
      chargeCents: 0,
      refundCents: originalAuthorizedCents,
      tier: 'free',
    };
  }

  const millisecondsBeforeStart = bookingStartAt.getTime() - cancellationAt.getTime();

  if (millisecondsBeforeStart >= CANCELLATION_FREE_THRESHOLD_MS) {
    return {
      chargeCents: 0,
      refundCents: originalAuthorizedCents,
      tier: 'free',
    };
  }

  if (millisecondsBeforeStart >= CANCELLATION_HALF_THRESHOLD_MS) {
    const chargeCents = Math.floor(originalAuthorizedCents / 2);
    return {
      chargeCents,
      refundCents: originalAuthorizedCents - chargeCents,
      tier: 'half',
    };
  }

  return {
    chargeCents: originalAuthorizedCents,
    refundCents: 0,
    tier: 'full',
  };
}

export const CANCELLATION_MODULE_VERSION = '0.1.0-OH-112';
