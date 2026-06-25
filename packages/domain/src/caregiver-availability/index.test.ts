import type { AvailabilityBand, AvailabilityDay, AvailabilityGrid } from '@our-haven/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  appearsInSearch,
  bandsOverlapping,
  CAREGIVER_AVAILABILITY_MODULE_VERSION,
  intersectAvailabilityWithQuery,
  isPaused,
  noteWithinLimit,
  renderCaregiverAvailability,
  weekdayOf,
  type AvailabilityQuery,
  type CaregiverAvailability,
} from './index.js';

function avail(grid: AvailabilityGrid, paused = false, note = ''): CaregiverAvailability {
  return { grid, note, paused };
}

// Rock-solid weekday anchors: the Unix epoch 1970-01-01 was a Thursday.
const EPOCH_WEEKDAYS: Array<[string, string]> = [
  ['1970-01-01', 'thu'],
  ['1970-01-02', 'fri'],
  ['1970-01-03', 'sat'],
  ['1970-01-04', 'sun'],
  ['1970-01-05', 'mon'],
  ['1970-01-06', 'tue'],
  ['1970-01-07', 'wed'],
];
const A_MONDAY = '1970-01-05';
const A_TUESDAY = '1970-01-06';

describe('paused / appearsInSearch', () => {
  it('isPaused reflects the flag', () => {
    expect(isPaused(avail({}, true))).toBe(true);
    expect(isPaused(avail({}, false))).toBe(false);
  });

  it('a paused Caregiver does not appear in search; an active one does', () => {
    expect(appearsInSearch(avail({}, true))).toBe(false);
    expect(appearsInSearch(avail({}, false))).toBe(true);
  });
});

describe('noteWithinLimit', () => {
  it('accepts ≤200 chars, rejects 201', () => {
    expect(noteWithinLimit('a'.repeat(200))).toBe(true);
    expect(noteWithinLimit('a'.repeat(201))).toBe(false);
  });
});

describe('renderCaregiverAvailability', () => {
  it('renders null for an empty grid', () => {
    expect(renderCaregiverAvailability(avail({}))).toBeNull();
  });

  it('renders a short Parent-facing summary for weekday afternoons', () => {
    const grid: AvailabilityGrid = {
      mon: { afternoon: true },
      tue: { afternoon: true },
      wed: { afternoon: true },
      thu: { afternoon: true },
      fri: { afternoon: true },
    };
    expect(renderCaregiverAvailability(avail(grid))).toBe('Weekdays, afternoons');
  });
});

describe('weekdayOf', () => {
  it.each(EPOCH_WEEKDAYS)('maps %s to %s', (date, day) => {
    expect(weekdayOf(date)).toBe(day);
  });

  it.each(['2026-13-01', '2026-02-30', 'not-a-date', '20260101'])(
    'throws on malformed date %j',
    (bad) => {
      expect(() => weekdayOf(bad)).toThrow(/invalid query date/);
    },
  );
});

describe('bandsOverlapping (Morning 06–12 / Afternoon 12–18 / Evening 18–22)', () => {
  it.each([
    [360, 480, ['morning']], // 06:00–08:00
    [780, 840, ['afternoon']], // 13:00–14:00
    [1140, 1200, ['evening']], // 19:00–20:00
    [660, 780, ['morning', 'afternoon']], // 11:00–13:00 spans noon
    [1020, 1140, ['afternoon', 'evening']], // 17:00–19:00 spans 18:00
    [0, 1440, ['morning', 'afternoon', 'evening']], // whole day
    [0, 300, []], // 00:00–05:00 before any band
    [1380, 1410, []], // 23:00–23:30 after evening ends
  ])('window %i–%i → %j', (start, end, expected) => {
    expect(bandsOverlapping(start, end)).toEqual(expected);
  });
});

