/**
 * Post-a-Job compose planner — deep module (OH-209).
 *
 * Pure-TS per ADR-0004 (no DB / Stripe / Supabase imports; collaborators are
 * injected at the handler layer). Turns the Parent's **Post-a-Job** compose
 * payload into the concrete `jobs` row(s) to persist, applying the cross-field
 * business rules the Edge zod schema can't express and the ADR-0014 §A1 fan-out.
 *
 * ── Schedule fan-out (ADR-0014 §A1) ─────────────────────────────────────────
 * The composer produces the same `OfferSchedule` discriminated union as the
 * Book-request path (`one-off` single | `multi-day` | `recurring`), but a Job
 * cannot BE `multi-day`: a multi-day one-off is posted as **one one-off Job per
 * date** (the deliberate asymmetry vs the Book-request path, which bundles into
 * one Offer → many Bookings). So `planJobPosts` maps:
 *   - one-off (single date)  → 1 posted Job  (scheduleKind 'one-off', 1 slot)
 *   - multi-day (N dates)     → N posted Jobs (each 'one-off', 1 slot)
 *   - recurring (a rule)      → 1 posted Job  (scheduleKind 'recurring', rule)
 * A recurring Job carries its rule un-expanded; the Booking Series + occurrences
 * only materialise at award (booking-lifecycle), not at post.
 *
 * ── Disclose-or-none + timestamped consent (ADR-0016) ───────────────────────
 * `safetyBehaviors` is the parent-selected disclosed subset; `[]` is the valid
 * explicit "disclose none". `disclosureConsentAt` (the timestamped compose
 * consent covering the child-detail bundle) is REQUIRED — a post with the child
 * bundle but no consent stamp is refused.
 *
 * The occurrence PREVIEW a recurring composer shows is `expandRecurrence`
 * (booking-lifecycle) — a read-only projection kept out of this module so the
 * planner stays a pure structural validator + fan-out (the Edge counts
 * occurrences with `expandRecurrence` directly; ADR-0014 §4).
 */

import type { CaregiverCategory } from '@our-haven/shared';
import type { BookingSlot, RecurrenceRule } from '../booking-lifecycle/index.js';
import type { OfferSchedule } from '../offer-lifecycle/index.js';

/** Upper bound on hand-picked dates in one multi-day compose (→ that many Jobs). */
export const JOB_COMPOSE_MAX_SLOTS = 31;
/** Scope free-text cap (the Job `description`). */
export const JOB_COMPOSE_DESCRIPTION_MAX_CHARS = 2000;
/** Ad-hoc child bundle cap (mirrors the Offer composer). */
export const JOB_COMPOSE_MAX_CHILDREN = 12;
export const JOB_COMPOSE_MAX_CHILD_AGE = 17;

const CATEGORIES: readonly CaregiverCategory[] = ['babysitter', 'tutor', 'nanny'];

/** The service address on a posted Job. `postalCode` (ZIP) is the required
 *  location anchor; the street is optional and reveals to Caregivers at accept. */
export interface JobServiceAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode: string;
}

/** The raw Post-a-Job compose payload (as the composer assembles it). */
export interface JobComposeInput {
  category: CaregiverCategory;
  /** Scope free-text (persisted as the Job `description`). */
  description: string;
  childCount: number;
  /** One integer age (years, 0–17) per child — length must equal `childCount`. */
  childAges: readonly number[];
  /** Parent-disclosed Safety-Behaviors subset (taxonomy keys); `[]` = disclose none. */
  safetyBehaviors: readonly string[];
  /** ZIP is required; the street is optional (reveal-at-accept). */
  serviceAddress: JobServiceAddress;
  /** Optional advisory hourly-rate hint, integer cents. */
  budgetHintCents?: number | null;
  /** Timestamped compose disclosure consent (ISO). REQUIRED (ADR-0016 §6). */
  disclosureConsentAt: string;
  schedule: OfferSchedule;
}

/** One concrete posted Job to INSERT (schedule normalised to a single Job). */
export interface PostedJobSpec {
  category: CaregiverCategory;
  description: string;
  childCount: number;
  childAges: readonly number[];
  safetyBehaviors: readonly string[];
  serviceAddress: JobServiceAddress;
  budgetHintCents: number | null;
  disclosureConsentAt: string;
  scheduleKind: 'one-off' | 'recurring';
  /** A single-element list for a one-off Job; empty for a recurring Job. */
  slots: readonly BookingSlot[];
  /** Set for a recurring Job; null for a one-off Job. */
  recurrence: RecurrenceRule | null;
}

export type JobComposeValidation = { ok: true } | { ok: false; reason: string };
export type PlanJobPostsResult =
  | { ok: true; posts: PostedJobSpec[] }
  | { ok: false; reason: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATE_RE = /^[A-Z]{2}$/;
const ZIP_RE = /^\d{5}$/;

function isIntInRange(n: unknown, lo: number, hi: number): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;
}

/** A concrete session window is valid iff both ends are minute integers in
 *  [0,1440] and the start precedes the end. */
function validWindow(startMin: number, endMin: number): boolean {
  return (
    isIntInRange(startMin, 0, 1440) &&
    isIntInRange(endMin, 0, 1440) &&
    startMin < endMin
  );
}

function validSlot(slot: BookingSlot): boolean {
  return (
    typeof slot?.date === 'string' &&
    DATE_RE.test(slot.date) &&
    validWindow(slot.startMin, slot.endMin)
  );
}

/** Structural validity of a recurrence rule (dates + weekday selection + window).
 *  Occurrence-count (≥1) is checked by the caller via `expandRecurrence`. */
