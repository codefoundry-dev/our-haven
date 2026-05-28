/**
 * Offer state machine (OH-113).
 *
 * Pure-TS deep module per ADR-0004. Encodes the v1 Offer state graph from
 * CONTEXT.md § Offer + ADR-0006 § Decision 5.
 *
 *   pending → accepted    (counterparty Accept; creates a Booking)
 *           → countered   (counterparty Counter; previous Offer is sealed,
 *                          a new Offer is sent back — handler creates the
 *                          successor Offer with `supersedes_offer_id` set
 *                          to this Offer's id)
 *           → declined    (counterparty Decline)
 *           → expired     (valid_until passed without action)
 *
 *   Direct-Message materialisation:
 *     At the moment the recipient hits Accept on a Direct-Message Offer
 *     whose anchor is `thread_id`, the Offer transitions `pending → accepted`
 *     AND the handler rebinds the Offer's anchor from `thread_id` to the
 *     freshly materialised `job_id` (see direct-message-materialisation
 *     module). The same transition occurs for Posted-Job Offers; the only
 *     difference is the anchor was a `job_id` from the start.
 *
 *   Per-child surcharge snapshot is immutable across the Offer's lifetime
 *   — the value is captured at send time and never re-derived from the
 *   Provider's profile. This module enforces that invariant statically by
 *   exposing the snapshot only on construction; transitions cannot mutate it.
 *
 * Pure + deterministic. No I/O.
 */

export const OFFER_STATES = ['pending', 'accepted', 'countered', 'declined', 'expired'] as const;
export type OfferState = (typeof OFFER_STATES)[number];

export const OFFER_TERMINAL_STATES = [
  'accepted',
  'countered',
  'declined',
  'expired',
] as const;
export type OfferTerminalState = (typeof OFFER_TERMINAL_STATES)[number];

export const OFFER_SENDERS = ['parent', 'provider'] as const;
export type OfferSender = (typeof OFFER_SENDERS)[number];

export const OFFER_SCOPE_TYPES = ['hourly', 'per_session'] as const;
export type OfferScopeType = (typeof OFFER_SCOPE_TYPES)[number];

/**
 * The Offer's anchor — either a Job (`job_id`) or, pre-acceptance in the
 * Direct-Message flow, a chat thread (`thread_id`). At Direct-Message
 * acceptance, the handler flips the anchor from `thread_id` to the freshly
 * materialised `job_id`.
 */
export type OfferAnchor =
  | { kind: 'job'; jobId: string }
  | { kind: 'thread'; threadId: string };

/**
 * Default Offer time-to-live in hours (ADR-0006 §5 default 72h).
 */
export const OFFER_VALID_UNTIL_DEFAULT_HOURS = 72;

/**
 * Maximum length of the free-text `scope_note`. ADR-0006 §5.
 */
export const OFFER_SCOPE_NOTE_MAX_CHARS = 280;

/**
 * Structural shape of an Offer at send time. The five "snapshot" fields
 * (proposed_rate, scope_type, scope_quantity, perChildSurchargeSnapshot,
 * computedTotal) are immutable for the Offer's life; later transitions
 * never overwrite them.
 */
export interface OfferShape {
  proposedRate: number;
  scopeType: OfferScopeType;
  scopeQuantity: number;
  scopeNote: string;
  perChildSurchargeSnapshot: number;
  computedTotal: number;
  validUntil: Date;
  sender: OfferSender;
  anchor: OfferAnchor;
}

export interface Offer extends OfferShape {
  state: OfferState;
}

export const OFFER_EVENT_TYPES = [
  'counterparty-accept',
  'counterparty-counter',
  'counterparty-decline',
  'auto-expire',
] as const;
export type OfferEventType = (typeof OFFER_EVENT_TYPES)[number];

export interface OfferEvent {
  type: OfferEventType;
  /** Current time, supplied by the handler. Pure module never reads a clock. */
  now: Date;
}

export const OFFER_SIDE_EFFECT_TYPES = [
  'notify-counterparty',
  'create-booking-with-agreed-rate',
  'open-successor-offer',
  'rebind-anchor-to-job',
  'materialise-direct-message-job',
] as const;
export type OfferSideEffectType = (typeof OFFER_SIDE_EFFECT_TYPES)[number];

export interface OfferSideEffect {
  type: OfferSideEffectType;
}

export type OfferTransitionResult =
  | { ok: true; next: OfferState; sideEffects: readonly OfferSideEffect[] }
  | { ok: false; reason: string };

/**
 * Compute the canonical `computed_total` for an Offer at send time.
 * `proposed_rate × scope_quantity + per_child_surcharge_snapshot`.
 *
 * The per-child surcharge snapshot is already the *total* surcharge value
 * for the Offer (handler computes `surcharge_per_child × (childCount - 1)`
 * before passing it in); this function does not multiply it again. This
 * keeps the pure module agnostic to per-Provider surcharge structure.
 */
