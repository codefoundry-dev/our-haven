import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { BookingSlot, RecurrenceRule } from '../booking-lifecycle/index.js';
import {
  defaultValidUntil,
  type OfferAnchor,
  type OfferSchedule,
  type OfferShape,
} from '../offer-lifecycle/index.js';
import { planMaterialisation, type MaterialisationInput } from './index.js';

const NOW = new Date('2026-05-28T12:00:00.000Z');

const THREAD_ANCHOR: OfferAnchor = { kind: 'thread', threadId: 'thr_abc' };
const JOB_ANCHOR: OfferAnchor = { kind: 'job', jobId: 'job_xyz' };

const SLOT_A: BookingSlot = { date: '2026-06-01', startMin: 540, endMin: 720 }; // 09:00–12:00 = 3h
const SLOT_B: BookingSlot = { date: '2026-06-03', startMin: 540, endMin: 720 }; // 3h
const ONE_OFF: OfferSchedule = { kind: 'one-off', slot: SLOT_A };
const MULTI_DAY: OfferSchedule = { kind: 'multi-day', slots: [SLOT_A, SLOT_B] };
// 2026-06-01 is a Monday; weekdays [1] over [06-01, 06-08] → 2 occurrences.
const RECURRING_RULE: RecurrenceRule = {
  startDate: '2026-06-01',
  endDate: '2026-06-08',
  weekdays: [1],
  startMin: 540,
  endMin: 720,
};
const RECURRING: OfferSchedule = { kind: 'recurring', rule: RECURRING_RULE };

function makeOffer(overrides?: Partial<OfferShape>): OfferShape {
  return {
    proposedRate: 3500, // $35/hr in cents
    scopeType: 'hourly',
    scopeQuantity: 3,
    scopeNote: 'Weekday mornings, one kid',
    childCount: 1,
    category: 'babysitter',
    perChildSurchargeSnapshot: 0,
    computedTotal: 3500 * 3, // 10500
    validUntil: defaultValidUntil(NOW),
    sender: 'parent',
    negotiable: true,
    anchor: THREAD_ANCHOR,
    schedule: ONE_OFF,
    ...overrides,
  };
}

function makeInput(overrides?: Partial<MaterialisationInput>): MaterialisationInput {
  return {
    ids: { jobId: 'job_new', applicationId: 'app_new', bookingIds: ['bkg_1'] },
    thread: {
      threadId: 'thr_abc',
      caregiverId: 'cgv_1',
      parentId: 'par_1',
      description: 'Weekday mornings sitter',
    },
    acceptedOffer: { offerId: 'ofr_1', offer: makeOffer() },
    now: NOW,
    ...overrides,
  };
}

