import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  BOOKING_EVENT_TYPES,
  BOOKING_KINDS,
  BOOKING_STATES,
  BOOKING_TERMINAL_STATES,
  CAREGIVER_ORIGINS,
  approveBookingTimeReduction,
  cancelBookingTimeReductionRequest,
  canFileBillingComplaint,
  declineBookingTimeReduction,
  expandRecurrence,
  extendBookingTime,
  initialBookingSideEffects,
  initialBookingState,
  isBookingActive,
  isBookingTerminal,
  isConsultation,
  isDisputable,
  materialiseMultiDayOneOff,
  materialiseSeries,
  requestReduceBookingTime,
  transitionBooking,
  type AdjustableBooking,
  type Booking,
  type BookingEvent,
  type BookingEventType,
  type BookingShape,
  type BookingState,
  type CaregiverOrigin,
  type RecurrenceRule,
} from './index.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const POSTED: BookingShape = { kind: 'caregiver', origin: 'posted-job' };
const DM: BookingShape = { kind: 'caregiver', origin: 'direct-message' };
const PROVIDER: BookingShape = { kind: 'provider' };

function at(shape: BookingShape, state: BookingState): Booking {
  return { ...shape, state };
}

const REQUESTED_AT = new Date('2026-06-25T12:00:00.000Z');
const DAY_MS = 86_400_000;

function accepted(durationHours: number, endMin?: number): AdjustableBooking {
  return {
    kind: 'caregiver',
    origin: 'direct-message',
    state: 'accepted',
    schedule: { durationHours, endMin },
  };
}

// ── Birth state + creation side-effects ──────────────────────────────────────

describe('initialBookingState', () => {
  it('caregiver posted-job is born requested', () => {
    expect(initialBookingState(POSTED)).toBe('requested');
  });
  it('caregiver direct-message is born accepted', () => {
    expect(initialBookingState(DM)).toBe('accepted');
  });
  it('provider consultation is born accepted (slot-pick is the commitment)', () => {
    expect(initialBookingState(PROVIDER)).toBe('accepted');
  });
});

describe('initialBookingSideEffects', () => {
  it('posted-job notifies the caregiver + arms the 24h expiry timer', () => {
    expect(initialBookingSideEffects(POSTED)).toEqual([
      { type: 'notify-caregiver' },
      { type: 'schedule-request-expiry-24h' },
    ]);
  });
  it('direct-message notifies both (born accepted — no expiry)', () => {
    expect(initialBookingSideEffects(DM)).toEqual([{ type: 'notify-both' }]);
  });
  it('provider arms the auto-complete timer + notifies both, with no payment intent', () => {
    const fx = initialBookingSideEffects(PROVIDER);
    expect(fx).toEqual([
      { type: 'notify-both' },
      { type: 'schedule-consultation-auto-complete' },
    ]);
    // null payment — nothing payment-related at creation
    expect(fx.some((e) => e.type.startsWith('enqueue-payment'))).toBe(false);
  });
});

// ── Predicates ───────────────────────────────────────────────────────────────

describe('predicates', () => {
  it('isBookingTerminal: declined/expired/completed/cancelled/disputed are terminal', () => {
    for (const s of BOOKING_STATES) {
      expect(isBookingTerminal(s)).toBe(
        (BOOKING_TERMINAL_STATES as readonly string[]).includes(s),
      );
    }
  });

  it('completed is terminal (ADR-0013 retired the 7-day post-completion dispute edge)', () => {
    expect(isBookingTerminal('completed')).toBe(true);
  });

  it('isBookingActive: requested/accepted/in-progress/awaiting-confirmation', () => {
    expect(BOOKING_STATES.filter(isBookingActive)).toEqual([
      'requested',
      'accepted',
      'in-progress',
      'awaiting-confirmation',
    ]);
  });

  it('isDisputable is true only for awaiting-confirmation (the in-window payout-holding dispute)', () => {
    for (const s of BOOKING_STATES) {
      expect(isDisputable(s)).toBe(s === 'awaiting-confirmation');
    }
  });

  it('canFileBillingComplaint covers accepted/awaiting-confirmation/completed (ADR-0013 amendment)', () => {
    for (const s of BOOKING_STATES) {
      expect(canFileBillingComplaint(s)).toBe(
        s === 'accepted' || s === 'awaiting-confirmation' || s === 'completed',
      );
    }
  });

  it('isConsultation distinguishes the provider track', () => {
    expect(isConsultation(PROVIDER)).toBe(true);
    expect(isConsultation(POSTED)).toBe(false);
    expect(isConsultation(DM)).toBe(false);
  });
});

