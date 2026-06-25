/**
 * Pricing & Commission calculator (OH-112).
 *
 * Pure-TS deep module per ADR-0004. Computes the full receipt for a Booking
 * given its Agreed Rate (from the accepted Offer) and ancillary inputs.
 *
 * Math reference: CONTEXT.md § Rate + § Commission + § Sales tax model.
 *
 *   Hourly bookings (Caregivers — Babysitter / Tutor / Nanny):
 *     base       = round(agreedRateCents × hours)
 *     surcharge  = round(perChildSurchargeCents × hours × max(0, childCount-1))
 *     subtotal   = base + surcharge           ← Parent's charge
 *     commission = round(subtotal × commissionBp / 10_000)
 *     payout     = subtotal - commission       ← Provider's payout
 *
 *   Per-session bookings (Providers — clinical tier):
 *     subtotal   = agreedRateCents             ← Providers are single-child;
 *                                                no per-child surcharge applies
 *     commission = round(subtotal × commissionBp / 10_000)
 *     payout     = subtotal - commission
 *
 * Sales tax is delegated to Stripe Tax (per CONTEXT.md § Sales tax model).
 * The calculator returns `salesTaxHandling: 'stripe-tax'` as a tag so the
 * handler knows not to compute tax itself.
 *
 * All amounts are integer cents. The Commission rate is expressed in basis
 * points (`commissionBp`) — 1500bp = 15%, 2000bp = 20% — to keep all math
 * on integers and avoid IEEE-754 drift on common percentages.
 *
 * Invariants enforced + property-tested:
 *   - parentChargeCents = baseCents + surchargeCents (hourly) or = agreedRateCents (per-session)
 *   - parentChargeCents = providerPayoutCents + platformCommissionCents
 *   - parentChargeCents ≥ providerPayoutCents (i.e. commissionCents ≥ 0)
 *   - Tutor and Provider callers must pass childCount=1 + perChildSurchargeCents=0
 */

import type { CaregiverCategory, Specialty } from '@our-haven/shared';

export const PRICING_BILLING_MODELS = ['hourly', 'per-session'] as const;
export type PricingBillingModel = (typeof PRICING_BILLING_MODELS)[number];

/**
 * Caller-supplied category context, used only to gate `single-child` semantics
 * (Tutor and Provider) without the calculator having to know the full
 * supply-role discriminant.
 */
export const PRICING_CATEGORIES = [
  'babysitter',
  'tutor',
  'nanny',
  'provider',
] as const;
export type PricingCategory = (typeof PRICING_CATEGORIES)[number];

const SINGLE_CHILD_CATEGORIES: ReadonlySet<PricingCategory> = new Set([
  'tutor',
  'provider',
]);

export const COMMISSION_BP_MAX = 10_000; // = 100%

export interface PricingInput {
  /** From the accepted Offer's `proposed_rate`. Hourly Rate or per-session Rate. Integer cents. */
  agreedRateCents: number;
  /** Hourly or per-session. Determines surcharge applicability. */
  billingModel: PricingBillingModel;
  /** For hourly only — positive, may be fractional (e.g. 2.5). For per-session, must be 1. */
  hours: number;
  /** Number of Children on the Booking. ≥ 1. Tutor + Specialist must be 1. */
  childCount: number;
  /**
   * Babysitter / Nanny per-child surcharge, expressed in cents-per-hour.
   * Snapshotted from the Offer's `computed_total` calculation. Tutor +
   * Specialist must pass 0 (single-child).
   */
  perChildSurchargeCents: number;
  /** Platform commission in basis points (1500 = 15%). 0 ≤ bp ≤ 10_000. */
  commissionBp: number;
  /** Provider category — gates single-child enforcement. */
  category: PricingCategory;
}

export interface PricingResult {
  /** Agreed Rate × hours (hourly) or agreed Rate (per-session). Integer cents. */
  baseCents: number;
  /** Per-child surcharge total for hourly Babysitter / Nanny bookings. Integer cents, ≥ 0. */
  surchargeCents: number;
  /** What the Parent is charged. = baseCents + surchargeCents. */
  parentChargeCents: number;
  /** Our Haven's take. = round(parentChargeCents × commissionBp / 10_000). */
  platformCommissionCents: number;
  /** What the Provider receives. = parentChargeCents - platformCommissionCents. */
  providerPayoutCents: number;
  /** Sales tax handling tag — the only supported value in v1. */
  salesTaxHandling: 'stripe-tax';
}

/**
 * Convenience derivation for the pricing category from the flat supply role +
 * (categories | specialty) discriminant on the Provider record (ADR-0011).
 * Handlers should call this rather than picking categories by hand.
 */
export function pricingCategoryFor(
  role: 'caregiver' | 'provider',
  caregiverCategoryOrSpecialty: CaregiverCategory | Specialty,
): PricingCategory {
  if (role === 'provider') return 'provider';
  // role === 'caregiver' → caregiverCategoryOrSpecialty is a CaregiverCategory
  return caregiverCategoryOrSpecialty as PricingCategory;
}

/**
 * Compute the full pricing receipt for a Booking.
 *
 * Pure + deterministic. Throws on caller-bug inputs (negative cents,
 * non-positive hours, Tutor/Specialist with multi-child or surcharge,
 * commission out of range). The handler must validate at the API boundary.
 */
export function calculatePricing(input: PricingInput): PricingResult {
  const {
    agreedRateCents,
    billingModel,
    hours,
    childCount,
    perChildSurchargeCents,
    commissionBp,
    category,
  } = input;

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
  if (billingModel === 'per-session' && hours !== 1) {
    throw new Error(
      `per-session bookings must pass hours=1 (the per-session Rate is the session price; got ${hours})`,
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
  const baseCents =
    billingModel === 'per-session' ? agreedRateCents : Math.round(agreedRateCents * hours);

  const extraChildren = Math.max(0, childCount - 1);
  const surchargeCents =
    billingModel === 'per-session'
      ? 0
      : Math.round(perChildSurchargeCents * hours * extraChildren);

  const parentChargeCents = baseCents + surchargeCents;
  const platformCommissionCents = Math.round((parentChargeCents * commissionBp) / COMMISSION_BP_MAX);
  const providerPayoutCents = parentChargeCents - platformCommissionCents;

  return {
    baseCents,
    surchargeCents,
    parentChargeCents,
    platformCommissionCents,
    providerPayoutCents,
    salesTaxHandling: 'stripe-tax',
  };
}

export const PRICING_MODULE_VERSION = '0.1.0-OH-112';
