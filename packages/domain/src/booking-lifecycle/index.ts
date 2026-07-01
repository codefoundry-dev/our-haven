/**
 * Booking lifecycle state machine — deep module (OH-177, deepens OH-112).
 *
 * Pure-TS per ADR-0004 (no DB / Stripe / Supabase imports; collaborators are
 * injected at the handler layer). Encodes the v1 Booking state graph and the
 * Caregiver/Provider supply fork from CONTEXT.md § Booking / § Booking Series /
 * § Booking states + ADR-0011 (three roles), ADR-0013 (single review window),
 * ADR-0014 (concrete scheduling + recurring Series + multi-day one-off +
 * adjust-time).
 *
 * ── The two supply tracks (ADR-0011) ──────────────────────────────────────
 *
 *   Caregiver Booking (hourly, ON-platform payment):
 *     Posted-Job:     requested → accepted | declined | expired
 *     Direct-Message: born `accepted` (skips `requested`)
 *     accepted    → in-progress           (session-start)
 *     in-progress → awaiting-confirmation  (session-end-propose-hours)
 *     awaiting-confirmation → completed     (parent-confirm-hours | session-auto-confirm)
 *                          → disputed       (parent-dispute — the only payout-holding dispute)
 *     any active state → cancelled          (parent-cancel / caregiver-cancel)
 *
 *   Provider consultation (per-session, NULL payment — off-platform, HIPAA):
 *     born `accepted` (slot-pick is the commitment)
 *     accepted → completed                  (consultation-auto-complete after the slot)
 *              → cancelled                   (parent-cancel / provider-cancel — releases the slot)
 *     Skips in-progress / awaiting-confirmation / dispute entirely. No capture,
 *     no payout, no Commission, no payment-coupled dispute (ADR-0011).
 *
 * ── Dispute (ADR-0013 + 2026-06-23 amendment) ─────────────────────────────
 *   `awaiting-confirmation` is the SOLE payout-holding / state-changing dispute
 *   (in-window → `disputed`). `completed` is terminal for payout — the old
 *   7-day `completed → disputed` edge is RETIRED. A self-serve "charge/billing"
 *   complaint from `accepted` or `completed` is an admin escalation (it sets a
 *   flag + routes to admin) and is NOT a lifecycle transition — see
 *   `canFileBillingComplaint`; `transitionBooking` refuses `parent-dispute`
 *   from those states.
 *
 * ── Scheduling (ADR-0014) ─────────────────────────────────────────────────
 *   - Recurring Caregiver arrangement → a stateless Booking Series whose
 *     occurrences are materialised up front, each an independent Booking
 *     running the graph on its own (`materialiseSeries`).
 *   - Multi-day one-off → one independent Booking per hand-picked date, with
 *     NO Series (`materialiseMultiDayOneOff`).
 *   - Adjust-time on an `accepted` Caregiver Booking: extend applies
 *     immediately; shorten writes a transient `pendingTimeChange` the Caregiver
 *     approves/declines, resolving back to a plain `accepted`.
 *
 * Inputs: a Booking's shape + state + an event / operation. Outputs: the next
 * state (or updated schedule) + the semantic side-effects the handler layer
 * must enqueue (notifications, pgmq timers, Stripe ops). No I/O happens here.
 */

// ──────────────────────────────────────────────────────────────────────────
// States
// ──────────────────────────────────────────────────────────────────────────

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
 * States from which no further lifecycle transition is valid.
 *
 * `completed` is terminal here (ADR-0013): with the 7-day post-completion
 * dispute edge retired, no event moves a Booking out of `completed`. A
 * post-payout billing complaint is an admin escalation (`canFileBillingComplaint`)
 * that sets a flag without changing state — it is not a transition.
 *
 * `disputed` is NOT terminal (OH-213): an in-window dispute holds the Payout and
 * routes to admin, who resolves it (`admin-resolve-dispute`) either back to
 * `completed` (rejected → caregiver paid) or `cancelled` (upheld → parent
 * refunded). It stays out of `BOOKING_ACTIVE_STATES` so a Parent/Caregiver
 * cancel can never move a held dispute — only admin resolution can.
 */
export const BOOKING_TERMINAL_STATES = [
  'declined',
  'expired',
  'completed',
  'cancelled',
] as const;
export type BookingTerminalState = (typeof BOOKING_TERMINAL_STATES)[number];

/** Non-terminal states a Booking can be cancelled from (caregiver track). */
export const BOOKING_ACTIVE_STATES = [
  'requested',
  'accepted',
  'in-progress',
  'awaiting-confirmation',
] as const;
export type BookingActiveState = (typeof BOOKING_ACTIVE_STATES)[number];

// ──────────────────────────────────────────────────────────────────────────
// The supply fork (ADR-0011) — caregiver (payment rail) vs provider (SaaS)
// ──────────────────────────────────────────────────────────────────────────

export const BOOKING_KINDS = ['caregiver', 'provider'] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];