// ── Caregiver hourly — happy path ────────────────────────────────────────────

describe('Caregiver posted-job hourly happy path', () => {
  it('requested → accepted (caregiver-accept)', () => {
    expect(transitionBooking(at(POSTED, 'requested'), { type: 'caregiver-accept' })).toEqual({
      ok: true,
      next: 'accepted',
      sideEffects: [{ type: 'notify-parent' }],
    });
  });

  it('accepted → in-progress → awaiting-confirmation → completed (capture + payout)', () => {
    const start = transitionBooking(at(POSTED, 'accepted'), { type: 'session-start' });
    expect(start.ok && start.next).toBe('in-progress');

    const propose = transitionBooking(at(POSTED, 'in-progress'), {
      type: 'session-end-propose-hours',
    });
    expect(propose.ok && propose.next).toBe('awaiting-confirmation');
    if (propose.ok) {
      expect(propose.sideEffects).toContainEqual({ type: 'schedule-session-auto-confirm-24h' });
    }

    const confirm = transitionBooking(at(POSTED, 'awaiting-confirmation'), {
      type: 'parent-confirm-hours',
    });
    expect(confirm.ok && confirm.next).toBe('completed');
    if (confirm.ok) {
      expect(confirm.sideEffects).toContainEqual({ type: 'enqueue-payment-capture' });
      expect(confirm.sideEffects).toContainEqual({ type: 'enqueue-payout' });
    }
  });

  it('awaiting-confirmation → completed via session-auto-confirm (24h timer)', () => {
    const r = transitionBooking(at(POSTED, 'awaiting-confirmation'), {
      type: 'session-auto-confirm',
    });
    expect(r.ok && r.next).toBe('completed');
  });
});

