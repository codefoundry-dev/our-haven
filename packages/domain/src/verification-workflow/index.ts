/**
 * Verification workflow state machine (OH-105).
 *
 * Pure-TS deep module per ADR-0004. Consumes verification *results* (Checkr
 * webhook outcomes, admin license-board lookup outcomes, ID-doc upload events,
 * email/phone confirmation timestamps) — not vendor APIs. Vendor adapters live
 * at the handler layer and reduce to the timestamp facts on this struct.
 *
 * Per CONTEXT.md § Verification (roles per ADR-0011: caregiver | provider):
 *   - All supply (Caregiver + Provider): email + phone + ID upload + Checkr
 *     screening + Stripe Connect Express account ready (OH-110).
 *   - Providers (clinical tier) additionally: license verified against the
 *     per-state license-board adapter; Providers in launch-unsupported states
 *     route to `holding-state-not-supported` until the adapter ships.
 *   - Caregivers never need a license; Checkr is multi-state.
 *
 * NB: the behavioural forks ADR-0011 implies for the clinical tier (Provider
 * has no Stripe Connect / payout — clinical payment is off-platform) are
 * deferred to the per-role Verification rework (OH-181) + Connect ticket
 * (OH-190). This module preserves the prior behaviour on the flat role.
 *
 * Transition order encoded:
 *   unverified
 *     → email-verified
 *     → phone-verified
 *     → id-uploaded
 *     → screening-initiated
 *     → screening-passed
 *     → (Caregiver: connect-pending → activated)
 *     → (Provider, supported state: license-pending → license-verified → connect-pending → activated)
 *     → (Provider, unsupported state: holding-state-not-supported)
 *     → rejected (terminal, from any state)
 *
 * `connect-pending` is the OH-110 gate that holds the Provider out of search
 * results until Stripe confirms the Connect Express account can both charge
 * (collect Booking payments) and pay out (receive funds). It applies equally
 * to Caregivers and Providers.
 */

import type { SupplyRole, UsState } from '@our-haven/shared';

export const VERIFICATION_STATES = [
  'unverified',
  'email-verified',
  'phone-verified',
  'id-uploaded',
  'screening-initiated',
  'screening-passed',
  'license-pending',
  'license-verified',
  'connect-pending',
  'activated',
  'rejected',
  'holding-state-not-supported',
] as const;

export type VerificationState = (typeof VERIFICATION_STATES)[number];

/**
 * Per-step facts. Each field is the timestamp at which the result was
 * recorded, or null if the step has not been satisfied. The compute function
 * never mutates these — it just folds them into a state.
 */
export interface VerificationFacts {
  emailConfirmedAt: Date | null;
  phoneConfirmedAt: Date | null;
  idDocUploadedAt: Date | null;
  screeningInitiatedAt: Date | null;
  screeningPassedAt: Date | null;
  licenseVerifiedAt: Date | null;
  /**
   * OH-110: timestamp at which the Provider's Stripe Connect Express account
   * first had BOTH `charges_enabled` and `payouts_enabled` true. Stamped by
   * the Stripe Connect webhook; gates activation + search visibility.
   */
  connectAccountReadyAt: Date | null;
  /** Terminal — set by admin when a Provider is rejected (Checkr fail, ID mismatch, etc.). */
  rejectedAt: Date | null;
}

export interface ComputeVerificationStateInput {
  role: SupplyRole;
  state: UsState;
  /**
   * The set of US states for which a per-state license-board adapter has
   * shipped. Specialists whose `state` is outside this set route to
   * `holding-state-not-supported` once they reach the license stage.
   * Caregivers are never gated on this set (Checkr is multi-state).
   */
  supportedStates: ReadonlySet<UsState>;
  facts: VerificationFacts;
}

/**
 * Fold a Provider's verification facts into the current state.
 *
 * Pure + deterministic — same input always produces the same output. The
 * persistence + side-effect layer (handler / route) is responsible for
 * recording the facts; this module only interprets them.
 */
export function computeVerificationState(input: ComputeVerificationStateInput): VerificationState {
  const { role, state, supportedStates, facts } = input;

  if (facts.rejectedAt) return 'rejected';
  if (!facts.emailConfirmedAt) return 'unverified';
  if (!facts.phoneConfirmedAt) return 'email-verified';
  if (!facts.idDocUploadedAt) return 'phone-verified';
  if (!facts.screeningInitiatedAt) return 'id-uploaded';
  if (!facts.screeningPassedAt) return 'screening-initiated';

  if (role === 'provider') {
    if (!supportedStates.has(state)) return 'holding-state-not-supported';
    if (!facts.licenseVerifiedAt) return 'license-pending';
  }

  // OH-110: Stripe Connect Express must be ready (charges + payouts) before
  // the Provider can be activated and surface in search.
  if (!facts.connectAccountReadyAt) return 'connect-pending';
  return 'activated';
}

/**
 * Whether the Provider's profile is publicly visible and bookable.
 * Mirrors the design's "Not yet visible" right-rail card.
 */
export function isActivated(state: VerificationState): boolean {
  return state === 'activated';
}

/**
 * Whether the Provider has terminally failed verification — no further
 * checklist progression is possible.
 */
export function isTerminal(state: VerificationState): boolean {
  return state === 'rejected';
}

export const VERIFICATION_WORKFLOW_MODULE_VERSION = '0.1.0-OH-105';
