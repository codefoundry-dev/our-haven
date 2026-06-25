/**
 * Verification workflow state machine — per-**role** deep module (OH-181,
 * reworks OH-105).
 *
 * Pure-TS per ADR-0004. Consumes verification *results* (Checkr webhook
 * outcomes, admin license-board + insurance lookup outcomes, ID-doc upload
 * events, email/phone confirmation timestamps, Stripe Connect webhook) — never
 * vendor APIs. Vendor adapters live at the handler layer and reduce to the
 * timestamp facts on this struct (see `background-check`, `license-board`).
 *
 * ── Per-role fork (ADR-0011) ───────────────────────────────────────────────
 * ADR-0011 split the two supply businesses, and the activation gates fork with
 * them. OH-105 ran BOTH roles through one shared `connect-pending` Stripe gate;
 * its header flagged that as "deferred to the per-role Verification rework
 * (OH-181)". This module is that rework:
 *
 *   - **Both roles** clear the shared spine: email → government ID →
 *     Checkr standard-package screening (CONTEXT.md § Verification).
 *   - **Caregiver** (transactional payment rail) then needs a **Stripe Connect
 *     Express** account that can charge + pay out → `connect-pending`.
 *   - **Provider** (listings/scheduling SaaS, off-platform clinical payment)
 *     has **NO Stripe Connect** (ADR-0011 — "the clinical tier no longer needs
 *     it; Providers pay *us* a subscription"). Instead it needs a professional
 *     **license** verified against the per-state board (OH-107) and proof of
 *     liability **insurance** → `license-pending` → `insurance-pending`. A
 *     Provider whose resident state is outside the launch adapter slate routes
 *     to `holding-state-not-supported` until the adapter ships.
 *
 * ── Phone is a hard activation gate, NOT a linear step (ADR-0015) ───────────
 * Phone is **optional on the sign-up form** but a verified phone is a **hard
 * activation gate** — the booking-request SMS is the most critical notification
 * (ADR-0015 / client #1). So `phoneConfirmedAt` does NOT sit on the linear
 * spine (OH-105 wrongly placed it between email and ID). It is evaluated LAST,
 * gating only the final `activated` transition: a member who has cleared every
 * other gate but not verified a phone rests in `awaiting-phone-verification`.
 *
 * Encoded transition spines (off-spine branches: `holding-state-not-supported`,
 * `rejected`):
 *
 *   Caregiver:  unverified → email-verified → id-uploaded → screening-initiated
 *               → connect-pending → awaiting-phone-verification → activated
 *
 *   Provider:   unverified → email-verified → id-uploaded → screening-initiated
 *               → license-pending → insurance-pending
 *               → awaiting-phone-verification → activated
 *               (resident state out of slate → holding-state-not-supported)
 *
 *   Any state → rejected (terminal; admin-set on Checkr fail / ID mismatch /
 *               license or insurance rejection).
 *
 * The state is a pure FOLD of the facts (not an event reducer): verification
 * facts arrive out of order from many independent sources, so "given the facts,
 * what state are we in" is the honest model. The fold walks a per-role ordered
 * gate list and returns the first unmet gate's resting state; if every gate is
 * satisfied it returns `activated`.
 */

import type { SupplyRole, UsState } from '@our-haven/shared';

export const VERIFICATION_STATES = [
  'unverified',
  'email-verified',
  'id-uploaded',
  'screening-initiated',
  'connect-pending', // Caregiver-only — Stripe Connect Express payout rail (ADR-0011)
  'license-pending', // Provider-only — professional license vs per-state board (OH-107)
  'insurance-pending', // Provider-only — proof of liability insurance (CONTEXT § Verification)
  'holding-state-not-supported', // Provider-only — resident state outside the launch slate
  'awaiting-phone-verification', // Both — phone is the final hard activation gate (ADR-0015)
  'activated',
  'rejected',
] as const;

export type VerificationState = (typeof VERIFICATION_STATES)[number];

/**
 * The only truly terminal state: an admin rejection seals the workflow. Note
 * `activated` is NOT terminal — an admin may still reject an activated member
 * (e.g. a delayed Checkr adverse-action), which moves them to `rejected`.
 */
export const VERIFICATION_TERMINAL_STATES = ['rejected'] as const;
export type VerificationTerminalState = (typeof VERIFICATION_TERMINAL_STATES)[number];

/**
 * Per-step facts. Each field is the timestamp at which the result was recorded,
 * or null if the step has not been satisfied. The compute function never
 * mutates these — it folds them into a state.
 */
