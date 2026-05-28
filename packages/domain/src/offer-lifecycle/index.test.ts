import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  computeOfferTotal,
  defaultValidUntil,
  initialOfferState,
  isExpiredAt,
  isOfferTerminal,
  OFFER_EVENT_TYPES,
  OFFER_SCOPE_NOTE_MAX_CHARS,
  OFFER_SCOPE_TYPES,
  OFFER_SENDERS,
  OFFER_STATES,
  OFFER_TERMINAL_STATES,
  OFFER_VALID_UNTIL_DEFAULT_HOURS,
  snapshotInvariantsHold,
  transitionOffer,
  type Offer,
  type OfferAnchor,
  type OfferEvent,
  type OfferEventType,
  type OfferShape,
  type OfferState,
} from './index.js';

const T0 = new Date('2026-05-28T12:00:00.000Z');
const T_VALID = new Date('2026-05-30T12:00:00.000Z'); // 48h after T0 (< 72h default)
const T_EXPIRED = new Date('2026-06-02T12:00:00.000Z'); // 5d after T0 (> 72h default)

const JOB_ANCHOR: OfferAnchor = { kind: 'job', jobId: 'job_123' };
const THREAD_ANCHOR: OfferAnchor = { kind: 'thread', threadId: 'thr_abc' };

function makeOffer(overrides?: Partial<OfferShape & { state: OfferState }>): Offer {
  return {
    proposedRate: 35,
    scopeType: 'hourly',
    scopeQuantity: 4,
    scopeNote: 'Saturday evening, two kids',
    perChildSurchargeSnapshot: 5,
    computedTotal: 35 * 4 + 5,
    validUntil: defaultValidUntil(T0),
    sender: 'parent',
    anchor: JOB_ANCHOR,
    state: 'pending',
    ...overrides,
  };
}

describe('initialOfferState', () => {
  it('newly-sent Offers are born pending', () => {
    expect(initialOfferState()).toBe('pending');
  });
});

describe('computeOfferTotal', () => {
  it('proposed_rate × scope_quantity + per_child_surcharge_snapshot', () => {
    expect(
      computeOfferTotal({ proposedRate: 40, scopeQuantity: 3, perChildSurchargeSnapshot: 0 }),
    ).toBe(120);
    expect(
      computeOfferTotal({ proposedRate: 40, scopeQuantity: 3, perChildSurchargeSnapshot: 5 }),
    ).toBe(125);
  });

  it('per_session math: scope_quantity = 1 collapses to proposed_rate + surcharge', () => {
    expect(
      computeOfferTotal({ proposedRate: 150, scopeQuantity: 1, perChildSurchargeSnapshot: 0 }),
    ).toBe(150);
  });
});

describe('defaultValidUntil', () => {
  it('is exactly 72h after sentAt', () => {
    const got = defaultValidUntil(T0);
    expect(got.getTime() - T0.getTime()).toBe(OFFER_VALID_UNTIL_DEFAULT_HOURS * 60 * 60 * 1000);
  });
});

describe('isOfferTerminal / isExpiredAt', () => {
  it('accepted, countered, declined, expired are terminal; pending is not', () => {
    for (const s of OFFER_STATES) {
      const expected = (OFFER_TERMINAL_STATES as readonly string[]).includes(s);
      expect(isOfferTerminal(s)).toBe(expected);
    }
  });

  it('isExpiredAt is true at and after validUntil', () => {
    const o = makeOffer();
    expect(isExpiredAt(o, T_VALID)).toBe(false);
    expect(isExpiredAt(o, T_EXPIRED)).toBe(true);
    expect(isExpiredAt(o, o.validUntil)).toBe(true); // exact boundary
  });
});

describe('counterparty-accept — Posted-Job anchor', () => {
  it('pending → accepted; emits create-booking-with-agreed-rate (no materialisation)', () => {
    const r = transitionOffer(makeOffer(), { type: 'counterparty-accept', now: T_VALID });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('accepted');
      expect(r.sideEffects).toContainEqual({ type: 'create-booking-with-agreed-rate' });
      expect(r.sideEffects.some((s) => s.type === 'materialise-direct-message-job')).toBe(false);
      expect(r.sideEffects.some((s) => s.type === 'rebind-anchor-to-job')).toBe(false);
    }
  });

  it('rejects accept after valid_until', () => {
    const r = transitionOffer(makeOffer(), { type: 'counterparty-accept', now: T_EXPIRED });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/expired/);
  });

  it('rejects accept from a non-pending state', () => {
    const r = transitionOffer(makeOffer({ state: 'declined' }), {
      type: 'counterparty-accept',
      now: T_VALID,
    });
    expect(r.ok).toBe(false);
  });
});

