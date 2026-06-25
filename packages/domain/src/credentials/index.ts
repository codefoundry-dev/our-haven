/**
 * Caregiver Credentials — pure-TS deep module (OH-181).
 *
 * The umbrella for a Caregiver's professional qualifications (CONTEXT.md
 * § Credentials, ADR-0015 / client #9): `type ∈ {title, certification,
 * training}`. Added during sign-up or from the profile.
 *
 * Three rules this module encodes, all from CONTEXT.md § Credentials:
 *
 *   1. **Admin-verified, hidden until approved.** A Credential is born
 *      `pending` and is NOT shown on the public profile until an admin approves
 *      it (the Caregiver sees "Pending review"). See `isCredentialPubliclyVisible`.
 *
 *   2. **Clinical-title rejection path.** Admin rejects clinical-sounding
 *      *titles* (e.g. "Pediatric Nurse") to protect the Caregiver / Provider
 *      line — a Caregiver must not present as a licensed clinician (that is the
 *      Provider tier, ADR-0011). `hasClinicalTitleConflict` auto-flags such
 *      titles for the admin queue; it is an ADMIN-ASSIST classifier, not an
 *      auto-reject — the admin makes the final call. The rule fires on
 *      `type: 'title'` only: a `certification` named "Pediatric First Aid" is a
 *      legitimate qualification, not a claimed clinical role.
 *
 *   3. **Never an activation gate.** Credentials are OPTIONAL and do NOT gate
 *      activation — they are search-discoverability aids. This module is
 *      deliberately decoupled from `verification-workflow`; `computeVerificationState`
 *      never reads a Credential. (v1 verifies certs manually; automated
 *      certification verification is post-v1.)
 *
 * Also exposes the self-attested **"Tax-credit-friendly" (W-10) badge**
 * eligibility (Babysitter / Nanny only — CONTEXT.md § CDCTC). The companion
 * **"State-registered home childcare" (FCCH) badge** is admin-verified through
 * the `home-childcare-license-board` module (OH-108); like the W-10 badge it is
 * never an activation gate.
 *
 * Pure + deterministic. No I/O, no clock.
 */

import type { CaregiverCategory } from '@our-haven/shared';

// ---------------------------------------------------------------------------
// Credential shape
// ---------------------------------------------------------------------------

export const CREDENTIAL_TYPES = ['title', 'certification', 'training'] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

/** Max length of the free-text credential label (matches a single-line field). */
export const CREDENTIAL_LABEL_MAX_CHARS = 120;

/**
 * The immutable submission: the kind of qualification and its free-text label
 * (e.g. `title` "Lead Teacher", `certification` "CPR / First Aid", `training`
 * "Newborn Care").
 */
export interface CredentialShape {
  type: CredentialType;
  label: string;
}

// ---------------------------------------------------------------------------
// Review state machine (admin-driven)
// ---------------------------------------------------------------------------

export const CREDENTIAL_REVIEW_STATES = ['pending', 'approved', 'rejected'] as const;
export type CredentialReviewState = (typeof CREDENTIAL_REVIEW_STATES)[number];

/** A Credential plus its review status. */
export interface Credential extends CredentialShape {
  review: CredentialReviewState;
  /** Admin-facing reason, set when `review === 'rejected'`. */
  rejectionReason?: string | null;
}

export const CREDENTIAL_REVIEW_EVENTS = ['admin-approve', 'admin-reject'] as const;
export type CredentialReviewEventType = (typeof CREDENTIAL_REVIEW_EVENTS)[number];

export interface CredentialReviewEvent {
  type: CredentialReviewEventType;
  /** Admin-facing rejection reason; used only by `admin-reject`. */
  reason?: string;
}

export type CredentialReviewResult =
  | { ok: true; next: CredentialReviewState; rejectionReason: string | null }
  | { ok: false; reason: string };

/** The state a newly-submitted Credential is born in. Always `pending`. */
export function initialCredentialReview(): CredentialReviewState {
  return 'pending';
}

/**
 * Apply an admin review decision. Pure + deterministic. Only a `pending`
 * Credential can be reviewed; `approved` / `rejected` are terminal in v1
 * (re-submission, not in-place revocation, is the path to re-review).
 */
export function reviewCredential(
  current: CredentialReviewState,
  event: CredentialReviewEvent,
): CredentialReviewResult {
  if (current !== 'pending') {
    return {
      ok: false,
      reason: `${event.type} invalid from ${current} — only a pending credential can be reviewed`,
    };
  }
  switch (event.type) {
    case 'admin-approve':
      return { ok: true, next: 'approved', rejectionReason: null };
    case 'admin-reject': {
      const reason = event.reason?.trim();
      return { ok: true, next: 'rejected', rejectionReason: reason && reason.length > 0 ? reason : 'rejected' };
    }
  }
}

/**
 * Whether a Credential is shown on the public profile. Hidden until approved
 * (CONTEXT.md § Credentials) — `pending` and `rejected` are private to the
 * Caregiver and the admin queue.
 */
export function isCredentialPubliclyVisible(review: CredentialReviewState): boolean {
  return review === 'approved';
}

/** The status copy the Caregiver sees on their own profile for a Credential. */
export function caregiverFacingStatusLabel(review: CredentialReviewState): string {
  switch (review) {
    case 'pending':
      return 'Pending review';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Not approved';
  }
}

// ---------------------------------------------------------------------------
// Clinical-title classifier (the clinical-title rejection path)
// ---------------------------------------------------------------------------

