/**
 * Parent Profile — pure-TS deep module (OH-200).
 *
 * Owns the rules specific to the family-level **Parent profile** (CONTEXT.md
 * § Parent profile / § Sensitive-data consent / § Service address & distance;
 * ADR-0012 / ADR-0016; PRD-0001 v1.7 stories 3, 4, 74, 124):
 *
 *   - the **sensitive-info consent-to-store gate** — the fixed **Safety
 *     Behaviors** checklist is sensitive child data and may be persisted ONLY
 *     after an explicit, **timestamped** consent (ADR-0012; story 3),
 *   - **consent withdrawal erasure** — withdrawing consent deletes every Safety
 *     Behavior AND the consent timestamp; Bio + Preferences survive (CONTEXT.md
 *     § Retention; story 74),
 *   - validation/normalisation of the optional **default service address** that
 *     pre-fills a transaction's `service_address` (ADR-0016; story 124).
 *
 * The `safety_behaviors` / `preferences` vocabularies are fixed taxonomies that
 * live in `@our-haven/shared` (`safety-behaviors.ts` / `parent-preferences.ts`);
 * the handler normalises a posted checklist against them (membership), then this
 * module gates the persist. There is **no Child entity** (ADR-0012) and **no
 * `parents` table** — a Parent is just the Supabase auth user, so the persisted
 * row is keyed by `uid`.
 *
 * Pure + deterministic — no I/O, no clock. The handler supplies `now` and the
 * persisted row. Deno-clean per the cross-tree Edge-import contract (ADR-0019):
 * the only `@our-haven/*` import is a TYPE (erased before resolution), and the US
 * state guard is INJECTED so this module carries no runtime import from
 * `@our-haven/shared`.
 */

// Type-only — erased before module resolution, so it stays Deno-clean (the same
// posture as caregiver-profile's `CaregiverCategory` import).
import type { SafetyBehavior } from '@our-haven/shared';

// ---------------------------------------------------------------------------
// Sensitive-info consent gate (Safety Behaviors)
// ---------------------------------------------------------------------------

/**
 * Whether sensitive-info consent is currently in force — a non-null
 * `safety_behaviors_consent_at` timestamp is held. The single read every surface
 * (the editor's lock, the persist gate, the public-disclosure compose step)
 * shares.
 */
export function hasSafetyBehaviorsConsent(consentAt: string | null): boolean {
  return consentAt !== null;
}

export type SafetyBehaviorsSaveResult =
  | { ok: true; safetyBehaviors: SafetyBehavior[] }
  | { ok: false; reason: 'consent_required' };

/**
 * Resolve a request to persist the Safety-Behaviors checklist. The caller passes
 * the ALREADY-NORMALISED behaviours (taxonomy membership enforced upstream via
 * the shared `normaliseSafetyBehaviors`) and the current consent timestamp.
 *
 * The persist is rejected unless consent is in force — the consent-to-store gate
 * (ADR-0012; PRD story 3): "explicitly accept a sensitive-information consent
 * screen before I can save any Safety Behaviors". Saving an EMPTY list is also
 * gated: clearing the checklist is still a write to sensitive data, and the
 * normal path to remove everything is consent withdrawal (which also clears the
 * timestamp).
 */
export function resolveSafetyBehaviorsSave(
  consentAt: string | null,
  normalisedBehaviors: readonly SafetyBehavior[],
): SafetyBehaviorsSaveResult {
  if (!hasSafetyBehaviorsConsent(consentAt)) return { ok: false, reason: 'consent_required' };
  return { ok: true, safetyBehaviors: [...normalisedBehaviors] };
}

/**
 * Resolve an explicit consent **grant**. Idempotent: a first grant stamps `now`;
 * a repeat grant keeps the ORIGINAL timestamp (consent has been in force since
 * then, and a re-stamp would misreport when the family first agreed). A material
 * privacy-policy change that demands re-consent is modelled as a withdrawal +
 * fresh grant, not a silent re-stamp.
 */
export function resolveConsentGrant(currentConsentAt: string | null, now: string): string {
  return currentConsentAt ?? now;
}

