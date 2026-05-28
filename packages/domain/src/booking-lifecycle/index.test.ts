import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  BOOKING_BILLING_MODELS,
  BOOKING_EVENT_TYPES,
  BOOKING_ORIGINS,
  BOOKING_STATES,
  BOOKING_TERMINAL_STATES,
  initialBookingSideEffects,
  initialBookingState,
  isBookingTerminal,
  isDisputable,
  transitionBooking,
  type Booking,
  type BookingBillingModel,
  type BookingEvent,
  type BookingEventType,
  type BookingOrigin,
  type BookingShape,
  type BookingState,
} from './index.js';

const POSTED_HOURLY: BookingShape = { origin: 'posted-job', billingModel: 'hourly' };
const POSTED_PER_SESSION: BookingShape = { origin: 'posted-job', billingModel: 'per-session' };
const DM_HOURLY: BookingShape = { origin: 'direct-message', billingModel: 'hourly' };
const DM_PER_SESSION: BookingShape = { origin: 'direct-message', billingModel: 'per-session' };

function bookingAt(shape: BookingShape, state: BookingState): Booking {
  return { ...shape, state };
}

describe('initialBookingState', () => {
  it('Posted-Job bookings are born requested', () => {
    expect(initialBookingState(POSTED_HOURLY)).toBe('requested');
    expect(initialBookingState(POSTED_PER_SESSION)).toBe('requested');
  });

  it('Direct-Message bookings are born accepted', () => {
    expect(initialBookingState(DM_HOURLY)).toBe('accepted');
    expect(initialBookingState(DM_PER_SESSION)).toBe('accepted');
  });
});

describe('initialBookingSideEffects', () => {
  it('Posted-Job emits provider-notify + 24h expiry timer', () => {
    expect(initialBookingSideEffects(POSTED_HOURLY)).toEqual([
      { type: 'notify-provider' },
      { type: 'schedule-request-expiry-24h' },
    ]);
  });

  it('Direct-Message emits a both-sides notification only (no expiry — born accepted)', () => {
    expect(initialBookingSideEffects(DM_HOURLY)).toEqual([{ type: 'notify-both' }]);
  });
});

describe('isBookingTerminal / isDisputable', () => {
  it('isBookingTerminal is true for declined, expired, cancelled, disputed', () => {
    for (const s of BOOKING_STATES) {
      const expected = (BOOKING_TERMINAL_STATES as readonly string[]).includes(s);
      expect(isBookingTerminal(s)).toBe(expected);
    }
  });

  it('completed is not terminal — disputes can still be filed within 7d', () => {
    expect(isBookingTerminal('completed')).toBe(false);
  });

  it('isDisputable is true only for awaiting-confirmation and completed', () => {
    for (const s of BOOKING_STATES) {
      expect(isDisputable(s)).toBe(s === 'awaiting-confirmation' || s === 'completed');
    }
  });
});

