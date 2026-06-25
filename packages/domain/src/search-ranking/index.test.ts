import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SEARCH_RADIUS_MILES,
  proximityScore,
  rankCandidates,
  ratingScore,
  recencyScore,
  RECENCY_WINDOW_DAYS,
  scoreCandidate,
  SEARCH_RANKING_MODULE_VERSION,
  SEARCH_RANKING_WEIGHTS,
  type RankingCandidate,
} from './index.js';

const NOW = new Date('2026-06-25T12:00:00.000Z');
const DAY_MS = 86_400_000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY_MS);

function candidate(overrides?: Partial<RankingCandidate>): RankingCandidate {
  return {
    id: 'c',
    distanceMiles: 0,
    ratingAverage: 5,
    lastActiveAt: NOW,
    ...overrides,
  };
}

describe('weights', () => {
  it('sum to 1 (so the score lands in [0, 1])', () => {
    const { proximity, rating, recency } = SEARCH_RANKING_WEIGHTS;
    expect(proximity + rating + recency).toBeCloseTo(1, 10);
  });

  it('match the CONTEXT.md hybrid: 0.5 / 0.3 / 0.2', () => {
    expect(SEARCH_RANKING_WEIGHTS).toEqual({ proximity: 0.5, rating: 0.3, recency: 0.2 });
  });
});

describe('proximityScore', () => {
  it('is 1 at the centroid, 0 at the radius, 0.5 at half-radius', () => {
    expect(proximityScore(0)).toBe(1);
    expect(proximityScore(DEFAULT_SEARCH_RADIUS_MILES)).toBe(0);
    expect(proximityScore(DEFAULT_SEARCH_RADIUS_MILES / 2)).toBeCloseTo(0.5, 10);
  });

  it('clamps to 0 beyond the radius', () => {
    expect(proximityScore(DEFAULT_SEARCH_RADIUS_MILES * 3)).toBe(0);
  });

  it('honours a custom radius', () => {
    expect(proximityScore(5, 10)).toBeCloseTo(0.5, 10);
  });

  it('throws on a non-positive radius (caller bug)', () => {
    expect(() => proximityScore(1, 0)).toThrow(/radiusMiles must be > 0/);
    expect(() => proximityScore(1, -2)).toThrow(/radiusMiles must be > 0/);
  });
});

describe('ratingScore', () => {
  it('normalises stars / 5', () => {
    expect(ratingScore(5)).toBe(1);
    expect(ratingScore(0)).toBe(0); // unrated cold start
    expect(ratingScore(2.5)).toBeCloseTo(0.5, 10);
  });
});

describe('recencyScore', () => {
  it('is 1 now, 0 at the 7-day window edge, 0.5 mid-window', () => {
    expect(recencyScore(NOW, NOW)).toBe(1);
    expect(recencyScore(daysAgo(RECENCY_WINDOW_DAYS), NOW)).toBe(0);
    expect(recencyScore(daysAgo(RECENCY_WINDOW_DAYS / 2), NOW)).toBeCloseTo(0.5, 10);
  });

  it('clamps to 0 past the window and to 1 for a future timestamp', () => {
    expect(recencyScore(daysAgo(30), NOW)).toBe(0);
    expect(recencyScore(new Date(NOW.getTime() + DAY_MS), NOW)).toBe(1);
  });
});

describe('scoreCandidate', () => {
  it('combines components by weight', () => {
    // distance 2.5mi (prox 0.5), rating 4 (0.8), idle 3.5d (recency 0.5)
    const s = scoreCandidate(
      candidate({ distanceMiles: 2.5, ratingAverage: 4, lastActiveAt: daysAgo(3.5) }),
      { now: NOW },
    );
    expect(s.components.proximity).toBeCloseTo(0.5, 10);
    expect(s.components.rating).toBeCloseTo(0.8, 10);
    expect(s.components.recency).toBeCloseTo(0.5, 10);
    // 0.5*0.5 + 0.3*0.8 + 0.2*0.5 = 0.25 + 0.24 + 0.10 = 0.59
    expect(s.score).toBeCloseTo(0.59, 10);
  });

  it('a perfect candidate scores 1; a worst-case candidate scores 0', () => {
    expect(scoreCandidate(candidate(), { now: NOW }).score).toBe(1);
    const worst = candidate({ distanceMiles: 100, ratingAverage: 0, lastActiveAt: daysAgo(60) });
    expect(scoreCandidate(worst, { now: NOW }).score).toBe(0);
  });
});