describe('intersectAvailabilityWithQuery', () => {
  const monAfternoon = avail({ mon: { afternoon: true } });
  const q = (date: string, startMin: number, endMin: number): AvailabilityQuery => ({
    date,
    startMin,
    endMin,
  });

  it('matches when the weekday + band line up', () => {
    expect(intersectAvailabilityWithQuery(monAfternoon, q(A_MONDAY, 780, 840))).toBe(true);
  });

  it('no match on a different weekday', () => {
    expect(intersectAvailabilityWithQuery(monAfternoon, q(A_TUESDAY, 780, 840))).toBe(false);
  });

  it('no match on the right day but the wrong band', () => {
    expect(intersectAvailabilityWithQuery(monAfternoon, q(A_MONDAY, 420, 480))).toBe(false); // morning
  });

  it('matches when the window straddles into an on band', () => {
    // 11:00–13:00 overlaps morning + afternoon; afternoon is on → match.
    expect(intersectAvailabilityWithQuery(monAfternoon, q(A_MONDAY, 660, 780))).toBe(true);
  });

  it('an empty grid matches nothing', () => {
    expect(intersectAvailabilityWithQuery(avail({}), q(A_MONDAY, 780, 840))).toBe(false);
  });

  it('a PAUSED Caregiver matches nothing even when the grid would (hides from search)', () => {
    const paused = avail({ mon: { afternoon: true } }, true);
    expect(intersectAvailabilityWithQuery(paused, q(A_MONDAY, 780, 840))).toBe(false);
  });

  it('throws on a malformed query window or date', () => {
    expect(() => intersectAvailabilityWithQuery(monAfternoon, q(A_MONDAY, 800, 700))).toThrow(
      /invalid query window/,
    );
    expect(() => intersectAvailabilityWithQuery(monAfternoon, q(A_MONDAY, -1, 60))).toThrow(
      /invalid query window/,
    );
    expect(() => intersectAvailabilityWithQuery(monAfternoon, q('bad', 780, 840))).toThrow(
      /invalid query date/,
    );
  });
});

describe('properties (fast-check)', () => {
  const arbDay = fc.constantFrom('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');
  const arbBand = fc.constantFrom('morning', 'afternoon', 'evening');
  const arbGrid = fc
    .array(fc.tuple(arbDay, arbBand), { maxLength: 21 })
    .map((pairs): AvailabilityGrid => {
      const g: AvailabilityGrid = {};
      for (const [d, b] of pairs) {
        const day = d as AvailabilityDay;
        const band = b as AvailabilityBand;
        g[day] = { ...(g[day] ?? {}), [band]: true };
      }
      return g;
    });
  // Valid windows: 0 ≤ start < end ≤ 1440.
  const arbQuery = fc
    .tuple(
      fc.constantFrom(...EPOCH_WEEKDAYS.map(([d]) => d)),
      fc.integer({ min: 0, max: 1439 }),
      fc.integer({ min: 1, max: 1440 }),
    )
    .filter(([, s, e]) => s < e)
    .map(([date, startMin, endMin]): AvailabilityQuery => ({ date, startMin, endMin }));

  it('a paused Caregiver never intersects any query', () => {
    fc.assert(
      fc.property(arbGrid, arbQuery, (grid, query) => {
        expect(intersectAvailabilityWithQuery(avail(grid, true), query)).toBe(false);
      }),
    );
  });

  it('an intersection implies the Caregiver appears in search', () => {
    fc.assert(
      fc.property(arbGrid, arbQuery, (grid, query) => {
        const a = avail(grid, false);
        if (intersectAvailabilityWithQuery(a, query)) {
          expect(appearsInSearch(a)).toBe(true);
        }
      }),
    );
  });

  it('bandsOverlapping is always a canonical-ordered subset', () => {
    const order = ['morning', 'afternoon', 'evening'];
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1439 }),
        fc.integer({ min: 1, max: 1440 }),
        (s, e) => {
          fc.pre(s < e);
          const bands = bandsOverlapping(s, e);
          const idx = bands.map((b) => order.indexOf(b));
          expect(idx).toEqual([...idx].sort((a, z) => a - z));
        },
      ),
    );
  });
});

describe('module version', () => {
  it('is bumped for OH-180', () => {
    expect(CAREGIVER_AVAILABILITY_MODULE_VERSION).toBe('0.2.0-OH-180');
  });
});