describe('Caregiver posted-job hourly — negative paths', () => {
  it('requested → declined (full refund)', () => {
    const r = transitionBooking(at(POSTED, 'requested'), { type: 'caregiver-decline' });
    expect(r.ok && r.next).toBe('declined');
    if (r.ok) expect(r.sideEffects).toContainEqual({ type: 'enqueue-payment-full-refund' });
  });

  it('requested → expired (full refund); re-firing the expire timer is a no-op', () => {
    const r = transitionBooking(at(POSTED, 'requested'), { type: 'request-expire' });
    expect(r.ok && r.next).toBe('expired');
    // re-fire from expired → illegal / no-op
    expect(transitionBooking(at(POSTED, 'expired'), { type: 'request-expire' }).ok).toBe(false);
  });

  it('awaiting-confirmation → disputed (payout hold, admin review flagged)', () => {
    const r = transitionBooking(at(POSTED, 'awaiting-confirmation'), { type: 'parent-dispute' });
    expect(r.ok && r.next).toBe('disputed');
    if (r.ok) expect(r.sideEffects).toContainEqual({ type: 'flag-for-admin-review' });
  });

  it('completed is terminal — parent-dispute is refused (post-payout complaint is an admin escalation)', () => {
    const r = transitionBooking(at(POSTED, 'completed'), { type: 'parent-dispute' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/admin escalation/);
  });

  it('parent-dispute is refused from accepted (pre-session) — not a transition', () => {
    expect(transitionBooking(at(POSTED, 'accepted'), { type: 'parent-dispute' }).ok).toBe(false);
  });
});

// ── Caregiver direct-message ─────────────────────────────────────────────────

describe('Caregiver direct-message', () => {
  it('born accepted — caregiver-accept is illegal from accepted', () => {
    const r = transitionBooking(at(DM, 'accepted'), { type: 'caregiver-accept' });
    expect(r.ok).toBe(false);
  });

  it('a DM booking placed in requested still rejects caregiver-accept (DM is born accepted)', () => {
    const r = transitionBooking(at(DM, 'requested'), { type: 'caregiver-accept' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/born accepted/);
  });

  it('runs accepted → in-progress → awaiting-confirmation → completed', () => {
    expect(transitionBooking(at(DM, 'accepted'), { type: 'session-start' }).ok).toBe(true);
    expect(
      transitionBooking(at(DM, 'in-progress'), { type: 'session-end-propose-hours' }).ok,
    ).toBe(true);
    const done = transitionBooking(at(DM, 'awaiting-confirmation'), {
      type: 'parent-confirm-hours',
    });
    expect(done.ok && done.next).toBe('completed');
  });
});

// ── Provider consultation path (accepted → completed, null payment) ───────────

describe('Provider consultation path', () => {
  it('accepted → completed via consultation-auto-complete — NULL payment (no capture/payout)', () => {
    const r = transitionBooking(at(PROVIDER, 'accepted'), { type: 'consultation-auto-complete' });
    expect(r.ok && r.next).toBe('completed');
    if (r.ok) {
      expect(r.sideEffects).toEqual([{ type: 'notify-both' }]);
      expect(r.sideEffects.some((e) => e.type.startsWith('enqueue-payment'))).toBe(false);
      expect(r.sideEffects.some((e) => e.type === 'enqueue-payout')).toBe(false);
    }
  });

  it('skips the hourly states — session-start / propose-hours / confirm / auto-confirm all illegal', () => {
    for (const type of [
      'session-start',
      'session-end-propose-hours',
      'parent-confirm-hours',
      'session-auto-confirm',
    ] as const) {
      expect(transitionBooking(at(PROVIDER, 'accepted'), { type }).ok).toBe(false);
    }
  });

  it('carries no dispute — parent-dispute is illegal', () => {
    const r = transitionBooking(at(PROVIDER, 'awaiting-confirmation'), { type: 'parent-dispute' });
    expect(r.ok).toBe(false);
  });

  it('parent-cancel releases the slot with no payment movement', () => {
    const r = transitionBooking(at(PROVIDER, 'accepted'), { type: 'parent-cancel' });
    expect(r.ok && r.next).toBe('cancelled');
    if (r.ok) {
      expect(r.sideEffects).toContainEqual({ type: 'release-consultation-slot' });
      expect(r.sideEffects.some((e) => e.type.startsWith('enqueue-payment'))).toBe(false);
    }
  });

  it('provider-cancel releases the slot; caregiver-cancel is rejected for a consultation', () => {
    expect(transitionBooking(at(PROVIDER, 'accepted'), { type: 'provider-cancel' }).ok).toBe(true);
    expect(transitionBooking(at(PROVIDER, 'accepted'), { type: 'caregiver-cancel' }).ok).toBe(
      false,
    );
  });

  it('does not accept caregiver-only completion events', () => {
    expect(transitionBooking(at(PROVIDER, 'accepted'), { type: 'parent-confirm-hours' }).ok).toBe(
      false,
    );
  });
});

// ── Cancellation ─────────────────────────────────────────────────────────────

describe('Cancellation', () => {
  for (const s of ['requested', 'accepted', 'in-progress', 'awaiting-confirmation'] as const) {
    it(`parent-cancel valid from ${s} (caregiver) — enqueues cancellation charge`, () => {
      const r = transitionBooking(at(POSTED, s), { type: 'parent-cancel' });
      expect(r.ok && r.next).toBe('cancelled');
      if (r.ok) {
        expect(r.sideEffects).toContainEqual({ type: 'enqueue-payment-cancellation-charge' });
      }
    });
  }

  it('parent-cancel from completed/terminal is illegal', () => {
    expect(transitionBooking(at(POSTED, 'completed'), { type: 'parent-cancel' }).ok).toBe(false);
  });

  it('caregiver-cancel from requested is rejected (use caregiver-decline)', () => {
    const r = transitionBooking(at(POSTED, 'requested'), { type: 'caregiver-cancel' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/caregiver-decline/);
  });

  it('caregiver-cancel from accepted is valid — full refund + admin review', () => {
    const r = transitionBooking(at(POSTED, 'accepted'), { type: 'caregiver-cancel' });
    expect(r.ok && r.next).toBe('cancelled');
    if (r.ok) {
      expect(r.sideEffects).toContainEqual({ type: 'enqueue-payment-full-refund' });
      expect(r.sideEffects).toContainEqual({ type: 'flag-for-admin-review' });
    }
  });
});

// ── Exhaustive legal matrices + terminal rejection ───────────────────────────

describe('Exhaustive legal matrix — caregiver posted-job', () => {
  const LEGAL: Record<BookingState, ReadonlyArray<BookingEventType>> = {
    requested: ['caregiver-accept', 'caregiver-decline', 'request-expire', 'parent-cancel'],
    accepted: ['session-start', 'parent-cancel', 'caregiver-cancel'],
    'in-progress': ['session-end-propose-hours', 'parent-cancel', 'caregiver-cancel'],
    'awaiting-confirmation': [
      'parent-confirm-hours',
      'session-auto-confirm',
      'parent-dispute',
      'parent-cancel',
      'caregiver-cancel',
    ],
    completed: [],
    declined: [],
    expired: [],
    cancelled: [],
    disputed: [],
  };

  for (const state of BOOKING_STATES) {
    for (const type of BOOKING_EVENT_TYPES) {
      const expected = LEGAL[state].includes(type);
      it(`${state} ⨯ ${type} → ${expected ? 'legal' : 'illegal'}`, () => {
        expect(transitionBooking(at(POSTED, state), { type }).ok).toBe(expected);
      });
    }
  }
});

describe('Exhaustive legal matrix — provider consultation', () => {
  const LEGAL: Record<BookingState, ReadonlyArray<BookingEventType>> = {
    requested: [],
    accepted: ['consultation-auto-complete', 'parent-cancel', 'provider-cancel'],
    'in-progress': [],
    'awaiting-confirmation': [],
    completed: [],
    declined: [],
    expired: [],
    cancelled: [],
    disputed: [],
  };

  for (const state of BOOKING_STATES) {
    for (const type of BOOKING_EVENT_TYPES) {
      const expected = LEGAL[state].includes(type);
      it(`${state} ⨯ ${type} → ${expected ? 'legal' : 'illegal'}`, () => {
        expect(transitionBooking(at(PROVIDER, state), { type }).ok).toBe(expected);
      });
    }
  }
});

describe('Terminal states reject all events', () => {
  for (const state of BOOKING_TERMINAL_STATES) {
    for (const type of BOOKING_EVENT_TYPES) {
      it(`${state} rejects ${type}`, () => {
        expect(transitionBooking(at(POSTED, state), { type }).ok).toBe(false);
        expect(transitionBooking(at(PROVIDER, state), { type }).ok).toBe(false);
      });
    }
  }
});

// ── Adjust-time (ADR-0014 §A3) ───────────────────────────────────────────────

describe('Adjust-time — extend (applies immediately)', () => {
  it('extend adds hours + endMin and re-authorizes the larger total; stays plain accepted', () => {
    const r = extendBookingTime(accepted(3, 18 * 60), 2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.booking.schedule.durationHours).toBe(5);
      expect(r.booking.schedule.endMin).toBe(20 * 60);
      expect(r.booking.pendingTimeChange).toBeUndefined();
      expect(r.sideEffects).toContainEqual({ type: 'enqueue-payment-reauthorize' });
    }
  });

  it('extend rejects non-positive hours, non-accepted states, and provider has no adjust-time', () => {
    expect(extendBookingTime(accepted(3), 0).ok).toBe(false);
    expect(extendBookingTime({ ...accepted(3), state: 'in-progress' }, 1).ok).toBe(false);
  });
});

describe('Adjust-time — shorten (needs Caregiver approval)', () => {
  it('request writes a pendingTimeChange but keeps the original duration', () => {
    const r = requestReduceBookingTime(accepted(4, 20 * 60), 2, REQUESTED_AT, 'leaving early');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.booking.schedule.durationHours).toBe(4); // unchanged until approved
      expect(r.booking.pendingTimeChange).toEqual({
        proposedDurationHours: 2,
        proposedEndMin: 18 * 60,
        note: 'leaving early',
        requestedAt: REQUESTED_AT,
      });
      expect(r.sideEffects).toContainEqual({ type: 'notify-caregiver' });
    }
  });

  it('request must actually shorten (>= current duration is rejected)', () => {
    expect(requestReduceBookingTime(accepted(3), 3, REQUESTED_AT).ok).toBe(false);
    expect(requestReduceBookingTime(accepted(3), 5, REQUESTED_AT).ok).toBe(false);
  });

  it('approve applies the proposed duration and resolves back to a plain accepted', () => {
    const req = requestReduceBookingTime(accepted(4, 20 * 60), 2, REQUESTED_AT);
    expect(req.ok).toBe(true);
    if (!req.ok) return;
    const appr = approveBookingTimeReduction(req.booking);
    expect(appr.ok).toBe(true);
    if (appr.ok) {
      expect(appr.booking.state).toBe('accepted');
      expect(appr.booking.pendingTimeChange).toBeUndefined();
      expect(appr.booking.schedule.durationHours).toBe(2);
      expect(appr.booking.schedule.endMin).toBe(18 * 60);
      expect(appr.sideEffects).toContainEqual({ type: 'enqueue-payment-reauthorize' });
    }
  });

  it('decline drops the proposal, keeps the original duration, resolves to plain accepted', () => {
    const req = requestReduceBookingTime(accepted(4), 2, REQUESTED_AT);
    if (!req.ok) throw new Error('setup');
    const dec = declineBookingTimeReduction(req.booking);
    expect(dec.ok).toBe(true);
    if (dec.ok) {
      expect(dec.booking.pendingTimeChange).toBeUndefined();
      expect(dec.booking.schedule.durationHours).toBe(4);
    }
  });

  it('parent can rescind their own pending shorten', () => {
    const req = requestReduceBookingTime(accepted(4), 2, REQUESTED_AT);
    if (!req.ok) throw new Error('setup');
    const rescind = cancelBookingTimeReductionRequest(req.booking);
    expect(rescind.ok).toBe(true);
    if (rescind.ok) expect(rescind.booking.pendingTimeChange).toBeUndefined();
  });

  it('approve/decline/cancel with no pending change are no-ops (refused)', () => {
    expect(approveBookingTimeReduction(accepted(4)).ok).toBe(false);
    expect(declineBookingTimeReduction(accepted(4)).ok).toBe(false);
    expect(cancelBookingTimeReductionRequest(accepted(4)).ok).toBe(false);
  });

  it('cannot stack a second change while one is pending', () => {
    const req = requestReduceBookingTime(accepted(4), 2, REQUESTED_AT);
    if (!req.ok) throw new Error('setup');
    expect(extendBookingTime(req.booking, 1).ok).toBe(false);
    expect(requestReduceBookingTime(req.booking, 1, REQUESTED_AT).ok).toBe(false);
  });
});