describe('planMaterialisation — one-off happy path', () => {
  it('returns a plan with Job + Application + one Booking + accepted Offer + thread rebind', () => {
    const r = planMaterialisation(makeInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.plan.job).toMatchObject({
      id: 'job_new',
      origin: 'direct-message',
      state: 'awarded',
      parentId: 'par_1',
      caregiverId: 'cgv_1',
      category: 'babysitter',
      description: 'Weekday mornings sitter',
    });
    expect(r.plan.application).toMatchObject({
      id: 'app_new',
      jobId: 'job_new',
      caregiverId: 'cgv_1',
      origin: 'direct-message',
      state: 'awarded',
      acceptedOfferId: 'ofr_1',
    });
    expect(r.plan.bookings).toHaveLength(1);
    expect(r.plan.bookings[0]).toMatchObject({
      id: 'bkg_1',
      jobId: 'job_new',
      applicationId: 'app_new',
      caregiverId: 'cgv_1',
      origin: 'direct-message',
      state: 'accepted', // born accepted — skips `requested`
      seriesId: null,
      offerId: 'ofr_1',
      agreedRate: 3500,
      computedTotal: 3500 * 3, // 3h slot
    });
    expect(r.plan.series).toBeNull();
    expect(r.plan.offer).toMatchObject({
      id: 'ofr_1',
      state: 'accepted',
      anchor: { kind: 'job', jobId: 'job_new' },
      originatingThreadId: 'thr_abc',
    });
    expect(r.plan.threadRebind).toEqual({ threadId: 'thr_abc', newJobId: 'job_new' });
  });

  it('all materialised rows share the same fresh jobId', () => {
    const r = planMaterialisation(makeInput());
    if (!r.ok) throw new Error('expected ok');
    expect(r.plan.job.id).toBe(r.plan.application.jobId);
    expect(r.plan.job.id).toBe(r.plan.bookings[0]!.jobId);
    expect(r.plan.job.id).toBe(r.plan.offer.anchor.jobId);
    expect(r.plan.job.id).toBe(r.plan.threadRebind.newJobId);
  });

  it("Booking carries the Offer's agreedRate; per-slot computedTotal via the Pricing model", () => {
    const r = planMaterialisation(
      makeInput({
        acceptedOffer: {
          offerId: 'ofr_1',
          offer: makeOffer({
            proposedRate: 5000,
            childCount: 2,
            perChildSurchargeSnapshot: 1000,
          }),
        },
      }),
    );
    if (!r.ok) throw new Error('expected ok');
    // 3h slot: base 5000×3 = 15000 + surcharge 1000×3×1 = 3000 → 18000.
    expect(r.plan.bookings[0]!.agreedRate).toBe(5000);
    expect(r.plan.bookings[0]!.computedTotal).toBe(18000);
  });

  it('default description marker is used when thread provides none', () => {
    const r = planMaterialisation(
      makeInput({
        thread: { threadId: 'thr_abc', caregiverId: 'cgv_1', parentId: 'par_1' },
      }),
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.plan.job.description).toMatch(/direct-message thr_abc/);
  });

  it("Offer's OfferShape fields are preserved unchanged (snapshot invariant)", () => {
    const original = makeOffer({ scopeNote: 'preserved exactly' });
    const r = planMaterialisation(makeInput({ acceptedOffer: { offerId: 'ofr_1', offer: original } }));
    if (!r.ok) throw new Error('expected ok');
    expect(r.plan.offer.preserved).toEqual(original);
  });
});

