import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  defaultValidUntil,
  type OfferAnchor,
  type OfferShape,
} from '../offer-lifecycle/index.js';
import {
  planMaterialisation,
  type MaterialisationInput,
} from './index.js';

const NOW = new Date('2026-05-28T12:00:00.000Z');

const THREAD_ANCHOR: OfferAnchor = { kind: 'thread', threadId: 'thr_abc' };
const JOB_ANCHOR: OfferAnchor = { kind: 'job', jobId: 'job_xyz' };

function makeOffer(overrides?: Partial<OfferShape>): OfferShape {
  return {
    proposedRate: 35,
    scopeType: 'hourly',
    scopeQuantity: 4,
    scopeNote: 'Saturday evening, two kids',
    perChildSurchargeSnapshot: 5,
    computedTotal: 35 * 4 + 5,
    validUntil: defaultValidUntil(NOW),
    sender: 'parent',
    anchor: THREAD_ANCHOR,
    ...overrides,
  };
}

function makeInput(overrides?: Partial<MaterialisationInput>): MaterialisationInput {
  return {
    ids: { jobId: 'job_new', applicationId: 'app_new', bookingId: 'bkg_new' },
    thread: {
      threadId: 'thr_abc',
      providerId: 'prov_1',
      parentId: 'par_1',
      description: 'Specialist for ABA, weekday mornings',
    },
    acceptedOffer: { offerId: 'ofr_1', offer: makeOffer() },
    now: NOW,
    ...overrides,
  };
}