export interface VerificationFacts {
  /** Email confirmed (Supabase `email_confirmed_at`). The spine's entry gate. */
  emailConfirmedAt: Date | null;
  /**
   * Phone confirmed (Supabase `phone_confirmed_at`). Phone is OPTIONAL on the
   * sign-up form but a HARD activation gate (ADR-0015 / client #1) — the
   * booking-request SMS is the most critical notification. Tracked as an
   * INDEPENDENT fact: it does not advance the linear spine; it gates only the
   * final `activated` transition (see `awaiting-phone-verification`).
   */
  phoneConfirmedAt: Date | null;
  idDocUploadedAt: Date | null;
  screeningInitiatedAt: Date | null;
  screeningPassedAt: Date | null;
  /**
   * Provider-only — professional license verified by admin against the
   * per-state license board (OH-107). Ignored for `role: 'caregiver'`.
   */
  licenseVerifiedAt: Date | null;
  /**
   * Provider-only — proof of liability insurance verified by admin
   * (CONTEXT.md § Verification). Ignored for `role: 'caregiver'`.
   */
  insuranceVerifiedAt: Date | null;
  /**
   * Caregiver-only — timestamp at which the Caregiver's Stripe Connect Express
   * account first had BOTH `charges_enabled` and `payouts_enabled` true
   * (stamped by the Stripe Connect webhook; gates activation + search
   * visibility). Providers have NO Stripe Connect (off-platform clinical
   * payment, ADR-0011) — this fact is ignored for `role: 'provider'`.
   */
  connectAccountReadyAt: Date | null;
  /** Terminal — set by admin on rejection (Checkr fail, ID mismatch, license/insurance fail). */
  rejectedAt: Date | null;
}

export interface ComputeVerificationStateInput {
  role: SupplyRole;
  /** The member's resident US state — drives the Provider holding branch. */
  state: UsState;
  /**
   * The set of US states for which a per-state license-board adapter has
   * shipped. A Provider whose `state` is outside this set routes to
   * `holding-state-not-supported` once they reach the license gate. Caregivers
   * are never gated on this set (Checkr is multi-state).
   */
  supportedStates: ReadonlySet<UsState>;
  facts: VerificationFacts;
}

// ---------------------------------------------------------------------------
// Activation gates — the per-role state machine, expressed declaratively so the
// fold and the exported happy-path spines cannot drift apart.
// ---------------------------------------------------------------------------

/** Stable keys for the activation gates, in canonical (cross-role) order. */
export const VERIFICATION_GATE_KEYS = [
  'email',
  'id',
  'screening-initiated',
  'screening-passed',
  'connect', // Caregiver-only
  'license', // Provider-only
  'insurance', // Provider-only
  'phone',
] as const;
export type VerificationGateKey = (typeof VERIFICATION_GATE_KEYS)[number];

interface GateContext {
  state: UsState;
  supportedStates: ReadonlySet<UsState>;
}

/**
 * One activation gate: the fact it requires, and the state the workflow rests
 * in while that fact is unmet. Gates are evaluated in per-role order; the first
 * unmet gate's `pendingState` is the current VerificationState.
 */
interface VerificationGate {
  readonly key: VerificationGateKey;
  isSatisfied(facts: VerificationFacts, ctx: GateContext): boolean;
  pendingState(ctx: GateContext): VerificationState;
}

const EMAIL_GATE: VerificationGate = {
  key: 'email',
  isSatisfied: (f) => f.emailConfirmedAt !== null,
  pendingState: () => 'unverified',
};

const ID_GATE: VerificationGate = {
  key: 'id',
  isSatisfied: (f) => f.idDocUploadedAt !== null,
  pendingState: () => 'email-verified',
};

const SCREENING_INITIATED_GATE: VerificationGate = {
  key: 'screening-initiated',
  isSatisfied: (f) => f.screeningInitiatedAt !== null,
  pendingState: () => 'id-uploaded',
};

const SCREENING_PASSED_GATE: VerificationGate = {
  key: 'screening-passed',
  isSatisfied: (f) => f.screeningPassedAt !== null,
  pendingState: () => 'screening-initiated',
};

/** Caregiver-only — Stripe Connect Express ready (charges + payouts). */
const CONNECT_GATE: VerificationGate = {
  key: 'connect',
  isSatisfied: (f) => f.connectAccountReadyAt !== null,
  pendingState: () => 'connect-pending',
};

/**
 * Provider-only — license verified vs the per-state board. An out-of-slate
 * resident state can NEVER satisfy this gate (no adapter exists to verify the
 * license — see `licenseBoardAdapterFor`), so the gate stays unmet regardless
 * of any `licenseVerifiedAt` fact and the Provider rests in the
 * `holding-state-not-supported` branch until the adapter ships.
 */
const LICENSE_GATE: VerificationGate = {
  key: 'license',
  isSatisfied: (f, ctx) => ctx.supportedStates.has(ctx.state) && f.licenseVerifiedAt !== null,
  pendingState: (ctx) =>
    ctx.supportedStates.has(ctx.state) ? 'license-pending' : 'holding-state-not-supported',
};

