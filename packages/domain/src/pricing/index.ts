/**
 * Pricing & Commission calculator (OH-178; completes the OH-112 draft).
 *
 * Pure-TS deep module per ADR-0004. Computes the full receipt for a *Caregiver*
 * Booking from its Agreed Rate (the accepted Offer's `proposed_rate`) and the
 * ancillary inputs, plus the commission-exempt Tip pass-through (ADR-0018).
 *
 * ── Caregiver-only (ADR-0011) ──────────────────────────────────────────────
 * Provider consultations carry no on-platform money — no charge, Commission, or
 * Payout (off-platform, HIPAA) — so they NEVER enter this calculator. The
 * `category` input is typed `CaregiverCategory`, making a Provider
 * unrepresentable here. Caregiver Bookings are **hourly only** (the per-session
 * Offer variant retired with the off-platform Provider tier — CONTEXT.md
 * § Offer), so there is no billing-model switch.
 *
 * Math reference: CONTEXT.md § Rate + § Commission + § Sales tax model + § Tip.
 *
 *     base         = round(agreedRateCents × hours)
 *     surcharge    = round(perChildSurchargeCents × hours × max(0, childCount-1))
 *     parentCharge = base + surcharge                          ← what the Parent pays
 *     commission   = round(parentCharge × commissionBp / 10_000) ← platform skim
 *     payout       = parentCharge - commission                 ← the Caregiver's Payout
 *
 * A **Tip** (ADR-0018 / CONTEXT § Tip) is a Parent gratuity filed *after* the
 * Booking completes — it is NOT an input to the receipt above. It is 100%
 * pass-through to the Caregiver and carries **no Commission** (the skim does not
 * apply); it is modelled as a separate additive Payout line (`calculateTip` /
 * `caregiverTakeHome`).
 *
 * All amounts are integer cents. The Commission rate is expressed in basis
 * points (`commissionBp`) — 1500bp = 15%, 2000bp = 20% — to keep all math on
 * integers and avoid IEEE-754 drift on common percentages.
 *
 * Invariants enforced + property-tested:
 *   - parentChargeCents = baseCents + surchargeCents
 *   - parentChargeCents = caregiverPayoutCents + platformCommissionCents
 *   - parentChargeCents ≥ caregiverPayoutCents (i.e. commission ≥ 0)
 *   - a Tip adds to the Caregiver's take 1:1 and never to the Commission
 *   - Tutor callers must pass childCount=1 + perChildSurchargeCents=0
 */

import type { CaregiverCategory } from '@our-haven/shared';

export const COMMISSION_BP_MAX = 10_000; // = 100%

/**
 * Caregiver categories that are single-child by rule (CONTEXT.md § Rate — Tutor
 * engagements are `child_count == 1`). Babysitter / Nanny may take extra
 * children with a per-child surcharge.
 */
const SINGLE_CHILD_CATEGORIES: ReadonlySet<CaregiverCategory> = new Set(['tutor']);

export interface PricingInput {
  /** From the accepted Offer's `proposed_rate` — the hourly Agreed Rate. Integer cents ≥ 0. */
  agreedRateCents: number;
  /** Hours for the Booking. Non-negative, may be fractional (e.g. 2.5); 0 is a degenerate but legal input. */
  hours: number;
  /** Number of Children on the Booking. ≥ 1. Tutor must be 1. */
  childCount: number;
  /**
   * Babysitter / Nanny per-child surcharge, expressed in cents-per-hour and
   * snapshotted from the Offer's `per_child_surcharge_snapshot`. Tutor must
   * pass 0 (single-child).
   */
  perChildSurchargeCents: number;
  /** Platform Commission in basis points (1500 = 15%). 0 ≤ bp ≤ 10_000. */
  commissionBp: number;
  /** Caregiver category — gates single-child enforcement (Tutor). */
  category: CaregiverCategory;
}

export interface PricingResult {
  /** Agreed Rate × hours. Integer cents. */
  baseCents: number;
  /** Per-child surcharge total for hourly Babysitter / Nanny bookings. Integer cents, ≥ 0. */
  surchargeCents: number;
  /** What the Parent is charged. = baseCents + surchargeCents. */
  parentChargeCents: number;
  /** Our Haven's take. = round(parentChargeCents × commissionBp / 10_000). */
  platformCommissionCents: number;
  /** What the Caregiver receives, before any Tip. = parentChargeCents - platformCommissionCents. */
  caregiverPayoutCents: number;
  /** Sales tax handling tag — delegated to Stripe Tax (the only supported value in v1). */
  salesTaxHandling: 'stripe-tax';
}

/**
 * Compute the full pricing receipt for a Caregiver Booking.
 *
 * Pure + deterministic. Throws on caller-bug inputs (negative cents, negative /
 * non-finite hours, Tutor with multi-child or surcharge, commission out of
 * range). The handler must validate at the API boundary.
 */