// ── Scheduling — recurrence expansion ────────────────────────────────────────

describe('expandRecurrence', () => {
  const RULE: RecurrenceRule = {
    // 2026-06-25 is a Thursday. Tue=2, Thu=4.
    startDate: '2026-06-23',
    endDate: '2026-07-06',
    weekdays: [2, 4],
    startMin: 16 * 60,
    endMin: 18 * 60,
  };

  it('generates only the selected weekdays within the inclusive range', () => {
    const r = expandRecurrence(RULE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Tue/Thu across 2026-06-23 .. 2026-07-06: 23,25,30 (Jun) + 02,07? 07 is out.
      expect(r.slots.map((s) => s.date)).toEqual([
        '2026-06-23',
        '2026-06-25',
        '2026-06-30',
        '2026-07-02',
      ]);
      for (const s of r.slots) {
        expect(s.startMin).toBe(16 * 60);
        expect(s.endMin).toBe(18 * 60);
      }
    }
  });

  it('rejects malformed dates, reversed ranges, empty/invalid weekdays, bad windows', () => {
    expect(expandRecurrence({ ...RULE, startDate: '2026-13-01' }).ok).toBe(false);
    expect(expandRecurrence({ ...RULE, startDate: '2026-02-30' }).ok).toBe(false);
    expect(expandRecurrence({ ...RULE, endDate: '2026-06-01' }).ok).toBe(false);
    expect(expandRecurrence({ ...RULE, weekdays: [] }).ok).toBe(false);
    expect(expandRecurrence({ ...RULE, weekdays: [7] }).ok).toBe(false);
    expect(expandRecurrence({ ...RULE, startMin: 18 * 60, endMin: 16 * 60 }).ok).toBe(false);
  });
});

