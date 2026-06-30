import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { ScoredCandidate } from '../search-ranking/index.js';
import {
  categoryKeyOf,
  ctasForRole,
  DEFAULT_PREVIEW_FULL_PER_CATEGORY,
  hasOverlap,
  haversineMiles,
  matchesAgeBands,
  matchesBehaviourComfort,
  passesMinRating,
  passesRateCeiling,
  projectPreviewWall,
  rankAndProject,
  SEARCH_MODULE_VERSION,
  toBlurred,
  withinRadius,
  type SupplyCard,
} from './index.js';

const NOW = new Date('2026-06-30T12:00:00.000Z');

function card(overrides: Partial<SupplyCard> = {}): SupplyCard {
  return {
    id: 'c1',
    distanceMiles: 1,
    ratingAverage: 0,
    lastActiveAt: NOW,
    role: 'caregiver',
    categoryKey: 'tutor',
    displayName: 'Maya Okafor',
    headline: 'K–8 math',
    photoUrl: 'https://cdn/avatar/maya.png',
    zip: '78701',
    areaLabel: 'Austin, TX',
    fromRateCents: 3500,
    negotiable: true,
    categories: ['tutor'],
    specialty: null,
    agesServed: ['school-age'],
    behaviourComfort: [],
    taxCreditFriendly: false,
    fcchBadge: false,
    availabilitySummary: 'Weekdays, afternoons',
    ratingCount: 0,
    ...overrides,
  };
}

const scored = (c: SupplyCard): ScoredCandidate<SupplyCard> => ({
  candidate: c,
  score: 0,
  components: { proximity: 0, rating: 0, recency: 0 },
});

describe('module version', () => {
  it('is the OH-201 tag', () => {
    expect(SEARCH_MODULE_VERSION).toBe('0.1.0-OH-201');
  });
});

