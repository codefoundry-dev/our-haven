import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CANCELLATION_FREE_THRESHOLD_MS,
  CANCELLATION_HALF_THRESHOLD_MS,
  CANCELLATION_PARTIES,
  CANCELLATION_TIERS,
  calculateCancellation,
  type CancellationInput,
} from './index.js';

const START = new Date('2026-06-01T12:00:00.000Z');
const cents = (n: number) => n; // alias for readability

function at(offsetMs: number): Date {
  return new Date(START.getTime() - offsetMs);
}

describe('Provider-initiated cancellation', () => {
  it('is always free (full refund, regardless of timing)', () => {
    const r = calculateCancellation({
      originalAuthorizedCents: cents(10_000),
      bookingStartAt: START,
      cancellationAt: at(60 * 60 * 1000), // 1h before start (would be 100% if Parent-initiated)
      cancelledBy: 'provider',
    });
    expect(r).toEqual({ chargeCents: 0, refundCents: 10_000, tier: 'free' });
  });

  it('is free even after start time', () => {
    const r = calculateCancellation({
      originalAuthorizedCents: cents(5_000),
      bookingStartAt: START,
      cancellationAt: new Date(START.getTime() + 60 * 60 * 1000), // 1h AFTER start
      cancelledBy: 'provider',
    });
    expect(r.tier).toBe('free');
    expect(r.refundCents).toBe(5_000);
  });
});

describe('Parent-initiated cancellation — tier boundaries', () => {
  it('exactly 24h before start → free (boundary is inclusive of the free tier)', () => {
    const r = calculateCancellation({
      originalAuthorizedCents: cents(10_000),
      bookingStartAt: START,
      cancellationAt: at(CANCELLATION_FREE_THRESHOLD_MS),
      cancelledBy: 'parent',
    });
    expect(r.tier).toBe('free');
    expect(r).toEqual({ chargeCents: 0, refundCents: 10_000, tier: 'free' });
  });

  it('1ms inside 24h → half tier', () => {
    const r = calculateCancellation({
      originalAuthorizedCents: cents(10_000),
      bookingStartAt: START,
      cancellationAt: at(CANCELLATION_FREE_THRESHOLD_MS - 1),
      cancelledBy: 'parent',
    });
    expect(r.tier).toBe('half');
    expect(r.chargeCents).toBe(5_000);
    expect(r.refundCents).toBe(5_000);
  });

  it('exactly 2h before start → half (boundary is inclusive of the half tier)', () => {
    const r = calculateCancellation({
      originalAuthorizedCents: cents(10_000),
      bookingStartAt: START,
      cancellationAt: at(CANCELLATION_HALF_THRESHOLD_MS),
      cancelledBy: 'parent',
    });
    expect(r.tier).toBe('half');
  });

  it('1ms inside 2h → full charge', () => {
    const r = calculateCancellation({
      originalAuthorizedCents: cents(10_000),
      bookingStartAt: START,
      cancellationAt: at(CANCELLATION_HALF_THRESHOLD_MS - 1),
      cancelledBy: 'parent',
    });
    expect(r).toEqual({ chargeCents: 10_000, refundCents: 0, tier: 'full' });
  });

  it('exactly at start → full charge', () => {
    const r = calculateCancellation({
      originalAuthorizedCents: cents(10_000),
      bookingStartAt: START,
      cancellationAt: START,
      cancelledBy: 'parent',
    });
    expect(r.tier).toBe('full');
    expect(r.chargeCents).toBe(10_000);
  });

  it('after start → full charge', () => {
    const r = calculateCancellation({
      originalAuthorizedCents: cents(10_000),
      bookingStartAt: START,
      cancellationAt: new Date(START.getTime() + 5 * 60 * 1000), // 5min after
      cancelledBy: 'parent',
    });
    expect(r.tier).toBe('full');
  });

  it('a week early → free', () => {
    const r = calculateCancellation({
      originalAuthorizedCents: cents(10_000),
      bookingStartAt: START,
      cancellationAt: at(7 * 24 * 60 * 60 * 1000),
      cancelledBy: 'parent',
    });
    expect(r.tier).toBe('free');
  });
});

describe('Rounding behaviour for the 50% tier', () => {
  it('floors the charge on odd cents — Parent absorbs the spare cent as extra refund', () => {
    // 9_999 / 2 = 4999.5 → charge 4999, refund 5000
    const r = calculateCancellation({
      originalAuthorizedCents: cents(9_999),
      bookingStartAt: START,
      cancellationAt: at(12 * 60 * 60 * 1000), // 12h before start, in half tier
      cancelledBy: 'parent',
    });
    expect(r.tier).toBe('half');
    expect(r.chargeCents).toBe(4_999);
    expect(r.refundCents).toBe(5_000);
    expect(r.chargeCents + r.refundCents).toBe(9_999);
  });

  it('1-cent original at 50% tier → charge 0, refund 1 (no overcharge)', () => {
    const r = calculateCancellation({
      originalAuthorizedCents: cents(1),
      bookingStartAt: START,
      cancellationAt: at(12 * 60 * 60 * 1000),
      cancelledBy: 'parent',
    });
    expect(r).toEqual({ chargeCents: 0, refundCents: 1, tier: 'half' });
  });
});

describe('Zero-amount edge case', () => {
  it('originalAuthorizedCents=0 → both 0 across every tier', () => {
    for (const offsetHours of [48, 12, 1, -1]) {
      const r = calculateCancellation({
        originalAuthorizedCents: 0,
        bookingStartAt: START,
        cancellationAt: at(offsetHours * 60 * 60 * 1000),
        cancelledBy: 'parent',
      });
      expect(r.chargeCents).toBe(0);
      expect(r.refundCents).toBe(0);
    }
  });
});