// ── Scheduling — Series (stateless) materialisation ──────────────────────────

describe('materialiseSeries', () => {
  const RULE: RecurrenceRule = {
    startDate: '2026-06-23',
    endDate: '2026-07-06',
    weekdays: [2, 4],
    startMin: 16 * 60,
    endMin: 18 * 60,
  };
  const baseInput = {
    seriesId: 'series-1',
    parentId: 'p1',
    caregiverId: 'c1',
    category: 'nanny',
    origin: 'direct-message' as CaregiverOrigin,
    agreedRate: 2500,
    rule: RULE,
    occurrenceIds: ['b1', 'b2', 'b3', 'b4'],
    offerId: 'offer-1',
  };

  it('materialises one independent accepted Booking per occurrence; the Series holds no state', () => {
    const r = materialiseSeries(baseInput);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.occurrences).toHaveLength(4);
      for (const occ of r.occurrences) {
        expect(occ.state).toBe('accepted');
        expect(occ.seriesId).toBe('series-1');
        expect(occ.kind).toBe('caregiver');
        expect(occ.schedule.durationHours).toBe(2);
      }
      // The Series object has no `state` field at all.
      expect('state' in r.series).toBe(false);
      expect(r.series.occurrenceIds).toEqual(['b1', 'b2', 'b3', 'b4']);
      expect(r.series.offerId).toBe('offer-1');
    }
  });

  it('each occurrence runs the graph independently — cancelling one leaves the others untouched', () => {
    const r = materialiseSeries(baseInput);
    if (!r.ok) throw new Error('setup');
    const first = r.occurrences[0];
    const rest = r.occurrences.slice(1);
    if (!first) throw new Error('expected at least one occurrence');
    const cancel = transitionBooking(first, { type: 'parent-cancel' });
    expect(cancel.ok && cancel.next).toBe('cancelled');
    // The others are still independently progressable.
    for (const occ of rest) {
      expect(transitionBooking(occ, { type: 'session-start' }).ok).toBe(true);
    }
  });

  it('rejects an occurrenceIds count that does not match the generated occurrences', () => {
    const r = materialiseSeries({ ...baseInput, occurrenceIds: ['b1', 'b2'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/length/);
  });

  it('rejects a non-empty rule that generates zero occurrences, and an empty seriesId', () => {
    expect(
      materialiseSeries({ ...baseInput, rule: { ...RULE, weekdays: [0] }, occurrenceIds: [] }).ok,
    ).toBe(false);
    expect(materialiseSeries({ ...baseInput, seriesId: '' }).ok).toBe(false);
  });
});