describe('planMaterialisation — multi-day slots[] → N Bookings, NO Series (ADR-0014 §A1)', () => {
  it('materialises one independent Booking per slot, every seriesId null, no Series', () => {
    const r = planMaterialisation(
      makeInput({
        ids: { jobId: 'job_new', applicationId: 'app_new', bookingIds: ['bkg_1', 'bkg_2'] },
        acceptedOffer: { offerId: 'ofr_1', offer: makeOffer({ schedule: MULTI_DAY }) },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.bookings).toHaveLength(2);
    expect(r.plan.series).toBeNull();
    expect(r.plan.bookings.map((b) => b.slot.date)).toEqual(['2026-06-01', '2026-06-03']);
    for (const b of r.plan.bookings) {
      expect(b.seriesId).toBeNull();
      expect(b.state).toBe('accepted');
      expect(b.offerId).toBe('ofr_1'); // cascade linkage
      expect(b.jobId).toBe('job_new');
      expect(b.applicationId).toBe('app_new');
    }
  });

  it('rejects when bookingIds count does not match the slot count', () => {
    const r = planMaterialisation(
      makeInput({
        ids: { jobId: 'job_new', applicationId: 'app_new', bookingIds: ['bkg_1'] }, // only 1 for 2 slots
        acceptedOffer: { offerId: 'ofr_1', offer: makeOffer({ schedule: MULTI_DAY }) },
      }),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a seriesId on a non-recurring (multi-day) offer', () => {
    const r = planMaterialisation(
      makeInput({
        ids: {
          jobId: 'job_new',
          applicationId: 'app_new',
          bookingIds: ['bkg_1', 'bkg_2'],
          seriesId: 'ser_1',
        },
        acceptedOffer: { offerId: 'ofr_1', offer: makeOffer({ schedule: MULTI_DAY }) },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/seriesId must be omitted/);
  });
});

describe('planMaterialisation — recurring → a Series + occurrence Bookings', () => {
  it('materialises a Series (with offerId back-link) + one Booking per occurrence', () => {
    const r = planMaterialisation(
      makeInput({
        ids: {
          jobId: 'job_new',
          applicationId: 'app_new',
          bookingIds: ['bkg_1', 'bkg_2'],
          seriesId: 'ser_1',
        },
        acceptedOffer: { offerId: 'ofr_1', offer: makeOffer({ schedule: RECURRING }) },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.series).not.toBeNull();
    expect(r.plan.series).toMatchObject({
      id: 'ser_1',
      jobId: 'job_new',
      caregiverId: 'cgv_1',
      offerId: 'ofr_1',
      occurrenceIds: ['bkg_1', 'bkg_2'],
    });
    expect(r.plan.bookings).toHaveLength(2);
    for (const b of r.plan.bookings) {
      expect(b.seriesId).toBe('ser_1');
      expect(b.offerId).toBe('ofr_1');
      expect(b.state).toBe('accepted');
    }
  });

  it('rejects a recurring offer with no seriesId', () => {
    const r = planMaterialisation(
      makeInput({
        ids: { jobId: 'job_new', applicationId: 'app_new', bookingIds: ['bkg_1', 'bkg_2'] },
        acceptedOffer: { offerId: 'ofr_1', offer: makeOffer({ schedule: RECURRING }) },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/requires ids\.seriesId/);
  });
});

describe('planMaterialisation — validation failures', () => {
  it('rejects when offer anchor is a job (Posted-Job flow, wrong code path)', () => {
    const r = planMaterialisation(
      makeInput({ acceptedOffer: { offerId: 'ofr_1', offer: makeOffer({ anchor: JOB_ANCHOR }) } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/requires a thread-anchored offer/);
  });

  it('rejects when offer anchor thread does not match input thread', () => {
    const r = planMaterialisation(
      makeInput({
        acceptedOffer: {
          offerId: 'ofr_1',
          offer: makeOffer({ anchor: { kind: 'thread', threadId: 'thr_other' } }),
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/does not match/);
  });

  it('rejects when jobId or applicationId is empty', () => {
    const r1 = planMaterialisation(
      makeInput({ ids: { jobId: '', applicationId: 'app', bookingIds: ['bkg'] } }),
    );
    const r2 = planMaterialisation(
      makeInput({ ids: { jobId: 'job', applicationId: '', bookingIds: ['bkg'] } }),
    );
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
  });

  it('rejects when ids collide (e.g. jobId equals a bookingId)', () => {
    const r = planMaterialisation(
      makeInput({ ids: { jobId: 'same', applicationId: 'app', bookingIds: ['same'] } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/distinct/);
  });

  it('rejects an invalid offer pricing (Tutor with > 1 child) as a refusal, not a throw', () => {
    const r = planMaterialisation(
      makeInput({
        acceptedOffer: { offerId: 'ofr_1', offer: makeOffer({ category: 'tutor', childCount: 2 }) },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/invalid offer pricing/);
  });
});

describe('Atomic contract — all-or-nothing', () => {
  it('a validation failure returns ok:false and produces NO partial plan', () => {
    const r = planMaterialisation(
      makeInput({ acceptedOffer: { offerId: 'ofr_1', offer: makeOffer({ anchor: JOB_ANCHOR }) } }),
    );
    expect(r.ok).toBe(false);
    // No `plan` on the failure case — the handler has nothing to INSERT, so it
    // must not open a TX. This is the pure-level proof of all-or-nothing.
    if (!r.ok) expect((r as { plan?: unknown }).plan).toBeUndefined();
  });

  it('a successful plan always includes every output (no skips)', () => {
    const r = planMaterialisation(makeInput());
    if (!r.ok) throw new Error('expected ok');
    expect(r.plan.job).toBeDefined();
    expect(r.plan.application).toBeDefined();
    expect(r.plan.bookings.length).toBeGreaterThan(0);
    expect(r.plan.offer).toBeDefined();
    expect(r.plan.threadRebind).toBeDefined();
  });
});

describe('Property-based — planMaterialisation', () => {
  const offerArb: fc.Arbitrary<OfferShape> = fc.record({
    proposedRate: fc.integer({ min: 100, max: 50000 }),
    scopeType: fc.constant<'hourly'>('hourly'),
    scopeQuantity: fc.float({ min: Math.fround(0.5), max: 100, noNaN: true }),
    scopeNote: fc.string({ maxLength: 280 }),
    childCount: fc.integer({ min: 1, max: 4 }),
    category: fc.constantFrom('babysitter' as const, 'nanny' as const),
    perChildSurchargeSnapshot: fc.integer({ min: 0, max: 2000 }),
    computedTotal: fc.integer({ min: 0, max: 5_000_000 }),
    validUntil: fc.constant(defaultValidUntil(NOW)),
    sender: fc.constantFrom('parent' as const, 'caregiver' as const),
    negotiable: fc.boolean(),
    anchor: fc.constant<OfferAnchor>({ kind: 'thread', threadId: 'thr_X' }),
    schedule: fc.constant(ONE_OFF),
  });

  it('every successful one-off plan has jobId equal across all shapes', () => {
    fc.assert(
      fc.property(offerArb, (offer) => {
        const r = planMaterialisation(
          makeInput({
            ids: { jobId: 'job_X', applicationId: 'app_X', bookingIds: ['bkg_X'] },
            thread: { threadId: 'thr_X', caregiverId: 'cgv_X', parentId: 'par_X' },
            acceptedOffer: { offerId: 'ofr_X', offer },
          }),
        );
        if (!r.ok) return;
        for (const b of r.plan.bookings) {
          expect(b.jobId).toBe('job_X');
          expect(b.offerId).toBe('ofr_X');
        }
        expect(r.plan.offer.anchor.jobId).toBe('job_X');
        expect(r.plan.threadRebind.newJobId).toBe('job_X');
      }),
    );
  });

  it('multi-day slots[] always materialises exactly one Booking per slot, all seriesId null', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (n) => {
        const slots: BookingSlot[] = Array.from({ length: n }, (_, i) => ({
          date: `2026-06-${String(i + 1).padStart(2, '0')}`,
          startMin: 540,
          endMin: 720,
        }));
        const bookingIds = Array.from({ length: n }, (_, i) => `bkg_${i}`);
        const r = planMaterialisation(
          makeInput({
            ids: { jobId: 'job_X', applicationId: 'app_X', bookingIds },
            thread: { threadId: 'thr_X', caregiverId: 'cgv_X', parentId: 'par_X' },
            acceptedOffer: {
              offerId: 'ofr_X',
              offer: makeOffer({ anchor: { kind: 'thread', threadId: 'thr_X' }, schedule: { kind: 'multi-day', slots } }),
            },
          }),
        );
        if (!r.ok) throw new Error(r.reason);
        expect(r.plan.bookings).toHaveLength(n);
        expect(r.plan.series).toBeNull();
        for (const b of r.plan.bookings) {
          expect(b.seriesId).toBeNull();
          expect(b.state).toBe('accepted');
          expect(b.offerId).toBe('ofr_X');
        }
      }),
    );
  });

  it('determinism: identical inputs produce identical plans', () => {
    fc.assert(
      fc.property(offerArb, (offer) => {
        const input = makeInput({
          ids: { jobId: 'job_X', applicationId: 'app_X', bookingIds: ['bkg_X'] },
          thread: { threadId: 'thr_X', caregiverId: 'cgv_X', parentId: 'par_X' },
          acceptedOffer: { offerId: 'ofr_X', offer },
        });
        expect(planMaterialisation(input)).toEqual(planMaterialisation(input));
      }),
    );
  });

  it('every successful plan: Job + Application awarded, Booking(s) + Offer accepted', () => {
    fc.assert(
      fc.property(offerArb, (offer) => {
        const r = planMaterialisation(
          makeInput({
            ids: { jobId: 'job_X', applicationId: 'app_X', bookingIds: ['bkg_X'] },
            thread: { threadId: 'thr_X', caregiverId: 'cgv_X', parentId: 'par_X' },
            acceptedOffer: { offerId: 'ofr_X', offer },
          }),
        );
        if (!r.ok) return;
        expect(r.plan.job.state).toBe('awarded');
        expect(r.plan.application.state).toBe('awarded');
        expect(r.plan.offer.state).toBe('accepted');
        for (const b of r.plan.bookings) expect(b.state).toBe('accepted');
      }),
    );
  });
});
