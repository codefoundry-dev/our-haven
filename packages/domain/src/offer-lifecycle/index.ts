/**
 * Offer state machine — deep module (OH-179, deepens OH-113).
 *
 * Pure-TS per ADR-0004 (no DB / Stripe / Supabase imports; collaborators are
 * injected at the handler layer). Encodes the v1 Offer state graph from
 * CONTEXT.md § Offer + § negotiable + ADR-0006 § Decision 5 (narrowed by
 * ADR-0011 to Caregiver-only), ADR-0014 (multi-day `slots[]` → one Booking per
 * slot, no Series), ADR-0017 (`negotiable` gate), ADR-0018 (Tip lives on the
 * Booking receipt, never on the Offer).
 *
 *   pending → accepted    (counterparty Accept; materialises Booking(s))
 *           → countered   (counterparty Counter — GATED by `negotiable`; the
 *                          previous Offer is sealed, the handler opens a
 *                          successor with `supersedes_offer_id` set to this id)
 *           → declined    (counterparty Decline)
 *           → expired     (valid_until passed without action)
 *           → withdrawn   (SENDER-initiated, from `pending` OR `accepted`)
 *
 *   accepted → withdrawn  (sender withdraws an already-accepted Offer →
 *                          cascade-cancels every Booking/Series it materialised
 *                          via `offerId`; ADR-0014 amended). `accepted` is
 *                          therefore NOT terminal — withdraw is its one exit.
 *
 * ── Caregiver-only (ADR-0011) ──────────────────────────────────────────────
 *   Offers exist only on the Caregiver rail. Provider consultations are
 *   fixed-price slot-picks with no Offer (CONTEXT.md § Offer). Engagement is
 *   hourly — the `per_session` scope variant retired with the off-platform
 *   Provider tier, so `scope_type` is `hourly` only.
 *
 * ── Direct-Message materialisation ─────────────────────────────────────────
 *   At Accept on a Direct-Message Offer (anchor `thread`), the Offer goes
 *   `pending → accepted` AND the handler rebinds its anchor from `thread_id` to
 *   the freshly-materialised `job_id` (see direct-message-materialisation). A
 *   Posted-Job Offer (anchor `job`) takes the same transition without the
 *   materialisation/rebind — its anchor was a `job_id` from the start.
 *
 * ── Immutable snapshot ─────────────────────────────────────────────────────
 *   The pricing-snapshot fields (`proposedRate`, `scopeType`, `scopeQuantity`,
 *   `childCount`, `category`, `perChildSurchargeSnapshot`, `computedTotal`,
 *   `schedule`) are captured at send time and never re-derived from the
 *   Caregiver's profile; transitions never overwrite them.
 *
 * Pure + deterministic. No I/O. No clock is read — `now` is supplied on the
 * event so timer-driven transitions (`auto-expire`) stay deterministic.
 */

import type { CaregiverCategory } from '@our-haven/shared';

import type { BookingSlot, RecurrenceRule } from '../booking-lifecycle/index.js';
// NOTE: the `computed_total` derivation (`computeOfferTotal` /
// `offerTotalIsConsistent`) lives in the sibling `./total.ts` because it needs a
// RUNTIME import of the Pricing calculator. Keeping it out of this module leaves
// the Offer state machine free of runtime relative imports, so the Supabase Edge
// can import it cross-tree via an explicit `.ts` specifier without Deno chasing a
// `../pricing/index.js` that only exists as `.ts` on disk (ADR-0019; OH-203).

export const OFFER_STATES = [
  'pending',
  'accepted',
  'countered',
  'declined',
  'expired',
  'withdrawn',
] as const;
export type OfferState = (typeof OFFER_STATES)[number];

/**
 * States from which no further transition is valid.
 *
 * `accepted` is intentionally NOT terminal: a sender may still withdraw an
 * accepted Offer (CONTEXT.md § Offer — "Withdraw is sender-initiated from
 * `pending` or `accepted`"), which cascade-cancels the Booking(s) it
 * materialised. Its sole legal exit is `sender-withdraw`.
 */
export const OFFER_TERMINAL_STATES = [
  'countered',
  'declined',
  'expired',
  'withdrawn',
] as const;
export type OfferTerminalState = (typeof OFFER_TERMINAL_STATES)[number];