function validRule(rule: RecurrenceRule): boolean {
  return (
    typeof rule?.startDate === 'string' &&
    DATE_RE.test(rule.startDate) &&
    typeof rule.endDate === 'string' &&
    DATE_RE.test(rule.endDate) &&
    rule.endDate >= rule.startDate &&
    Array.isArray(rule.weekdays) &&
    rule.weekdays.length > 0 &&
    rule.weekdays.every((w: number) => isIntInRange(w, 0, 6)) &&
    validWindow(rule.startMin, rule.endMin)
  );
}

/** The slots a schedule carries (a one-off is a single-slot list). */
function scheduleSlots(schedule: OfferSchedule): readonly BookingSlot[] {
  if (schedule.kind === 'one-off') return [schedule.slot];
  if (schedule.kind === 'multi-day') return schedule.slots;
  return [];
}

/**
 * Validate a Post-a-Job compose payload against the cross-field business rules
 * (the Edge zod validates types + ranges; this layer owns the invariants that
 * span fields). Returns `{ok:false, reason}` on the first violation.
 */
export function validateJobCompose(input: JobComposeInput): JobComposeValidation {
  if (!CATEGORIES.includes(input.category)) {
    return { ok: false, reason: `unknown category '${input.category}'` };
  }
  const desc = input.description?.trim() ?? '';
  if (desc.length === 0) {
    return { ok: false, reason: 'description (scope) is required' };
  }
  if (desc.length > JOB_COMPOSE_DESCRIPTION_MAX_CHARS) {
    return { ok: false, reason: `description exceeds ${JOB_COMPOSE_DESCRIPTION_MAX_CHARS} chars` };
  }
  if (!isIntInRange(input.childCount, 1, JOB_COMPOSE_MAX_CHILDREN)) {
    return { ok: false, reason: 'childCount must be between 1 and 12' };
  }
  if (input.category === 'tutor' && input.childCount !== 1) {
    return { ok: false, reason: 'tutor Jobs are single-child' };
  }
  if (!Array.isArray(input.childAges) || input.childAges.length !== input.childCount) {
    return { ok: false, reason: 'childAges length must equal childCount' };
  }
  if (!input.childAges.every((a) => isIntInRange(a, 0, JOB_COMPOSE_MAX_CHILD_AGE))) {
    return { ok: false, reason: 'each child age must be an integer 0–17' };
  }
  if (!Array.isArray(input.safetyBehaviors)) {
    return { ok: false, reason: 'safetyBehaviors must be provided ([] = disclose none)' };
  }
  // Disclosure consent is required whenever the child-detail bundle is posted
  // (ADR-0016 §6) — the whole bundle is always present on a posted Job.
  if (typeof input.disclosureConsentAt !== 'string' || input.disclosureConsentAt.trim() === '') {
    return { ok: false, reason: 'disclosure consent (timestamped) is required' };
  }
  const zip = input.serviceAddress?.postalCode;
  if (typeof zip !== 'string' || !ZIP_RE.test(zip)) {
    return { ok: false, reason: 'a 5-digit service ZIP is required' };
  }
  const st = input.serviceAddress?.state;
  if (st != null && st !== '' && !STATE_RE.test(st)) {
    return { ok: false, reason: 'service state must be a 2-letter code' };
  }
  if (input.budgetHintCents != null && (!Number.isInteger(input.budgetHintCents) || input.budgetHintCents < 0)) {
    return { ok: false, reason: 'budgetHintCents must be a non-negative integer' };
  }

  const { schedule } = input;
  if (schedule.kind === 'recurring') {
    if (!validRule(schedule.rule)) {
      return { ok: false, reason: 'invalid recurrence rule' };
    }
  } else {
    const slots = scheduleSlots(schedule);
    if (slots.length === 0) {
      return { ok: false, reason: 'at least one date is required' };
    }
    if (slots.length > JOB_COMPOSE_MAX_SLOTS) {
      return { ok: false, reason: `at most ${JOB_COMPOSE_MAX_SLOTS} dates` };
    }
    if (!slots.every(validSlot)) {
      return { ok: false, reason: 'each date needs a valid date + start-before-end window' };
    }
  }
  return { ok: true };
}

/**
 * Plan the posted Job row(s) for a compose payload: validate, then fan a
 * multi-day one-off out into one one-off Job per date (ADR-0014 §A1). A one-off
 * single-date post yields one Job; a recurring post yields one Job carrying the
 * un-expanded rule. Returns `{ok:false, reason}` if validation fails.
 */
export function planJobPosts(input: JobComposeInput): PlanJobPostsResult {
  const check = validateJobCompose(input);
  if (!check.ok) return check;

  const base = {
    category: input.category,
    description: input.description.trim(),
    childCount: input.childCount,
    childAges: [...input.childAges],
    safetyBehaviors: [...input.safetyBehaviors],
    serviceAddress: input.serviceAddress,
    budgetHintCents: input.budgetHintCents ?? null,
    disclosureConsentAt: input.disclosureConsentAt,
  } as const;

  if (input.schedule.kind === 'recurring') {
    return {
      ok: true,
      posts: [{ ...base, scheduleKind: 'recurring', slots: [], recurrence: input.schedule.rule }],
    };
  }

  // one-off (single) OR multi-day → one one-off Job per date.
  const slots = scheduleSlots(input.schedule);
  return {
    ok: true,
    posts: slots.map((slot) => ({
      ...base,
      scheduleKind: 'one-off' as const,
      slots: [slot],
      recurrence: null,
    })),
  };
}

export const JOB_COMPOSE_MODULE_VERSION = '0.1.0-OH-209';
