import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  createSlot,
  findSlotConflicts,
  holdSlot,
  initialSlotState,
  intersectSlotsWithQuery,
  isBookable,
  PROVIDER_SLOT_SCHEDULER_MODULE_VERSION,
  releaseSlot,
  reopenSlot,
  SLOT_STATES,
  slotsOverlap,
  withdrawSlot,
  type ConsultationSlot,
  type SlotResult,
  type SlotState,
} from './index.js';

const DATE = '2026-06-25';

function slot(overrides?: Partial<ConsultationSlot>): ConsultationSlot {
  return {
    id: 's1',
    date: DATE,
    startMin: 540, // 09:00
    endMin: 600, // 10:00
    state: 'open',
    heldByBookingId: null,
    ...overrides,
  };
}

function ok(result: SlotResult): ConsultationSlot {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.slot;
}

describe('createSlot (CRUD create)', () => {
  it('lists a valid slot born open with no holder', () => {
    const s = ok(createSlot({ id: 'a', date: DATE, startMin: 540, endMin: 600 }));
    expect(s).toEqual({
      id: 'a',
      date: DATE,
      startMin: 540,
      endMin: 600,
      state: 'open',
      heldByBookingId: null,
    });
    expect(s.state).toBe(initialSlotState());
  });

  it.each([
    [{ id: '', date: DATE, startMin: 540, endMin: 600 }, /id must be non-empty/],
    [{ id: 'a', date: '2026-13-01', startMin: 540, endMin: 600 }, /invalid slot date/],
    [{ id: 'a', date: DATE, startMin: 600, endMin: 540 }, /invalid slot window/],
    [{ id: 'a', date: DATE, startMin: -5, endMin: 600 }, /invalid slot window/],
  ])('refuses bad input %j', (input, re) => {
    const r = createSlot(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(re);
  });
});

describe('isBookable', () => {
  it('is true only for open slots', () => {
    expect(isBookable(slot({ state: 'open' }))).toBe(true);
    expect(isBookable(slot({ state: 'held' }))).toBe(false);
    expect(isBookable(slot({ state: 'released' }))).toBe(false);
  });
});

describe('holdSlot (booking holds a slot)', () => {
  it('open → held, stamping the holding booking id', () => {
    const s = ok(holdSlot(slot(), 'bk_1'));
    expect(s.state).toBe('held');
    expect(s.heldByBookingId).toBe('bk_1');
  });

  it('refuses a non-open slot', () => {
    expect(holdSlot(slot({ state: 'held', heldByBookingId: 'bk_x' }), 'bk_1').ok).toBe(false);
    expect(holdSlot(slot({ state: 'released' }), 'bk_1').ok).toBe(false);
  });

  it('refuses an empty booking id', () => {
    const r = holdSlot(slot(), '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/bookingId must be non-empty/);
  });
});

describe('releaseSlot (cancel releases it)', () => {
  it('held → released, clearing the holder', () => {
    const held = ok(holdSlot(slot(), 'bk_1'));
    const released = ok(releaseSlot(held));
    expect(released.state).toBe('released');
    expect(released.heldByBookingId).toBeNull();
  });

  it('refuses a slot that is not held', () => {
    expect(releaseSlot(slot({ state: 'open' })).ok).toBe(false);
    expect(releaseSlot(slot({ state: 'released' })).ok).toBe(false);
  });
});

describe('withdrawSlot / reopenSlot (CRUD un-publish / re-list)', () => {
  it('open → released via withdraw', () => {
    expect(ok(withdrawSlot(slot())).state).toBe('released');
  });

  it('refuses to withdraw a held slot (cancel the booking first)', () => {
    const r = withdrawSlot(slot({ state: 'held', heldByBookingId: 'bk_1' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/cancel the booking/);
  });

  it('released → open via reopen', () => {
    expect(ok(reopenSlot(slot({ state: 'released' }))).state).toBe('open');
  });

  it('refuses to reopen a non-released slot', () => {
    expect(reopenSlot(slot({ state: 'open' })).ok).toBe(false);
    expect(reopenSlot(slot({ state: 'held', heldByBookingId: 'b' })).ok).toBe(false);
  });
});

describe('full cycle: open → held → released → open', () => {
  it('books, cancels (releases), and re-lists', () => {
    let s = slot();
    expect(s.state).toBe('open');
    s = ok(holdSlot(s, 'bk_1')); // booking holds it
    expect(s.state).toBe('held');
    s = ok(releaseSlot(s)); // cancellation releases it
    expect(s.state).toBe('released');
    expect(s.heldByBookingId).toBeNull();
    s = ok(reopenSlot(s)); // provider re-lists it
    expect(s.state).toBe('open');
  });
});

describe('slotsOverlap / findSlotConflicts (CRUD overlap guard)', () => {
  it('overlapping windows on the same day collide', () => {
    expect(slotsOverlap(slot({ startMin: 540, endMin: 600 }), slot({ startMin: 570, endMin: 630 }))).toBe(true);
  });

  it('touching windows do NOT collide (half-open)', () => {
    expect(slotsOverlap(slot({ startMin: 540, endMin: 600 }), slot({ startMin: 600, endMin: 660 }))).toBe(false);
  });

  it('same window on different days does not collide', () => {
    expect(slotsOverlap(slot({ date: '2026-06-25' }), slot({ date: '2026-06-26' }))).toBe(false);
  });

  it('findSlotConflicts ignores the candidate itself and non-overlapping slots', () => {
    const candidate = slot({ id: 'c', startMin: 540, endMin: 600 });
    const existing = [
      slot({ id: 'c', startMin: 540, endMin: 600 }), // same id — ignored
      slot({ id: 'overlap', startMin: 570, endMin: 660 }), // collides
      slot({ id: 'later', startMin: 600, endMin: 660 }), // touches, no overlap
      slot({ id: 'otherday', date: '2026-06-26', startMin: 540, endMin: 600 }),
    ];
    expect(findSlotConflicts(candidate, existing).map((s) => s.id)).toEqual(['overlap']);
  });
});

describe('intersectSlotsWithQuery', () => {
  const slots: ConsultationSlot[] = [
    slot({ id: 'open-hit', startMin: 540, endMin: 600 }),
    slot({ id: 'open-miss-time', startMin: 900, endMin: 960 }),
    slot({ id: 'open-other-day', date: '2026-06-26', startMin: 540, endMin: 600 }),
    slot({ id: 'held', state: 'held', heldByBookingId: 'b', startMin: 540, endMin: 600 }),
    slot({ id: 'released', state: 'released', startMin: 540, endMin: 600 }),
  ];

  it('returns only open slots on the day whose window overlaps the query', () => {
    const hits = intersectSlotsWithQuery(slots, { date: DATE, startMin: 570, endMin: 630 });
    expect(hits.map((s) => s.id)).toEqual(['open-hit']);
  });

  it('excludes held + released slots even when the time matches', () => {
    const hits = intersectSlotsWithQuery(slots, { date: DATE, startMin: 540, endMin: 600 });
    expect(hits.map((s) => s.id)).toEqual(['open-hit']);
  });

  it('throws on a malformed query', () => {
    expect(() => intersectSlotsWithQuery(slots, { date: 'nope', startMin: 540, endMin: 600 })).toThrow(
      /invalid query date/,
    );
    expect(() => intersectSlotsWithQuery(slots, { date: DATE, startMin: 600, endMin: 540 })).toThrow(
      /invalid query window/,
    );
  });
});

describe('properties (fast-check)', () => {
  const arbState = fc.constantFrom<SlotState>('open', 'held', 'released');
  const arbSlot = fc
    .record({
      id: fc.string({ minLength: 1, maxLength: 6 }),
      date: fc.constantFrom('2026-06-25', '2026-06-26'),
      startMin: fc.integer({ min: 0, max: 1439 }),
      endMin: fc.integer({ min: 1, max: 1440 }),
      state: arbState,
    })
    .filter((r) => r.startMin < r.endMin)
    .map(
      (r): ConsultationSlot => ({
        ...r,
        heldByBookingId: r.state === 'held' ? 'bk' : null,
      }),
    );

  it('createSlot always yields an open, holder-free slot echoing its inputs', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 1439 }),
        fc.integer({ min: 1, max: 1440 }),
        (id, startMin, endMin) => {
          fc.pre(startMin < endMin);
          const r = createSlot({ id, date: DATE, startMin, endMin });
          expect(r.ok).toBe(true);
          if (r.ok) {
            expect(r.slot.state).toBe('open');
            expect(r.slot.heldByBookingId).toBeNull();
            expect(r.slot).toMatchObject({ id, date: DATE, startMin, endMin });
          }
        },
      ),
    );
  });

  it('any successful transition lands on a valid slot state', () => {
    fc.assert(
      fc.property(arbSlot, (s) => {
        for (const r of [holdSlot(s, 'bk'), releaseSlot(s), withdrawSlot(s), reopenSlot(s)]) {
          if (r.ok) expect(SLOT_STATES).toContain(r.slot.state);
        }
      }),
    );
  });

  it('a held slot always carries a holder; open/released never do (post-transition)', () => {
    fc.assert(
      fc.property(arbSlot, (s) => {
        for (const r of [holdSlot(s, 'bk'), releaseSlot(s), withdrawSlot(s), reopenSlot(s)]) {
          if (r.ok) {
            if (r.slot.state === 'held') expect(r.slot.heldByBookingId).not.toBeNull();
            else expect(r.slot.heldByBookingId).toBeNull();
          }
        }
      }),
    );
  });

  it('intersect results are always open, same-day, and overlapping', () => {
    fc.assert(
      fc.property(fc.array(arbSlot, { maxLength: 20 }), (slots) => {
        const query = { date: DATE, startMin: 480, endMin: 720 };
        for (const hit of intersectSlotsWithQuery(slots, query)) {
          expect(hit.state).toBe('open');
          expect(hit.date).toBe(DATE);
          expect(hit.startMin < query.endMin && query.startMin < hit.endMin).toBe(true);
        }
      }),
    );
  });

  it('slotsOverlap is symmetric', () => {
    fc.assert(
      fc.property(arbSlot, arbSlot, (a, b) => {
        expect(slotsOverlap(a, b)).toBe(slotsOverlap(b, a));
      }),
    );
  });
});

describe('module version', () => {
  it('is bumped for OH-180', () => {
    expect(PROVIDER_SLOT_SCHEDULER_MODULE_VERSION).toBe('0.2.0-OH-180');
  });
});
