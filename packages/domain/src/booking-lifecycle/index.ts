/**
 * Booking lifecycle state machine (OH-112).
 *
 * Pure-TS deep module per ADR-0004. Encodes the v1 Booking state graph from
 * CONTEXT.md § Booking states + PRD-0001 § Modules / Booking lifecycle.
 *
 *   Posted-Job hourly:
 *     requested → accepted | declined | expired
 *     accepted  → in-progress | cancelled
 *     in-progress → awaiting-confirmation | cancelled
 *     awaiting-confirmation → completed | disputed
 *     completed → disputed (within 7d, dispute filed by Parent)
 *
 *   Direct-Message hourly:
 *     Born in `accepted` (skips `requested`); rest as Posted-Job hourly.
 *
 *   Per-session Specialist (origin agnostic):
 *     Skips in-progress + awaiting-confirmation entirely.
 *     Posted-Job:    requested → accepted → completed | cancelled
 *     Direct-Message: accepted → completed | cancelled
 *
 * Inputs: current Booking shape + state + event. Outputs: next state + the
 * semantic side-effects the handler layer must enqueue (notifications, pgmq
 * timers, Stripe operations). No I/O happens here.
 */

export const BOOKING_STATES = [
  'requested',
  'accepted',
  'declined',
  'expired',
  'in-progress',
  'awaiting-confirmation',
  'completed',
  'disputed',
  'cancelled',
] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

/**
 * States from which no further transitions are valid.
 *
 * `completed` is intentionally *not* in this list — a Parent may file a
 * dispute within 7d of completion, transitioning `completed → disputed`
 * (CONTEXT.md § Dispute).
 */
export const BOOKING_TERMINAL_STATES = [
  'declined',
  'expired',
  'cancelled',
  'disputed',
] as const;
export type BookingTerminalState = (typeof BOOKING_TERMINAL_STATES)[number];

export const BOOKING_ORIGINS = ['posted-job', 'direct-message'] as const;
export type BookingOrigin = (typeof BOOKING_ORIGINS)[number];

export const BOOKING_BILLING_MODELS = ['hourly', 'per-session'] as const;
export type BookingBillingModel = (typeof BOOKING_BILLING_MODELS)[number];

export interface BookingShape {
  origin: BookingOrigin;
  billingModel: BookingBillingModel;
}

export interface Booking extends BookingShape {
  state: BookingState;
}

export const BOOKING_EVENT_TYPES = [
  'provider-accept',
  'provider-decline',
  'request-expire',
  'parent-cancel',
  'provider-cancel',
  'session-start',
  'session-end-propose-hours',
  'parent-confirm-hours',
  'session-auto-confirm',
  'parent-dispute',
  'mark-completed',
] as const;
export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number];

export interface BookingEvent {
  type: BookingEventType;
}

/**
 * Semantic side-effect tags. The handler layer translates each into actual
 * I/O — Expo Push / SendGrid / Twilio dispatch, pgmq enqueue, Stripe ops.
 */
export const BOOKING_SIDE_EFFECT_TYPES = [
  'schedule-request-expiry-24h',
  'schedule-session-auto-confirm-24h',
  'notify-parent',
  'notify-provider',
  'notify-both',
  'enqueue-payment-capture',
  'enqueue-payment-cancellation-charge',
  'enqueue-payment-full-refund',
  'enqueue-payout',
  'flag-for-admin-review',
] as const;
export type BookingSideEffectType = (typeof BOOKING_SIDE_EFFECT_TYPES)[number];

export interface BookingSideEffect {
  type: BookingSideEffectType;
}

export type TransitionResult =
  | { ok: true; next: BookingState; sideEffects: readonly BookingSideEffect[] }
  | { ok: false; reason: string };

/**
 * The state a newly-created Booking is born in.
 *
 * Per CONTEXT.md § Booking states + § Job (Direct-Message lazy materialisation):
 *   - Posted-Job:    born `requested` (Provider has 24h to confirm)
 *   - Direct-Message: born `accepted` (the Accept click was the commitment)
 */
export function initialBookingState(shape: BookingShape): BookingState {
  return shape.origin === 'posted-job' ? 'requested' : 'accepted';
}

/**
 * The side-effects to enqueue at Booking creation. Posted-Job Bookings need
 * a 24h auto-expiry timer wired up so the Provider's silence triggers the
 * `request-expire` event.
 */
export function initialBookingSideEffects(
  shape: BookingShape,
): readonly BookingSideEffect[] {
  if (shape.origin === 'posted-job') {
    return [{ type: 'notify-provider' }, { type: 'schedule-request-expiry-24h' }];
  }
  return [{ type: 'notify-both' }];
}

