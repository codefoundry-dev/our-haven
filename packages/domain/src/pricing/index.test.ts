import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  COMMISSION_BP_MAX,
  calculatePricing,
  calculateTip,
  caregiverTakeHome,
  type PricingInput,
} from './index.js';

const BABYSITTER_25hr_15pct: PricingInput = {
  agreedRateCents: 2_500, // $25/hr
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
    expect(r.caregiverPayoutCents).toBe(8_500);
    expect(r.salesTaxHandling).toBe('stripe-tax');
  });

  it('Nanny $30/hr × 2h, 20% commission → Parent $60, Commission $12, Payout $48', () => {
    const r = calculatePricing({
      agreedRateCents: 3_000,
      hours: 2,
      childCount: 1,
      perChildSurchargeCents: 0,
      commissionBp: 2_000,
      category: 'nanny',
    });
    expect(r.parentChargeCents).toBe(6_000);
    expect(r.platformCommissionCents).toBe(1_200);
    expect(r.caregiverPayoutCents).toBe(4_800);
  });

  it('handles fractional hours via rounding', () => {
    // $25.51/hr × 1.33h = 33.9283 → round to 3393 cents
    const r = calculatePricing({
      agreedRateCents: 2_551,
      hours: 1.33,
      childCount: 1,
      perChildSurchargeCents: 0,
      commissionBp: 1_500,
      category: 'babysitter',
    });
    expect(r.baseCents).toBe(Math.round(2_551 * 1.33));
    expect(r.parentChargeCents).toBe(r.baseCents);
    expect(r.caregiverPayoutCents + r.platformCommissionCents).toBe(r.parentChargeCents);
  });
});