/** How a Caregiver Booking was created. Provider consultations have no Job
 *  chain (slot-pick from the profile), so this axis is Caregiver-only. */
export const CAREGIVER_ORIGINS = ['posted-job', 'direct-message'] as const;
export type CaregiverOrigin = (typeof CAREGIVER_ORIGINS)[number];

/**
 * The structural shape that picks a Booking's track. A discriminated union so
 * illegal combinations (e.g. a Provider with a posted-job origin) are
 * unrepresentable:
 *   - `caregiver` → hourly, on-platform payment, posted-job | direct-message.
 *   - `provider`  → per-session consultation, null payment, slot-pick.
 */
export type BookingShape =
  | { kind: 'caregiver'; origin: CaregiverOrigin }
  | { kind: 'provider' };

export type Booking = BookingShape & { state: BookingState };

// ──────────────────────────────────────────────────────────────────────────
// Events
// ──────────────────────────────────────────────────────────────────────────

export const BOOKING_EVENT_TYPES = [
  // Caregiver — posted-job confirmation gate
  'caregiver-accept',
  'caregiver-decline',
  'request-expire',
  // Caregiver — hourly session spine
  'session-start',
  'session-end-propose-hours',
  'parent-confirm-hours',
  'session-auto-confirm',
  'parent-dispute',
  // Dispute resolution (admin, OH-213) — the only exit from `disputed`.
  'admin-resolve-dispute',
  // No-show (OH-213) — Parent reports the supply did not show, from `accepted`.
  'parent-report-no-show',
  // Cancellation (both tracks, validity differs by kind)
  'parent-cancel',
  'caregiver-cancel',
  'provider-cancel',
  // Provider — consultation completion
  'consultation-auto-complete',
] as const;
export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number];

/** The admin's decision on a disputed Booking (`admin-resolve-dispute`). */
export type DisputeResolutionOutcome = 'rejected' | 'upheld';

/**
 * Most events are payload-free. `admin-resolve-dispute` additionally carries the
 * admin's `outcome`, which picks the resolved state + money side-effect:
 *   - `rejected` (dispute not upheld) → `completed`, caregiver paid (capture).
 *   - `upheld`   (dispute upheld)     → `cancelled`, parent refunded.
 * The field is optional on the shared type; `transitionBooking` refuses an
 * `admin-resolve-dispute` that omits it, so callers can't silently pick a branch.
 */
export interface BookingEvent {
  type: BookingEventType;
  outcome?: DisputeResolutionOutcome;
}

// ──────────────────────────────────────────────────────────────────────────
// Side-effects (semantic tags; the handler layer maps each to real I/O)
// ──────────────────────────────────────────────────────────────────────────

export const BOOKING_SIDE_EFFECT_TYPES = [
  'schedule-request-expiry-24h',
  'schedule-session-auto-confirm-24h',
  'schedule-consultation-auto-complete',
  'notify-parent',
  'notify-caregiver',
  'notify-provider',
  'notify-both',
  'enqueue-payment-capture',
  'enqueue-payment-cancellation-charge',
  'enqueue-payment-full-refund',
  'enqueue-payment-reauthorize',
  'enqueue-payout',
  'release-consultation-slot',
  'flag-for-admin-review',
  // Supply-quality auto-flag for a no-show (OH-213) — distinct from
  // `flag-for-admin-review` (a dispute/cancel admin-queue signal): this one
  // increments the supply's no-show flag count that drives the 2→review / 3→
  // suspend standing (CONTEXT § No-show).
  'flag-supply-no-show',
] as const;
export type BookingSideEffectType = (typeof BOOKING_SIDE_EFFECT_TYPES)[number];

export interface BookingSideEffect {
  type: BookingSideEffectType;
}

export type TransitionResult =
  | { ok: true; next: BookingState; sideEffects: readonly BookingSideEffect[] }
  | { ok: false; reason: string };

// ──────────────────────────────────────────────────────────────────────────
// Predicates
// ──────────────────────────────────────────────────────────────────────────

export function isBookingTerminal(state: BookingState): boolean {
  return (BOOKING_TERMINAL_STATES as readonly string[]).includes(state);
}

export function isBookingActive(state: BookingState): boolean {
  return (BOOKING_ACTIVE_STATES as readonly string[]).includes(state);
}

/**
 * Whether a state-changing, payout-holding dispute (`parent-dispute`) is valid.
 * Only `awaiting-confirmation` — the in-window review dispute (ADR-0013).
 */
export function isDisputable(state: BookingState): boolean {
  return state === 'awaiting-confirmation';
}

/**
 * States from which a Parent may file a self-serve "charge & billing" complaint
 * (ADR-0013 amendment, `DISPUTABLE = { accepted, confirm_hours, completed }`).
 * Only the `awaiting-confirmation` case is a lifecycle transition that holds the
 * Payout; from `accepted` / `completed` the complaint is an ADMIN ESCALATION
 * that sets the Booking's `dispute` flag and routes to admin WITHOUT moving the
 * Booking's state or holding money. This predicate documents the entry points;
 * the escalation itself is handler-layer, not a `transitionBooking` event.
 */