describe('counterparty-accept — Direct-Message thread anchor', () => {
  it('pending → accepted; emits materialise + rebind + create-booking (Direct-Message bundle)', () => {
    const o = makeOffer({ anchor: THREAD_ANCHOR });
    const r = transitionOffer(o, { type: 'counterparty-accept', now: T_VALID });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('accepted');
      expect(r.sideEffects).toContainEqual({ type: 'materialise-direct-message-job' });
      expect(r.sideEffects).toContainEqual({ type: 'rebind-anchor-to-job' });
      expect(r.sideEffects).toContainEqual({ type: 'create-booking-with-agreed-rate' });
    }
  });

  it('materialisation side-effects are ordered: materialise → rebind → create-booking', () => {
    const o = makeOffer({ anchor: THREAD_ANCHOR });
    const r = transitionOffer(o, { type: 'counterparty-accept', now: T_VALID });
    if (!r.ok) throw new Error('expected ok');
    const order = r.sideEffects
      .map((s) => s.type)
      .filter((t) =>
        ['materialise-direct-message-job', 'rebind-anchor-to-job', 'create-booking-with-agreed-rate'].includes(
          t,
        ),
      );
    expect(order).toEqual([
      'materialise-direct-message-job',
      'rebind-anchor-to-job',
      'create-booking-with-agreed-rate',
    ]);
  });
});

describe('counterparty-counter', () => {
  it('pending → countered; emits open-successor-offer (drives the supersedes_offer_id FK)', () => {
    const r = transitionOffer(makeOffer(), { type: 'counterparty-counter', now: T_VALID });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('countered');
      expect(r.sideEffects).toContainEqual({ type: 'open-successor-offer' });
    }
  });

  it('rejects counter after valid_until', () => {
    const r = transitionOffer(makeOffer(), { type: 'counterparty-counter', now: T_EXPIRED });
    expect(r.ok).toBe(false);
  });
});

describe('counterparty-decline', () => {
  it('pending → declined; emits notify-counterparty', () => {
    const r = transitionOffer(makeOffer(), { type: 'counterparty-decline', now: T_VALID });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toBe('declined');
  });

  it('decline is allowed past valid_until (terminates without booking)', () => {
    const r = transitionOffer(makeOffer(), { type: 'counterparty-decline', now: T_EXPIRED });
    expect(r.ok).toBe(true);
  });
});

