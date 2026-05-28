import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  COMMISSION_BP_MAX,
  PRICING_BILLING_MODELS,
  PRICING_CATEGORIES,
  calculatePricing,
  pricingCategoryFor,
  type PricingInput,
} from './index.js';

const BABYSITTER_25hr_15pct: PricingInput = {
  agreedRateCents: 2_500, // $25/hr
  billingModel: 'hourly',
  hours: 4,
  childCount: 1,
  perChildSurchargeCents: 0,
  commissionBp: 1_500, // 15%
  category: 'babysitter',
};

describe('calculatePricing — hourly, single-child, no surcharge', () => {
  it('Babysitter $25/hr × 4h, 15% commission → Parent $100, Commission $15, Payout $85', () => {
    const r = calculatePricing(BABYSITTER_25hr_15pct);
    expect(r.baseCents).toBe(10_000);
    expect(r.surchargeCents).toBe(0);
    expect(r.parentChargeCents).toBe(10_000);
    expect(r.platformCommissionCents).toBe(1_500);
    expect(r.providerPayoutCents).toBe(8_500);
    expect(r.salesTaxHandling).toBe('stripe-tax');
  });

  it('Babysitter $30/hr × 2h, 20% commission → Parent $60, Commission $12, Payout $48', () => {
    const r = calculatePricing({
      agreedRateCents: 3_000,
      billingModel: 'hourly',
      hours: 2,
      childCount: 1,
      perChildSurchargeCents: 0,
      commissionBp: 2_000,
      category: 'babysitter',
    });
    expect(r.parentChargeCents).toBe(6_000);
    expect(r.platformCommissionCents).toBe(1_200);
    expect(r.providerPayoutCents).toBe(4_800);
  });

  it('handles fractional hours via rounding', () => {
    // $25.51/hr × 1.33h = 33.9283 → round to 3393 cents
    const r = calculatePricing({
      agreedRateCents: 2_551,
      billingModel: 'hourly',
      hours: 1.33,
      childCount: 1,
      perChildSurchargeCents: 0,
      commissionBp: 1_500,
      category: 'babysitter',
    });
    expect(r.baseCents).toBe(Math.round(2_551 * 1.33));
    expect(r.parentChargeCents).toBe(r.baseCents);
    expect(r.providerPayoutCents + r.platformCommissionCents).toBe(r.parentChargeCents);
  });
});

describe('calculatePricing — hourly with per-child surcharge', () => {
  it('Babysitter $25/hr × 4h + $5/hr surcharge × 2 extra kids → Parent $140', () => {
    const r = calculatePricing({
      agreedRateCents: 2_500,
      billingModel: 'hourly',
      hours: 4,
      childCount: 3, // 2 extra
      perChildSurchargeCents: 500,
      commissionBp: 1_500,
      category: 'babysitter',
    });
    expect(r.baseCents).toBe(10_000);
    expect(r.surchargeCents).toBe(4_000); // $5 × 4h × 2 extra
    expect(r.parentChargeCents).toBe(14_000);
    expect(r.platformCommissionCents).toBe(2_100); // 15% of 140
    expect(r.providerPayoutCents).toBe(11_900);
  });

  it('childCount=1 produces zero surcharge regardless of per-child rate', () => {
    const r = calculatePricing({
      agreedRateCents: 2_500,
      billingModel: 'hourly',
      hours: 4,
      childCount: 1,
      perChildSurchargeCents: 10_000, // huge — irrelevant
      commissionBp: 1_500,
      category: 'nanny',
    });
    expect(r.surchargeCents).toBe(0);
  });
});

describe('calculatePricing — per-session Specialist', () => {
  it('Specialist $200/session, 20% commission → Parent $200, Commission $40, Payout $160', () => {
    const r = calculatePricing({
      agreedRateCents: 20_000,
      billingModel: 'per-session',
      hours: 1,
      childCount: 1,
      perChildSurchargeCents: 0,
      commissionBp: 2_000,
      category: 'specialist',
    });
    expect(r.baseCents).toBe(20_000);
    expect(r.surchargeCents).toBe(0);
    expect(r.parentChargeCents).toBe(20_000);
    expect(r.platformCommissionCents).toBe(4_000);
    expect(r.providerPayoutCents).toBe(16_000);
  });
});

