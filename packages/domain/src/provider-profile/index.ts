/**
 * Provider Profile — pure-TS deep module (OH-189).
 *
 * The Provider (clinical-tier) analogue of `caregiver-profile`. Owns the rules
 * specific to the Provider profile builder (CONTEXT.md § Booking — Provider
 * slot-pick; § Verification — license/insurance display; PRD-0001 v1.7 stories
 * 46, 48; ADR-0011):
 *
 *   - the **per-session display Rate** model — a single hourly/per-session Rate
 *     that is display-only because Provider payment happens off-platform
 *     (ADR-0011: the clinical tier is a directory, not a payment rail),
 *   - the **specialty** vocabulary (slp / ot / aba / psychology / other) that
 *     drives both discovery and the license-board resolution,
 *   - the **credential-status projection** the profile surfaces read-only:
 *     license + insurance + screening facts (from `provider_verifications` /
 *     `specialist_credentials`, written by the OH-184/185/186 flows) collapsed to
 *     one Parent-facing badge — `verified` is shown only when every clinical gate
 *     is cleared (CONTEXT.md § Verification: hidden until approved).
 *
 * The consultation-slot lifecycle (open / held / released) is its own module
 * (`provider-slot-scheduler`, OH-180); the handler composes the two. The
 * specialty / US-state vocabularies live in `@our-haven/shared`.
 *
 * Pure + deterministic — no I/O, no clock. The handler supplies persisted rows.
 */

// Deno-clean per the cross-tree Edge-import contract (ADR-0019; OH-184/186/188):
// the Edge consumes this module via an explicit `.ts` specifier, so it must carry
// NO runtime import from `@our-haven/shared` (type-only is erased). The specialty
// list is inlined here (kept honest by `satisfies Specialty[]`), mirroring how
// `caregiver-profile` inlines CAREGIVER_CATEGORY_ORDER.
import type { Specialty } from '@our-haven/shared';

/** Canonical specialty order (CONTEXT.md § role-pick). Inlined to stay Deno-clean. */
const SPECIALTY_ORDER = ['slp', 'ot', 'aba', 'psychology', 'other'] as const satisfies readonly Specialty[];

export function isKnownSpecialty(value: string): value is Specialty {
  return (SPECIALTY_ORDER as readonly string[]).includes(value);
}

export type SpecialtyResult =
  | { ok: true; specialty: Specialty }
  | { ok: false; reason: string };

/** Validate a posted specialty against the canonical vocabulary. */
export function validateSpecialty(value: string): SpecialtyResult {
  if (!isKnownSpecialty(value)) return { ok: false, reason: `unknown specialty '${value}'` };
  return { ok: true, specialty: value };
}

// ---------------------------------------------------------------------------
// Per-session display Rate
// ---------------------------------------------------------------------------

export type RateResult =
  | { ok: true; cents: number | null }
  | { ok: false; reason: string };

/**
 * Validate + normalise the Provider's per-session display Rate. `null` clears the
 * Rate; otherwise it must be a non-negative integer (cents). Display-only —
 * Provider payment is off-platform — so there is no commission/payout coupling.
 */
export function sanitisePerSessionRateCents(input: number | null | undefined): RateResult {
  if (input == null) return { ok: true, cents: null };
  if (!Number.isInteger(input) || input < 0) {
    return { ok: false, reason: 'perSessionRateCents must be a non-negative integer (cents) or null' };
  }
  return { ok: true, cents: input };
}

// ---------------------------------------------------------------------------
// Clinical credential status (read-only display projection)
// ---------------------------------------------------------------------------

/**
 * The clinical-credential facts the profile reads, sourced from
 * `provider_verifications` (license/insurance/screening/rejection timestamps) and
 * `specialist_credentials` (the admin's holistic decision + which docs the
 * Provider uploaded). All timestamps are passed as "is it set?" booleans so this
 * stays clock-free.
 */
export interface ClinicalCredentialFacts {
  licenseVerified: boolean;
  insuranceVerified: boolean;
  screeningPassed: boolean;
  rejected: boolean;
  licenseUploaded: boolean;
  insuranceUploaded: boolean;
}

/** Per-document display state. */
export type DocStatus = 'verified' | 'uploaded' | 'missing';

/**
 * The collapsed status the profile badge shows.
 *   - `verified`   every clinical gate cleared — the only state that surfaces a
 *                  public "Verified" badge.
 *   - `rejected`   the admin rejected the clinical credentials (terminal).
 *   - `in-review`  at least one doc uploaded / screening passed, not yet fully
 *                  verified — "Under review".
 *   - `unverified` nothing submitted yet.
 */
export type CredentialStatus = 'verified' | 'in-review' | 'rejected' | 'unverified';

export interface ClinicalCredentialSummary {
  license: DocStatus;
  insurance: DocStatus;
  screening: 'passed' | 'pending';
  overall: CredentialStatus;
  /** Whether the public (Parent-facing) profile shows the "Verified" badge. */
  publiclyVerified: boolean;
}

function docStatus(verified: boolean, uploaded: boolean): DocStatus {
  if (verified) return 'verified';
  if (uploaded) return 'uploaded';
  return 'missing';
}

/**
 * Collapse the raw verification facts into the read-only credential summary the
 * profile (and its public preview) displays. Mirrors the CONTEXT.md § Verification
 * rule that a Provider is only publicly "Verified" once license + insurance +
 * background screening are all cleared and nothing was rejected.
 */
export function deriveCredentialStatus(facts: ClinicalCredentialFacts): ClinicalCredentialSummary {
  const fullyVerified = facts.licenseVerified && facts.insuranceVerified && facts.screeningPassed;
  const started =
    facts.licenseUploaded ||
    facts.insuranceUploaded ||
    facts.screeningPassed ||
    facts.licenseVerified ||
    facts.insuranceVerified;

  let overall: CredentialStatus;
  if (facts.rejected) overall = 'rejected';
  else if (fullyVerified) overall = 'verified';
  else if (started) overall = 'in-review';
  else overall = 'unverified';

  return {
    license: docStatus(facts.licenseVerified, facts.licenseUploaded),
    insurance: docStatus(facts.insuranceVerified, facts.insuranceUploaded),
    screening: facts.screeningPassed ? 'passed' : 'pending',
    overall,
    publiclyVerified: overall === 'verified',
  };
}

export const PROVIDER_PROFILE_MODULE_VERSION = '0.1.0-OH-189';