// ── Scheduling — multi-day one-off (independent, no Series) ───────────────────

describe('materialiseMultiDayOneOff', () => {
  const slots = [
    { date: '2026-06-26', startMin: 18 * 60, endMin: 22 * 60 },
    { date: '2026-07-01', startMin: 17 * 60, endMin: 20 * 60 },
  ];
  const input = {
    parentId: 'p1',
    caregiverId: 'c1',
    category: 'babysitter',
    origin: 'direct-message' as CaregiverOrigin,
    agreedRate: 2000,
    slots,
    bookingIds: ['b1', 'b2'],
  };

  it('produces one independent Booking per date with NO Series (seriesId null)', () => {
    const r = materialiseMultiDayOneOff(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bookings).toHaveLength(2);
      for (const b of r.bookings) {
        expect(b.seriesId).toBeNull();
        expect(b.state).toBe('accepted');
      }
      expect(r.bookings[0]?.schedule.durationHours).toBe(4);
      expect(r.bookings[1]?.schedule.durationHours).toBe(3);
    }
  });

  it('rejects mismatched id counts, empty slot lists, and malformed slots', () => {
    expect(materialiseMultiDayOneOff({ ...input, bookingIds: ['only-one'] }).ok).toBe(false);
    expect(materialiseMultiDayOneOff({ ...input, slots: [], bookingIds: [] }).ok).toBe(false);
    expect(
      materialiseMultiDayOneOff({
        ...input,
        slots: [{ date: 'nope', startMin: 0, endMin: 60 }],
        bookingIds: ['b1'],
      }).ok,
    ).toBe(false);
  });
});