describe('calculatePricing — hourly with per-child surcharge', () => {
  it('Babysitter $25/hr × 4h + $5/hr surcharge × 2 extra kids → Parent $140', () => {
    const r = calculatePricing({
      agreedRateCents: 2_500,
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
    expect(r.caregiverPayoutCents).toBe(11_900);
  });

  it('childCount=1 produces zero surcharge regardless of per-child rate', () => {
    const r = calculatePricing({
      agreedRateCents: 2_500,
      hours: 4,
      childCount: 1,
      perChildSurchargeCents: 10_000, // huge — irrelevant
      commissionBp: 1_500,
      category: 'nanny',
    });
    expect(r.surchargeCents).toBe(0);
  });
});

describe('calculatePricing — input validation', () => {
  it('rejects negative agreedRateCents', () => {
    expect(() => calculatePricing({ ...BABYSITTER_25hr_15pct, agreedRateCents: -1 })).toThrow(
      /agreedRateCents/,
    );
  });

  it('rejects non-integer agreedRateCents', () => {
    expect(() => calculatePricing({ ...BABYSITTER_25hr_15pct, agreedRateCents: 12.5 })).toThrow(
      /agreedRateCents/,
    );
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

  it('rejects Tutor multi-child (single-child category)', () => {
    expect(() =>
      calculatePricing({
        agreedRateCents: 5_000,
        hours: 1,
        childCount: 2,
        perChildSurchargeCents: 0,
        commissionBp: 1_500,
        category: 'tutor',
      }),
    ).toThrow(/tutor bookings are single-child/);
  });

  it('rejects Tutor with a per-child surcharge', () => {
    expect(() =>
      calculatePricing({
        agreedRateCents: 5_000,
        hours: 1,
        childCount: 1,
        perChildSurchargeCents: 500,
        commissionBp: 1_500,
        category: 'tutor',
      }),
    ).toThrow(/tutor bookings cannot carry a per-child surcharge/);
  });
});

describe('calculateTip — commission-exempt, 100% pass-through (ADR-0018)', () => {
  it('a $20 tip goes entirely to the Caregiver with zero commission', () => {
    const t = calculateTip(2_000);
    expect(t.tipCents).toBe(2_000);
    expect(t.caregiverTipCents).toBe(2_000);
    expect(t.platformCommissionCents).toBe(0);
  });

  it('a 0 tip (absent / cleared) is valid and yields zeros', () => {
    expect(calculateTip(0)).toEqual({
      tipCents: 0,
      caregiverTipCents: 0,
      platformCommissionCents: 0,
    });
  });

  it('rejects negative tipCents', () => {
    expect(() => calculateTip(-1)).toThrow(/tipCents/);
  });

  it('rejects non-integer tipCents', () => {
    expect(() => calculateTip(99.5)).toThrow(/tipCents/);
  });
});

describe('caregiverTakeHome — Tip is an additive Payout line that bypasses the skim', () => {
  it('adds the full tip to the engagement payout and leaves commission untouched', () => {
    const pricing = calculatePricing(BABYSITTER_25hr_15pct); // payout 8_500, commission 1_500
    const withTip = caregiverTakeHome(pricing, 2_000);
    expect(withTip.engagementPayoutCents).toBe(8_500);
    expect(withTip.tipCents).toBe(2_000);
    expect(withTip.totalPayoutCents).toBe(10_500); // 8_500 + 2_000
    // The tip adds nothing to the platform's take — still the engagement skim.
    expect(withTip.platformCommissionCents).toBe(pricing.platformCommissionCents);
    expect(withTip.platformCommissionCents).toBe(1_500);
  });

  it('a zero tip leaves the take-home equal to the engagement payout', () => {
    const pricing = calculatePricing(BABYSITTER_25hr_15pct);
    const noTip = caregiverTakeHome(pricing, 0);
    expect(noTip.totalPayoutCents).toBe(pricing.caregiverPayoutCents);
    expect(noTip.platformCommissionCents).toBe(pricing.platformCommissionCents);
  });
});

describe('Property-based — calculatePricing', () => {
  const agreedRateArb = fc.integer({ min: 0, max: 1_000_000 });
  const hoursArb = fc.double({ min: 0, max: 24, noNaN: true, noDefaultInfinity: true });
  const childCountArb = fc.integer({ min: 1, max: 8 });
  const surchargeArb = fc.integer({ min: 0, max: 10_000 });
  const commissionBpArb = fc.integer({ min: 0, max: COMMISSION_BP_MAX });

  // Multi-child-capable categories (Tutor is single-child, exercised separately).
  const multiChildCategoryArb = fc.constantFrom('babysitter' as const, 'nanny' as const);

  const inputArb: fc.Arbitrary<PricingInput> = fc.record({
    agreedRateCents: agreedRateArb,
    hours: hoursArb,
    childCount: childCountArb,
    perChildSurchargeCents: surchargeArb,
    commissionBp: commissionBpArb,
    category: multiChildCategoryArb,
  });

  it('Parent charge ≥ Caregiver Payout (commission is always ≥ 0)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const r = calculatePricing(input);
        expect(r.parentChargeCents).toBeGreaterThanOrEqual(r.caregiverPayoutCents);
        expect(r.platformCommissionCents).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('payout + commission = parent charge (closed-system invariant)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const r = calculatePricing(input);
        expect(r.caregiverPayoutCents + r.platformCommissionCents).toBe(r.parentChargeCents);
      }),
    );
  });

  it('parent charge = base + surcharge (decomposition invariant)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const r = calculatePricing(input);
        expect(r.baseCents + r.surchargeCents).toBe(r.parentChargeCents);
      }),
    );
  });

  it('all amounts are non-negative integers', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const r = calculatePricing(input);
        for (const v of [
          r.baseCents,
          r.surchargeCents,
          r.parentChargeCents,
          r.platformCommissionCents,
          r.caregiverPayoutCents,
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
          expect(r.caregiverPayoutCents).toBe(0);
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
            hours,
            childCount: kids,
            perChildSurchargeCents: surcharge,
            commissionBp: 0,
            category,
          });
          expect(r.platformCommissionCents).toBe(0);
          expect(r.caregiverPayoutCents).toBe(r.parentChargeCents);
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
            hours,
            childCount: kids,
            perChildSurchargeCents: surcharge,
            commissionBp: COMMISSION_BP_MAX,
            category,
          });
          expect(r.platformCommissionCents).toBe(r.parentChargeCents);
          expect(r.caregiverPayoutCents).toBe(0);
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
      fc.property(inputArb, (input) => {
        expect(calculatePricing(input)).toEqual(calculatePricing(input));
      }),
    );
  });

  it('Tutor (single-child) holds the closed-system invariant across the input space', () => {
    const tutorInputArb: fc.Arbitrary<PricingInput> = fc.record({
      agreedRateCents: agreedRateArb,
      hours: hoursArb,
      childCount: fc.constant(1),
      perChildSurchargeCents: fc.constant(0),
      commissionBp: commissionBpArb,
      category: fc.constant<'tutor'>('tutor'),
    });
    fc.assert(
      fc.property(tutorInputArb, (input) => {
        const r = calculatePricing(input);
        expect(r.surchargeCents).toBe(0);
        expect(r.baseCents).toBe(r.parentChargeCents);
        expect(r.caregiverPayoutCents + r.platformCommissionCents).toBe(r.parentChargeCents);
      }),
    );
  });
});

describe('Property-based — Tip is always excluded from the Commission skim (ADR-0018)', () => {
  const tipArb = fc.integer({ min: 0, max: 1_000_000 });

  it('the whole tip reaches the Caregiver and the platform takes nothing', () => {
    fc.assert(
      fc.property(tipArb, (tip) => {
        const t = calculateTip(tip);
        expect(t.caregiverTipCents).toBe(tip);
        expect(t.platformCommissionCents).toBe(0);
      }),
    );
  });

  it('adding a tip never changes the engagement commission', () => {
    const agreedRateArb = fc.integer({ min: 0, max: 1_000_000 });
    const hoursArb = fc.double({ min: 0, max: 24, noNaN: true, noDefaultInfinity: true });
    const commissionBpArb = fc.integer({ min: 0, max: COMMISSION_BP_MAX });
    fc.assert(
      fc.property(agreedRateArb, hoursArb, commissionBpArb, tipArb, (rate, hours, bp, tip) => {
        const pricing = calculatePricing({
          agreedRateCents: rate,
          hours,
          childCount: 1,
          perChildSurchargeCents: 0,
          commissionBp: bp,
          category: 'babysitter',
        });
        const take = caregiverTakeHome(pricing, tip);
        // Commission is unchanged by the tip…
        expect(take.platformCommissionCents).toBe(pricing.platformCommissionCents);
        // …and the tip is purely additive to the Caregiver's payout.
        expect(take.totalPayoutCents).toBe(pricing.caregiverPayoutCents + tip);
      }),
    );
  });
});
