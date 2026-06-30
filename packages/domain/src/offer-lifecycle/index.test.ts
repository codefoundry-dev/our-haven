import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { OfferSchedule } from './index.js';
import {
  canCounter,
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
import { computeOfferTotal, offerTotalIsConsistent } from './total.js';

const T0 = new Date('2026-05-28T12:00:00.000Z');
const T_VALID = new Date('2026-05-30T12:00:00.000Z'); // 48h after T0 (< 72h default)
const T_EXPIRED = new Date('2026-06-02T12:00:00.000Z'); // 5d after T0 (> 72h default)

const JOB_ANCHOR: OfferAnchor = { kind: 'job', jobId: 'job_123' };
const THREAD_ANCHOR: OfferAnchor = { kind: 'thread', threadId: 'thr_abc' };

// 18:00–22:00 = 4h, matching scopeQuantity below.
const ONE_OFF: OfferSchedule = {
  kind: 'one-off',
  slot: { date: '2026-05-30', startMin: 1080, endMin: 1320 },
};

function makeOffer(overrides?: Partial<OfferShape & { state: OfferState }>): Offer {
  return {
    proposedRate: 3500, // $35/hr in cents
    scopeType: 'hourly',
    scopeQuantity: 4,
    scopeNote: 'Saturday evening, two kids',
    childCount: 2,
    category: 'babysitter',
    perChildSurchargeSnapshot: 500, // $5/hr per extra child, cents
    computedTotal: 3500 * 4 + 500 * 4 * 1, // base 14000 + surcharge 2000 = 16000
    validUntil: defaultValidUntil(T0),
    sender: 'parent',
    negotiable: true,
    anchor: JOB_ANCHOR,
    schedule: ONE_OFF,
    state: 'pending',
    ...overrides,
  };
}

describe('initialOfferState', () => {
  it('newly-sent Offers are born pending', () => {
    expect(initialOfferState()).toBe('pending');
  });
});

describe('computeOfferTotal (delegates to the Pricing calculator)', () => {
  it('base only when single-child / no surcharge', () => {
    expect(
      computeOfferTotal({
        proposedRate: 4000,
        scopeQuantity: 3,
        childCount: 1,
        perChildSurchargeSnapshot: 0,
        category: 'babysitter',
      }),
    ).toBe(12000);
  });

  it('adds per-child surcharge × hours × (childCount − 1) — the Pricing model', () => {
    expect(
      computeOfferTotal({
        proposedRate: 4000,
        scopeQuantity: 3,
        childCount: 2,
        perChildSurchargeSnapshot: 500,
        category: 'babysitter',
      }),
    ).toBe(12000 + 500 * 3 * 1); // 13500
  });

  it('Tutor single-child collapses to base', () => {
    expect(
      computeOfferTotal({
        proposedRate: 15000,
        scopeQuantity: 1,
        childCount: 1,
        perChildSurchargeSnapshot: 0,
        category: 'tutor',
      }),
    ).toBe(15000);
  });

  it('throws on a Tutor with > 1 child (caller bug — surfaced via Pricing)', () => {
    expect(() =>
      computeOfferTotal({
        proposedRate: 15000,
        scopeQuantity: 1,
        childCount: 2,
        perChildSurchargeSnapshot: 0,
        category: 'tutor',
      }),
    ).toThrow();
  });
});

describe('offerTotalIsConsistent', () => {
  it('true when computedTotal matches the canonical recompute', () => {
    expect(offerTotalIsConsistent(makeOffer())).toBe(true);
  });

  it('false when the stored snapshot has drifted', () => {
    expect(offerTotalIsConsistent(makeOffer({ computedTotal: 99999 }))).toBe(false);
  });
});

describe('defaultValidUntil', () => {
  it('is exactly 72h after sentAt', () => {
    const got = defaultValidUntil(T0);
    expect(got.getTime() - T0.getTime()).toBe(OFFER_VALID_UNTIL_DEFAULT_HOURS * 60 * 60 * 1000);
  });
});

describe('scope types — per_session retired (ADR-0011)', () => {
  it('hourly is the only scope type', () => {
    expect(OFFER_SCOPE_TYPES).toEqual(['hourly']);
  });
});

describe('senders — caregiver replaced the old "provider" (ADR-0011)', () => {
  it('parent and caregiver only', () => {
    expect(OFFER_SENDERS).toEqual(['parent', 'caregiver']);
  });
});

describe('isOfferTerminal / isExpiredAt', () => {
  it('countered, declined, expired, withdrawn are terminal; pending + accepted are not', () => {
    for (const s of OFFER_STATES) {
      const expected = (OFFER_TERMINAL_STATES as readonly string[]).includes(s);
      expect(isOfferTerminal(s)).toBe(expected);
    }
    // accepted is explicitly NOT terminal — a sender may still withdraw it.
    expect(isOfferTerminal('accepted')).toBe(false);
  });

  it('isExpiredAt is true at and after validUntil', () => {
    const o = makeOffer();
    expect(isExpiredAt(o, T_VALID)).toBe(false);
    expect(isExpiredAt(o, T_EXPIRED)).toBe(true);
    expect(isExpiredAt(o, o.validUntil)).toBe(true); // exact boundary
  });
});

describe('canCounter (negotiable gate — ADR-0017)', () => {
  it('true only for a pending offer whose caregiver has negotiable on', () => {
    expect(canCounter(makeOffer({ negotiable: true }))).toBe(true);
    expect(canCounter(makeOffer({ negotiable: false }))).toBe(false);
    expect(canCounter(makeOffer({ state: 'accepted', negotiable: true }))).toBe(false);
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
        [
          'materialise-direct-message-job',
          'rebind-anchor-to-job',
          'create-booking-with-agreed-rate',
        ].includes(t),
      );
    expect(order).toEqual([
      'materialise-direct-message-job',
      'rebind-anchor-to-job',
      'create-booking-with-agreed-rate',
    ]);
  });
});

