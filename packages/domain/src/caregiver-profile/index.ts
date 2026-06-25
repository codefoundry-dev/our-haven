/**
 * Caregiver Profile — pure-TS deep module (OH-188).
 *
 * Owns the rules specific to the Caregiver profile builder
 * (CONTEXT.md § Rate / § negotiable / § Ages served & behaviour-comfort /
 * § Credentials; ADR-0015 / ADR-0016 / ADR-0017):
 *
 *   - the **per-category Published Rate** model + per-child **surcharge
 *     eligibility** (Babysitter / Nanny only — Tutor engagements are
 *     single-child, so no surcharge — CONTEXT.md § Rate),
 *   - the **"from $X"** lowest-Rate derivation a no-category-filter search shows,
 *   - the **negotiable → Counter/lock** gate (ADR-0017),
 *   - the **public preview** projection — pending Credentials are hidden until
 *     approved (CONTEXT.md § Credentials),
 *   - validation/sanitising of a posted profile patch before persistence.
 *
 * Availability (the 7×3 grid) is its own module (`caregiver-availability`);
 * the Credential review state machine + clinical-title classifier are their own
 * module (`credentials`); the `ages_served` / `behaviour_comfort` vocabularies
 * live in `@our-haven/shared`. This module composes them for the profile.
 *
 * Pure + deterministic — no I/O, no clock. The handler supplies persisted rows.
 */

// Deno-clean per the cross-tree Edge-import contract (ADR-0019; OH-184/186): the
// Edge consumes this module via an explicit `.ts` specifier, so it must carry NO
// runtime import from `@our-haven/shared` (type-only is erased). The 3-item
// category list is inlined here (kept honest by `satisfies CaregiverCategory[]`),
// mirroring how `credentials` inlines TAX_CREDIT_FRIENDLY_CATEGORIES. The
// `ages_served` / `behaviour_comfort` taxonomy normalisers live in the
// zero-import `@our-haven/shared/safety-behaviors` module the Edge imports
// directly.
import type { CaregiverCategory } from '@our-haven/shared';

import type { Credential, CredentialReviewState } from '../credentials/index.js';

/** Canonical category order (CONTEXT.md § role-pick). Inlined to stay Deno-clean. */
const CAREGIVER_CATEGORY_ORDER = ['babysitter', 'tutor', 'nanny'] as const satisfies readonly CaregiverCategory[];

