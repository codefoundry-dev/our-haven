/**
 * Direct-Message atomic materialisation — deep module (OH-179, deepens OH-113).
 *
 * Pure-TS per ADR-0004. Encodes the v1 Book-request-accept contract from
 * CONTEXT.md § Job (Direct-Message) / § Application / § Offer / § Booking +
 * ADR-0006 § Decision 2 + § Decision 6, ADR-0011 (Caregiver-only), ADR-0014
 * (multi-day `slots[]` → one Booking per slot, no Series; recurring → a Series),
 * ADR-0019 (the atomic write is a TS-orchestrated Kysely `db.transaction()` —
 * the plpgsql-canary green-state, no stored procedure).
 *
 *   Pre-acceptance:
 *     - A chat thread exists, anchored to a `thread_id`, between a Parent and a
 *       Caregiver. The latest Offer is `pending` and `thread_id`-anchored.
 *     - No Job, Application, or Booking exists yet.
 *
 *   At Accept (recipient accepts the pending Book-request Offer):
 *     - **All mutations happen in one TX or none of them do.**
 *     - Job is materialised, born `awarded` (skips draft + open).
 *     - One Application is materialised, born `awarded`.
 *     - The Booking(s) are materialised, born `accepted` (skip `requested`):
 *         · one-off          → exactly one Booking,
 *         · multi-day slots[] → one INDEPENDENT Booking per slot, NO Series,
 *         · recurring        → a stateless Series + one Booking per occurrence.
 *       Every materialised Booking/Series carries the accepted Offer's `offerId`
 *       so a later sender-withdraw can cascade-cancel them (ADR-0014 amended).
 *     - The Offer transitions `pending → accepted` and its anchor flips from
 *       `thread_id` to the new `job_id`.
 *     - The chat thread rebinds from `thread_id` to the new `job_id`.
 *
 * This module returns the *plan* — the row shapes the handler INSERTs, in
 * dependency order, inside one `db.transaction()`. The pure module proves the
 * all-or-nothing contract at the schema level: a validation failure returns
 * `{ ok: false }` with NO partial plan (the handler must not open a TX), and on
 * success every materialised row carries the same fresh `jobId` and is a pure
 * function of the inputs. The booking-lifecycle materialise helpers do the slot
 * expansion + id/slot validation, so that logic lives in exactly one place.
 */

import type { CaregiverCategory } from '@our-haven/shared';

import {
  materialiseMultiDayOneOff,
  materialiseSeries,
  type BookingSlot,
  type CaregiverSchedule,
  type RecurrenceRule,
} from '../booking-lifecycle/index.js';
import { calculatePricing } from '../pricing/index.js';
import type { OfferAnchor, OfferShape } from '../offer-lifecycle/index.js';

export interface AcceptedOfferInput {
  /** The accepted Offer's `id` — the FK every materialised Booking/Series
   *  carries for the withdraw-cascade, and the accepted-offer row's own id. */
  offerId: string;
  /** The Offer's body at the moment of Accept. Its `state` must be `pending`;
   *  this module emits the `accepted` form in the output. Its `schedule` drives
   *  how many Bookings are materialised. */
  offer: OfferShape;
}

export interface AcceptingThreadInput {
  /** The pre-acceptance thread's id; the rebind moves it to the new `jobId`. */
  threadId: string;
  /** The Caregiver in the thread (supply side — ADR-0011). */
  caregiverId: string;
  /** The Parent in the thread. */
  parentId: string;
  /** Free-text Job description. Direct-Message Jobs have no composer step, so
   *  this defaults to a short auto-generated marker when absent. */
  description?: string;
}

export interface MaterialisationIds {
  jobId: string;
  applicationId: string;
  /** One handler-reserved id per materialised Booking. Length must equal the
   *  Offer schedule's slot/occurrence count. The pure module never invents ids. */
  bookingIds: readonly string[];
  /** Required iff the Offer schedule is `recurring`; the Series row's id. Must
   *  be omitted for one-off / multi-day schedules (which have no Series). */
  seriesId?: string;
}

export interface MaterialisationInput {
  ids: MaterialisationIds;
  thread: AcceptingThreadInput;
  acceptedOffer: AcceptedOfferInput;
  /** Wall-clock at acceptance, for `acceptedAt` / `awardedAt` timestamps. */
  now: Date;
}

export interface MaterialisedJob {
  id: string;
  origin: 'direct-message';
  state: 'awarded';
  parentId: string;
  caregiverId: string;
  category: CaregiverCategory;
  description: string;
  createdAt: Date;
  awardedAt: Date;
}

export interface MaterialisedApplication {
  id: string;
  jobId: string;
  caregiverId: string;
  origin: 'direct-message';
  state: 'awarded';
  acceptedOfferId: string;
  awardedAt: Date;
}