/**
 * Clinical role/profession terms that must not appear in a Caregiver *title*.
 * Curated to the licensed-clinician vocabulary that collides with the Provider
 * tier (ADR-0011: slp / ot / aba / psychology) plus nursing & medicine.
 *
 * Matched on word boundaries (case-insensitive) so legitimate Caregiver
 * credentials are not snagged: "nursery" ≠ "nurse", "Doctorate in Education" ≠
 * "doctor", "Newborn Care Specialist" carries no listed term, "Aromatherapy" ≠
 * "therapy". Generic words ("specialist", "counselor" as in *camp counselor*,
 * "special education") are deliberately excluded to avoid false positives.
 */
const CLINICAL_TITLE_PATTERNS: readonly { term: string; re: RegExp }[] = [
  { term: 'nurse', re: /\bnurses?\b/i },
  { term: 'nursing', re: /\bnursing\b/i },
  { term: 'RN', re: /\brn\b/i },
  { term: 'LPN', re: /\blpn\b/i },
  { term: 'LVN', re: /\blvn\b/i },
  { term: 'CNA', re: /\bcna\b/i },
  { term: 'physician', re: /\bphysicians?\b/i },
  { term: 'doctor', re: /\bdoctors?\b/i },
  { term: 'surgeon', re: /\bsurgeons?\b/i },
  { term: 'MD', re: /\bm\.?d\.?\b/i },
  { term: 'therapist', re: /\btherapists?\b/i },
  { term: 'therapy', re: /\btherapy\b/i },
  { term: 'speech-language', re: /\bspeech[-\s]?language\b/i },
  { term: 'pathologist', re: /\bpathologists?\b/i },
  { term: 'SLP', re: /\bslp\b/i },
  { term: 'occupational', re: /\boccupational\b/i },
  { term: 'OT', re: /\bot\b/i },
  { term: 'physical therapy', re: /\bphysical therap(y|ist)\b/i },
  { term: 'PT', re: /\bpt\b/i },
  { term: 'psychologist', re: /\bpsycholog(y|ist)\b/i },
  { term: 'psychiatrist', re: /\bpsychiatr(y|ic|ist)\b/i },
  { term: 'behavior analyst', re: /\bbehaviou?r analysts?\b/i },
  { term: 'BCBA', re: /\bbcba\b/i },
  { term: 'RBT', re: /\brbt\b/i },
  { term: 'clinical', re: /\bclinical\b/i },
  { term: 'clinician', re: /\bclinicians?\b/i },
  { term: 'medical', re: /\bmedical\b/i },
  { term: 'pediatric', re: /\bpa?ediatric(ian)?s?\b/i },
  { term: 'audiologist', re: /\baudiolog(y|ist)\b/i },
  { term: 'dietitian', re: /\bdietitians?\b/i },
  { term: 'social worker', re: /\bsocial workers?\b/i },
  { term: 'LCSW', re: /\blcsw\b/i },
];

/**
 * The canonical clinical terms detected in a free-text label, in declaration
 * order. Empty when none — exposed for the admin UI to explain WHY a title was
 * flagged.
 */
export function clinicalTitleMatches(label: string): readonly string[] {
  return CLINICAL_TITLE_PATTERNS.filter(({ re }) => re.test(label)).map(({ term }) => term);
}

/** Whether a free-text label reads as a licensed clinical role/profession. */
export function isClinicalSoundingTitle(label: string): boolean {
  return CLINICAL_TITLE_PATTERNS.some(({ re }) => re.test(label));
}

/**
 * Whether a Credential should be auto-flagged for the clinical-title rejection
 * path. Fires on `type: 'title'` ONLY (CONTEXT.md § Credentials — admin rejects
 * clinical-sounding *titles*); certifications and trainings are exempt even if
 * their label names a clinical domain (e.g. a "Pediatric First Aid"
 * certification is legitimate). Admin-assist — not an auto-reject.
 */
export function hasClinicalTitleConflict(credential: CredentialShape): boolean {
  return credential.type === 'title' && isClinicalSoundingTitle(credential.label);
}

// ---------------------------------------------------------------------------
// Optional badges
// ---------------------------------------------------------------------------

/**
 * Categories eligible for the self-attested "Tax-credit-friendly" (W-10) badge
 * — Babysitter and Nanny only (CONTEXT.md § CDCTC). Tutoring is not childcare
 * for CDCTC / Dependent-Care-FSA purposes, so Tutor is excluded.
 */
export const TAX_CREDIT_FRIENDLY_CATEGORIES = ['babysitter', 'nanny'] as const satisfies readonly CaregiverCategory[];

/**
 * Whether a Caregiver qualifies for the "Tax-credit-friendly" badge: they have
 * self-attested they will issue IRS Form W-10 on request AND offer at least one
 * eligible (Babysitter / Nanny) category. Self-attestation only in v1 — no
 * document upload, no admin verification (CONTEXT.md § CDCTC).
 */
export function isTaxCreditFriendlyBadgeEligible(
  categories: readonly CaregiverCategory[],
  selfAttested: boolean,
): boolean {
  return (
    selfAttested &&
    categories.some((c) =>
      (TAX_CREDIT_FRIENDLY_CATEGORIES as readonly CaregiverCategory[]).includes(c),
    )
  );
}

export const CREDENTIALS_MODULE_VERSION = '0.1.0-OH-181';