describe('calculatePricing — input validation', () => {
  it('rejects negative agreedRateCents', () => {
    expect(() =>
      calculatePricing({ ...BABYSITTER_25hr_15pct, agreedRateCents: -1 }),
    ).toThrow(/agreedRateCents/);
  });

  it('rejects non-integer agreedRateCents', () => {
    expect(() =>
      calculatePricing({ ...BABYSITTER_25hr_15pct, agreedRateCents: 12.5 }),
    ).toThrow(/agreedRateCents/);
  });

  it('rejects negative hours', () => {
    expect(() => calculatePricing({ ...BABYSITTER_25hr_15pct, hours: -1 })).toThrow(/hours/);
  });

  it('rejects non-finite hours', () => {
    expect(() => calculatePricing({ ...BABYSITTER_25hr_15pct, hours: Infinity })).toThrow(/hours/);
  });

  it('rejects childCount < 1', () => {
    expect(() => calculatePricing({ ...BABYSITTER_25hr_15pct, childCount: 0 })).toThrow(/childCount/);
  });

  it('rejects commissionBp out of [0, 10_000]', () => {
    expect(() => calculatePricing({ ...BABYSITTER_25hr_15pct, commissionBp: -1 })).toThrow(
      /commissionBp/,
    );
    expect(() => calculatePricing({ ...BABYSITTER_25hr_15pct, commissionBp: 10_001 })).toThrow(
      /commissionBp/,
    );
  });

  it('rejects per-session hours ≠ 1', () => {
    expect(() =>
      calculatePricing({
        agreedRateCents: 20_000,
        billingModel: 'per-session',
        hours: 2,
        childCount: 1,
        perChildSurchargeCents: 0,
        commissionBp: 1_500,
        category: 'specialist',
      }),
    ).toThrow(/per-session/);
  });

  it('rejects Tutor multi-child', () => {
    expect(() =>
      calculatePricing({
        agreedRateCents: 5_000,
        billingModel: 'hourly',
        hours: 1,
        childCount: 2,
        perChildSurchargeCents: 0,
        commissionBp: 1_500,
        category: 'tutor',
      }),
    ).toThrow(/tutor bookings are single-child/);
  });

  it('rejects Specialist with surcharge', () => {
    expect(() =>
      calculatePricing({
        agreedRateCents: 20_000,
        billingModel: 'per-session',
        hours: 1,
        childCount: 1,
        perChildSurchargeCents: 500,
        commissionBp: 1_500,
        category: 'specialist',
      }),
    ).toThrow(/specialist bookings cannot carry a per-child surcharge/);
  });

  it('rejects Specialist multi-child', () => {
    expect(() =>
      calculatePricing({
        agreedRateCents: 20_000,
        billingModel: 'per-session',
        hours: 1,
        childCount: 2,
        perChildSurchargeCents: 0,
        commissionBp: 1_500,
        category: 'specialist',
      }),
    ).toThrow(/specialist bookings are single-child/);
  });
});

describe('pricingCategoryFor', () => {
  it('maps specialist kind regardless of specialty', () => {
    expect(pricingCategoryFor('specialist', 'slp')).toBe('specialist');
    expect(pricingCategoryFor('specialist', 'aba')).toBe('specialist');
    expect(pricingCategoryFor('specialist', 'other')).toBe('specialist');
  });

  it('passes Caregiver categories straight through', () => {
    expect(pricingCategoryFor('caregiver', 'babysitter')).toBe('babysitter');
    expect(pricingCategoryFor('caregiver', 'tutor')).toBe('tutor');
    expect(pricingCategoryFor('caregiver', 'nanny')).toBe('nanny');
  });
});