export interface MaterialisedBooking {
  id: string;
  jobId: string;
  applicationId: string;
  parentId: string;
  caregiverId: string;
  category: CaregiverCategory;
  origin: 'direct-message';
  /** Born `accepted` — the Accept click was the commitment (ADR-0006 §6). */
  state: 'accepted';
  /** Set for recurring Series occurrences; null for a one-off or multi-day
   *  one-off bundle (a multi-day one-off is not a Series — ADR-0014 §A1). */
  seriesId: string | null;
  /** Back-link to the accepted Offer; withdrawing it cascade-cancels this row. */
  offerId: string;
  slot: BookingSlot;
  schedule: CaregiverSchedule;
  agreedRate: number;
  /** This slot's parent charge (Pricing calculator), per-child surcharge
   *  included. Integer cents — the booking-level receipt snapshot. */
  computedTotal: number;
  acceptedAt: Date;
}

export interface MaterialisedSeries {
  id: string;
  jobId: string;
  parentId: string;
  caregiverId: string;
  category: CaregiverCategory;
  origin: 'direct-message';
  rule: RecurrenceRule;
  agreedRate: number;
  occurrenceIds: readonly string[];
  offerId: string;
}

export interface MaterialisedAcceptedOffer {
  id: string;
  state: 'accepted';
  /** New anchor — Job id, post-rebind. */
  anchor: Extract<OfferAnchor, { kind: 'job' }>;
  /** Original thread id, retained for audit (where the conversation lived). */
  originatingThreadId: string;
  acceptedAt: Date;
  /** All other Offer fields preserved unchanged (snapshot immutability). */
  preserved: OfferShape;
}

export interface MaterialisationPlan {
  job: MaterialisedJob;
  application: MaterialisedApplication;
  /** 1 (one-off), N (multi-day one-off), or M (recurring occurrences). */
  bookings: MaterialisedBooking[];
  /** Set only for a recurring Offer; null for one-off + multi-day one-off. */
  series: MaterialisedSeries | null;
  offer: MaterialisedAcceptedOffer;
  /** The thread row is repointed at the new job id. */
  threadRebind: { threadId: string; newJobId: string };
}

export type MaterialisationResult =
  | { ok: true; plan: MaterialisationPlan }
  | { ok: false; reason: string };

/** A materialised occurrence reduced to the fields this module re-envelopes. */
interface RawOccurrence {
  id: string;
  slot: BookingSlot;
  schedule: CaregiverSchedule;
  seriesId: string | null;
}

/** This slot's parent charge (base + per-child surcharge), via the Pricing
 *  calculator so the booking receipt and the Offer total share one model.
 *  `commissionBp` is 0 — `computedTotal` is the pre-commission parent charge. */
function bookingTotal(offer: OfferShape, hours: number): number {
  return calculatePricing({
    agreedRateCents: offer.proposedRate,
    hours,
    childCount: offer.childCount,
    perChildSurchargeCents: offer.perChildSurchargeSnapshot,
    commissionBp: 0,
    category: offer.category,
  }).parentChargeCents;
}

/**
 * Plan the atomic materialisation. Pure + deterministic — same input always
 * produces the same plan.
 *
 * Validation (any failure → `{ ok: false }`, no partial plan):
 *   - `jobId` / `applicationId` / `offerId` non-empty; all reserved ids distinct.
 *   - Offer anchor must be `thread` and match the input thread.
 *   - `seriesId` present iff the Offer schedule is `recurring`.
 *   - `bookingIds` count must match the schedule's slot/occurrence count (and
 *     the recurrence rule must be valid) — enforced by the booking-lifecycle
 *     materialise helpers.
 *   - Offer pricing inputs must be valid (e.g. a Tutor must be single-child).
 *
 * On success the handler INSERTs job → application → series? → booking(s) →
 * accepted-offer and UPDATEs the thread, all in one `db.transaction()`.
 */