export const OFFER_SENDERS = ['parent', 'caregiver'] as const;
export type OfferSender = (typeof OFFER_SENDERS)[number];

/**
 * The only scope type in v1. Caregiver engagement is hourly; the `per_session`
 * variant retired with the off-platform Provider tier (CONTEXT.md § Offer).
 * Kept as a one-member enum for schema fidelity + forward-compat.
 */
export const OFFER_SCOPE_TYPES = ['hourly'] as const;
export type OfferScopeType = (typeof OFFER_SCOPE_TYPES)[number];

/**
 * The Offer's anchor — either a Job (`job_id`) or, pre-acceptance in the
 * Direct-Message flow, a chat thread (`thread_id`). At Direct-Message
 * acceptance the handler flips the anchor from `thread_id` to the freshly
 * materialised `job_id`.
 */
export type OfferAnchor =
  | { kind: 'job'; jobId: string }
  | { kind: 'thread'; threadId: string };

/**
 * The proposed concrete schedule (ADR-0014). One of:
 *   - `one-off`    — a single date + start–end window → one Booking.
 *   - `multi-day`  — several hand-picked dates → one INDEPENDENT Booking per
 *                    slot, NO Series (a multi-day one-off is not a recurrence).
 *   - `recurring`  — an anchored weekly rule → a Booking Series whose
 *                    occurrences are materialised up front.
 * Reuses the booking-lifecycle slot/rule shapes so the materialisation handler
 * can feed them straight into `materialiseMultiDayOneOff` / `materialiseSeries`.
 */
export type OfferSchedule =
  | { kind: 'one-off'; slot: BookingSlot }
  | { kind: 'multi-day'; slots: readonly BookingSlot[] }
  | { kind: 'recurring'; rule: RecurrenceRule };

/**
 * Default Offer time-to-live in hours (CONTEXT.md § Offer — `valid_until`
 * default 72h).
 */
export const OFFER_VALID_UNTIL_DEFAULT_HOURS = 72;

/** Maximum length of the free-text `scope_note` (CONTEXT.md § Offer). */
export const OFFER_SCOPE_NOTE_MAX_CHARS = 280;

/**
 * Structural shape of an Offer at send time. The pricing-snapshot fields are
 * immutable for the Offer's life; transitions never overwrite them. All money
 * is integer cents; `scopeQuantity` is billable hours (the sum across slots for
 * a multi-day / recurring schedule).
 */
export interface OfferShape {
  /** Hourly Agreed-Rate proposal. Integer cents ≥ 0. */
  proposedRate: number;
  scopeType: OfferScopeType;
  /** Billable hours the `computedTotal` covers (sum across slots if multi-day). */
  scopeQuantity: number;
  scopeNote: string;
  /** Number of Children on the engagement. ≥ 1; Tutor must be 1. */
  childCount: number;
  /** The single service category this Offer is pinned to. */
  category: CaregiverCategory;
  /** Babysitter / Nanny per-child surcharge, cents-PER-HOUR, snapshotted from
   *  the Caregiver's profile at send time. Tutor must be 0. */
  perChildSurchargeSnapshot: number;
  /** Snapshot of the parent charge (`proposedRate × scopeQuantity` + surcharge)
   *  at send time. Integer cents. See `computeOfferTotal`. */
  computedTotal: number;
  validUntil: Date;
  sender: OfferSender;
  /** The involved Caregiver's `negotiable` flag (ADR-0017). When false the
   *  `counterparty-counter` transition is refused — only Accept/Decline. */
  negotiable: boolean;
  anchor: OfferAnchor;
  schedule: OfferSchedule;
}

export interface Offer extends OfferShape {
  state: OfferState;
}

export const OFFER_EVENT_TYPES = [
  'counterparty-accept',
  'counterparty-counter',
  'counterparty-decline',
  'sender-withdraw',
  'auto-expire',
] as const;
export type OfferEventType = (typeof OFFER_EVENT_TYPES)[number];

export interface OfferEvent {
  type: OfferEventType;
  /** Current time, supplied by the handler. The pure module never reads a clock. */
  now: Date;
}