describe('counterparty-counter (gated by negotiable)', () => {
  it('pending → countered when negotiable; emits open-successor-offer', () => {
    const r = transitionOffer(makeOffer({ negotiable: true }), {
      type: 'counterparty-counter',
      now: T_VALID,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('countered');
      expect(r.sideEffects).toContainEqual({ type: 'open-successor-offer' });
    }
  });

  it('refuses counter when the caregiver has negotiable off (ADR-0017)', () => {
    const r = transitionOffer(makeOffer({ negotiable: false }), {
      type: 'counterparty-counter',
      now: T_VALID,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/negotiable/);
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

describe('sender-withdraw', () => {
  it('pending → withdrawn; notify only (no booking exists yet, no cascade)', () => {
    const r = transitionOffer(makeOffer({ state: 'pending' }), {
      type: 'sender-withdraw',
      now: T_VALID,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('withdrawn');
      expect(r.sideEffects).toEqual([{ type: 'notify-counterparty' }]);
    }
  });

  it('accepted → withdrawn; cascade-cancels the materialised Booking(s)/Series', () => {
    const r = transitionOffer(makeOffer({ state: 'accepted' }), {
      type: 'sender-withdraw',
      now: T_VALID,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('withdrawn');
      expect(r.sideEffects).toContainEqual({ type: 'cascade-cancel-materialised-bookings' });
      expect(r.sideEffects).toContainEqual({ type: 'notify-counterparty' });
    }
  });

  it('rejects withdraw from countered / declined / expired / withdrawn', () => {
    for (const state of ['countered', 'declined', 'expired', 'withdrawn'] as const) {
      const r = transitionOffer(makeOffer({ state }), { type: 'sender-withdraw', now: T_VALID });
      expect(r.ok).toBe(false);
    }
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

describe('accepted is non-terminal but accepts ONLY sender-withdraw', () => {
  for (const eventType of OFFER_EVENT_TYPES) {
    const expected = eventType === 'sender-withdraw';
    it(`accepted ⨯ ${eventType} → ${expected ? 'legal' : 'illegal'}`, () => {
      const r = transitionOffer(makeOffer({ state: 'accepted' }), {
        type: eventType,
        now: T_VALID,
      });
      expect(r.ok).toBe(expected);
    });
  }
});

describe('Terminal Offers reject everything', () => {
  for (const state of OFFER_TERMINAL_STATES) {
    for (const eventType of OFFER_EVENT_TYPES) {
      const now = eventType === 'auto-expire' ? T_EXPIRED : T_VALID;
      it(`${state} rejects ${eventType}`, () => {
        const r = transitionOffer(makeOffer({ state }), { type: eventType, now });
        expect(r.ok).toBe(false);
      });
    }
  }
});

describe('Exhaustive illegal-event matrix', () => {
  // negotiable on so counterparty-counter is legal from pending; the negotiable
  // gate is exercised separately above.
  const LEGAL: Record<OfferState, ReadonlyArray<OfferEventType>> = {
    pending: [
      'counterparty-accept',
      'counterparty-counter',
      'counterparty-decline',
      'sender-withdraw',
      'auto-expire',
    ],
    accepted: ['sender-withdraw'],
    countered: [],
    declined: [],
    expired: [],
    withdrawn: [],
  };

  for (const state of OFFER_STATES) {
    for (const eventType of OFFER_EVENT_TYPES) {
      // Pick a `now` that satisfies the clock guard when the event is allowed,
      // so the test isolates (state, event) legality from the clock.
      const now = eventType === 'auto-expire' ? T_EXPIRED : T_VALID;
      const expected = LEGAL[state].includes(eventType);
      it(`${state} ⨯ ${eventType} → ${expected ? 'legal' : 'illegal'}`, () => {
        const r = transitionOffer(makeOffer({ state, negotiable: true }), {
          type: eventType,
          now,
        });
        expect(r.ok).toBe(expected);
      });
    }
  }
});

describe('Per-child surcharge snapshot invariant', () => {
  it('byte-identical when same sender + caregiver profile unchanged', () => {
    const a = makeOffer({ perChildSurchargeSnapshot: 700 });
    const b = makeOffer({ perChildSurchargeSnapshot: 700 });
    expect(snapshotInvariantsHold(a, b, true)).toBe(true);
  });

  it('flags drift when same sender + profile unchanged but snapshot differs (caller bug)', () => {
    const a = makeOffer({ perChildSurchargeSnapshot: 700 });
    const b = makeOffer({ perChildSurchargeSnapshot: 900 });
    expect(snapshotInvariantsHold(a, b, true)).toBe(false);
  });

  it('different sender — predecessor invariant does not apply', () => {
    const a = makeOffer({ sender: 'parent', perChildSurchargeSnapshot: 700 });
    const b = makeOffer({ sender: 'caregiver', perChildSurchargeSnapshot: 900 });
    expect(snapshotInvariantsHold(a, b, true)).toBe(true);
  });

  it('same sender but profile changed — snapshot may legitimately differ', () => {
    const a = makeOffer({ perChildSurchargeSnapshot: 700 });
    const b = makeOffer({ perChildSurchargeSnapshot: 900 });
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
  // transitionOffer never recomputes pricing, so the snapshot fields are free.
  const offerArb: fc.Arbitrary<Offer> = fc.record({
    proposedRate: fc.integer({ min: 100, max: 50000 }),
    scopeType: fc.constant<'hourly'>('hourly'),
    scopeQuantity: fc.float({ min: Math.fround(0.5), max: 100, noNaN: true }),
    scopeNote: fc.string({ maxLength: 280 }),
    childCount: fc.integer({ min: 1, max: 4 }),
    category: fc.constantFrom('babysitter' as const, 'nanny' as const),
    perChildSurchargeSnapshot: fc.integer({ min: 0, max: 5000 }),
    computedTotal: fc.integer({ min: 0, max: 5_000_000 }),
    validUntil: fc.constant(defaultValidUntil(T0)),
    sender: senderArb,
    negotiable: fc.boolean(),
    anchor: anchorArb,
    schedule: fc.constant(ONE_OFF),
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

  it('counter is refused whenever the offer is non-negotiable', () => {
    fc.assert(
      fc.property(senderArb, anchorArb, (sender, anchor) => {
        const r = transitionOffer(makeOffer({ sender, anchor, negotiable: false }), {
          type: 'counterparty-counter',
          now: T_VALID,
        });
        expect(r.ok).toBe(false);
      }),
    );
  });

  it('successful accept on thread anchor always emits the materialisation bundle', () => {
    fc.assert(
      fc.property(senderArb, (sender) => {
        const r = transitionOffer(makeOffer({ sender, anchor: THREAD_ANCHOR }), {
          type: 'counterparty-accept',
          now: T_VALID,
        });
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
      fc.property(senderArb, (sender) => {
        const r = transitionOffer(makeOffer({ sender, anchor: JOB_ANCHOR }), {
          type: 'counterparty-accept',
          now: T_VALID,
        });
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