function isKnownCategory(value: string): value is CaregiverCategory {
  return (CAREGIVER_CATEGORY_ORDER as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Per-category Published Rate
// ---------------------------------------------------------------------------

export interface CategoryRate {
  category: CaregiverCategory;
  /** Hourly Published Rate for this category, integer cents (≥ 0). */
  publishedRateCents: number;
  /**
   * Optional flat per-child surcharge, integer cents (≥ 0). Babysitter / Nanny
   * only; always `null` for Tutor and for an unset surcharge.
   */
  perChildSurchargeCents: number | null;
}

/**
 * Categories whose Rate may carry an optional per-child surcharge — Babysitter
 * & Nanny. Tutor engagements are single-child (CONTEXT.md § Rate), so a Tutor
 * Rate never carries a surcharge.
 */
export const SURCHARGE_ELIGIBLE_CATEGORIES = [
  'babysitter',
  'nanny',
] as const satisfies readonly CaregiverCategory[];

export function isSurchargeEligible(category: CaregiverCategory): boolean {
  return (SURCHARGE_ELIGIBLE_CATEGORIES as readonly CaregiverCategory[]).includes(category);
}

export type CategoryRateInput = {
  category: string;
  publishedRateCents: number;
  perChildSurchargeCents?: number | null;
};

export type CategoryRateResult =
  | { ok: true; rate: CategoryRate }
  | { ok: false; reason: string };

/**
 * Validate + normalise a single posted category Rate. Rejects an unknown
 * category, a non-integer / negative Rate, a non-integer / negative surcharge,
 * or a surcharge on a surcharge-ineligible category (Tutor) — matching the
 * API-layer-enforcement convention from the `provider_profiles` migration.
 */
export function sanitiseCategoryRate(input: CategoryRateInput): CategoryRateResult {
  if (!isKnownCategory(input.category)) {
    return { ok: false, reason: `unknown category '${input.category}'` };
  }
  const category = input.category;
  if (!Number.isInteger(input.publishedRateCents) || input.publishedRateCents < 0) {
    return { ok: false, reason: `publishedRateCents for '${category}' must be a non-negative integer` };
  }
  let surcharge: number | null = null;
  if (input.perChildSurchargeCents != null) {
    if (!isSurchargeEligible(category)) {
      return { ok: false, reason: `'${category}' rate cannot carry a per-child surcharge (Babysitter / Nanny only)` };
    }
    if (!Number.isInteger(input.perChildSurchargeCents) || input.perChildSurchargeCents < 0) {
      return { ok: false, reason: `perChildSurchargeCents for '${category}' must be a non-negative integer` };
    }
    surcharge = input.perChildSurchargeCents;
  }
  return { ok: true, rate: { category, publishedRateCents: input.publishedRateCents, perChildSurchargeCents: surcharge } };
}

export type CategoryRatesResult =
  | { ok: true; rates: CategoryRate[] }
  | { ok: false; reason: string };

/**
 * Validate a posted set of category Rates against the Caregiver's owned
 * `categories[]`: each must be valid (see {@link sanitiseCategoryRate}), unique,
 * and one of the Caregiver's own categories. A partial set is allowed — a
 * Caregiver need not price every category yet. Returns the rates in canonical
 * category order.
 */
export function validateCategoryRates(
  rates: readonly CategoryRateInput[],
  ownedCategories: readonly CaregiverCategory[],
): CategoryRatesResult {
  const owned = new Set<CaregiverCategory>(ownedCategories);
  const seen = new Set<string>();
  const out: CategoryRate[] = [];
  for (const r of rates) {
    if (seen.has(r.category)) {
      return { ok: false, reason: `duplicate rate for category '${r.category}'` };
    }
    seen.add(r.category);
    const res = sanitiseCategoryRate(r);
    if (!res.ok) return res;
    if (!owned.has(res.rate.category)) {
      return { ok: false, reason: `category '${res.rate.category}' is not one of this Caregiver's categories` };
    }
    out.push(res.rate);
  }
  out.sort(
    (a, b) =>
      CAREGIVER_CATEGORY_ORDER.indexOf(a.category) - CAREGIVER_CATEGORY_ORDER.indexOf(b.category),
  );
  return { ok: true, rates: out };
}

/**
 * The lowest Published Rate across a Caregiver's category Rates, in cents — the
 * "from $X" a no-category-filter search shows (CONTEXT.md § Rate). `null` when
 * no category has a Rate set yet.
 */
export function fromRateCents(rates: readonly CategoryRate[]): number | null {
  let min: number | null = null;
  for (const r of rates) {
    if (min === null || r.publishedRateCents < min) min = r.publishedRateCents;
  }
  return min;
}

/** The Published Rate for a specific category, in cents, or `null` if unpriced. */
export function publishedRateForCategory(
  rates: readonly CategoryRate[],
  category: CaregiverCategory,
): number | null {
  return rates.find((r) => r.category === category)?.publishedRateCents ?? null;
}

// ---------------------------------------------------------------------------
// negotiable gate (ADR-0017)
// ---------------------------------------------------------------------------

/**
 * Whether the Counter affordance is offered. When `negotiable` is OFF the
 * Counter is hidden on both sides and the Direct-Message rate locks to the
 * Caregiver's published per-category Rate (ADR-0017). Default-on lives at the
 * schema/UI layer; this is the read.
 */
export function counterAllowed(negotiable: boolean): boolean {
  return negotiable === true;
}

// ---------------------------------------------------------------------------
// Public preview (Credentials visibility)
// ---------------------------------------------------------------------------

/**
 * The Credentials shown on the public (Parent-facing) profile / preview —
 * approved only (CONTEXT.md § Credentials: hidden until approved). The
 * Caregiver's own editor still lists pending / rejected with their status; this
 * is the read-only Parent projection.
 */
export function publicCredentials(credentials: readonly Credential[]): Credential[] {
  return credentials.filter((c) => isPubliclyVisible(c.review));
}

/** Approved-only — mirrors `credentials.isCredentialPubliclyVisible`, inlined to stay Deno-clean. */
function isPubliclyVisible(review: CredentialReviewState): boolean {
  return review === 'approved';
}

export const CAREGIVER_PROFILE_MODULE_VERSION = '0.1.0-OH-188';