describe('haversineMiles', () => {
  const austin = { lat: 30.2672, lng: -97.7431 };
  const dallas = { lat: 32.7767, lng: -96.797 };

  it('is 0 for identical points', () => {
    expect(haversineMiles(austin, austin)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineMiles(austin, dallas)).toBeCloseTo(haversineMiles(dallas, austin), 9);
  });

  it('approximates a known city distance (Austin↔Dallas ≈ 182 mi)', () => {
    expect(haversineMiles(austin, dallas)).toBeGreaterThan(175);
    expect(haversineMiles(austin, dallas)).toBeLessThan(190);
  });

  it('≈ 69 miles per degree of latitude', () => {
    expect(haversineMiles({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(69, 0);
  });

  it('withinRadius respects the bound (inclusive)', () => {
    expect(withinRadius(austin, austin, 5)).toBe(true);
    expect(withinRadius(austin, dallas, 5)).toBe(false);
    expect(withinRadius(austin, dallas, 500)).toBe(true);
  });

  it('property: distance is always ≥ 0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -89, max: 89, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        fc.double({ min: -89, max: 89, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        (la, lo, lb, lob) => {
          expect(haversineMiles({ lat: la, lng: lo }, { lat: lb, lng: lob })).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe('set-overlap predicates', () => {
  it('hasOverlap: empty request is no constraint', () => {
    expect(hasOverlap([], [])).toBe(true);
    expect(hasOverlap(['a'], [])).toBe(true);
  });
  it('hasOverlap: matches on any shared member', () => {
    expect(hasOverlap(['a', 'b'], ['b', 'c'])).toBe(true);
    expect(hasOverlap(['a'], ['b'])).toBe(false);
  });
  it('hasOverlap: a candidate advertising nothing fails a non-empty request', () => {
    expect(hasOverlap([], ['b'])).toBe(false);
  });
  it('matchesAgeBands / matchesBehaviourComfort delegate to overlap', () => {
    expect(matchesAgeBands(['toddler', 'teen'], ['teen'])).toBe(true);
    expect(matchesAgeBands(['toddler'], ['teen'])).toBe(false);
    expect(matchesBehaviourComfort(['aggression'], ['aggression', 'pica'])).toBe(true);
    expect(matchesBehaviourComfort(['meltdowns'], ['aggression'])).toBe(false);
  });
});

describe('passesMinRating (cold-start rule)', () => {
  it('floor of 0 (or below) is no constraint', () => {
    expect(passesMinRating(0, 0, 0)).toBe(true);
    expect(passesMinRating(2, 10, -1)).toBe(true);
  });
  it('unrated supply always passes a positive floor', () => {
    expect(passesMinRating(0, 0, 4)).toBe(true);
  });
  it('rated supply is held to the floor', () => {
    expect(passesMinRating(4.5, 12, 4)).toBe(true);
    expect(passesMinRating(3.2, 12, 4)).toBe(false);
    expect(passesMinRating(4, 1, 4)).toBe(true);
  });
});

describe('passesRateCeiling', () => {
  it('no ceiling is no constraint', () => {
    expect(passesRateCeiling(9999, null)).toBe(true);
  });
  it('unpriced supply passes (cold start)', () => {
    expect(passesRateCeiling(null, 4500)).toBe(true);
  });
  it('compares the from-rate to the ceiling', () => {
    expect(passesRateCeiling(3500, 4500)).toBe(true);
    expect(passesRateCeiling(4500, 4500)).toBe(true);
    expect(passesRateCeiling(5000, 4500)).toBe(false);
  });
});

describe('categoryKeyOf', () => {
  it('buckets all Providers under "provider"', () => {
    expect(categoryKeyOf({ role: 'provider', categories: [], specialty: 'slp' })).toBe('provider');
  });
  it('buckets a Caregiver under its primary category', () => {
    expect(categoryKeyOf({ role: 'caregiver', categories: ['nanny', 'babysitter'], specialty: null })).toBe('nanny');
  });
  it('falls back to "caregiver" when no category is set', () => {
    expect(categoryKeyOf({ role: 'caregiver', categories: [], specialty: null })).toBe('caregiver');
  });
});

describe('ctasForRole', () => {
  it('Caregiver → Message + Book; Provider → Book-a-consultation', () => {
    expect(ctasForRole('caregiver')).toEqual(['message', 'book']);
    expect(ctasForRole('provider')).toEqual(['book-consultation']);
  });
});

describe('toBlurred (privacy boundary)', () => {
  it('drops every identifying / locating field', () => {
    const blurred = toBlurred(card({ id: 'c9', zip: '78701', displayName: 'Maya Okafor' }));
    expect(blurred).toEqual({
      id: 'c9',
      role: 'caregiver',
      categoryKey: 'tutor',
      categories: ['tutor'],
      specialty: null,
      areaLabel: 'Austin, TX',
      fromRateCents: 3500,
      ratingAverage: 0,
      ratingCount: 0,
      taxCreditFriendly: false,
      fcchBadge: false,
      locked: true,
    });
    // No leakage of name/photo/exact-zip/distance/availability.
    expect(Object.keys(blurred)).not.toContain('displayName');
    expect(Object.keys(blurred)).not.toContain('photoUrl');
    expect(Object.keys(blurred)).not.toContain('zip');
    expect(Object.keys(blurred)).not.toContain('distanceMiles');
    expect(Object.keys(blurred)).not.toContain('availabilitySummary');
  });
});

describe('projectPreviewWall', () => {
  const ranked = [
    scored(card({ id: 't1', categoryKey: 'tutor' })),
    scored(card({ id: 't2', categoryKey: 'tutor' })),
    scored(card({ id: 't3', categoryKey: 'tutor' })),
    scored(card({ id: 'b1', categoryKey: 'babysitter', role: 'caregiver', categories: ['babysitter'] })),
    scored(card({ id: 'p1', categoryKey: 'provider', role: 'provider', categories: [], specialty: 'slp' })),
    scored(card({ id: 'p2', categoryKey: 'provider', role: 'provider', categories: [], specialty: 'ot' })),
    scored(card({ id: 'p3', categoryKey: 'provider', role: 'provider', categories: [], specialty: 'aba' })),
  ];

  it('entitled → every result is full, none blurred', () => {
    const wall = projectPreviewWall(ranked, { entitled: true });
    expect(wall.entitled).toBe(true);
    expect(wall.total).toBe(7);
    expect(wall.fullCount).toBe(7);
    expect(wall.blurredCount).toBe(0);
    expect(wall.items.every((i) => i.kind === 'full')).toBe(true);
  });

  it('free browse → top 2 per category full, rest blurred, order preserved', () => {
    const wall = projectPreviewWall(ranked, { entitled: false });
    expect(wall.entitled).toBe(false);
    expect(wall.total).toBe(7);
    // tutor: t1,t2 full, t3 blurred; babysitter: b1 full; provider: p1,p2 full, p3 blurred.
    expect(wall.fullCount).toBe(5);
    expect(wall.blurredCount).toBe(2);
    const kindsById = Object.fromEntries(wall.items.map((i) => [i.card.id, i.kind]));
    expect(kindsById).toMatchObject({
      t1: 'full',
      t2: 'full',
      t3: 'blurred',
      b1: 'full',
      p1: 'full',
      p2: 'full',
      p3: 'blurred',
    });
    // rank order is preserved exactly.
    expect(wall.items.map((i) => i.card.id)).toEqual(['t1', 't2', 't3', 'b1', 'p1', 'p2', 'p3']);
  });

  it('respects a custom fullPerCategory (1 full per category)', () => {
    const wall = projectPreviewWall(ranked, { entitled: false, fullPerCategory: 1 });
    expect(wall.fullCount).toBe(3); // one tutor, one babysitter, one provider
    expect(wall.blurredCount).toBe(4);
    const kindsById = Object.fromEntries(wall.items.map((i) => [i.card.id, i.kind]));
    expect(kindsById).toMatchObject({ t1: 'full', t2: 'blurred', b1: 'full', p1: 'full', p2: 'blurred' });
  });

  it('blurred items are teaser cards (no displayName), full items are SupplyCards', () => {
    const wall = projectPreviewWall(ranked, { entitled: false });
    const blurred = wall.items.find((i) => i.card.id === 't3')!;
    const full = wall.items.find((i) => i.card.id === 't1')!;
    expect(blurred.kind).toBe('blurred');
    expect('locked' in blurred.card && blurred.card.locked).toBe(true);
    expect('displayName' in blurred.card).toBe(false);
    expect(full.kind).toBe('full');
    expect('displayName' in full.card).toBe(true);
  });

  it('empty results → empty wall', () => {
    expect(projectPreviewWall([], { entitled: false })).toMatchObject({ total: 0, fullCount: 0, blurredCount: 0, items: [] });
  });

  it('default reveal count is 2', () => {
    expect(DEFAULT_PREVIEW_FULL_PER_CATEGORY).toBe(2);
  });
});

describe('rankAndProject', () => {
  it('ranks (closest/highest first) then walls in one call', () => {
    const far = card({ id: 'far', distanceMiles: 4, ratingAverage: 5, ratingCount: 9, categoryKey: 'tutor' });
    const near = card({ id: 'near', distanceMiles: 0, ratingAverage: 5, ratingCount: 9, categoryKey: 'tutor' });
    const wall = rankAndProject([far, near], { now: NOW, radiusMiles: 5 }, { entitled: false, fullPerCategory: 1 });
    // near outranks far → near is the full reveal, far is blurred.
    expect(wall.items[0]!.card.id).toBe('near');
    expect(wall.items[0]!.kind).toBe('full');
    expect(wall.items[1]!.card.id).toBe('far');
    expect(wall.items[1]!.kind).toBe('blurred');
  });
});
