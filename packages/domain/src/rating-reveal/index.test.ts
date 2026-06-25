import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  canSubmitRating,
  isRevealed,
  isValidStars,
  isWindowOpen,
  projectParentRatingForSupply,
  projectPublicSupplyRating,
  RATING_REVEAL_MODULE_VERSION,
  RATING_WINDOW_DAYS,
  revealExchange,
  windowClosesAt,
  type Rating,
  type RatingExchange,
} from './index.js';

const DAY_MS = 86_400_000;
const COMPLETED = new Date('2026-06-01T12:00:00.000Z');
const OPEN_NOW = new Date(COMPLETED.getTime() + 5 * DAY_MS); // 5d in — window open
const CLOSED_NOW = new Date(COMPLETED.getTime() + 15 * DAY_MS); // 15d in — window closed

function rating(stars: number, text?: string): Rating {
  return { stars, text, submittedAt: OPEN_NOW };
}

const PARENT_R = rating(5, 'Wonderful with my toddler');
const SUPPLY_R = rating(4, 'Lovely family, clear communication');

function exchange(overrides?: Partial<RatingExchange>): RatingExchange {
  return { completedAt: COMPLETED, ...overrides };
}

describe('window helpers', () => {
  it('window closes 14 days after completion', () => {
    expect(windowClosesAt(COMPLETED).getTime()).toBe(
      COMPLETED.getTime() + RATING_WINDOW_DAYS * DAY_MS,
    );
  });

  it('is open before the edge, closed at/after it', () => {
    expect(isWindowOpen(exchange(), OPEN_NOW)).toBe(true);
    expect(isWindowOpen(exchange(), CLOSED_NOW)).toBe(false);
    expect(isWindowOpen(exchange(), windowClosesAt(COMPLETED))).toBe(false); // exclusive
  });

  it('submission is gated to the open window', () => {
    expect(canSubmitRating(exchange(), OPEN_NOW)).toBe(true);
    expect(canSubmitRating(exchange(), CLOSED_NOW)).toBe(false);
  });
});

describe('isValidStars', () => {
  it.each([1, 2, 3, 4, 5])('accepts %i', (s) => expect(isValidStars(s)).toBe(true));
  it.each([0, 6, 2.5, -1, NaN])('rejects %p', (s) => expect(isValidStars(s)).toBe(false));
});

describe('revealExchange — the four submission × window combos', () => {
  it('both submitted + window OPEN → revealed (mutual reveal on 2nd submit)', () => {
    const r = revealExchange(exchange({ parentToSupply: PARENT_R, supplyToParent: SUPPLY_R }), OPEN_NOW);
    expect(r.revealed).toBe(true);
    expect(r.parentToSupply).toEqual(PARENT_R);
    expect(r.supplyToParent).toEqual(SUPPLY_R);
  });

  it('one submitted + window OPEN → BLIND (nothing revealed yet)', () => {
    const r = revealExchange(exchange({ parentToSupply: PARENT_R }), OPEN_NOW);
    expect(r.revealed).toBe(false);
    expect(r.parentToSupply).toBeNull();
    expect(r.supplyToParent).toBeNull();
  });

  it('both submitted + window CLOSED → revealed', () => {
    const r = revealExchange(exchange({ parentToSupply: PARENT_R, supplyToParent: SUPPLY_R }), CLOSED_NOW);
    expect(r.revealed).toBe(true);
  });

  it('one submitted + window CLOSED → revealed (the submitted one shows; the other stays null)', () => {
    const r = revealExchange(exchange({ parentToSupply: PARENT_R }), CLOSED_NOW);
    expect(r.revealed).toBe(true);
    expect(r.parentToSupply).toEqual(PARENT_R);
    expect(r.supplyToParent).toBeNull();
  });

  it('none submitted: blind while open, revealed-but-empty once closed', () => {
    expect(isRevealed(exchange(), OPEN_NOW)).toBe(false);
    expect(isRevealed(exchange(), CLOSED_NOW)).toBe(true);
  });
});

describe('public supply profile surface (Parent → supply, full text)', () => {
  it('shows aggregate + count + full text once revealed', () => {
    const exchanges = [
      exchange({ parentToSupply: rating(5, 'A+'), supplyToParent: SUPPLY_R }),
      exchange({ parentToSupply: rating(3, 'Late once'), supplyToParent: SUPPLY_R }),
    ];
    const d = projectPublicSupplyRating(exchanges, OPEN_NOW);
    expect(d.count).toBe(2);
    expect(d.averageStars).toBe(4);
    expect(d.items).toEqual([
      { stars: 5, text: 'A+' },
      { stars: 3, text: 'Late once' },
    ]);
  });

  it('blind: one-sided + open contributes nothing', () => {
    const d = projectPublicSupplyRating([exchange({ parentToSupply: PARENT_R })], OPEN_NOW);
    expect(d).toEqual({ count: 0, averageStars: null, items: [] });
  });

  it('window close reveals a one-sided parent rating', () => {
    const d = projectPublicSupplyRating([exchange({ parentToSupply: PARENT_R })], CLOSED_NOW);
    expect(d.count).toBe(1);
    expect(d.items[0]).toEqual({ stars: 5, text: 'Wonderful with my toddler' });
  });

  it('a rating under active Dispute is WITHHELD from public display', () => {
    const exchanges = [
      exchange({ parentToSupply: rating(5, 'great'), supplyToParent: SUPPLY_R }),
      exchange({ parentToSupply: rating(1, 'billing fight'), supplyToParent: SUPPLY_R, disputeActive: true }),
    ];
    const d = projectPublicSupplyRating(exchanges, OPEN_NOW);
    expect(d.count).toBe(1);
    expect(d.averageStars).toBe(5);
    expect(d.items).toEqual([{ stars: 5, text: 'great' }]);
  });
});