describe('Property-based — calculatePricing', () => {
  const agreedRateArb = fc.integer({ min: 0, max: 1_000_000 });
  const hoursArb = fc.double({ min: 0, max: 24, noNaN: true, noDefaultInfinity: true });
  const childCountArb = fc.integer({ min: 1, max: 8 });
  const surchargeArb = fc.integer({ min: 0, max: 10_000 });
  const commissionBpArb = fc.integer({ min: 0, max: COMMISSION_BP_MAX });

  // Multi-child-capable categories
  const multiChildCategoryArb = fc.constantFrom('babysitter' as const, 'nanny' as const);

  const hourlyMultiChildInputArb: fc.Arbitrary<PricingInput> = fc.record({
    agreedRateCents: agreedRateArb,
    billingModel: fc.constant<'hourly'>('hourly'),
    hours: hoursArb,
    childCount: childCountArb,
    perChildSurchargeCents: surchargeArb,
    commissionBp: commissionBpArb,
    category: multiChildCategoryArb,
  });

  it('Parent charge ≥ Provider payout (commission is always ≥ 0)', () => {
    fc.assert(
      fc.property(hourlyMultiChildInputArb, (input) => {
        const r = calculatePricing(input);
        expect(r.parentChargeCents).toBeGreaterThanOrEqual(r.providerPayoutCents);
        expect(r.platformCommissionCents).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('payout + commission = parent charge (closed-system invariant)', () => {
    fc.assert(
      fc.property(hourlyMultiChildInputArb, (input) => {
        const r = calculatePricing(input);
        expect(r.providerPayoutCents + r.platformCommissionCents).toBe(r.parentChargeCents);
      }),
    );
  });

  it('parent charge = base + surcharge (decomposition invariant)', () => {
    fc.assert(
      fc.property(hourlyMultiChildInputArb, (input) => {
        const r = calculatePricing(input);
        expect(r.baseCents + r.surchargeCents).toBe(r.parentChargeCents);
      }),
    );
  });

  it('all amounts are non-negative integers', () => {
    fc.assert(
      fc.property(hourlyMultiChildInputArb, (input) => {
        const r = calculatePricing(input);
        for (const v of [
          r.baseCents,
          r.surchargeCents,
          r.parentChargeCents,
          r.platformCommissionCents,
          r.providerPayoutCents,
        ]) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it('hours=0 → base=0, surcharge=0, all zero', () => {
    fc.assert(
      fc.property(
        agreedRateArb,
        childCountArb,
        surchargeArb,
        commissionBpArb,
        multiChildCategoryArb,
        (rate, kids, surcharge, bp, category) => {
          const r = calculatePricing({
            agreedRateCents: rate,
            billingModel: 'hourly',
            hours: 0,
            childCount: kids,
            perChildSurchargeCents: surcharge,
            commissionBp: bp,
            category,
          });
          expect(r.baseCents).toBe(0);
          expect(r.surchargeCents).toBe(0);
          expect(r.parentChargeCents).toBe(0);
          expect(r.platformCommissionCents).toBe(0);
          expect(r.providerPayoutCents).toBe(0);
        },
      ),
    );
  });

  it('commissionBp=0 → commission=0, payout=parentCharge', () => {
    fc.assert(
      fc.property(
        agreedRateArb,
        hoursArb,
        childCountArb,
        surchargeArb,
        multiChildCategoryArb,
        (rate, hours, kids, surcharge, category) => {
          const r = calculatePricing({
            agreedRateCents: rate,
            billingModel: 'hourly',
            hours,
            childCount: kids,
            perChildSurchargeCents: surcharge,
            commissionBp: 0,
            category,
          });
          expect(r.platformCommissionCents).toBe(0);
          expect(r.providerPayoutCents).toBe(r.parentChargeCents);
        },
      ),
    );
  });

  it('commissionBp=10_000 → payout=0, commission=parentCharge', () => {
    fc.assert(
      fc.property(
        agreedRateArb,
        hoursArb,
        childCountArb,
        surchargeArb,
        multiChildCategoryArb,
        (rate, hours, kids, surcharge, category) => {
          const r = calculatePricing({
            agreedRateCents: rate,
            billingModel: 'hourly',
            hours,
            childCount: kids,
            perChildSurchargeCents: surcharge,
            commissionBp: COMMISSION_BP_MAX,
            category,
          });
          expect(r.platformCommissionCents).toBe(r.parentChargeCents);
          expect(r.providerPayoutCents).toBe(0);
        },
      ),
    );
  });

  it('childCount=1 → surcharge=0 regardless of perChildSurchargeCents', () => {
    fc.assert(
      fc.property(
        agreedRateArb,
        hoursArb,
        surchargeArb,
        commissionBpArb,
        multiChildCategoryArb,
        (rate, hours, surcharge, bp, category) => {
          const r = calculatePricing({
            agreedRateCents: rate,
            billingModel: 'hourly',
            hours,
            childCount: 1,
            perChildSurchargeCents: surcharge,
            commissionBp: bp,
            category,
          });
          expect(r.surchargeCents).toBe(0);
        },
      ),
    );
  });

  it('determinism — identical inputs always produce identical outputs', () => {
    fc.assert(
      fc.property(hourlyMultiChildInputArb, (input) => {
        expect(calculatePricing(input)).toEqual(calculatePricing(input));
      }),
    );
  });

  it('per-session Specialist invariants hold across the input space', () => {
    const perSessionInputArb: fc.Arbitrary<PricingInput> = fc.record({
      agreedRateCents: agreedRateArb,
      billingModel: fc.constant<'per-session'>('per-session'),
      hours: fc.constant(1),
      childCount: fc.constant(1),
      perChildSurchargeCents: fc.constant(0),
      commissionBp: commissionBpArb,
      category: fc.constant<'specialist'>('specialist'),
    });
    fc.assert(
      fc.property(perSessionInputArb, (input) => {
        const r = calculatePricing(input);
        expect(r.baseCents).toBe(input.agreedRateCents);
        expect(r.surchargeCents).toBe(0);
        expect(r.parentChargeCents).toBe(input.agreedRateCents);
        expect(r.providerPayoutCents + r.platformCommissionCents).toBe(r.parentChargeCents);
      }),
    );
  });
});

// Reference unused imports to keep tsc honest if shared exports rotate.
void PRICING_BILLING_MODELS;
void PRICING_CATEGORIES;