describe('rankCandidates — ordering', () => {
  it('sorts by score, highest first', () => {
    const near = candidate({ id: 'near', distanceMiles: 0 });
    const far = candidate({ id: 'far', distanceMiles: 4.9 });
    const ranked = rankCandidates([far, near], { now: NOW });
    expect(ranked.map((r) => r.candidate.id)).toEqual(['near', 'far']);
  });

  it('no-match: an empty candidate list yields an empty ranking', () => {
    expect(rankCandidates([], { now: NOW })).toEqual([]);
  });
});

describe('rankCandidates — stability + ties (AC)', () => {
  it('ties preserve input order (stable sort)', () => {
    // Three identically-scoring candidates — order must be A, B, C as supplied.
    const a = candidate({ id: 'A' });
    const b = candidate({ id: 'B' });
    const c = candidate({ id: 'C' });
    const ranked = rankCandidates([a, b, c], { now: NOW });
    expect(ranked.map((r) => r.candidate.id)).toEqual(['A', 'B', 'C']);
    expect(ranked.every((r) => r.score === 1)).toBe(true);
  });

  it('a top scorer leads; the tied remainder keeps input order', () => {
    const top = candidate({ id: 'top', distanceMiles: 0 }); // score 1
    const midB = candidate({ id: 'midB', distanceMiles: 2.5, ratingAverage: 5, lastActiveAt: NOW });
    const midC = candidate({ id: 'midC', distanceMiles: 2.5, ratingAverage: 5, lastActiveAt: NOW });
    const ranked = rankCandidates([midB, top, midC], { now: NOW });
    expect(ranked.map((r) => r.candidate.id)).toEqual(['top', 'midB', 'midC']);
    expect(ranked[1]!.score).toBe(ranked[2]!.score); // midB and midC tie
  });
});

describe('properties (fast-check)', () => {
  const arbCandidate = fc.record({
    distanceMiles: fc.double({ min: 0, max: 20, noNaN: true }),
    ratingAverage: fc.double({ min: 0, max: 5, noNaN: true }),
    ageDays: fc.double({ min: 0, max: 14, noNaN: true }),
  });

  const arbCandidates = fc.array(arbCandidate, { maxLength: 30 }).map((rows) =>
    rows.map((r, i) => ({
      id: String(i), // id encodes the input index
      distanceMiles: r.distanceMiles,
      ratingAverage: r.ratingAverage,
      lastActiveAt: daysAgo(r.ageDays),
    })),
  );

  it('every score lands in [0, 1] and equals the weighted component sum', () => {
    fc.assert(
      fc.property(arbCandidates, (cands) => {
        for (const s of rankCandidates(cands, { now: NOW })) {
          expect(s.score).toBeGreaterThanOrEqual(0);
          expect(s.score).toBeLessThanOrEqual(1);
          const expected =
            SEARCH_RANKING_WEIGHTS.proximity * s.components.proximity +
            SEARCH_RANKING_WEIGHTS.rating * s.components.rating +
            SEARCH_RANKING_WEIGHTS.recency * s.components.recency;
          expect(s.score).toBeCloseTo(expected, 12);
        }
      }),
    );
  });

  it('output is a permutation of input, ordered by non-increasing score', () => {
    fc.assert(
      fc.property(arbCandidates, (cands) => {
        const ranked = rankCandidates(cands, { now: NOW });
        expect(ranked).toHaveLength(cands.length);
        expect(new Set(ranked.map((r) => r.candidate.id))).toEqual(
          new Set(cands.map((c) => c.id)),
        );
        for (let i = 1; i < ranked.length; i += 1) {
          expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
        }
      }),
    );
  });

  it('stability: equal-score neighbours keep ascending input index', () => {
    fc.assert(
      fc.property(arbCandidates, (cands) => {
        const ranked = rankCandidates(cands, { now: NOW });
        for (let i = 1; i < ranked.length; i += 1) {
          if (ranked[i - 1]!.score === ranked[i]!.score) {
            expect(Number(ranked[i - 1]!.candidate.id)).toBeLessThan(
              Number(ranked[i]!.candidate.id),
            );
          }
        }
      }),
    );
  });
});

describe('module version', () => {
  it('is bumped for OH-180', () => {
    expect(SEARCH_RANKING_MODULE_VERSION).toBe('0.2.0-OH-180');
  });
});