describe('supply-only parent surface (supply → Parent, aggregate only)', () => {
  it('shows aggregate + count and NO text field at all', () => {
    const exchanges = [
      exchange({ parentToSupply: PARENT_R, supplyToParent: rating(4, 'private note') }),
      exchange({ parentToSupply: PARENT_R, supplyToParent: rating(2, 'late payment') }),
    ];
    const d = projectParentRatingForSupply(exchanges, OPEN_NOW);
    expect(d).toEqual({ count: 2, averageStars: 3 });
    // No leakage of parent-rating text through this surface.
    expect(Object.keys(d).sort()).toEqual(['averageStars', 'count']);
    expect(JSON.stringify(d)).not.toContain('private note');
    expect(JSON.stringify(d)).not.toContain('late payment');
  });

  it('blind: one-sided + open contributes nothing', () => {
    const d = projectParentRatingForSupply([exchange({ supplyToParent: SUPPLY_R })], OPEN_NOW);
    expect(d).toEqual({ count: 0, averageStars: null });
  });

  it('dispute-withholding is a PUBLIC rule — it does NOT hide the supply-internal aggregate', () => {
    const exchanges = [
      exchange({ parentToSupply: PARENT_R, supplyToParent: rating(2), disputeActive: true }),
    ];
    const d = projectParentRatingForSupply(exchanges, OPEN_NOW);
    expect(d).toEqual({ count: 1, averageStars: 2 });
  });
});

describe('properties (fast-check)', () => {
  const arbRating = fc.record({ stars: fc.integer({ min: 1, max: 5 }) }).map(
    (r): Rating => ({ stars: r.stars, submittedAt: OPEN_NOW }),
  );
  const arbExchange = fc
    .record({
      parent: fc.option(arbRating, { nil: undefined }),
      supply: fc.option(arbRating, { nil: undefined }),
      dispute: fc.boolean(),
    })
    .map(
      (x): RatingExchange => ({
        completedAt: COMPLETED,
        parentToSupply: x.parent,
        supplyToParent: x.supply,
        disputeActive: x.dispute,
      }),
    );

  it('both-submitted ⇒ revealed at any time (even within the open window)', () => {
    fc.assert(
      fc.property(arbRating, arbRating, fc.date(), (p, s, now) => {
        expect(isRevealed({ completedAt: COMPLETED, parentToSupply: p, supplyToParent: s }, now)).toBe(true);
      }),
    );
  });

  it('after window close everything is revealed regardless of submissions', () => {
    fc.assert(
      fc.property(arbExchange, (ex) => {
        expect(isRevealed(ex, CLOSED_NOW)).toBe(true);
      }),
    );
  });

  it('public average lies within [1, 5] whenever any rating is shown', () => {
    fc.assert(
      fc.property(fc.array(arbExchange, { maxLength: 20 }), (exchanges) => {
        const d = projectPublicSupplyRating(exchanges, CLOSED_NOW);
        if (d.count > 0) {
          expect(d.averageStars!).toBeGreaterThanOrEqual(1);
          expect(d.averageStars!).toBeLessThanOrEqual(5);
        } else {
          expect(d.averageStars).toBeNull();
        }
      }),
    );
  });

  it('public display never includes a dispute-withheld exchange', () => {
    fc.assert(
      fc.property(fc.array(arbExchange, { maxLength: 20 }), (exchanges) => {
        const disputedShown = exchanges.filter((e) => e.disputeActive && e.parentToSupply).length;
        const allShown = projectPublicSupplyRating(exchanges, CLOSED_NOW).count;
        const nonDisputedShown = exchanges.filter((e) => !e.disputeActive && e.parentToSupply).length;
        expect(allShown).toBe(nonDisputedShown);
        // sanity: withheld ones really were excluded
        expect(allShown).toBeLessThanOrEqual(nonDisputedShown + disputedShown);
      }),
    );
  });
});

describe('module version', () => {
  it('is bumped for OH-180', () => {
    expect(RATING_REVEAL_MODULE_VERSION).toBe('0.2.0-OH-180');
  });
});