export const BOOKING_BILLING_COMPLAINT_STATES = [
  'accepted',
  'awaiting-confirmation',
  'completed',
] as const;
export function canFileBillingComplaint(state: BookingState): boolean {
  return (BOOKING_BILLING_COMPLAINT_STATES as readonly string[]).includes(state);
}

/** A provider consultation Booking carries no on-platform payment (ADR-0011). */
export function isConsultation(shape: BookingShape): boolean {
  return shape.kind === 'provider';
}

/**
 * States from which a Parent may report a supply no-show (OH-213, CONTEXT §
 * No-show). Only `accepted`: the engagement was committed but the session never
 * started (a caregiver who reached `in-progress` "showed"; nothing auto-advances
 * an un-started `accepted` caregiver Booking). Provider consultations can
 * auto-complete off `accepted` at slot end — a no-show reported after that is
 * out of scope for v1 (provider no-show is a flag only, no money).
 */
export function canReportNoShow(state: BookingState): boolean {
  return state === 'accepted';
}

/**
 * The supply no-show flag thresholds (CONTEXT § No-show): two active no-show
 * flags route the caregiver/provider to manual admin review; three suspends
 * their listing. Exposed as constants so the handler + tests share one source.
 */
export const SUPPLY_NO_SHOW_REVIEW_THRESHOLD = 2;
export const SUPPLY_NO_SHOW_SUSPEND_THRESHOLD = 3;

export type SupplyStanding = 'ok' | 'manual-review' | 'suspended';

/**
 * Map a supply's active no-show flag count to their standing. Pure + monotone:
 *   0–1 → `ok`, 2 → `manual-review`, ≥3 → `suspended`.
 * The count MUST be scoped to active no-show flags only — an unrelated
 * `flag-for-admin-review` (e.g. a caregiver-cancel) must never push a supply
 * toward auto-suspension.
 */
export function evaluateSupplyStanding(activeNoShowFlagCount: number): SupplyStanding {
  if (activeNoShowFlagCount >= SUPPLY_NO_SHOW_SUSPEND_THRESHOLD) return 'suspended';
  if (activeNoShowFlagCount >= SUPPLY_NO_SHOW_REVIEW_THRESHOLD) return 'manual-review';
  return 'ok';
}

// ──────────────────────────────────────────────────────────────────────────
// Birth state + creation side-effects
// ──────────────────────────────────────────────────────────────────────────

/**
 * The state a newly-created Booking is born in.
 *   - Caregiver posted-job: `requested` (Caregiver has 24h to confirm).
 *   - Caregiver direct-message: `accepted` (the Accept click was the commitment).
 *   - Provider consultation: `accepted` (booking the open slot is the commitment).
 */
export function initialBookingState(shape: BookingShape): BookingState {
  if (shape.kind === 'provider') return 'accepted';
  return shape.origin === 'posted-job' ? 'requested' : 'accepted';
}

/**
 * The side-effects to enqueue at Booking creation.
 *   - Posted-Job: notify the Caregiver + arm the 24h auto-expiry timer.
 *   - Direct-Message: notify both (born accepted — no expiry timer).
 *   - Provider consultation: notify both + arm the auto-complete timer for the
 *     slot end. No payment intent is created (null payment, ADR-0011).
 */
export function initialBookingSideEffects(
  shape: BookingShape,
): readonly BookingSideEffect[] {
  if (shape.kind === 'provider') {
    return [{ type: 'notify-both' }, { type: 'schedule-consultation-auto-complete' }];
  }
  if (shape.origin === 'posted-job') {
    return [{ type: 'notify-caregiver' }, { type: 'schedule-request-expiry-24h' }];
  }
  return [{ type: 'notify-both' }];
}

// ──────────────────────────────────────────────────────────────────────────
// The state machine
// ──────────────────────────────────────────────────────────────────────────

function assertNever(x: never): never {
  throw new Error(`unhandled booking event type: ${String(x)}`);
}

/**
 * Apply an event to a Booking, returning the next state + the side-effects the
 * handler should enqueue, or a refusal explaining why the transition is illegal.
 *
 * Pure + deterministic: identical (booking, event) pairs always produce
 * identical results. No clock is read — timer-driven transitions
 * (`request-expire`, `session-auto-confirm`, `consultation-auto-complete`) are
 * delivered as events when the handler's pgmq timer fires.
 */