export function planMaterialisation(input: MaterialisationInput): MaterialisationResult {
  const { ids, thread, acceptedOffer, now } = input;
  const { offer, offerId } = acceptedOffer;
  const origin = 'direct-message' as const;

  // ── id presence + cross-distinctness ──────────────────────────────────────
  if (!ids.jobId || !ids.applicationId) {
    return { ok: false, reason: 'jobId and applicationId must be non-empty' };
  }
  if (!offerId) {
    return { ok: false, reason: 'offerId must be non-empty' };
  }
  const reservedIds = [
    ids.jobId,
    ids.applicationId,
    ...ids.bookingIds,
    ...(ids.seriesId ? [ids.seriesId] : []),
  ];
  if (reservedIds.some((id) => !id)) {
    return { ok: false, reason: 'all reserved ids must be non-empty' };
  }
  if (new Set(reservedIds).size !== reservedIds.length) {
    return {
      ok: false,
      reason: 'jobId, applicationId, bookingIds and seriesId must all be distinct',
    };
  }

  // ── anchor must be the Direct-Message thread, matching the input thread ────
  if (offer.anchor.kind !== 'thread') {
    return {
      ok: false,
      reason: `direct-message materialisation requires a thread-anchored offer; got ${offer.anchor.kind}`,
    };
  }
  if (offer.anchor.threadId !== thread.threadId) {
    return {
      ok: false,
      reason: `offer anchor thread (${offer.anchor.threadId}) does not match input thread (${thread.threadId})`,
    };
  }

  // ── materialise the Booking(s) from the Offer schedule (reuse the
  //    booking-lifecycle helpers for slot expansion + id/slot validation) ─────
  let occurrences: RawOccurrence[];
  let series: MaterialisedSeries | null = null;

  if (offer.schedule.kind === 'recurring') {
    if (!ids.seriesId) {
      return { ok: false, reason: 'a recurring offer requires ids.seriesId' };
    }
    const m = materialiseSeries({
      seriesId: ids.seriesId,
      parentId: thread.parentId,
      caregiverId: thread.caregiverId,
      category: offer.category,
      origin,
      agreedRate: offer.proposedRate,
      rule: offer.schedule.rule,
      occurrenceIds: ids.bookingIds,
      offerId,
    });
    if (!m.ok) return { ok: false, reason: m.reason };
    series = {
      id: m.series.id,
      jobId: ids.jobId,
      parentId: m.series.parentId,
      caregiverId: m.series.caregiverId,
      category: offer.category,
      origin,
      rule: m.series.rule,
      agreedRate: m.series.agreedRate,
      occurrenceIds: m.series.occurrenceIds,
      offerId,
    };
    occurrences = m.occurrences.map((o) => ({
      id: o.id,
      slot: o.slot,
      schedule: o.schedule,
      seriesId: o.seriesId,
    }));
  } else {
    if (ids.seriesId) {
      return {
        ok: false,
        reason: 'ids.seriesId must be omitted for a one-off / multi-day offer (no Series)',
      };
    }
    const slots =
      offer.schedule.kind === 'one-off' ? [offer.schedule.slot] : offer.schedule.slots;
    const m = materialiseMultiDayOneOff({
      parentId: thread.parentId,
      caregiverId: thread.caregiverId,
      category: offer.category,
      origin,
      agreedRate: offer.proposedRate,
      slots,
      bookingIds: ids.bookingIds,
      offerId,
    });
    if (!m.ok) return { ok: false, reason: m.reason };
    occurrences = m.bookings.map((o) => ({
      id: o.id,
      slot: o.slot,
      schedule: o.schedule,
      seriesId: o.seriesId,
    }));
  }

  // ── envelope each occurrence into a full Booking row ──────────────────────
  let bookings: MaterialisedBooking[];
  try {
    bookings = occurrences.map((o) => ({
      id: o.id,
      jobId: ids.jobId,
      applicationId: ids.applicationId,
      parentId: thread.parentId,
      caregiverId: thread.caregiverId,
      category: offer.category,
      origin,
      state: 'accepted' as const,
      seriesId: o.seriesId,
      offerId,
      slot: o.slot,
      schedule: o.schedule,
      agreedRate: offer.proposedRate,
      computedTotal: bookingTotal(offer, o.schedule.durationHours),
      acceptedAt: now,
    }));
  } catch (e) {
    // The Pricing calculator throws on caller-bug Offer inputs (e.g. a Tutor
    // with >1 child). Surface it as a refusal, not an exception — the handler
    // must not open a TX.
    return { ok: false, reason: `invalid offer pricing: ${(e as Error).message}` };
  }

  const job: MaterialisedJob = {
    id: ids.jobId,
    origin,
    state: 'awarded',
    parentId: thread.parentId,
    caregiverId: thread.caregiverId,
    category: offer.category,
    description: thread.description ?? `[direct-message ${thread.threadId}]`,
    createdAt: now,
    awardedAt: now,
  };

  const application: MaterialisedApplication = {
    id: ids.applicationId,
    jobId: ids.jobId,
    caregiverId: thread.caregiverId,
    origin,
    state: 'awarded',
    acceptedOfferId: offerId,
    awardedAt: now,
  };

  const acceptedOfferOut: MaterialisedAcceptedOffer = {
    id: offerId,
    state: 'accepted',
    anchor: { kind: 'job', jobId: ids.jobId },
    originatingThreadId: thread.threadId,
    acceptedAt: now,
    preserved: offer,
  };

  return {
    ok: true,
    plan: {
      job,
      application,
      bookings,
      series,
      offer: acceptedOfferOut,
      threadRebind: { threadId: thread.threadId, newJobId: ids.jobId },
    },
  };
}

export const DIRECT_MESSAGE_MATERIALISATION_MODULE_VERSION = '0.2.0-OH-179';