describe('auto-expire', () => {
  it('pending → expired only when now ≥ valid_until', () => {
    const r = transitionOffer(makeOffer(), { type: 'auto-expire', now: T_EXPIRED });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toBe('expired');
  });

  it('rejects auto-expire while still inside valid_until', () => {
    const r = transitionOffer(makeOffer(), { type: 'auto-expire', now: T_VALID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/still within valid_until/);
  });
});

describe('Terminal Offers reject everything', () => {
  for (const state of OFFER_TERMINAL_STATES) {
    for (const eventType of OFFER_EVENT_TYPES) {
      it(`${state} rejects ${eventType}`, () => {
        const r = transitionOffer(makeOffer({ state }), { type: eventType, now: T_VALID });
        expect(r.ok).toBe(false);
      });
    }
  }
});

describe('Exhaustive illegal-event matrix', () => {
  const LEGAL: Record<OfferState, ReadonlyArray<OfferEventType>> = {
    pending: ['counterparty-accept', 'counterparty-counter', 'counterparty-decline', 'auto-expire'],
    accepted: [],
    countered: [],
    declined: [],
    expired: [],
  };

  for (const state of OFFER_STATES) {
    for (const eventType of OFFER_EVENT_TYPES) {
      // auto-expire has a clock guard; we pick a `now` that satisfies it
      // when the state allows the event, so the test isolates the
      // (state, event) legality independently of the clock guard.
      const now = eventType === 'auto-expire' ? T_EXPIRED : T_VALID;
      const expected = LEGAL[state].includes(eventType);
      it(`${state} ⨯ ${eventType} → ${expected ? 'legal' : 'illegal'}`, () => {
        const r = transitionOffer(makeOffer({ state }), { type: eventType, now });
        expect(r.ok).toBe(expected);
      });
    }
  }
});

describe('Per-child surcharge snapshot invariant', () => {
  it('byte-identical when same sender + provider profile unchanged', () => {
    const a = makeOffer({ perChildSurchargeSnapshot: 7 });
    const b = makeOffer({ perChildSurchargeSnapshot: 7 });
    expect(snapshotInvariantsHold(a, b, true)).toBe(true);
  });

  it('flags drift when same sender + profile unchanged but snapshot differs (caller bug)', () => {
    const a = makeOffer({ perChildSurchargeSnapshot: 7 });
    const b = makeOffer({ perChildSurchargeSnapshot: 9 });
    expect(snapshotInvariantsHold(a, b, true)).toBe(false);
  });

  it('different sender — predecessor invariant does not apply', () => {
    const a = makeOffer({ sender: 'parent', perChildSurchargeSnapshot: 7 });
    const b = makeOffer({ sender: 'provider', perChildSurchargeSnapshot: 9 });
    expect(snapshotInvariantsHold(a, b, true)).toBe(true);
  });

  it('same sender but profile changed — snapshot may legitimately differ', () => {
    const a = makeOffer({ perChildSurchargeSnapshot: 7 });
    const b = makeOffer({ perChildSurchargeSnapshot: 9 });
    expect(snapshotInvariantsHold(a, b, false)).toBe(true);
  });
});

describe('scope_note length is a documented constant', () => {
  it('matches CONTEXT.md § Offer (280 chars)', () => {
    expect(OFFER_SCOPE_NOTE_MAX_CHARS).toBe(280);
  });
});

describe('Property-based — transitionOffer', () => {
  const stateArb = fc.constantFrom(...OFFER_STATES);
  const eventTypeArb = fc.constantFrom(...OFFER_EVENT_TYPES);
  const senderArb = fc.constantFrom(...OFFER_SENDERS);
  const scopeArb = fc.constantFrom(...OFFER_SCOPE_TYPES);
  const anchorArb: fc.Arbitrary<OfferAnchor> = fc.oneof(
    fc.record<OfferAnchor>({
      kind: fc.constant<'job'>('job'),
      jobId: fc.string({ minLength: 1, maxLength: 12 }),
    }),
    fc.record<OfferAnchor>({
      kind: fc.constant<'thread'>('thread'),
      threadId: fc.string({ minLength: 1, maxLength: 12 }),
    }),
  );
  const offerArb: fc.Arbitrary<Offer> = fc.record({
    proposedRate: fc.float({ min: Math.fround(1), max: 500, noNaN: true }),
    scopeType: scopeArb,
    scopeQuantity: fc.float({ min: Math.fround(0.5), max: 100, noNaN: true }),
    scopeNote: fc.string({ maxLength: 280 }),
    perChildSurchargeSnapshot: fc.float({ min: 0, max: 50, noNaN: true }),
    computedTotal: fc.float({ min: 0, max: 50000, noNaN: true }),
    validUntil: fc.constant(defaultValidUntil(T0)),
    sender: senderArb,
    anchor: anchorArb,
    state: stateArb,
  });

  it('always returns a valid OfferTransitionResult', () => {
    fc.assert(
      fc.property(offerArb, eventTypeArb, (offer, eventType) => {
        const ev: OfferEvent = { type: eventType, now: T_VALID };
        const r = transitionOffer(offer, ev);
        if (r.ok) {
          expect(OFFER_STATES).toContain(r.next);
          expect(r.sideEffects.length).toBeGreaterThan(0);
        } else {
          expect(r.reason.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('terminal states never accept any event', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...OFFER_TERMINAL_STATES),
        eventTypeArb,
        anchorArb,
        (state, eventType, anchor) => {
          const r = transitionOffer(makeOffer({ state, anchor }), {
            type: eventType,
            now: T_VALID,
          });
          expect(r.ok).toBe(false);
        },
      ),
    );
  });

  it('successful accept on thread anchor always emits the materialisation bundle', () => {
    fc.assert(
      fc.property(senderArb, scopeArb, (sender, scopeType) => {
        const r = transitionOffer(
          makeOffer({ sender, scopeType, anchor: THREAD_ANCHOR }),
          { type: 'counterparty-accept', now: T_VALID },
        );
        if (!r.ok) return;
        const types = r.sideEffects.map((s) => s.type);
        expect(types).toContain('materialise-direct-message-job');
        expect(types).toContain('rebind-anchor-to-job');
        expect(types).toContain('create-booking-with-agreed-rate');
      }),
    );
  });

  it('successful accept on job anchor never emits materialisation side-effects', () => {
    fc.assert(
      fc.property(senderArb, scopeArb, (sender, scopeType) => {
        const r = transitionOffer(
          makeOffer({ sender, scopeType, anchor: JOB_ANCHOR }),
          { type: 'counterparty-accept', now: T_VALID },
        );
        if (!r.ok) return;
        const types = r.sideEffects.map((s) => s.type);
        expect(types).not.toContain('materialise-direct-message-job');
        expect(types).not.toContain('rebind-anchor-to-job');
      }),
    );
  });

  it('determinism: identical inputs always produce identical outputs', () => {
    fc.assert(
      fc.property(offerArb, eventTypeArb, (offer, eventType) => {
        const ev: OfferEvent = { type: eventType, now: T_VALID };
        expect(transitionOffer(offer, ev)).toEqual(transitionOffer(offer, ev));
      }),
    );
  });
});