export function calculatePricing(input: PricingInput): PricingResult {
  const { agreedRateCents, hours, childCount, perChildSurchargeCents, commissionBp, category } =
    input;

  // ---------- Input validation ----------
  if (!Number.isInteger(agreedRateCents) || agreedRateCents < 0) {
    throw new Error(`agreedRateCents must be a non-negative integer (got ${agreedRateCents})`);
  }
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error(`hours must be a non-negative finite number (got ${hours})`);
  }
  if (!Number.isInteger(childCount) || childCount < 1) {
    throw new Error(`childCount must be a positive integer (got ${childCount})`);
  }
  if (!Number.isInteger(perChildSurchargeCents) || perChildSurchargeCents < 0) {
    throw new Error(
      `perChildSurchargeCents must be a non-negative integer (got ${perChildSurchargeCents})`,
    );
  }
  if (!Number.isInteger(commissionBp) || commissionBp < 0 || commissionBp > COMMISSION_BP_MAX) {
    throw new Error(
      `commissionBp must be an integer in [0, ${COMMISSION_BP_MAX}] (got ${commissionBp})`,
    );
  }
  if (SINGLE_CHILD_CATEGORIES.has(category)) {
    if (childCount !== 1) {
      throw new Error(`${category} bookings are single-child only (got childCount=${childCount})`);
    }
    if (perChildSurchargeCents !== 0) {
      throw new Error(
        `${category} bookings cannot carry a per-child surcharge (got ${perChildSurchargeCents})`,
      );
    }
  }

  // ---------- Compute ----------
  const baseCents = Math.round(agreedRateCents * hours);

  const extraChildren = Math.max(0, childCount - 1);
  const surchargeCents = Math.round(perChildSurchargeCents * hours * extraChildren);

  const parentChargeCents = baseCents + surchargeCents;
  const platformCommissionCents = Math.round((parentChargeCents * commissionBp) / COMMISSION_BP_MAX);
  const caregiverPayoutCents = parentChargeCents - platformCommissionCents;

  return {
    baseCents,
    surchargeCents,
    parentChargeCents,
    platformCommissionCents,
    caregiverPayoutCents,
    salesTaxHandling: 'stripe-tax',
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Tip — post-session gratuity, commission-exempt (ADR-0018 / CONTEXT § Tip)
// ──────────────────────────────────────────────────────────────────────────

/**
 * A post-session **Tip**: an optional Parent gratuity on a completed Caregiver
 * Booking. 100% pass-through to the Caregiver, **no Commission** — the Pricing
 * skim does not apply. It is a separate additive Payout line, deliberately NOT
 * folded into the Booking receipt: a tip is filed *after* completion and is "not
 * an input" to `calculatePricing` (ADR-0018).
 */
export interface TipResult {
  /** The gratuity, echoed + validated. Integer cents ≥ 0 (0 = no / cleared tip). */
  tipCents: number;
  /** What the Caregiver receives from the Tip = tipCents (100% pass-through). */
  caregiverTipCents: number;
  /** Platform take on a Tip — always 0 (tips bypass the Commission skim, ADR-0018). */
  platformCommissionCents: 0;
}

/**
 * Compute the Tip Payout line. Pure + deterministic. A Tip is commission-exempt,
 * so the whole amount flows to the Caregiver and the platform takes nothing.
 * `0` is a valid amount — an absent or cleared tip (CONTEXT.md § Tip).
 *
 * Throws on caller-bug inputs (negative / non-integer cents).
 */
export function calculateTip(tipCents: number): TipResult {
  if (!Number.isInteger(tipCents) || tipCents < 0) {
    throw new Error(`tipCents must be a non-negative integer (got ${tipCents})`);
  }
  return { tipCents, caregiverTipCents: tipCents, platformCommissionCents: 0 };
}

/**
 * The Caregiver's full take-home for a completed Booking: the engagement Payout
 * plus any post-session Tip. The Tip is purely additive and bypasses the
 * Commission skim, so `platformCommissionCents` is the engagement skim alone —
 * the Tip adds nothing to it (ADR-0018). Pure helper composing a `PricingResult`
 * with a Tip amount.
 */
export interface CaregiverTakeHome {
  /** The engagement Payout (Agreed Rate × hours, less Commission). */
  engagementPayoutCents: number;
  /** The post-session Tip, 100% to the Caregiver. */
  tipCents: number;
  /** Total to the Caregiver = engagementPayoutCents + tipCents. */
  totalPayoutCents: number;
  /** Platform Commission — the engagement skim only; the Tip contributes nothing. */
  platformCommissionCents: number;
}

export function caregiverTakeHome(pricing: PricingResult, tipCents: number): CaregiverTakeHome {
  const tip = calculateTip(tipCents);
  return {
    engagementPayoutCents: pricing.caregiverPayoutCents,
    tipCents: tip.tipCents,
    totalPayoutCents: pricing.caregiverPayoutCents + tip.caregiverTipCents,
    platformCommissionCents: pricing.platformCommissionCents,
  };
}

export const PRICING_MODULE_VERSION = '0.2.0-OH-178';
