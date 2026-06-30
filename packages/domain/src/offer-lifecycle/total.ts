/**
 * Offer `computed_total` derivation (OH-178 Pricing delegation).
 *
 * Split out of `offer-lifecycle/index.ts` (OH-206) so the Offer **state machine**
 * (`index.ts`) carries NO runtime import — it stays Deno-clean and the Supabase
 * Edge can import it cross-tree via an explicit `.ts` specifier (ADR-0019;
 * OH-184/186/203 contract). This file keeps the runtime `../pricing/index.js`
 * dependency, so the Edge must NOT import it — the Edge derives the total by
 * importing the Deno-clean `pricing` leaf directly (`computeOfferTotal` here is
 * the same six-line passthrough, kept for Node-side callers + tests).
 *
 * Pure + deterministic. No I/O.
 */

import type { CaregiverCategory } from '@our-haven/shared';

import { calculatePricing } from '../pricing/index.js';
import type { OfferShape } from './index.js';

/**
 * Compute the canonical `computed_total` for an Offer — the parent charge over
 * `scopeQuantity` hours, delegated to the OH-178 Pricing calculator so the
 * Offer's quoted total and the eventual Booking receipt share ONE source of
 * truth (no drift). The per-child surcharge is the cents-per-hour snapshot,
 * applied as `surcharge × hours × max(0, childCount − 1)` (the Pricing model).
 *
 * `commissionBp` is irrelevant here — `computed_total` is the pre-commission
 * parent charge — so it is passed as 0 and only `parentChargeCents` is read.
 *
 * Throws (via the Pricing calculator) on caller-bug inputs — e.g. a Tutor with
 * `childCount > 1` or a non-zero surcharge, or non-integer cents.
 */
export function computeOfferTotal(args: {
  proposedRate: number;
  scopeQuantity: number;
  childCount: number;
  perChildSurchargeSnapshot: number;
  category: CaregiverCategory;
}): number {
  return calculatePricing({
    agreedRateCents: args.proposedRate,
    hours: args.scopeQuantity,
    childCount: args.childCount,
    perChildSurchargeCents: args.perChildSurchargeSnapshot,
    commissionBp: 0,
    category: args.category,
  }).parentChargeCents;
}

/**
 * Whether the Offer's stored `computedTotal` matches the canonical recompute.
 * A construction-time invariant the composer/handler can assert; not enforced
 * inside `transitionOffer` (the snapshot is trusted once captured).
 */
export function offerTotalIsConsistent(offer: OfferShape): boolean {
  return (
    offer.computedTotal ===
    computeOfferTotal({
      proposedRate: offer.proposedRate,
      scopeQuantity: offer.scopeQuantity,
      childCount: offer.childCount,
      perChildSurchargeSnapshot: offer.perChildSurchargeSnapshot,
      category: offer.category,
    })
  );
}