describe('Input validation', () => {
  it('throws on negative originalAuthorizedCents', () => {
    expect(() =>
      calculateCancellation({
        originalAuthorizedCents: -1,
        bookingStartAt: START,
        cancellationAt: START,
        cancelledBy: 'parent',
      }),
    ).toThrow(/non-negative integer/);
  });

  it('throws on non-integer originalAuthorizedCents', () => {
    expect(() =>
      calculateCancellation({
        originalAuthorizedCents: 12.5,
        bookingStartAt: START,
        cancellationAt: START,
        cancelledBy: 'parent',
      }),
    ).toThrow(/non-negative integer/);
  });

  it('throws on invalid Dates', () => {
    expect(() =>
      calculateCancellation({
        originalAuthorizedCents: 100,
        bookingStartAt: new Date('not-a-date'),
        cancellationAt: START,
        cancelledBy: 'parent',
      }),
    ).toThrow(/valid Dates/);
  });
});

describe('Property-based — calculateCancellation', () => {
  const cancellationPartyArb = fc.constantFrom(...CANCELLATION_PARTIES);
  const originalArb = fc.integer({ min: 0, max: 1_000_000_000 });
  const startArb = fc
    .date({ min: new Date('2026-01-01T00:00:00Z'), max: new Date('2027-01-01T00:00:00Z') })
    .filter((d) => !Number.isNaN(d.getTime()));
  // Offset can be positive (before start) or negative (after start)
  const offsetMsArb = fc.integer({ min: -7 * 24 * 60 * 60 * 1000, max: 7 * 24 * 60 * 60 * 1000 });

  it('always returns a declared tier and integer cents that sum to the original', () => {
    fc.assert(
      fc.property(originalArb, startArb, offsetMsArb, cancellationPartyArb, (original, start, offsetMs, cancelledBy) => {
        const r = calculateCancellation({
          originalAuthorizedCents: original,
          bookingStartAt: start,
          cancellationAt: new Date(start.getTime() - offsetMs),
          cancelledBy,
        });
        expect(CANCELLATION_TIERS).toContain(r.tier);
        expect(Number.isInteger(r.chargeCents)).toBe(true);
        expect(Number.isInteger(r.refundCents)).toBe(true);
        expect(r.chargeCents).toBeGreaterThanOrEqual(0);
        expect(r.refundCents).toBeGreaterThanOrEqual(0);
        expect(r.chargeCents + r.refundCents).toBe(original);
      }),
    );
  });

  it('provider-initiated always lands in the free tier with a full refund', () => {
    fc.assert(
      fc.property(originalArb, startArb, offsetMsArb, (original, start, offsetMs) => {
        const r = calculateCancellation({
          originalAuthorizedCents: original,
          bookingStartAt: start,
          cancellationAt: new Date(start.getTime() - offsetMs),
          cancelledBy: 'provider',
        });
        expect(r.tier).toBe('free');
        expect(r.refundCents).toBe(original);
        expect(r.chargeCents).toBe(0);
      }),
    );
  });

  it('parent-initiated, cancellation ≥24h before start → tier=free', () => {
    fc.assert(
      fc.property(
        originalArb,
        startArb,
        fc.integer({
          min: CANCELLATION_FREE_THRESHOLD_MS,
          max: 30 * 24 * 60 * 60 * 1000,
        }),
        (original, start, offsetMs) => {
          const r = calculateCancellation({
            originalAuthorizedCents: original,
            bookingStartAt: start,
            cancellationAt: new Date(start.getTime() - offsetMs),
            cancelledBy: 'parent',
          });
          expect(r.tier).toBe('free');
          expect(r.refundCents).toBe(original);
        },
      ),
    );
  });

  it('parent-initiated, in half tier — charge is floor(original/2), refund covers the rest', () => {
    fc.assert(
      fc.property(
        originalArb,
        startArb,
        fc.integer({
          min: CANCELLATION_HALF_THRESHOLD_MS,
          max: CANCELLATION_FREE_THRESHOLD_MS - 1,
        }),
        (original, start, offsetMs) => {
          const r = calculateCancellation({
            originalAuthorizedCents: original,
            bookingStartAt: start,
            cancellationAt: new Date(start.getTime() - offsetMs),
            cancelledBy: 'parent',
          });
          expect(r.tier).toBe('half');
          expect(r.chargeCents).toBe(Math.floor(original / 2));
          expect(r.refundCents).toBe(original - Math.floor(original / 2));
        },
      ),
    );
  });

  it('parent-initiated, inside 2h or after start → tier=full, charge=original', () => {
    fc.assert(
      fc.property(
        originalArb,
        startArb,
        fc.integer({ min: -30 * 24 * 60 * 60 * 1000, max: CANCELLATION_HALF_THRESHOLD_MS - 1 }),
        (original, start, offsetMs) => {
          const r = calculateCancellation({
            originalAuthorizedCents: original,
            bookingStartAt: start,
            cancellationAt: new Date(start.getTime() - offsetMs),
            cancelledBy: 'parent',
          });
          expect(r.tier).toBe('full');
          expect(r.chargeCents).toBe(original);
          expect(r.refundCents).toBe(0);
        },
      ),
    );
  });

  it('determinism — identical inputs always produce identical outputs', () => {
    fc.assert(
      fc.property(originalArb, startArb, offsetMsArb, cancellationPartyArb, (original, start, offsetMs, cancelledBy) => {
        const input: CancellationInput = {
          originalAuthorizedCents: original,
          bookingStartAt: start,
          cancellationAt: new Date(start.getTime() - offsetMs),
          cancelledBy,
        };
        expect(calculateCancellation(input)).toEqual(calculateCancellation(input));
      }),
    );
  });
});
