import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  APPLICATION_EVENT_TYPES,
  APPLICATION_ORIGINS,
  APPLICATION_STATES,
  APPLICATION_TERMINAL_STATES,
  countsAgainstJobCap,
  initialApplicationState,
  isApplicationTerminal,
  transitionApplication,
  type Application,
  type ApplicationEvent,
  type ApplicationEventType,
  type ApplicationOrigin,
  type ApplicationShape,
  type ApplicationState,
} from './index.js';

const POSTED: ApplicationShape = { origin: 'posted' };
const DM: ApplicationShape = { origin: 'direct-message' };

function appAt(shape: ApplicationShape, state: ApplicationState): Application {
  return { ...shape, state };
}

describe('initialApplicationState', () => {
  it('Posted Applications are born submitted', () => {
    expect(initialApplicationState(POSTED)).toBe('submitted');
  });

  it('Direct-Message Applications are born awarded', () => {
    expect(initialApplicationState(DM)).toBe('awarded');
  });
});

describe('isApplicationTerminal', () => {
  it('awarded, declined, withdrawn, expired are terminal; submitted/countered are not', () => {
    for (const s of APPLICATION_STATES) {
      const expected = (APPLICATION_TERMINAL_STATES as readonly string[]).includes(s);
      expect(isApplicationTerminal(s)).toBe(expected);
    }
  });
});

describe('countsAgainstJobCap', () => {
  it('only submitted and countered count toward the 15-cap', () => {
    expect(countsAgainstJobCap('submitted')).toBe(true);
    expect(countsAgainstJobCap('countered')).toBe(true);
    expect(countsAgainstJobCap('awarded')).toBe(false);
    expect(countsAgainstJobCap('declined')).toBe(false);
    expect(countsAgainstJobCap('withdrawn')).toBe(false);
    expect(countsAgainstJobCap('expired')).toBe(false);
  });
});

