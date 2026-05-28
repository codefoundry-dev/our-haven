/**
 * Direct-Message atomic materialisation (OH-113).
 *
 * Pure-TS deep module per ADR-0004. Encodes the v1 contract from
 * CONTEXT.md § Job (Direct-Message), § Application, § Booking states +
 * ADR-0006 § Decision 2 + § Decision 6.
 *
 *   Pre-acceptance:
 *     - A chat thread exists, anchored to a `thread_id`.
 *     - Either party has sent at least one Offer; the latest Offer is
 *       `pending` and anchored to the same `thread_id`.
 *     - No Job, Application, or Booking exists yet.
 *
 *   At Accept (recipient hits Accept on the pending Offer):
 *     - **All four mutations happen in one TX or none of them happen.**
 *     - Job is materialised, born `awarded` (skips draft + open).
 *     - One Application is materialised, born `awarded`.
 *     - One Booking is materialised, born `accepted` (skips `requested`).
 *     - The Offer transitions `pending → accepted` and its anchor flips
 *       from `thread_id` to the new `job_id`.
 *     - The chat thread itself rebinds from `thread_id` to the new `job_id`.
 *     - Predecessor counter-Offers in the same thread stay `thread_id`-
 *       anchored (visible in chat history but not part of the materialised
 *       Job's audit trail — ADR-0006 §5).
 *
 * This module returns the *plan* — the shapes the handler should INSERT, in
 * dependency order, inside one TX. The handler layer wraps this in a
 * Supabase transaction. The pure module proves the all-or-nothing contract
 * at the schema level: every materialised row carries the same fresh
 * `jobId`, and every output is a function of the inputs.
 */

import type { OfferAnchor, OfferShape } from '../offer-lifecycle/index.js';

export interface AcceptedOfferInput {
  /** Original Offer's `id` — handler-supplied, used as the FK for the
   *  accepted Offer row after materialisation. */
  offerId: string;
  /** The Offer's body at the moment of Accept. `state` must be `pending`;
   *  this module flips it to `accepted` in the output. */
  offer: OfferShape;
}

export interface AcceptingThreadInput {
  /** The pre-acceptance thread's id; the rebind moves this thread from
   *  `thread_id` anchoring to the freshly materialised `jobId`. */
  threadId: string;
  /** The Provider id involved in the thread. */
  providerId: string;
  /** The Parent id involved in the thread. */
  parentId: string;
  /** Free-text Job description supplied by the Parent at thread creation.
   *  Materialised Direct-Message Jobs have no separate composer step; the
   *  description defaults to a short auto-generated marker if absent. */
  description?: string;
}

export interface MaterialisationInput {
  /** Fresh ids the handler reserved before calling this module. The pure
   *  module never invents ids. */
  ids: {
    jobId: string;
    applicationId: string;
    bookingId: string;
  };
  thread: AcceptingThreadInput;
  acceptedOffer: AcceptedOfferInput;
  /** Wall-clock at acceptance, for `acceptedAt` timestamps + audit. */
  now: Date;
}

export interface MaterialisedJob {
  id: string;
  origin: 'direct-message';
  state: 'awarded';
  parentId: string;
  providerId: string;
  description: string;
  createdAt: Date;
  awardedAt: Date;
}

export interface MaterialisedApplication {
  id: string;
  jobId: string;
  providerId: string;
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
  providerId: string;
  origin: 'direct-message';
  /** Born accepted — skips `requested` per ADR-0006 §6. */
  state: 'accepted';
  agreedRate: number;
  /** Computed total at Offer-send-time, baked in (per-child surcharge already
   *  included). The Booking record is the source of truth for billing math. */
  computedTotal: number;
  acceptedAt: Date;
}

export interface MaterialisedAcceptedOffer {
  id: string;
  state: 'accepted';
  /** New anchor — Job id, post-rebind. */
  anchor: Extract<OfferAnchor, { kind: 'job' }>;
  /** Original thread id, retained for audit (where the conversation lived). */
  originatingThreadId: string;
  acceptedAt: Date;
  /** All other Offer fields are preserved unchanged (immutability — see
   *  offer-lifecycle § snapshot invariant). */
  preserved: OfferShape;
}

export interface MaterialisationPlan {
  job: MaterialisedJob;
  application: MaterialisedApplication;
  booking: MaterialisedBooking;
  offer: MaterialisedAcceptedOffer;
  /** The thread row should be updated to point at the new job id. */
  threadRebind: {
    threadId: string;
    newJobId: string;
  };
}

export type MaterialisationResult =
  | { ok: true; plan: MaterialisationPlan }
  | { ok: false; reason: string };

/**
 * Plan the four-way materialisation. Pure + deterministic — same input
 * always produces the same plan.
 *
 * Validation:
 *   - Offer anchor must be `thread` (this is the Direct-Message path).
 *   - The thread id on the anchor must match the input thread.
 *   - The Offer must be the latest in the thread (caller's responsibility
 *     to fetch the latest; we sanity-check the anchor matches).
 *   - All three ids must be non-empty and distinct.
 *
 * On validation failure: returns `{ ok: false, reason }` — the handler must
 * NOT enter a TX. On success: returns the plan; the handler INSERTs the
 * four rows + UPDATEs the thread row in one TX. If any INSERT fails, the
 * TX rolls back; the all-or-nothing contract is preserved.
 */
export function planMaterialisation(input: MaterialisationInput): MaterialisationResult {
  const { ids, thread, acceptedOffer, now } = input;
  const { offer, offerId } = acceptedOffer;

  if (!ids.jobId || !ids.applicationId || !ids.bookingId) {
    return { ok: false, reason: 'all three ids (jobId, applicationId, bookingId) must be non-empty' };
  }
  if (
    ids.jobId === ids.applicationId ||
    ids.jobId === ids.bookingId ||
    ids.applicationId === ids.bookingId
  ) {
    return { ok: false, reason: 'jobId, applicationId, bookingId must all be distinct' };
  }
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

  const job: MaterialisedJob = {
    id: ids.jobId,
    origin: 'direct-message',
    state: 'awarded',
    parentId: thread.parentId,
    providerId: thread.providerId,
    description: thread.description ?? `[direct-message ${thread.threadId}]`,
    createdAt: now,
    awardedAt: now,
  };

  const application: MaterialisedApplication = {
    id: ids.applicationId,
    jobId: ids.jobId,
    providerId: thread.providerId,
    origin: 'direct-message',
    state: 'awarded',
    acceptedOfferId: offerId,
    awardedAt: now,
  };

  const booking: MaterialisedBooking = {
    id: ids.bookingId,
    jobId: ids.jobId,
    applicationId: ids.applicationId,
    parentId: thread.parentId,
    providerId: thread.providerId,
    origin: 'direct-message',
    state: 'accepted',
    agreedRate: offer.proposedRate,
    computedTotal: offer.computedTotal,
    acceptedAt: now,
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
      booking,
      offer: acceptedOfferOut,
      threadRebind: { threadId: thread.threadId, newJobId: ids.jobId },
    },
  };
}

export const DIRECT_MESSAGE_MATERIALISATION_MODULE_VERSION = '0.1.0-OH-113';