/** Provider-only — proof of liability insurance verified by admin. */
const INSURANCE_GATE: VerificationGate = {
  key: 'insurance',
  isSatisfied: (f, ctx) => ctx.supportedStates.has(ctx.state) && f.insuranceVerifiedAt !== null,
  pendingState: (ctx) =>
    ctx.supportedStates.has(ctx.state) ? 'insurance-pending' : 'holding-state-not-supported',
};

/** Both roles — the final hard activation gate (ADR-0015). Always evaluated last. */
const PHONE_GATE: VerificationGate = {
  key: 'phone',
  isSatisfied: (f) => f.phoneConfirmedAt !== null,
  pendingState: () => 'awaiting-phone-verification',
};

const SHARED_SPINE: readonly VerificationGate[] = [
  EMAIL_GATE,
  ID_GATE,
  SCREENING_INITIATED_GATE,
  SCREENING_PASSED_GATE,
];

/**
 * The ordered activation gates for a role. Caregiver: shared spine → Stripe
 * Connect → phone. Provider: shared spine → license → insurance → phone.
 */
export function verificationGates(role: SupplyRole): readonly VerificationGate[] {
  if (role === 'provider') {
    return [...SHARED_SPINE, LICENSE_GATE, INSURANCE_GATE, PHONE_GATE];
  }
  return [...SHARED_SPINE, CONNECT_GATE, PHONE_GATE];
}

/**
 * Fold a member's verification facts into their current state. Pure +
 * deterministic — same input always produces the same output. The persistence
 * + side-effect layer (handler / route) records the facts; this module only
 * interprets them.
 */
export function computeVerificationState(input: ComputeVerificationStateInput): VerificationState {
  const { role, state, supportedStates, facts } = input;

  // Rejection wins from anywhere — it is the one terminal state.
  if (facts.rejectedAt !== null) return 'rejected';

  const ctx: GateContext = { state, supportedStates };
  for (const gate of verificationGates(role)) {
    if (!gate.isSatisfied(facts, ctx)) return gate.pendingState(ctx);
  }
  return 'activated';
}

/**
 * The keys of the gates this member has NOT yet satisfied, in evaluation order
 * — a checklist affordance for the verification UI. Empty once `activated` (or
 * `rejected`). For a Provider in an out-of-slate state the `license` gate (and
 * everything after) remains listed, since it cannot be satisfied until the
 * adapter ships.
 */
export function unmetVerificationGates(
  input: ComputeVerificationStateInput,
): readonly VerificationGateKey[] {
  if (input.facts.rejectedAt !== null) return [];
  const ctx: GateContext = { state: input.state, supportedStates: input.supportedStates };
  return verificationGates(input.role)
    .filter((gate) => !gate.isSatisfied(input.facts, ctx))
    .map((gate) => gate.key);
}

/**
 * The canonical happy-path state spine for a Caregiver in a supported context.
 * Off-spine branch states (`holding-state-not-supported`, `rejected`) excluded.
 */
export const CAREGIVER_VERIFICATION_PATH = [
  'unverified',
  'email-verified',
  'id-uploaded',
  'screening-initiated',
  'connect-pending',
  'awaiting-phone-verification',
  'activated',
] as const satisfies readonly VerificationState[];

/** The canonical happy-path state spine for a Provider in a supported state. */
export const PROVIDER_VERIFICATION_PATH = [
  'unverified',
  'email-verified',
  'id-uploaded',
  'screening-initiated',
  'license-pending',
  'insurance-pending',
  'awaiting-phone-verification',
  'activated',
] as const satisfies readonly VerificationState[];

/** The happy-path spine for a role (supported resident state). */
export function verificationPath(role: SupplyRole): readonly VerificationState[] {
  return role === 'provider' ? PROVIDER_VERIFICATION_PATH : CAREGIVER_VERIFICATION_PATH;
}

/**
 * Whether the member's profile is publicly visible and bookable. Mirrors the
 * design's "Not yet visible" right-rail card.
 */
export function isActivated(state: VerificationState): boolean {
  return state === 'activated';
}

/** Whether the workflow has terminally failed — no further progression. */
export function isTerminal(state: VerificationState): boolean {
  return (VERIFICATION_TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * Whether the ONLY thing standing between this member and activation is phone
 * verification — i.e. every other role gate is satisfied but `phoneConfirmedAt`
 * is null (ADR-0015 hard activation gate). A pure predicate the UI uses to show
 * the "verify your phone to go live" nudge.
 */
export function isAwaitingPhoneOnly(input: ComputeVerificationStateInput): boolean {
  return computeVerificationState(input) === 'awaiting-phone-verification';
}

export const VERIFICATION_WORKFLOW_MODULE_VERSION = '0.2.0-OH-181';