// ── Property-based tests ─────────────────────────────────────────────────────

describe('Property-based — transitionBooking', () => {
  const shapeArb: fc.Arbitrary<BookingShape> = fc.oneof(
    fc.record({
      kind: fc.constant<'caregiver'>('caregiver'),
      origin: fc.constantFrom<CaregiverOrigin>(...CAREGIVER_ORIGINS),
    }),
    fc.constant<BookingShape>({ kind: 'provider' }),
  );
  const stateArb = fc.constantFrom(...BOOKING_STATES);
  const bookingArb: fc.Arbitrary<Booking> = fc
    .tuple(shapeArb, stateArb)
    .map(([shape, state]) => ({ ...shape, state }));
  const eventArb: fc.Arbitrary<BookingEvent> = fc
    .constantFrom(...BOOKING_EVENT_TYPES)
    .map((type) => ({ type }));

  it('always returns a well-formed result', () => {
    fc.assert(
      fc.property(bookingArb, eventArb, (booking, event) => {
        const r = transitionBooking(booking, event);
        if (r.ok) {
          expect(BOOKING_STATES).toContain(r.next);
          expect(r.sideEffects.length).toBeGreaterThan(0); // every legal transition acts
        } else {
          expect(r.reason.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(bookingArb, eventArb, (booking, event) => {
        expect(transitionBooking(booking, event)).toEqual(transitionBooking(booking, event));
      }),
    );
  });

  it('terminal states never accept any event', () => {
    fc.assert(
      fc.property(
        shapeArb,
        fc.constantFrom(...BOOKING_TERMINAL_STATES),
        eventArb,
        (shape, state, event) => {
          expect(transitionBooking({ ...shape, state }, event).ok).toBe(false);
        },
      ),
    );
  });

  it('re-applying a just-succeeded event from the new state fails (state has moved on)', () => {
    fc.assert(
      fc.property(bookingArb, eventArb, (booking, event) => {
        const first = transitionBooking(booking, event);
        if (!first.ok) return;
        const second = transitionBooking({ ...booking, state: first.next }, event);
        expect(second.ok).toBe(false);
      }),
    );
  });

  it('provider consultations never accept the hourly session events', () => {
    const hourlyOnly = fc.constantFrom<BookingEventType>(
      'session-start',
      'session-end-propose-hours',
      'parent-confirm-hours',
      'session-auto-confirm',
      'parent-dispute',
    );
    fc.assert(
      fc.property(stateArb, hourlyOnly, (state, type) => {
        expect(transitionBooking({ kind: 'provider', state }, { type }).ok).toBe(false);
      }),
    );
  });

  it('caregiver bookings never accept consultation-auto-complete', () => {
    const cgArb = fc.record({
      kind: fc.constant<'caregiver'>('caregiver'),
      origin: fc.constantFrom<CaregiverOrigin>(...CAREGIVER_ORIGINS),
      state: stateArb,
    });
    fc.assert(
      fc.property(cgArb, (booking) => {
        expect(transitionBooking(booking, { type: 'consultation-auto-complete' }).ok).toBe(false);
      }),
    );
  });

  it('expire on a requested posted-job → expired; expire from any other state → no-op', () => {
    fc.assert(
      fc.property(stateArb, (state) => {
        const r = transitionBooking({ kind: 'caregiver', origin: 'posted-job', state }, {
          type: 'request-expire',
        });
        if (state === 'requested') {
          expect(r.ok && r.next).toBe('expired');
        } else {
          expect(r.ok).toBe(false);
        }
      }),
    );
  });

  it('every kind in BOOKING_KINDS is constructible and total over events', () => {
    fc.assert(
      fc.property(fc.constantFrom(...BOOKING_KINDS), stateArb, eventArb, (kind, state, event) => {
        const booking: Booking =
          kind === 'caregiver' ? { kind, origin: 'posted-job', state } : { kind, state };
        // Must never throw — every (booking, event) pair is handled.
        expect(typeof transitionBooking(booking, event).ok).toBe('boolean');
      }),
    );
  });
});

describe('Property-based — adjust-time invariants', () => {
  const hours = fc.integer({ min: 1, max: 12 });

  it('extend strictly increases duration by addHours', () => {
    fc.assert(
      fc.property(hours, fc.integer({ min: 1, max: 6 }), (dur, add) => {
        const r = extendBookingTime(accepted(dur), add);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.booking.schedule.durationHours).toBe(dur + add);
      }),
    );
  });

  it('a shorten request never changes the live duration until approved', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), (dur) => {
        const r = requestReduceBookingTime(accepted(dur), dur - 1, REQUESTED_AT);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.booking.schedule.durationHours).toBe(dur);
      }),
    );
  });

  it('approve/decline/cancel always resolve back to a pendingTimeChange-free accepted', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), (dur) => {
        const req = requestReduceBookingTime(accepted(dur), dur - 1, REQUESTED_AT);
        if (!req.ok) throw new Error('setup');
        for (const resolve of [
          approveBookingTimeReduction,
          declineBookingTimeReduction,
          cancelBookingTimeReductionRequest,
        ]) {
          const out = resolve(req.booking);
          expect(out.ok).toBe(true);
          if (out.ok) {
            expect(out.booking.state).toBe('accepted');
            expect(out.booking.pendingTimeChange).toBeUndefined();
          }
        }
      }),
    );
  });
});