export function transitionBooking(
  booking: Booking,
  event: BookingEvent,
): TransitionResult {
  const { state } = booking;

  switch (event.type) {
    // ── Caregiver posted-job confirmation gate ────────────────────────────
    case 'caregiver-accept': {
      if (booking.kind !== 'caregiver') {
        return { ok: false, reason: 'caregiver-accept only valid for caregiver bookings' };
      }
      if (booking.origin !== 'posted-job') {
        return {
          ok: false,
          reason:
            'caregiver-accept only valid for posted-job bookings (direct-message bookings are born accepted)',
        };
      }
      if (state !== 'requested') {
        return { ok: false, reason: `caregiver-accept invalid from ${state}` };
      }
      return { ok: true, next: 'accepted', sideEffects: [{ type: 'notify-parent' }] };
    }

    case 'caregiver-decline': {
      if (booking.kind !== 'caregiver') {
        return { ok: false, reason: 'caregiver-decline only valid for caregiver bookings' };
      }
      if (booking.origin !== 'posted-job') {
        return { ok: false, reason: 'caregiver-decline only valid for posted-job bookings' };
      }
      if (state !== 'requested') {
        return { ok: false, reason: `caregiver-decline invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'declined',
        sideEffects: [{ type: 'notify-parent' }, { type: 'enqueue-payment-full-refund' }],
      };
    }

    case 'request-expire': {
      if (booking.kind !== 'caregiver') {
        return { ok: false, reason: 'request-expire only valid for caregiver bookings' };
      }
      if (booking.origin !== 'posted-job') {
        return { ok: false, reason: 'request-expire only valid for posted-job bookings' };
      }
      if (state !== 'requested') {
        // No-op when already out of `requested` (e.g. re-fired timer).
        return { ok: false, reason: `request-expire invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'expired',
        sideEffects: [{ type: 'notify-both' }, { type: 'enqueue-payment-full-refund' }],
      };
    }

    // ── Caregiver hourly session spine ────────────────────────────────────
    case 'session-start': {
      if (booking.kind !== 'caregiver') {
        return {
          ok: false,
          reason: 'session-start only valid for caregiver (hourly) bookings — provider consultations skip the session phase',
        };
      }
      if (state !== 'accepted') {
        return { ok: false, reason: `session-start invalid from ${state}` };
      }
      return { ok: true, next: 'in-progress', sideEffects: [{ type: 'notify-parent' }] };
    }

    case 'session-end-propose-hours': {
      if (booking.kind !== 'caregiver') {
        return {
          ok: false,
          reason: 'session-end-propose-hours only valid for caregiver (hourly) bookings',
        };
      }
      if (state !== 'in-progress') {
        return { ok: false, reason: `session-end-propose-hours invalid from ${state}` };
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
      if (booking.kind !== 'caregiver') {
        return { ok: false, reason: 'parent-confirm-hours only valid for caregiver bookings' };
      }
      if (state !== 'awaiting-confirmation') {
        return { ok: false, reason: `parent-confirm-hours invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'completed',
        sideEffects: [
          { type: 'notify-caregiver' },
          { type: 'enqueue-payment-capture' },
          { type: 'enqueue-payout' },
        ],
      };
    }

    case 'session-auto-confirm': {
      if (booking.kind !== 'caregiver') {
        return { ok: false, reason: 'session-auto-confirm only valid for caregiver bookings' };
      }
      if (state !== 'awaiting-confirmation') {
        return { ok: false, reason: `session-auto-confirm invalid from ${state}` };
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

    case 'parent-dispute': {
      if (booking.kind !== 'caregiver') {
        return {
          ok: false,
          reason: 'parent-dispute only valid for caregiver bookings — provider consultations carry no on-platform payment and no dispute (ADR-0011)',
        };
      }
      if (state !== 'awaiting-confirmation') {
        return {
          ok: false,
          reason: `parent-dispute invalid from ${state} — the payout-holding dispute is only valid in awaiting-confirmation (ADR-0013); a charge/billing complaint from accepted or completed is an admin escalation, not a state transition`,
        };
      }
      return {
        ok: true,
        next: 'disputed',
        sideEffects: [{ type: 'notify-caregiver' }, { type: 'flag-for-admin-review' }],
      };
    }

    // ── Dispute resolution (admin, OH-213) ────────────────────────────────
    case 'admin-resolve-dispute': {
      // Providers never reach `disputed` (null payment, no dispute), so this is
      // caregiver-only — guard defensively.
      if (booking.kind !== 'caregiver') {
        return {
          ok: false,
          reason: 'admin-resolve-dispute only valid for caregiver bookings (provider consultations never enter disputed)',
        };
      }
      if (state !== 'disputed') {
        return { ok: false, reason: `admin-resolve-dispute invalid from ${state} (only a disputed booking is resolvable)` };
      }
      if (event.outcome !== 'rejected' && event.outcome !== 'upheld') {
        return { ok: false, reason: 'admin-resolve-dispute requires an outcome of rejected|upheld' };
      }
      if (event.outcome === 'rejected') {
        // Dispute not upheld → release the held Payout to the Caregiver (capture
        // = payout) and complete the Booking.
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
      // Dispute upheld → refund the Parent in full and cancel the Booking.
      return {
        ok: true,
        next: 'cancelled',
        sideEffects: [{ type: 'notify-both' }, { type: 'enqueue-payment-full-refund' }],
      };
    }

    // ── No-show (OH-213) ──────────────────────────────────────────────────
    case 'parent-report-no-show': {
      if (!canReportNoShow(state)) {
        return { ok: false, reason: `parent-report-no-show invalid from ${state} (only reportable while accepted)` };
      }
      if (booking.kind === 'provider') {
        // Provider consultation no-show: supply-quality flag only, no money
        // (ADR-0011) — release the held slot (CONTEXT § No-show).
        return {
          ok: true,
          next: 'cancelled',
          sideEffects: [
            { type: 'notify-provider' },
            { type: 'release-consultation-slot' },
            { type: 'flag-supply-no-show' },
          ],
        };
      }
      // Caregiver no-show: Parent gets a full refund + the Caregiver is
      // auto-flagged (2→review, 3→suspend — CONTEXT § No-show).
      return {
        ok: true,
        next: 'cancelled',
        sideEffects: [
          { type: 'notify-caregiver' },
          { type: 'enqueue-payment-full-refund' },
          { type: 'flag-supply-no-show' },
        ],
      };
    }

    // ── Provider consultation completion ──────────────────────────────────
    case 'consultation-auto-complete': {
      if (booking.kind !== 'provider') {
        return {
          ok: false,
          reason: 'consultation-auto-complete only valid for provider consultations',
        };
      }
      if (state !== 'accepted') {
        return {
          ok: false,
          reason: `consultation-auto-complete invalid from ${state} (a consultation completes from accepted)`,
        };
      }
      // Null payment: no capture, no payout — the clinical service is paid for
      // off-platform (ADR-0011).
      return { ok: true, next: 'completed', sideEffects: [{ type: 'notify-both' }] };
    }

    // ── Cancellation ──────────────────────────────────────────────────────
    case 'parent-cancel': {
      if (booking.kind === 'provider') {
        if (state !== 'accepted') {
          return {
            ok: false,
            reason: `parent-cancel invalid from ${state} for a provider consultation (cancellable only while accepted)`,
          };
        }
        // Null payment — cancelling just releases the held slot (ADR-0011).
        return {
          ok: true,
          next: 'cancelled',
          sideEffects: [{ type: 'notify-provider' }, { type: 'release-consultation-slot' }],
        };
      }
      // Caregiver: cancellable from any active state. The cancellation-policy
      // calculator (separate module) decides the refund/fee split.
      if (!isBookingActive(state)) {
        return { ok: false, reason: `parent-cancel invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'cancelled',
        sideEffects: [
          { type: 'notify-caregiver' },
          { type: 'enqueue-payment-cancellation-charge' },
        ],
      };
    }

    case 'caregiver-cancel': {
      if (booking.kind !== 'caregiver') {
        return {
          ok: false,
          reason: 'caregiver-cancel only valid for caregiver bookings (provider consultations use provider-cancel)',
        };
      }
      if (state === 'requested') {
        return { ok: false, reason: 'caregiver-cancel from requested — use caregiver-decline' };
      }
      if (!isBookingActive(state)) {
        return { ok: false, reason: `caregiver-cancel invalid from ${state}` };
      }
      // Caregiver-initiated cancellation: free to the Parent (full refund) but
      // always flagged for admin review (CONTEXT.md § Cancellation policy).
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

    case 'provider-cancel': {
      if (booking.kind !== 'provider') {
        return {
          ok: false,
          reason: 'provider-cancel only valid for provider consultations (caregiver bookings use caregiver-cancel)',
        };
      }
      if (state !== 'accepted') {
        return {
          ok: false,
          reason: `provider-cancel invalid from ${state} (consultation cancellable only while accepted)`,
        };
      }
      // Null payment — releases the slot, no refund machinery (ADR-0011).
      return {
        ok: true,
        next: 'cancelled',
        sideEffects: [{ type: 'notify-parent' }, { type: 'release-consultation-slot' }],
      };
    }

    default:
      return assertNever(event.type);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Adjust-time (ADR-0014 §A3) — Caregiver `accepted` Bookings only
// ──────────────────────────────────────────────────────────────────────────

/** A clock time as minutes-since-midnight (0..1440), matching the Offer window. */
export interface CaregiverSchedule {
  /** Pricing input — `agreed_rate × durationHours`. */
  durationHours: number;
  /** End of the booked window, minutes-since-midnight. Optional; some callers
   *  track only the duration. */
  endMin?: number;
}

/**
 * A transient shorten proposal living on an `accepted` Caregiver Booking until
 * the Caregiver approves or declines it (ADR-0014 §A3). It is a sub-state, NOT
 * a top-level Booking status — the Booking stays `accepted` throughout.
 */
export interface PendingTimeChange {
  proposedDurationHours: number;
  proposedEndMin?: number;
  note?: string;
  /** Handler-supplied wall-clock at request time (pure module reads no clock). */
  requestedAt: Date;
}

export interface AdjustableBooking {
  kind: 'caregiver';
  origin: CaregiverOrigin;
  state: BookingState;
  schedule: CaregiverSchedule;
  pendingTimeChange?: PendingTimeChange;
}

export type AdjustTimeResult =
  | { ok: true; booking: AdjustableBooking; sideEffects: readonly BookingSideEffect[] }
  | { ok: false; reason: string };

/** Return a copy of the Booking with no pending change — a "plain" accepted. */
function plainAccepted(b: AdjustableBooking): AdjustableBooking {
  return { kind: b.kind, origin: b.origin, state: b.state, schedule: b.schedule };
}

function guardAccepted(b: AdjustableBooking, op: string): string | null {
  if (b.state !== 'accepted') {
    return `${op} invalid from ${b.state} — adjust-time applies only to an accepted Booking`;
  }
  return null;
}

/**
 * Extend a booked session (buy more of the Caregiver's time). Applies
 * IMMEDIATELY — the Parent is unilaterally purchasing more time, so no Caregiver
 * approval is needed (ADR-0014 §A3). Mutates duration/endMin and re-authorizes
 * the larger total. Stays `accepted`.
 */
export function extendBookingTime(
  booking: AdjustableBooking,
  addHours: number,
): AdjustTimeResult {
  const stateErr = guardAccepted(booking, 'extendBookingTime');
  if (stateErr) return { ok: false, reason: stateErr };
  if (booking.pendingTimeChange) {
    return {
      ok: false,
      reason: 'a pending time change is already in flight — resolve it before extending',
    };
  }
  if (!(addHours > 0)) {
    return { ok: false, reason: `addHours must be > 0 (got ${addHours})` };
  }
  const schedule: CaregiverSchedule = {
    durationHours: booking.schedule.durationHours + addHours,
    endMin:
      booking.schedule.endMin === undefined
        ? undefined
        : booking.schedule.endMin + addHours * 60,
  };
  return {
    ok: true,
    booking: { ...plainAccepted(booking), schedule },
    // Real path must re-authorize the larger total before the session (ADR-0014).
    sideEffects: [{ type: 'notify-caregiver' }, { type: 'enqueue-payment-reauthorize' }],
  };
}

/**
 * Request to shorten a booked session (remove paid hours). Does NOT apply
 * immediately — it writes a `pendingTimeChange` the Caregiver must approve,
 * because it cuts their agreed pay (ADR-0014 §A3). The Booking keeps its
 * original duration/pay until approval.
 */
export function requestReduceBookingTime(
  booking: AdjustableBooking,
  newDurationHours: number,
  requestedAt: Date,
  note?: string,
): AdjustTimeResult {
  const stateErr = guardAccepted(booking, 'requestReduceBookingTime');
  if (stateErr) return { ok: false, reason: stateErr };
  if (booking.pendingTimeChange) {
    return { ok: false, reason: 'a pending time change is already in flight' };
  }
  if (!(newDurationHours > 0)) {
    return { ok: false, reason: `newDurationHours must be > 0 (got ${newDurationHours})` };
  }
  if (newDurationHours >= booking.schedule.durationHours) {
    return {
      ok: false,
      reason: `requestReduceBookingTime must shorten — new ${newDurationHours}h must be < current ${booking.schedule.durationHours}h (to add time use extendBookingTime)`,
    };
  }
  const proposedEndMin =
    booking.schedule.endMin === undefined
      ? undefined
      : booking.schedule.endMin -
        Math.round((booking.schedule.durationHours - newDurationHours) * 60);
  const pendingTimeChange: PendingTimeChange = {
    proposedDurationHours: newDurationHours,
    proposedEndMin,
    note,
    requestedAt,
  };
  return {
    ok: true,
    booking: { ...plainAccepted(booking), pendingTimeChange },
    sideEffects: [{ type: 'notify-caregiver' }],
  };
}

/**
 * Caregiver approves a pending shorten. Applies the proposed duration and
 * resolves back to a plain `accepted` Booking; re-authorizes the lower total.
 */
export function approveBookingTimeReduction(booking: AdjustableBooking): AdjustTimeResult {
  const pending = booking.pendingTimeChange;
  if (!pending) return { ok: false, reason: 'no pending time change to approve' };
  const stateErr = guardAccepted(booking, 'approveBookingTimeReduction');
  if (stateErr) return { ok: false, reason: stateErr };
  const schedule: CaregiverSchedule = {
    durationHours: pending.proposedDurationHours,
    endMin: pending.proposedEndMin,
  };
  return {
    ok: true,
    booking: { ...plainAccepted(booking), schedule },
    sideEffects: [{ type: 'notify-parent' }, { type: 'enqueue-payment-reauthorize' }],
  };
}

/**
 * Caregiver declines a pending shorten. Drops the proposal; the Booking keeps
 * its original duration/pay and resolves back to a plain `accepted`.
 */
export function declineBookingTimeReduction(booking: AdjustableBooking): AdjustTimeResult {
  if (!booking.pendingTimeChange) {
    return { ok: false, reason: 'no pending time change to decline' };
  }
  return {
    ok: true,
    booking: plainAccepted(booking),
    sideEffects: [{ type: 'notify-parent' }],
  };
}

/**
 * Parent rescinds their own pending shorten before the Caregiver acts. Drops
 * the proposal; resolves back to a plain `accepted` (ADR-0014 §A3).
 */
export function cancelBookingTimeReductionRequest(
  booking: AdjustableBooking,
): AdjustTimeResult {
  if (!booking.pendingTimeChange) {
    return { ok: false, reason: 'no pending time change to cancel' };
  }
  return {
    ok: true,
    booking: plainAccepted(booking),
    sideEffects: [{ type: 'notify-caregiver' }],
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Scheduling — recurring Booking Series + multi-day one-off (ADR-0014)
// ──────────────────────────────────────────────────────────────────────────

/** A single concrete session slot. `date` is an ISO `YYYY-MM-DD` calendar day. */
export interface BookingSlot {
  date: string;
  startMin: number;
  endMin: number;
}

/**
 * An anchored weekly recurrence rule (ADR-0014 §4): a date range + selected
 * weekdays + a start–end clock window. `weekdays` are 0=Sun..6=Sat.
 */
export interface RecurrenceRule {
  startDate: string; // YYYY-MM-DD (inclusive)
  endDate: string; // YYYY-MM-DD (inclusive)
  weekdays: readonly number[];
  startMin: number;
  endMin: number;
}

export type ExpandRecurrenceResult =
  | { ok: true; slots: BookingSlot[] }
  | { ok: false; reason: string };

const DAY_MS = 86_400_000;

/** Parse `YYYY-MM-DD` to a UTC midnight epoch-ms, or null if malformed/invalid. */
function toUTCDayMs(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // Reject overflow dates like 2026-02-30 (Date.UTC would roll them over).
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

function msToISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isValidWindow(startMin: number, endMin: number): boolean {
  return (
    Number.isInteger(startMin) &&
    Number.isInteger(endMin) &&
    startMin >= 0 &&
    endMin <= 1440 &&
    startMin < endMin
  );
}

/**
 * Expand an anchored recurrence rule into the concrete occurrence slots it
 * generates (the dates the compose UI previews; ADR-0014 §4). Pure + UTC-based
 * so it is timezone-stable and deterministic.
 */
export function expandRecurrence(rule: RecurrenceRule): ExpandRecurrenceResult {
  const startMs = toUTCDayMs(rule.startDate);
  const endMs = toUTCDayMs(rule.endDate);
  if (startMs === null) {
    return { ok: false, reason: `invalid startDate '${rule.startDate}' (expected YYYY-MM-DD)` };
  }
  if (endMs === null) {
    return { ok: false, reason: `invalid endDate '${rule.endDate}' (expected YYYY-MM-DD)` };
  }
  if (endMs < startMs) {
    return { ok: false, reason: `endDate ${rule.endDate} is before startDate ${rule.startDate}` };
  }
  if (rule.weekdays.length === 0) {
    return { ok: false, reason: 'weekdays must select at least one day' };
  }
  if (rule.weekdays.some((w) => !Number.isInteger(w) || w < 0 || w > 6)) {
    return { ok: false, reason: 'weekdays must be integers 0..6 (0=Sun)' };
  }
  if (!isValidWindow(rule.startMin, rule.endMin)) {
    return {
      ok: false,
      reason: `invalid window startMin=${rule.startMin} endMin=${rule.endMin}`,
    };
  }
  const wanted = new Set(rule.weekdays);
  const slots: BookingSlot[] = [];
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    if (wanted.has(new Date(ms).getUTCDay())) {
      slots.push({ date: msToISODate(ms), startMin: rule.startMin, endMin: rule.endMin });
    }
  }
  return { ok: true, slots };
}

/**
 * A recurring Caregiver arrangement (ADR-0014; CONTEXT § Booking Series).
 * Holds the recurrence rule + Agreed Rate + the FKs of its materialised
 * occurrences. It deliberately has NO `state` field — the Series holds no
 * lifecycle state; each occurrence runs the Booking graph on its own.
 */
export interface BookingSeries {
  id: string;
  parentId: string;
  caregiverId: string;
  /** CaregiverCategory wire value (from @our-haven/shared). */
  category: string;
  origin: CaregiverOrigin;
  rule: RecurrenceRule;
  agreedRate: number;
  occurrenceIds: readonly string[];
  /** Back-link to the Book-request Offer for a DM-originated Series; else null. */
  offerId: string | null;
}

/** A materialised occurrence Booking — an ordinary independent Booking. */
export interface OccurrenceBooking {
  id: string;
  kind: 'caregiver';
  origin: CaregiverOrigin;
  /** Born `accepted` — the award/acceptance that created the bundle was the
   *  commitment (ADR-0014 §5: occurrences are materialised up front). */
  state: BookingState;
  /** Set for Series occurrences; null for a multi-day one-off bundle. */
  seriesId: string | null;
  slot: BookingSlot;
  schedule: CaregiverSchedule;
  agreedRate: number;
}

function slotDurationHours(slot: BookingSlot): number {
  return (slot.endMin - slot.startMin) / 60;
}

function occurrenceFrom(
  id: string,
  origin: CaregiverOrigin,
  slot: BookingSlot,
  agreedRate: number,
  seriesId: string | null,
): OccurrenceBooking {
  return {
    id,
    kind: 'caregiver',
    origin,
    state: 'accepted',
    seriesId,
    slot,
    schedule: { durationHours: slotDurationHours(slot), endMin: slot.endMin },
    agreedRate,
  };
}

function validateIds(
  ids: readonly string[],
  expected: number,
  label: string,
): string | null {
  if (ids.length !== expected) {
    return `${label} length ${ids.length} must equal occurrence count ${expected}`;
  }
  if (ids.some((id) => !id)) return `${label} must all be non-empty`;
  if (new Set(ids).size !== ids.length) return `${label} must all be distinct`;
  return null;
}

function validateSlots(slots: readonly BookingSlot[]): string | null {
  for (const slot of slots) {
    if (toUTCDayMs(slot.date) === null) {
      return `invalid slot date '${slot.date}' (expected YYYY-MM-DD)`;
    }
    if (!isValidWindow(slot.startMin, slot.endMin)) {
      return `invalid slot window for ${slot.date}: startMin=${slot.startMin} endMin=${slot.endMin}`;
    }
  }
  return null;
}

export interface MaterialiseSeriesInput {
  seriesId: string;
  parentId: string;
  caregiverId: string;
  category: string;
  origin: CaregiverOrigin;
  agreedRate: number;
  rule: RecurrenceRule;
  /** Handler-reserved ids, one per occurrence. The pure module never invents
   *  ids; length must equal the rule's occurrence count. */
  occurrenceIds: readonly string[];
  offerId?: string | null;
}

export type MaterialiseSeriesResult =
  | { ok: true; series: BookingSeries; occurrences: OccurrenceBooking[] }
  | { ok: false; reason: string };

/**
 * Materialise a recurring arrangement into a stateless Booking Series + its
 * occurrence Bookings, all up front (ADR-0014 §5). Each occurrence is an
 * independent `accepted` Booking that runs the graph on its own; cancelling one
 * leaves the rest. Returns a refusal if the rule is invalid or the reserved id
 * count does not match the generated occurrence count.
 */
export function materialiseSeries(input: MaterialiseSeriesInput): MaterialiseSeriesResult {
  if (!input.seriesId) return { ok: false, reason: 'seriesId must be non-empty' };
  const expanded = expandRecurrence(input.rule);
  if (!expanded.ok) return { ok: false, reason: expanded.reason };
  if (expanded.slots.length === 0) {
    return { ok: false, reason: 'recurrence rule generated no occurrences in range' };
  }
  const idErr = validateIds(input.occurrenceIds, expanded.slots.length, 'occurrenceIds');
  if (idErr) return { ok: false, reason: idErr };

  // validateIds above guarantees one non-empty id per occurrence, so the
  // indexed access is in-bounds (the `!` reflects that checked invariant).
  const occurrences = expanded.slots.map((slot, i) =>
    occurrenceFrom(input.occurrenceIds[i]!, input.origin, slot, input.agreedRate, input.seriesId),
  );
  const series: BookingSeries = {
    id: input.seriesId,
    parentId: input.parentId,
    caregiverId: input.caregiverId,
    category: input.category,
    origin: input.origin,
    rule: input.rule,
    agreedRate: input.agreedRate,
    occurrenceIds: input.occurrenceIds,
    offerId: input.offerId ?? null,
  };
  return { ok: true, series, occurrences };
}

export interface MaterialiseMultiDayInput {
  parentId: string;
  caregiverId: string;
  category: string;
  origin: CaregiverOrigin;
  agreedRate: number;
  /** The hand-picked dates of a multi-day one-off bundle (ADR-0014 §A1). */
  slots: readonly BookingSlot[];
  bookingIds: readonly string[];
  offerId?: string | null;
}

export type MaterialiseMultiDayResult =
  | { ok: true; bookings: OccurrenceBooking[] }
  | { ok: false; reason: string };

/**
 * Materialise a multi-day one-off bundle into independent Bookings — one per
 * hand-picked date, each born `accepted` with NO Series (`seriesId: null`).
 * A multi-day one-off is not a recurrence, so there is no Series grouping
 * (ADR-0014 §A1).
 */
export function materialiseMultiDayOneOff(
  input: MaterialiseMultiDayInput,
): MaterialiseMultiDayResult {
  if (input.slots.length === 0) {
    return { ok: false, reason: 'multi-day one-off needs at least one slot' };
  }
  const slotErr = validateSlots(input.slots);
  if (slotErr) return { ok: false, reason: slotErr };
  const idErr = validateIds(input.bookingIds, input.slots.length, 'bookingIds');
  if (idErr) return { ok: false, reason: idErr };

  const bookings = input.slots.map((slot, i) =>
    occurrenceFrom(input.bookingIds[i]!, input.origin, slot, input.agreedRate, null),
  );
  return { ok: true, bookings };
}

export const BOOKING_LIFECYCLE_MODULE_VERSION = '0.2.0-OH-177';