export const OFFER_SIDE_EFFECT_TYPES = [
  'notify-counterparty',
  'create-booking-with-agreed-rate',
  'open-successor-offer',
  'rebind-anchor-to-job',
  'materialise-direct-message-job',
  'cascade-cancel-materialised-bookings',
] as const;
export type OfferSideEffectType = (typeof OFFER_SIDE_EFFECT_TYPES)[number];

export interface OfferSideEffect {
  type: OfferSideEffectType;
}

export type OfferTransitionResult =
  | { ok: true; next: OfferState; sideEffects: readonly OfferSideEffect[] }
  | { ok: false; reason: string };

/**
 * Default `valid_until` for a newly-sent Offer — 72h ahead of `sentAt`. A
 * helper for the handler; the pure module never calls it itself.
 */
export function defaultValidUntil(sentAt: Date): Date {
  return new Date(sentAt.getTime() + OFFER_VALID_UNTIL_DEFAULT_HOURS * 60 * 60 * 1000);
}

export function isOfferTerminal(state: OfferState): boolean {
  return (OFFER_TERMINAL_STATES as readonly string[]).includes(state);
}

/** Whether the Offer's `valid_until` has elapsed relative to `now`. */
export function isExpiredAt(offer: Pick<Offer, 'validUntil'>, now: Date): boolean {
  return now.getTime() >= offer.validUntil.getTime();
}

/**
 * Whether a counter-Offer is allowed: only on a `pending` Offer whose involved
 * Caregiver has `negotiable` on (ADR-0017). A pure predicate the UI uses to
 * show/hide the Counter pill and `transitionOffer` enforces on the transition.
 */
export function canCounter(offer: Offer): boolean {
  return offer.state === 'pending' && offer.negotiable;
}

/**
 * Whether the SENDER may still EDIT their Offer in place (OH-208; PRD story 131).
 * Only a `pending` Offer is editable — an edit revises the immutable snapshot
 * (rate / schedule / child-detail / disclosure / address) WITHOUT changing state
 * and re-arms the `valid_until` window at the handler. Once the counterparty has
 * acted (`accepted` / `countered` / `declined`) or the Offer `expired`, the terms
 * are settled and can no longer be revised. Authorisation (sender-only) is a
 * handler concern; this is the pure state gate the UI + handler both consult.
 */
export function canEditOffer(offer: Pick<Offer, 'state'>): boolean {
  return offer.state === 'pending';
}

/**
 * Whether the SENDER may DELETE (hard-remove) their Offer (OH-208; PRD story 131),
 * erasing it from the transcript as though never sent. Only a `pending` Offer is
 * deletable — an already-`accepted` Offer has materialised Bookings and must be
 * `sender-withdraw`n instead (which cascade-cancels them; see `transitionOffer`),
 * never silently deleted. Delete is thus the pre-engagement sibling of withdraw:
 * withdraw leaves a `withdrawn` tombstone, delete leaves nothing.
 */
export function canDeleteOffer(offer: Pick<Offer, 'state'>): boolean {
  return offer.state === 'pending';
}

/** The state a newly-sent Offer is born in. Always `pending`. */
export function initialOfferState(): OfferState {
  return 'pending';
}

/**
 * Apply an event to an Offer. Pure + deterministic.
 *
 * Anchor-sensitive: an Offer anchored to a thread (`kind: 'thread'`)
 * transitioning to `accepted` emits the Direct-Message materialisation
 * side-effects; an Offer anchored to a Job (`kind: 'job'`) does not.
 */