export function isBookingTerminal(state: BookingState): boolean {
  return (BOOKING_TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * Whether the Booking is in a state that can still accept Parent disputes.
 * Hourly bookings allow disputes from `awaiting-confirmation`; both flows
 * allow disputes for 7d after `completed` (CONTEXT.md § Dispute).
 */
export function isDisputable(state: BookingState): boolean {
  return state === 'awaiting-confirmation' || state === 'completed';
}

/**
 * Apply an event to a Booking, returning the next state + the side-effects
 * the handler should enqueue, or a refusal explaining why the transition is
 * illegal.
 *
 * Pure + deterministic: identical (booking, event) pairs always produce
 * identical results.
 */
export function transitionBooking(
  booking: Booking,
  event: BookingEvent,
): TransitionResult {
  const { state, origin, billingModel } = booking;

  switch (event.type) {
    case 'provider-accept': {
      if (state !== 'requested') {
        return { ok: false, reason: `provider-accept invalid from ${state}` };
      }
      if (origin !== 'posted-job') {
        return {
          ok: false,
          reason: 'provider-accept only valid for posted-job bookings (direct-message bookings are born accepted)',
        };
      }
      return { ok: true, next: 'accepted', sideEffects: [{ type: 'notify-parent' }] };
    }

    case 'provider-decline': {
      if (state !== 'requested') {
        return { ok: false, reason: `provider-decline invalid from ${state}` };
      }
      if (origin !== 'posted-job') {
        return { ok: false, reason: 'provider-decline only valid for posted-job bookings' };
      }
      return {
        ok: true,
        next: 'declined',
        sideEffects: [
          { type: 'notify-parent' },
          { type: 'enqueue-payment-full-refund' },
        ],
      };
    }

    case 'request-expire': {
      if (state !== 'requested') {
        return { ok: false, reason: `request-expire invalid from ${state}` };
      }
      if (origin !== 'posted-job') {
        return { ok: false, reason: 'request-expire only valid for posted-job bookings' };
      }
      return {
        ok: true,
        next: 'expired',
        sideEffects: [
          { type: 'notify-both' },
          { type: 'enqueue-payment-full-refund' },
        ],
      };
    }

    case 'session-start': {
      if (state !== 'accepted') {
        return { ok: false, reason: `session-start invalid from ${state}` };
      }
      if (billingModel !== 'hourly') {
        return {
          ok: false,
          reason: 'session-start only valid for hourly bookings (per-session has no session phase)',
        };
      }
      return {
        ok: true,
        next: 'in-progress',
        sideEffects: [{ type: 'notify-parent' }],
      };
    }

    case 'session-end-propose-hours': {
      if (state !== 'in-progress') {
        return { ok: false, reason: `session-end-propose-hours invalid from ${state}` };
      }
      if (billingModel !== 'hourly') {
        return { ok: false, reason: 'session-end-propose-hours only valid for hourly bookings' };
      }
      return {
        ok: true,
        next: 'awaiting-confirmation',
        sideEffects: [
          { type: 'notify-parent' },
          { type: 'schedule-session-auto-confirm-24h' },
        ],
      };
    }

    case 'parent-confirm-hours': {
      if (state !== 'awaiting-confirmation') {
        return { ok: false, reason: `parent-confirm-hours invalid from ${state}` };
      }
      if (billingModel !== 'hourly') {
        return { ok: false, reason: 'parent-confirm-hours only valid for hourly bookings' };
      }
      return {
        ok: true,
        next: 'completed',
        sideEffects: [
          { type: 'notify-provider' },
          { type: 'enqueue-payment-capture' },
          { type: 'enqueue-payout' },
        ],
      };
    }

    case 'session-auto-confirm': {
      if (state !== 'awaiting-confirmation') {
        return { ok: false, reason: `session-auto-confirm invalid from ${state}` };
      }
      if (billingModel !== 'hourly') {
        return { ok: false, reason: 'session-auto-confirm only valid for hourly bookings' };
      }
      return {
        ok: true,
        next: 'completed',
        sideEffects: [
          { type: 'notify-both' },
          { type: 'enqueue-payment-capture' },
          { type: 'enqueue-payout' },
        ],
      };
    }

    case 'mark-completed': {
      if (state !== 'accepted') {
        return { ok: false, reason: `mark-completed invalid from ${state}` };
      }
      if (billingModel !== 'per-session') {
        return {
          ok: false,
          reason: 'mark-completed only valid for per-session bookings (hourly uses session-end-propose-hours + parent-confirm-hours)',
        };
      }
      return {
        ok: true,
        next: 'completed',
        sideEffects: [
          { type: 'notify-both' },
          { type: 'enqueue-payment-capture' },
          { type: 'enqueue-payout' },
        ],
      };
    }

    case 'parent-cancel': {
      // Parent may cancel from any non-terminal pre-completion state. The
      // separate cancellation policy calculator decides the refund/fee split
      // based on proximity to start time.
      if (isBookingTerminal(state) || state === 'completed') {
        return { ok: false, reason: `parent-cancel invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'cancelled',
        sideEffects: [
          { type: 'notify-provider' },
          { type: 'enqueue-payment-cancellation-charge' },
        ],
      };
    }

    case 'provider-cancel': {
      // Provider cancellation is free in v1 but always flagged for admin
      // review (CONTEXT.md § Cancellation policy). Provider cannot use this
      // from `requested` — they would use `provider-decline` instead.
      if (state === 'requested') {
        return {
          ok: false,
          reason: 'provider-cancel from requested — use provider-decline',
        };
      }
      if (isBookingTerminal(state) || state === 'completed') {
        return { ok: false, reason: `provider-cancel invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'cancelled',
        sideEffects: [
          { type: 'notify-parent' },
          { type: 'enqueue-payment-full-refund' },
          { type: 'flag-for-admin-review' },
        ],
      };
    }

    case 'parent-dispute': {
      // Dispute may be filed during awaiting-confirmation (hourly only) or
      // within 7d post-completion (both flows). CONTEXT.md § Dispute.
      if (!isDisputable(state)) {
        return { ok: false, reason: `parent-dispute invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'disputed',
        sideEffects: [
          { type: 'notify-provider' },
          { type: 'flag-for-admin-review' },
        ],
      };
    }
  }
}

export const BOOKING_LIFECYCLE_MODULE_VERSION = '0.1.0-OH-112';