describe('planMaterialisation — happy path', () => {
  it('returns a plan with Job + Application + Booking + accepted Offer + thread rebind', () => {
    const r = planMaterialisation(makeInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.plan.job).toMatchObject({
      id: 'job_new',
      origin: 'direct-message',
      state: 'awarded',
      parentId: 'par_1',
      providerId: 'prov_1',
      description: 'Specialist for ABA, weekday mornings',
    });
    expect(r.plan.application).toMatchObject({
      id: 'app_new',
      jobId: 'job_new',
      providerId: 'prov_1',
      origin: 'direct-message',
      state: 'awarded',
      acceptedOfferId: 'ofr_1',
    });
    expect(r.plan.booking).toMatchObject({
      id: 'bkg_new',
      jobId: 'job_new',
      applicationId: 'app_new',
      origin: 'direct-message',
      state: 'accepted', // born accepted — skips `requested`
      agreedRate: 35,
      computedTotal: 145,
    });
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
    expect(r.plan.job.id).toBe(r.plan.booking.jobId);
    expect(r.plan.job.id).toBe(r.plan.offer.anchor.jobId);
    expect(r.plan.job.id).toBe(r.plan.threadRebind.newJobId);
  });

  it('Booking carries the Offer\'s agreedRate and computedTotal (per-child surcharge already snapshotted)', () => {
    const r = planMaterialisation(
      makeInput({
        acceptedOffer: {
          offerId: 'ofr_1',
          offer: makeOffer({ proposedRate: 50, scopeQuantity: 2, perChildSurchargeSnapshot: 10, computedTotal: 110 }),
        },
      }),
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.plan.booking.agreedRate).toBe(50);
    expect(r.plan.booking.computedTotal).toBe(110);
  });

  it('default description marker is used when thread provides none', () => {
    const r = planMaterialisation(
      makeInput({
        thread: { threadId: 'thr_abc', providerId: 'prov_1', parentId: 'par_1' },
      }),
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.plan.job.description).toMatch(/direct-message thr_abc/);
  });

  it('Offer\'s OfferShape fields are preserved unchanged (snapshot invariant)', () => {
    const original = makeOffer({ scopeNote: 'preserved exactly' });
    const r = planMaterialisation(makeInput({ acceptedOffer: { offerId: 'ofr_1', offer: original } }));
    if (!r.ok) throw new Error('expected ok');
    expect(r.plan.offer.preserved).toEqual(original);
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

  it('rejects when any of the three ids is empty', () => {
    const r1 = planMaterialisation(
      makeInput({ ids: { jobId: '', applicationId: 'app', bookingId: 'bkg' } }),
    );
    const r2 = planMaterialisation(
      makeInput({ ids: { jobId: 'job', applicationId: '', bookingId: 'bkg' } }),
    );
    const r3 = planMaterialisation(
      makeInput({ ids: { jobId: 'job', applicationId: 'app', bookingId: '' } }),
    );
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(r3.ok).toBe(false);
  });

  it('rejects when ids collide', () => {
    const r = planMaterialisation(
      makeInput({ ids: { jobId: 'same', applicationId: 'same', bookingId: 'bkg' } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/distinct/);
  });
});

describe('Atomic contract — all-or-nothing', () => {
  it('a validation failure returns ok:false and produces NO partial plan', () => {
    const r = planMaterialisation(
      makeInput({ acceptedOffer: { offerId: 'ofr_1', offer: makeOffer({ anchor: JOB_ANCHOR }) } }),
    );
    expect(r.ok).toBe(false);
    // No `plan` field on the failure case — the handler has nothing to
    // INSERT, so it must not enter a TX. This is the pure-level proof of
    // the all-or-nothing contract.
    if (!r.ok) expect((r as { plan?: unknown }).plan).toBeUndefined();
  });

  it('a successful plan always includes every output (no skips)', () => {
    const r = planMaterialisation(makeInput());
    if (!r.ok) throw new Error('expected ok');
    expect(r.plan.job).toBeDefined();
    expect(r.plan.application).toBeDefined();
    expect(r.plan.booking).toBeDefined();
    expect(r.plan.offer).toBeDefined();
    expect(r.plan.threadRebind).toBeDefined();
  });
});

describe('Property-based — planMaterialisation', () => {
  const idArb = fc.string({ minLength: 1, maxLength: 12 });
  const distinctIdsArb = fc
    .tuple(idArb, idArb, idArb)
    .filter(([a, b, c]) => a !== b && a !== c && b !== c);

  const offerArb: fc.Arbitrary<OfferShape> = fc.record({
    proposedRate: fc.float({ min: Math.fround(1), max: 500, noNaN: true }),
    scopeType: fc.constantFrom('hourly' as const, 'per_session' as const),
    scopeQuantity: fc.float({ min: Math.fround(0.5), max: 100, noNaN: true }),
    scopeNote: fc.string({ maxLength: 280 }),
    perChildSurchargeSnapshot: fc.float({ min: 0, max: 50, noNaN: true }),
    computedTotal: fc.float({ min: 0, max: 50000, noNaN: true }),
    validUntil: fc.constant(defaultValidUntil(NOW)),
    sender: fc.constantFrom('parent' as const, 'provider' as const),
    anchor: fc.constant<OfferAnchor>({ kind: 'thread', threadId: 'thr_X' }),
  });

  it('every successful plan has jobId equal across all four shapes', () => {
    fc.assert(
      fc.property(distinctIdsArb, offerArb, ([jobId, applicationId, bookingId], offer) => {
        const r = planMaterialisation(
          makeInput({
            ids: { jobId, applicationId, bookingId },
            thread: {
              threadId: 'thr_X',
              providerId: 'prov_X',
              parentId: 'par_X',
            },
            acceptedOffer: { offerId: 'ofr_X', offer },
          }),
        );
        if (!r.ok) return;
        expect(r.plan.application.jobId).toBe(jobId);
        expect(r.plan.booking.jobId).toBe(jobId);
        expect(r.plan.offer.anchor.jobId).toBe(jobId);
        expect(r.plan.threadRebind.newJobId).toBe(jobId);
      }),
    );
  });

  it('determinism: identical inputs produce identical plans', () => {
    fc.assert(
      fc.property(distinctIdsArb, offerArb, ([jobId, applicationId, bookingId], offer) => {
        const input = makeInput({
          ids: { jobId, applicationId, bookingId },
          thread: { threadId: 'thr_X', providerId: 'prov_X', parentId: 'par_X' },
          acceptedOffer: { offerId: 'ofr_X', offer },
        });
        expect(planMaterialisation(input)).toEqual(planMaterialisation(input));
      }),
    );
  });

  it('every successful plan materialises a Booking in `accepted` state (never `requested`)', () => {
    fc.assert(
      fc.property(distinctIdsArb, offerArb, ([jobId, applicationId, bookingId], offer) => {
        const r = planMaterialisation(
          makeInput({
            ids: { jobId, applicationId, bookingId },
            thread: { threadId: 'thr_X', providerId: 'prov_X', parentId: 'par_X' },
            acceptedOffer: { offerId: 'ofr_X', offer },
          }),
        );
        if (!r.ok) return;
        expect(r.plan.booking.state).toBe('accepted');
        expect(r.plan.job.state).toBe('awarded');
        expect(r.plan.application.state).toBe('awarded');
        expect(r.plan.offer.state).toBe('accepted');
      }),
    );
  });
});