export function transitionOffer(offer: Offer, event: OfferEvent): OfferTransitionResult {
  const { state, anchor } = offer;

  switch (event.type) {
    case 'counterparty-accept': {
      if (state !== 'pending') {
        return { ok: false, reason: `counterparty-accept invalid from ${state}` };
      }
      if (isExpiredAt(offer, event.now)) {
        return {
          ok: false,
          reason: 'counterparty-accept invalid — offer has already expired (valid_until passed)',
        };
      }
      const sideEffects: OfferSideEffect[] = [{ type: 'notify-counterparty' }];
      if (anchor.kind === 'thread') {
        // Direct-Message flow: materialise Job + Application + Booking(s)
        // atomically, then rebind this Offer's anchor from thread to job.
        sideEffects.push(
          { type: 'materialise-direct-message-job' },
          { type: 'rebind-anchor-to-job' },
          { type: 'create-booking-with-agreed-rate' },
        );
      } else {
        // Posted-Job flow: the Booking creation is the only follow-on.
        sideEffects.push({ type: 'create-booking-with-agreed-rate' });
      }
      return { ok: true, next: 'accepted', sideEffects };
    }

    case 'counterparty-counter': {
      if (state !== 'pending') {
        return { ok: false, reason: `counterparty-counter invalid from ${state}` };
      }
      if (!offer.negotiable) {
        // ADR-0017: when the involved Caregiver has `negotiable` off, Counter
        // is hidden on both sides — only Accept/Decline are valid.
        return {
          ok: false,
          reason:
            'counterparty-counter invalid — the caregiver has negotiable off (only accept/decline are valid; ADR-0017)',
        };
      }
      if (isExpiredAt(offer, event.now)) {
        return { ok: false, reason: 'counterparty-counter invalid — offer has already expired' };
      }
      return {
        ok: true,
        next: 'countered',
        sideEffects: [
          // The handler creates the successor Offer with `supersedes_offer_id`
          // set to this Offer's id (FK back-reference).
          { type: 'open-successor-offer' },
          { type: 'notify-counterparty' },
        ],
      };
    }

    case 'counterparty-decline': {
      if (state !== 'pending') {
        return { ok: false, reason: `counterparty-decline invalid from ${state}` };
      }
      // Decline is valid even past valid_until — both terminate the Offer with
      // no Booking; in practice the auto-expire timer will already have fired.
      return { ok: true, next: 'declined', sideEffects: [{ type: 'notify-counterparty' }] };
    }

    case 'sender-withdraw': {
      // Sender-initiated (CONTEXT.md § Offer). Asymmetric by source state:
      //   - from `pending`:  no Booking exists yet — just seal the Offer.
      //   - from `accepted`: cascade-cancel every Booking/Series this Offer
      //                      materialised (the handler resolves them by offerId,
      //                      ADR-0014 amended).
      if (state === 'pending') {
        return { ok: true, next: 'withdrawn', sideEffects: [{ type: 'notify-counterparty' }] };
      }
      if (state === 'accepted') {
        return {
          ok: true,
          next: 'withdrawn',
          sideEffects: [
            { type: 'cascade-cancel-materialised-bookings' },
            { type: 'notify-counterparty' },
          ],
        };
      }
      return {
        ok: false,
        reason: `sender-withdraw invalid from ${state} — only a pending or accepted offer can be withdrawn`,
      };
    }

    case 'auto-expire': {
      if (state !== 'pending') {
        return { ok: false, reason: `auto-expire invalid from ${state}` };
      }
      if (!isExpiredAt(offer, event.now)) {
        return { ok: false, reason: 'auto-expire invalid — offer is still within valid_until' };
      }
      return { ok: true, next: 'expired', sideEffects: [{ type: 'notify-counterparty' }] };
    }
  }
}

/**
 * Validate that a successor Offer (sent in response to `counterparty-counter`)
 * preserves the immutable per-child surcharge snapshot of its predecessor.
 *
 * CONTEXT.md § Offer: "per_child_surcharge_snapshot immutable across Offer
 * lifetime." The rule that "in-flight Offers don't drift" applies WITHIN one
 * Offer; a counter chain may legitimately recompute the snapshot against the
 * sender-side profile at the time the counter is sent. This helper documents
 * the invariant explicitly and flags the inverse case (a same-sender successor
 * whose snapshot drifted with no profile change — a likely caller bug).
 */
export function snapshotInvariantsHold(
  predecessor: OfferShape,
  successor: OfferShape,
  caregiverProfileSurchargeUnchanged: boolean,
): boolean {
  if (predecessor.sender !== successor.sender) {
    // Different sender — successor uses its own sender's profile.
    return true;
  }
  if (!caregiverProfileSurchargeUnchanged) {
    // Same sender but profile changed — successor must reflect the new value.
    return true;
  }
  // Same sender, profile unchanged → snapshot must be byte-identical.
  return predecessor.perChildSurchargeSnapshot === successor.perChildSurchargeSnapshot;
}

export const OFFER_LIFECYCLE_MODULE_VERSION = '0.2.0-OH-179';