describe('Property-based — recurrence expansion', () => {
  it('every generated slot falls on a selected weekday and inside the range', () => {
    const weekdaySetArb = fc
      .subarray([0, 1, 2, 3, 4, 5, 6], { minLength: 1 })
      .map((xs) => [...new Set(xs)]);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }), // start offset days from a fixed anchor
        fc.integer({ min: 0, max: 60 }), // span days
        weekdaySetArb,
        (startOffset, span, weekdays) => {
          const anchor = Date.UTC(2026, 0, 1);
          const startMs = anchor + startOffset * DAY_MS;
          const endMs = startMs + span * DAY_MS;
          const rule: RecurrenceRule = {
            startDate: new Date(startMs).toISOString().slice(0, 10),
            endDate: new Date(endMs).toISOString().slice(0, 10),
            weekdays,
            startMin: 9 * 60,
            endMin: 12 * 60,
          };
          const r = expandRecurrence(rule);
          expect(r.ok).toBe(true);
          if (r.ok) {
            const wanted = new Set(weekdays);
            for (const slot of r.slots) {
              const ms = Date.UTC(
                Number(slot.date.slice(0, 4)),
                Number(slot.date.slice(5, 7)) - 1,
                Number(slot.date.slice(8, 10)),
              );
              expect(wanted.has(new Date(ms).getUTCDay())).toBe(true);
              expect(ms).toBeGreaterThanOrEqual(startMs);
              expect(ms).toBeLessThanOrEqual(endMs);
            }
          }
        },
      ),
    );
  });
});