describe('Posted-Job hourly happy path', () => {
  it('requested → accepted (provider-accept)', () => {
    const r = transitionBooking(bookingAt(POSTED_HOURLY, 'requested'), { type: 'provider-accept' });
    expect(r).toEqual({ ok: true, next: 'accepted', sideEffects: [{ type: 'notify-parent' }] });
  });

  it('accepted → in-progress (session-start)', () => {
    const r = transitionBooking(bookingAt(POSTED_HOURLY, 'accepted'), { type: 'session-start' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toBe('in-progress');
  });

  it('in-progress → awaiting-confirmation (session-end-propose-hours) — schedules 24h auto-confirm', () => {
    const r = transitionBooking(bookingAt(POSTED_HOURLY, 'in-progress'), {
      type: 'session-end-propose-hours',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('awaiting-confirmation');
      expect(r.sideEffects).toContainEqual({ type: 'schedule-session-auto-confirm-24h' });
    }
  });

  it('awaiting-confirmation → completed (parent-confirm-hours) — capture + payout', () => {
    const r = transitionBooking(bookingAt(POSTED_HOURLY, 'awaiting-confirmation'), {
      type: 'parent-confirm-hours',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('completed');
      expect(r.sideEffects).toContainEqual({ type: 'enqueue-payment-capture' });
      expect(r.sideEffects).toContainEqual({ type: 'enqueue-payout' });
    }
  });

  it('awaiting-confirmation → completed (session-auto-confirm)', () => {
    const r = transitionBooking(bookingAt(POSTED_HOURLY, 'awaiting-confirmation'), {
      type: 'session-auto-confirm',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toBe('completed');
  });
});

describe('Posted-Job hourly negative paths', () => {
  it('requested → declined (provider-decline) — full refund', () => {
    const r = transitionBooking(bookingAt(POSTED_HOURLY, 'requested'), {
      type: 'provider-decline',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('declined');
      expect(r.sideEffects).toContainEqual({ type: 'enqueue-payment-full-refund' });
    }
  });

  it('requested → expired (request-expire) — full refund', () => {
    const r = transitionBooking(bookingAt(POSTED_HOURLY, 'requested'), { type: 'request-expire' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('expired');
      expect(r.sideEffects).toContainEqual({ type: 'enqueue-payment-full-refund' });
    }
  });

  it('awaiting-confirmation → disputed (parent-dispute) — admin review flagged', () => {
    const r = transitionBooking(bookingAt(POSTED_HOURLY, 'awaiting-confirmation'), {
      type: 'parent-dispute',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('disputed');
      expect(r.sideEffects).toContainEqual({ type: 'flag-for-admin-review' });
    }
  });

  it('completed → disputed within 7d (parent-dispute)', () => {
    const r = transitionBooking(bookingAt(POSTED_HOURLY, 'completed'), { type: 'parent-dispute' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toBe('disputed');
  });
});

describe('Direct-Message hourly', () => {
  it('skips requested entirely — provider-accept from accepted is illegal', () => {
    const r = transitionBooking(bookingAt(DM_HOURLY, 'requested'), { type: 'provider-accept' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/direct-message bookings are born accepted/);
  });

  it('runs accepted → in-progress → awaiting-confirmation → completed', () => {
    const r1 = transitionBooking(bookingAt(DM_HOURLY, 'accepted'), { type: 'session-start' });
    expect(r1.ok && r1.next).toBe('in-progress');
    const r2 = transitionBooking(bookingAt(DM_HOURLY, 'in-progress'), {
      type: 'session-end-propose-hours',
    });
    expect(r2.ok && r2.next).toBe('awaiting-confirmation');
    const r3 = transitionBooking(bookingAt(DM_HOURLY, 'awaiting-confirmation'), {
      type: 'parent-confirm-hours',
    });
    expect(r3.ok && r3.next).toBe('completed');
  });
});

describe('Per-session Specialist (Posted-Job and Direct-Message)', () => {
  it('Posted-Job per-session: requested → accepted → completed (mark-completed)', () => {
    const accept = transitionBooking(bookingAt(POSTED_PER_SESSION, 'requested'), {
      type: 'provider-accept',
    });
    expect(accept.ok && accept.next).toBe('accepted');

    const complete = transitionBooking(bookingAt(POSTED_PER_SESSION, 'accepted'), {
      type: 'mark-completed',
    });
    expect(complete.ok && complete.next).toBe('completed');
  });

  it('Direct-Message per-session: accepted → completed (mark-completed)', () => {
    const r = transitionBooking(bookingAt(DM_PER_SESSION, 'accepted'), { type: 'mark-completed' });
    expect(r.ok && r.next).toBe('completed');
  });

  it('rejects session-start (no session phase for per-session)', () => {
    const r = transitionBooking(bookingAt(POSTED_PER_SESSION, 'accepted'), {
      type: 'session-start',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/per-session has no session phase/);
  });

  it('rejects mark-completed for hourly bookings', () => {
    const r = transitionBooking(bookingAt(POSTED_HOURLY, 'accepted'), { type: 'mark-completed' });
    expect(r.ok).toBe(false);
  });
});

describe('Cancellation transitions', () => {
  const cancellableStates: BookingState[] = [
    'requested',
    'accepted',
    'in-progress',
    'awaiting-confirmation',
  ];

  for (const s of cancellableStates) {
    it(`parent-cancel valid from ${s} — enqueues cancellation charge`, () => {
      const r = transitionBooking(bookingAt(POSTED_HOURLY, s), { type: 'parent-cancel' });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.next).toBe('cancelled');
        expect(r.sideEffects).toContainEqual({ type: 'enqueue-payment-cancellation-charge' });
      }
    });
  }

  it('parent-cancel from completed is illegal', () => {
    const r = transitionBooking(bookingAt(POSTED_HOURLY, 'completed'), { type: 'parent-cancel' });
    expect(r.ok).toBe(false);
  });

  it('provider-cancel from requested is rejected (must use provider-decline)', () => {
    const r = transitionBooking(bookingAt(POSTED_HOURLY, 'requested'), { type: 'provider-cancel' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/provider-decline/);
  });

  it('provider-cancel from accepted is valid and flags admin review', () => {
    const r = transitionBooking(bookingAt(POSTED_HOURLY, 'accepted'), { type: 'provider-cancel' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('cancelled');
      expect(r.sideEffects).toContainEqual({ type: 'enqueue-payment-full-refund' });
      expect(r.sideEffects).toContainEqual({ type: 'flag-for-admin-review' });
    }
  });
});

describe('Terminal states reject all events', () => {
  const terminalsExceptCompleted = BOOKING_TERMINAL_STATES;

  for (const state of terminalsExceptCompleted) {
    for (const eventType of BOOKING_EVENT_TYPES) {
      it(`${state} rejects ${eventType}`, () => {
        const r = transitionBooking(bookingAt(POSTED_HOURLY, state), { type: eventType });
        expect(r.ok).toBe(false);
      });
    }
  }
});

describe('Exhaustive illegal-event matrix for hourly Posted-Job', () => {
  // For each (state, event), document whether the transition is legal.
  // This catches typos in the implementation and locks the legal-edge set.
  const LEGAL: Record<BookingState, ReadonlyArray<BookingEventType>> = {
    requested: ['provider-accept', 'provider-decline', 'request-expire', 'parent-cancel'],
    accepted: ['session-start', 'parent-cancel', 'provider-cancel'],
    'in-progress': ['session-end-propose-hours', 'parent-cancel', 'provider-cancel'],
    // CONTEXT.md § Booking states explicitly allows awaiting-confirmation →
    // cancelled (full-charge tier applies — see cancellation calculator).
    'awaiting-confirmation': [
      'parent-confirm-hours',
      'session-auto-confirm',
      'parent-dispute',
      'parent-cancel',
      'provider-cancel',
    ],
    completed: ['parent-dispute'],
    declined: [],
    expired: [],
    cancelled: [],
    disputed: [],
  };

  for (const state of BOOKING_STATES) {
    for (const eventType of BOOKING_EVENT_TYPES) {
      const expected = LEGAL[state].includes(eventType);
      it(`${state} ⨯ ${eventType} → ${expected ? 'legal' : 'illegal'}`, () => {
        const r = transitionBooking(bookingAt(POSTED_HOURLY, state), { type: eventType });
        expect(r.ok).toBe(expected);
      });
    }
  }
});

describe('Property-based — transitionBooking', () => {
  const stateArb = fc.constantFrom(...BOOKING_STATES);
  const originArb = fc.constantFrom(...BOOKING_ORIGINS);
  const billingArb = fc.constantFrom(...BOOKING_BILLING_MODELS);
  const eventArb: fc.Arbitrary<BookingEvent> = fc
    .constantFrom(...BOOKING_EVENT_TYPES)
    .map((type) => ({ type }));
  const bookingArb: fc.Arbitrary<Booking> = fc.record({
    origin: originArb,
    billingModel: billingArb,
    state: stateArb,
  });

  it('always returns either ok:true with a valid BookingState or ok:false with a reason', () => {
    fc.assert(
      fc.property(bookingArb, eventArb, (booking, event) => {
        const r = transitionBooking(booking, event);
        if (r.ok) {
          expect(BOOKING_STATES).toContain(r.next);
          for (const sfx of r.sideEffects) {
            expect(typeof sfx.type).toBe('string');
          }
        } else {
          expect(typeof r.reason).toBe('string');
          expect(r.reason.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('terminal states never accept any event', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BOOKING_TERMINAL_STATES),
        originArb,
        billingArb,
        eventArb,
        (state, origin, billingModel, event) => {
          const r = transitionBooking({ state, origin, billingModel }, event);
          expect(r.ok).toBe(false);
        },
      ),
    );
  });

  it('idempotency: re-applying the same event after a successful transition fails (state has moved)', () => {
    fc.assert(
      fc.property(bookingArb, eventArb, (booking, event) => {
        const first = transitionBooking(booking, event);
        if (!first.ok) return; // event was illegal — nothing to test
        // first.next is now the booking state
        const second = transitionBooking({ ...booking, state: first.next }, event);
        // Any event that legally moved us out of state-X is illegal to re-apply
        // from the new state (because state-X-only-legal events are gone).
        expect(second.ok).toBe(false);
      }),
    );
  });

  it('determinism: identical inputs always produce identical outputs', () => {
    fc.assert(
      fc.property(bookingArb, eventArb, (booking, event) => {
        const a = transitionBooking(booking, event);
        const b = transitionBooking(booking, event);
        expect(a).toEqual(b);
      }),
    );
  });

  it('monotonicity along the happy-path spine — successful transitions never go backwards', () => {
    // Linear ordering scoring the happy-path spine + each side terminal at a
    // height ≥ every state from which it is reachable. Cancelled is the
    // highest because it is reachable from every active pre-completion state
    // (requested / accepted / in-progress / awaiting-confirmation).
    const ORDINAL: Record<BookingState, number> = {
      requested: 0,
      accepted: 1,
      declined: 1, // terminal sibling of accepted from requested
      expired: 1, // ditto
      'in-progress': 2,
      'awaiting-confirmation': 3,
      completed: 4,
      cancelled: 5, // reachable from any active state → highest among non-disputed
      disputed: 5, // reachable from awaiting-confirmation or completed
    };

    fc.assert(
      fc.property(bookingArb, eventArb, (booking, event) => {
        const r = transitionBooking(booking, event);
        if (!r.ok) return;
        expect(ORDINAL[r.next]).toBeGreaterThanOrEqual(ORDINAL[booking.state]);
      }),
    );
  });

  it('side-effects are non-empty for every successful transition', () => {
    fc.assert(
      fc.property(bookingArb, eventArb, (booking, event) => {
        const r = transitionBooking(booking, event);
        if (!r.ok) return;
        expect(r.sideEffects.length).toBeGreaterThan(0);
      }),
    );
  });

  it('direct-message bookings never accept provider-accept / provider-decline / request-expire', () => {
    const dmArb = fc.record({
      origin: fc.constant<BookingOrigin>('direct-message'),
      billingModel: billingArb,
      state: stateArb,
    });
    const requestedOnlyEvent = fc.constantFrom<BookingEventType>(
      'provider-accept',
      'provider-decline',
      'request-expire',
    );
    fc.assert(
      fc.property(dmArb, requestedOnlyEvent, (booking, type) => {
        const r = transitionBooking(booking, { type });
        expect(r.ok).toBe(false);
      }),
    );
  });

  it('per-session bookings never accept session-start / session-end-propose-hours / parent-confirm-hours / session-auto-confirm', () => {
    const psArb = fc.record({
      origin: originArb,
      billingModel: fc.constant<BookingBillingModel>('per-session'),
      state: stateArb,
    });
    const hourlyOnlyEvent = fc.constantFrom<BookingEventType>(
      'session-start',
      'session-end-propose-hours',
      'parent-confirm-hours',
      'session-auto-confirm',
    );
    fc.assert(
      fc.property(psArb, hourlyOnlyEvent, (booking, type) => {
        const r = transitionBooking(booking, { type });
        expect(r.ok).toBe(false);
      }),
    );
  });

  it('hourly bookings never accept mark-completed', () => {
    const hourlyArb = fc.record({
      origin: originArb,
      billingModel: fc.constant<BookingBillingModel>('hourly'),
      state: stateArb,
    });
    fc.assert(
      fc.property(hourlyArb, (booking) => {
        const r = transitionBooking(booking, { type: 'mark-completed' });
        expect(r.ok).toBe(false);
      }),
    );
  });
});