describe('Posted-Job Application transitions', () => {
  it('submitted → countered (parent-counter) — supersedes previous Offer + notifies caregiver', () => {
    const r = transitionApplication(appAt(POSTED, 'submitted'), { type: 'parent-counter' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('countered');
      expect(r.sideEffects).toContainEqual({ type: 'supersede-previous-offer' });
      expect(r.sideEffects).toContainEqual({ type: 'notify-caregiver' });
    }
  });

  it('submitted → countered (caregiver-counter) — notifies parent', () => {
    const r = transitionApplication(appAt(POSTED, 'submitted'), { type: 'caregiver-counter' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('countered');
      expect(r.sideEffects).toContainEqual({ type: 'notify-parent' });
    }
  });

  it('countered → countered (re-counter) — chain stays open', () => {
    const r = transitionApplication(appAt(POSTED, 'countered'), { type: 'caregiver-counter' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toBe('countered');
  });

  it('submitted → awarded (parent-award) — drives Job to awarded + creates Booking', () => {
    const r = transitionApplication(appAt(POSTED, 'submitted'), { type: 'parent-award' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('awarded');
      expect(r.sideEffects).toContainEqual({ type: 'transition-job-to-awarded' });
      expect(r.sideEffects).toContainEqual({ type: 'create-booking-from-offer' });
    }
  });

  it('countered → awarded (parent-award) — Parent accepts the latest counter', () => {
    const r = transitionApplication(appAt(POSTED, 'countered'), { type: 'parent-award' });
    expect(r.ok && r.next).toBe('awarded');
  });

  it('submitted → declined (parent-decline)', () => {
    const r = transitionApplication(appAt(POSTED, 'submitted'), { type: 'parent-decline' });
    expect(r.ok && r.next).toBe('declined');
  });

  it('submitted → withdrawn (caregiver-withdraw)', () => {
    const r = transitionApplication(appAt(POSTED, 'submitted'), { type: 'caregiver-withdraw' });
    expect(r.ok && r.next).toBe('withdrawn');
  });

  it('submitted → declined (auto-decline) — fired by Job.award on losers', () => {
    const r = transitionApplication(appAt(POSTED, 'submitted'), { type: 'auto-decline' });
    expect(r.ok && r.next).toBe('declined');
  });

  it('submitted → expired (job-expired) — fired by Job.auto-expire / Job.parent-cancel', () => {
    const r = transitionApplication(appAt(POSTED, 'submitted'), { type: 'job-expired' });
    expect(r.ok && r.next).toBe('expired');
  });
});

describe('Direct-Message Applications are terminal at birth', () => {
  for (const eventType of APPLICATION_EVENT_TYPES) {
    it(`rejects ${eventType}`, () => {
      const r = transitionApplication(appAt(DM, 'awarded'), { type: eventType });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/direct-message/);
    });
  }
});

describe('Terminal Posted-Job Applications reject everything', () => {
  for (const state of APPLICATION_TERMINAL_STATES) {
    for (const eventType of APPLICATION_EVENT_TYPES) {
      it(`${state} rejects ${eventType}`, () => {
        const r = transitionApplication(appAt(POSTED, state), { type: eventType });
        expect(r.ok).toBe(false);
      });
    }
  }
});

describe('Exhaustive illegal-event matrix — Posted Applications', () => {
  const ACTIONABLE: ReadonlyArray<ApplicationEventType> = [
    'parent-counter',
    'caregiver-counter',
    'parent-award',
    'parent-decline',
    'caregiver-withdraw',
    'auto-decline',
    'job-expired',
  ];
  const LEGAL: Record<ApplicationState, ReadonlyArray<ApplicationEventType>> = {
    submitted: ACTIONABLE,
    countered: ACTIONABLE,
    awarded: [],
    declined: [],
    withdrawn: [],
    expired: [],
  };

  for (const state of APPLICATION_STATES) {
    for (const eventType of APPLICATION_EVENT_TYPES) {
      const expected = LEGAL[state].includes(eventType);
      it(`posted ${state} ⨯ ${eventType} → ${expected ? 'legal' : 'illegal'}`, () => {
        const r = transitionApplication(appAt(POSTED, state), { type: eventType });
        expect(r.ok).toBe(expected);
      });
    }
  }
});

describe('Job-Application lockstep on Award', () => {
  it('parent-award emits transition-job-to-awarded so the handler can fire Job.award atomically', () => {
    const r = transitionApplication(appAt(POSTED, 'submitted'), { type: 'parent-award' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sideEffects.some((s) => s.type === 'transition-job-to-awarded')).toBe(true);
    }
  });

  it('auto-decline (from Job.award side-effect) does NOT re-fire transition-job-to-awarded', () => {
    const r = transitionApplication(appAt(POSTED, 'submitted'), { type: 'auto-decline' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sideEffects.every((s) => s.type !== 'transition-job-to-awarded')).toBe(true);
    }
  });
});

describe('Property-based — transitionApplication', () => {
  const stateArb = fc.constantFrom(...APPLICATION_STATES);
  const originArb = fc.constantFrom(...APPLICATION_ORIGINS);
  const eventArb: fc.Arbitrary<ApplicationEvent> = fc
    .constantFrom(...APPLICATION_EVENT_TYPES)
    .map((type) => ({ type }));
  const appArb: fc.Arbitrary<Application> = fc.record({
    origin: originArb,
    state: stateArb,
  });

  it('always returns either ok:true with a valid ApplicationState or ok:false with a reason', () => {
    fc.assert(
      fc.property(appArb, eventArb, (app, event) => {
        const r = transitionApplication(app, event);
        if (r.ok) {
          expect(APPLICATION_STATES).toContain(r.next);
        } else {
          expect(r.reason.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('terminal Posted-Job states never accept any event', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...APPLICATION_TERMINAL_STATES),
        eventArb,
        (state, event) => {
          const r = transitionApplication({ origin: 'posted', state }, event);
          expect(r.ok).toBe(false);
        },
      ),
    );
  });

  it('direct-message applications reject every event from every state', () => {
    fc.assert(
      fc.property(stateArb, eventArb, (state, event) => {
        const r = transitionApplication({ origin: 'direct-message', state }, event);
        expect(r.ok).toBe(false);
      }),
    );
  });

  it('determinism: identical inputs always produce identical outputs', () => {
    fc.assert(
      fc.property(appArb, eventArb, (app, event) => {
        const a = transitionApplication(app, event);
        const b = transitionApplication(app, event);
        expect(a).toEqual(b);
      }),
    );
  });

  it('successful transitions out of submitted/countered always land in a valid follow-on state', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ApplicationState>('submitted', 'countered'),
        eventArb,
        (state, event) => {
          const r = transitionApplication({ origin: 'posted', state }, event);
          if (!r.ok) return;
          expect([
            'countered',
            'awarded',
            'declined',
            'withdrawn',
            'expired',
          ]).toContain(r.next);
        },
      ),
    );
  });
});
