import { describe, expect, it } from 'vitest';

import {
  AGE_BANDS,
  SAFETY_BEHAVIORS,
  isAgeBand,
  isSafetyBehavior,
  normaliseAgeBands,
  normaliseSafetyBehaviors,
} from '@our-haven/shared';

import type { Credential } from '../credentials/index.js';

import {
  SURCHARGE_ELIGIBLE_CATEGORIES,
  counterAllowed,
  fromRateCents,
  isSurchargeEligible,
  publicCredentials,
  publishedRateForCategory,
  sanitiseCategoryRate,
  validateCategoryRates,
  type CategoryRate,
} from './index.js';

describe('surcharge eligibility', () => {
  it('is Babysitter / Nanny only — Tutor is single-child, no surcharge', () => {
    expect(isSurchargeEligible('babysitter')).toBe(true);
    expect(isSurchargeEligible('nanny')).toBe(true);
    expect(isSurchargeEligible('tutor')).toBe(false);
    expect([...SURCHARGE_ELIGIBLE_CATEGORIES]).toEqual(['babysitter', 'nanny']);
  });
});

describe('sanitiseCategoryRate', () => {
  it('accepts a Babysitter rate with a surcharge', () => {
    expect(
      sanitiseCategoryRate({ category: 'babysitter', publishedRateCents: 2500, perChildSurchargeCents: 500 }),
    ).toEqual({ ok: true, rate: { category: 'babysitter', publishedRateCents: 2500, perChildSurchargeCents: 500 } });
  });

  it('defaults an unset surcharge to null', () => {
    expect(sanitiseCategoryRate({ category: 'tutor', publishedRateCents: 4000 })).toEqual({
      ok: true,
      rate: { category: 'tutor', publishedRateCents: 4000, perChildSurchargeCents: null },
    });
  });

  it('rejects a surcharge on a Tutor rate', () => {
    const res = sanitiseCategoryRate({ category: 'tutor', publishedRateCents: 4000, perChildSurchargeCents: 500 });
    expect(res.ok).toBe(false);
  });

  it('rejects an unknown category', () => {
    expect(sanitiseCategoryRate({ category: 'chef', publishedRateCents: 2500 }).ok).toBe(false);
  });

  it('rejects a negative or non-integer rate', () => {
    expect(sanitiseCategoryRate({ category: 'nanny', publishedRateCents: -1 }).ok).toBe(false);
    expect(sanitiseCategoryRate({ category: 'nanny', publishedRateCents: 12.5 }).ok).toBe(false);
  });

  it('rejects a negative surcharge', () => {
    expect(
      sanitiseCategoryRate({ category: 'nanny', publishedRateCents: 2500, perChildSurchargeCents: -5 }).ok,
    ).toBe(false);
  });
});

describe('validateCategoryRates', () => {
  it('rejects a rate for a category the Caregiver does not offer', () => {
    const res = validateCategoryRates([{ category: 'nanny', publishedRateCents: 2500 }], ['babysitter', 'tutor']);
    expect(res.ok).toBe(false);
  });

  it('rejects a duplicate category', () => {
    const res = validateCategoryRates(
      [
        { category: 'babysitter', publishedRateCents: 2500 },
        { category: 'babysitter', publishedRateCents: 3000 },
      ],
      ['babysitter'],
    );
    expect(res.ok).toBe(false);
  });

  it('accepts a partial set and returns rates in canonical category order', () => {
    const res = validateCategoryRates(
      [
        { category: 'nanny', publishedRateCents: 3000 },
        { category: 'babysitter', publishedRateCents: 2500, perChildSurchargeCents: 400 },
      ],
      ['babysitter', 'tutor', 'nanny'],
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rates.map((r) => r.category)).toEqual(['babysitter', 'nanny']);
    }
  });
});

describe('fromRateCents / publishedRateForCategory', () => {
  const rates: CategoryRate[] = [
    { category: 'babysitter', publishedRateCents: 2500, perChildSurchargeCents: 400 },
    { category: 'nanny', publishedRateCents: 3000, perChildSurchargeCents: null },
  ];

  it('"from $X" is the lowest published rate', () => {
    expect(fromRateCents(rates)).toBe(2500);
  });

  it('is null when no category is priced', () => {
    expect(fromRateCents([])).toBeNull();
  });

  it('returns the rate for a specific category, null when unpriced', () => {
    expect(publishedRateForCategory(rates, 'nanny')).toBe(3000);
    expect(publishedRateForCategory(rates, 'tutor')).toBeNull();
  });
});

describe('negotiable gate (ADR-0017)', () => {
  it('Counter is offered only when negotiable is on', () => {
    expect(counterAllowed(true)).toBe(true);
    expect(counterAllowed(false)).toBe(false);
  });
});

describe('publicCredentials', () => {
  const creds: Credential[] = [
    { type: 'title', label: 'Lead Teacher', review: 'approved' },
    { type: 'certification', label: 'CPR / First Aid', review: 'pending' },
    { type: 'training', label: 'Newborn Care', review: 'rejected', rejectionReason: 'unverifiable' },
  ];

  it('shows approved Credentials only — pending and rejected are hidden from the Parent view', () => {
    expect(publicCredentials(creds)).toEqual([{ type: 'title', label: 'Lead Teacher', review: 'approved' }]);
  });
});

describe('shared taxonomy normalisers', () => {
  it('drops unknown tokens, de-dupes, and returns canonical order (behaviours)', () => {
    expect(normaliseSafetyBehaviors(['pica', 'aggression', 'pica', 'made-up'])).toEqual(['aggression', 'pica']);
  });

  it('drops unknown tokens, de-dupes, and returns canonical order (age bands)', () => {
    expect(normaliseAgeBands(['teen', 'infant', 'infant', 'grown-up'])).toEqual(['infant', 'teen']);
  });

  it('every taxonomy value passes its own guard', () => {
    for (const b of SAFETY_BEHAVIORS) expect(isSafetyBehavior(b)).toBe(true);
    for (const a of AGE_BANDS) expect(isAgeBand(a)).toBe(true);
    expect(isSafetyBehavior('made-up')).toBe(false);
    expect(isAgeBand('grown-up')).toBe(false);
  });
});