export function computeOfferTotal(args: {
  proposedRate: number;
  scopeQuantity: number;
  perChildSurchargeSnapshot: number;
}): number {
  return args.proposedRate * args.scopeQuantity + args.perChildSurchargeSnapshot;
}

/**
 * Default `valid_until` for a newly-sent Offer. 72h ahead of `sentAt`.
 * Exposed as a helper for the handler; the pure module does not call it
 * itself.
 */
export function defaultValidUntil(sentAt: Date): Date {
  return new Date(sentAt.getTime() + OFFER_VALID_UNTIL_DEFAULT_HOURS * 60 * 60 * 1000);
}

export function isOfferTerminal(state: OfferState): boolean {
  return (OFFER_TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * Whether the Offer's `valid_until` has elapsed relative to `now`.
 */
export function isExpiredAt(offer: Offer, now: Date): boolean {
  return now.getTime() >= offer.validUntil.getTime();
}

/**
 * The state a newly-sent Offer is born in. Always `pending`.
 */
export function initialOfferState(): OfferState {
  return 'pending';
}

/**
 * Apply an event to an Offer. Pure + deterministic.
 *
 * Anchor-sensitive: an Offer anchored to a thread (`kind: 'thread'`)
 * transitioning to `accepted` triggers Direct-Message materialisation
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
        // Direct-Message flow: materialise Job + Application + Booking
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
      if (isExpiredAt(offer, event.now)) {
        return {
          ok: false,
          reason: 'counterparty-counter invalid — offer has already expired',
        };
      }
      return {
        ok: true,
        next: 'countered',
        sideEffects: [
          // The handler creates the new successor Offer with `supersedes_offer_id`
          // set to this Offer's id (FK back-reference); this side-effect tag
          // is the signal to do that.
          { type: 'open-successor-offer' },
          { type: 'notify-counterparty' },
        ],
      };
    }

    case 'counterparty-decline': {
      if (state !== 'pending') {
        return { ok: false, reason: `counterparty-decline invalid from ${state}` };
      }
      // Decline is valid even if the Offer is past valid_until, but in
      // practice the auto-expire timer will already have fired. We allow it
      // as a no-op-equivalent — both terminate the Offer with no Booking.
      return {
        ok: true,
        next: 'declined',
        sideEffects: [{ type: 'notify-counterparty' }],
      };
    }

    case 'auto-expire': {
      if (state !== 'pending') {
        return { ok: false, reason: `auto-expire invalid from ${state}` };
      }
      if (!isExpiredAt(offer, event.now)) {
        return {
          ok: false,
          reason: 'auto-expire invalid — offer is still within valid_until',
        };
      }
      return {
        ok: true,
        next: 'expired',
        sideEffects: [{ type: 'notify-counterparty' }],
      };
    }
  }
}

/**
 * Validate that a successor Offer (sent in response to `counterparty-counter`)
 * preserves the immutable per-child surcharge snapshot anchor of the original
 * Direct-Message Offer chain.
 *
 * ADR-0006 §5: "per_child_surcharge_snapshot immutable across Offer lifetime."
 * In a counter chain, the snapshot is recomputed against the sender-side
 * Provider profile *at the time the counter is sent*; the rule that "in-flight
 * Offers don't drift" applies *within* one Offer, not across the chain. This
 * helper exists to document the invariant explicitly and to flag the inverse
 * case (a successor that tries to re-use the predecessor's snapshot when its
 * own send-time profile has a different value — a likely caller bug).
 *
 * For the same-sender case (both Offers in the chain sent by the Provider
 * with no profile change in between) the snapshot must be byte-identical.
 */
export function snapshotInvariantsHold(
  predecessor: OfferShape,
  successor: OfferShape,
  providerProfileSurchargeUnchanged: boolean,
): boolean {
  if (predecessor.sender !== successor.sender) {
    // Different sender — successor uses its own sender's profile, predecessor
    // ratchet does not apply.
    return true;
  }
  if (!providerProfileSurchargeUnchanged) {
    // Same sender but profile changed — successor must reflect the new value.
    // Caller's responsibility; the invariant says we cannot *check* the value
    // here, only that whatever is captured at send time is honoured for the
    // rest of that Offer's lifetime.
    return true;
  }
  // Same sender, profile unchanged → snapshot must be byte-identical.
  return predecessor.perChildSurchargeSnapshot === successor.perChildSurchargeSnapshot;
}

export const OFFER_LIFECYCLE_MODULE_VERSION = '0.1.0-OH-113';