/**
 * The persisted state after consent **withdrawal** — every Safety Behavior and
 * the consent timestamp are erased (CONTEXT.md § Retention; PRD story 74). Bio +
 * Preferences are deliberately NOT part of this shape: they survive a withdrawal
 * (Bio follows the ordinary free-text-content retention rule).
 */
export interface SafetyBehaviorsErased {
  safetyBehaviors: readonly [];
  safetyBehaviorsConsentAt: null;
}

export function eraseSafetyBehaviors(): SafetyBehaviorsErased {
  return { safetyBehaviors: [], safetyBehaviorsConsentAt: null };
}

// ---------------------------------------------------------------------------
// Default service address
// ---------------------------------------------------------------------------

/** Field ceilings — generous; the UI caps tighter. Backstopped by DB CHECKs. */
export const ADDRESS_LINE_MAX_LEN = 120;
export const ADDRESS_CITY_MAX_LEN = 80;

export interface DefaultAddressInput {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  /** 2-letter US state / DC (validated via the injected `isUsState`). */
  state?: string | null;
  /** 5-digit US ZIP. */
  postalCode?: string | null;
}

export interface DefaultAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

export type DefaultAddressResult =
  | { ok: true; address: DefaultAddress }
  | { ok: false; reason: string };

/** An all-null address — the "no default set" value + the cleared state. */
export function emptyDefaultAddress(): DefaultAddress {
  return { line1: null, line2: null, city: null, state: null, postalCode: null };
}

/** Trim, collapse internal whitespace runs, and map empty → null. */
function normField(value: string | null | undefined, maxLen: number): { value: string | null; tooLong: boolean } {
  if (value == null) return { value: null, tooLong: false };
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return { value: null, tooLong: false };
  if (trimmed.length > maxLen) return { value: trimmed, tooLong: true };
  return { value: trimmed, tooLong: false };
}

/**
 * Validate + normalise a posted default service address. The address is
 * **optional and partial** — a family may save just a city + state, or clear a
 * field by sending `null`/blank — so this never requires a complete address.
 * It rejects only a malformed state (not a US state/DC) or ZIP (not 5 digits),
 * or an over-long line/city. `state` is upper-cased before the membership check.
 *
 * `isUsState` is injected (rather than imported) so the module stays Deno-clean
 * for the Edge tree; the handler passes `@our-haven/shared`'s `isUsState`.
 */
export function sanitiseDefaultAddress(
  input: DefaultAddressInput,
  isUsState: (value: string) => boolean,
): DefaultAddressResult {
  const line1 = normField(input.line1, ADDRESS_LINE_MAX_LEN);
  if (line1.tooLong) return { ok: false, reason: `address line 1 exceeds ${ADDRESS_LINE_MAX_LEN} characters` };
  const line2 = normField(input.line2, ADDRESS_LINE_MAX_LEN);
  if (line2.tooLong) return { ok: false, reason: `address line 2 exceeds ${ADDRESS_LINE_MAX_LEN} characters` };
  const city = normField(input.city, ADDRESS_CITY_MAX_LEN);
  if (city.tooLong) return { ok: false, reason: `city exceeds ${ADDRESS_CITY_MAX_LEN} characters` };

  let state: string | null = null;
  if (input.state != null) {
    const upper = input.state.trim().toUpperCase();
    if (upper !== '') {
      if (!isUsState(upper)) return { ok: false, reason: `'${input.state}' is not a US state` };
      state = upper;
    }
  }

  let postalCode: string | null = null;
  if (input.postalCode != null) {
    const z = input.postalCode.trim();
    if (z !== '') {
      if (!/^\d{5}$/.test(z)) return { ok: false, reason: 'postal code must be a 5-digit US ZIP' };
      postalCode = z;
    }
  }

  return { ok: true, address: { line1: line1.value, line2: line2.value, city: city.value, state, postalCode } };
}

/** Whether a default address carries any field at all (drives the "set" badge). */
export function hasDefaultAddress(address: DefaultAddress): boolean {
  return (
    address.line1 !== null ||
    address.line2 !== null ||
    address.city !== null ||
    address.state !== null ||
    address.postalCode !== null
  );
}

export const PARENT_PROFILE_MODULE_VERSION = '0.1.0-OH-200';
