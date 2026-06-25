import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  canAcceptApplication,
  initialJobSideEffects,
  initialJobState,
  isJobTerminal,
  JOB_APPLICATION_CAP,
  JOB_EVENT_TYPES,
  JOB_OPEN_TTL_DAYS,
  JOB_ORIGINS,
  JOB_STATES,
  JOB_TERMINAL_STATES,
  transitionJob,
  type Job,
  type JobEvent,
  type JobEventType,
  type JobOrigin,
  type JobShape,
  type JobState,
} from './index.js';

const POSTED: JobShape = { origin: 'posted' };
const DM: JobShape = { origin: 'direct-message' };

function jobAt(shape: JobShape, state: JobState): Job {
  return { ...shape, state };
}

describe('initialJobState', () => {
  it('Posted Jobs are born draft', () => {
    expect(initialJobState(POSTED)).toBe('draft');
  });

  it('Direct-Message Jobs are born awarded', () => {
    expect(initialJobState(DM)).toBe('awarded');
  });
});

describe('initialJobSideEffects', () => {
  it('Posted Jobs in draft emit no side-effects (Parent is still composing)', () => {
    expect(initialJobSideEffects(POSTED)).toEqual([]);
  });

  it('Direct-Message Jobs emit thread-rebind + booking-creation at materialisation', () => {
    expect(initialJobSideEffects(DM)).toEqual([
      { type: 'rebind-thread-to-job' },
      { type: 'create-booking-from-offer' },
    ]);
  });
});

describe('isJobTerminal', () => {
  it('expired, cancelled, closed are terminal; awarded is not', () => {
    for (const s of JOB_STATES) {
      const expected = (JOB_TERMINAL_STATES as readonly string[]).includes(s);
      expect(isJobTerminal(s)).toBe(expected);
    }
    expect(isJobTerminal('awarded')).toBe(false);
  });
});

describe('canAcceptApplication', () => {
  it('only open Posted Jobs with < 15 applications accept new ones', () => {
    expect(canAcceptApplication(jobAt(POSTED, 'open'), 0)).toBe(true);
    expect(canAcceptApplication(jobAt(POSTED, 'open'), JOB_APPLICATION_CAP - 1)).toBe(true);
    expect(canAcceptApplication(jobAt(POSTED, 'open'), JOB_APPLICATION_CAP)).toBe(false);
    expect(canAcceptApplication(jobAt(POSTED, 'open'), JOB_APPLICATION_CAP + 1)).toBe(false);
  });

  it('rejects when Job is not open', () => {
    for (const s of JOB_STATES) {
      if (s === 'open') continue;
      expect(canAcceptApplication(jobAt(POSTED, s), 0)).toBe(false);
    }
  });

  it('rejects Direct-Message Jobs regardless of count (they carry exactly one Application by construction)', () => {
    for (const s of JOB_STATES) {
      expect(canAcceptApplication(jobAt(DM, s), 0)).toBe(false);
    }
  });
});

describe('Posted-Job happy path', () => {
  it('draft → open (publish) — schedules 14d expiry + notifies category Caregivers', () => {
    const r = transitionJob(jobAt(POSTED, 'draft'), { type: 'publish' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('open');
      expect(r.sideEffects).toContainEqual({ type: 'notify-caregivers-in-category' });
      expect(r.sideEffects).toContainEqual({ type: 'schedule-job-expiry-14d' });
    }
  });

  it('open → awarded (award) — creates booking + auto-declines losers + notifies applicants', () => {
    const r = transitionJob(jobAt(POSTED, 'open'), { type: 'award' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('awarded');
      expect(r.sideEffects).toContainEqual({ type: 'create-booking-from-offer' });
      expect(r.sideEffects).toContainEqual({ type: 'auto-decline-losing-applications' });
      expect(r.sideEffects).toContainEqual({ type: 'notify-applicants' });
    }
  });

  it('awarded → closed (booking-resolved)', () => {
    const r = transitionJob(jobAt(POSTED, 'awarded'), { type: 'booking-resolved' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toBe('closed');
  });

  it('14d auto-expire is exposed as a constant', () => {
    expect(JOB_OPEN_TTL_DAYS).toBe(14);
  });
});

describe('Posted-Job negative paths', () => {
  it('open → expired (auto-expire) — notifies parent + marks applications expired', () => {
    const r = transitionJob(jobAt(POSTED, 'open'), { type: 'auto-expire' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('expired');
      expect(r.sideEffects).toContainEqual({ type: 'notify-parent' });
      expect(r.sideEffects).toContainEqual({ type: 'mark-applications-expired' });
    }
  });

  it('draft → cancelled (parent-cancel) — silent (no applications yet)', () => {
    const r = transitionJob(jobAt(POSTED, 'draft'), { type: 'parent-cancel' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('cancelled');
      expect(r.sideEffects).toEqual([]);
    }
  });

  it('open → cancelled (parent-cancel) — notifies applicants + marks them expired', () => {
    const r = transitionJob(jobAt(POSTED, 'open'), { type: 'parent-cancel' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('cancelled');
      expect(r.sideEffects).toContainEqual({ type: 'notify-applicants' });
      expect(r.sideEffects).toContainEqual({ type: 'mark-applications-expired' });
    }
  });

  it('awarded → cancelled is rejected (Booking lifecycle owns cancellation post-Award)', () => {
    const r = transitionJob(jobAt(POSTED, 'awarded'), { type: 'parent-cancel' });
    expect(r.ok).toBe(false);
  });
});

describe('Direct-Message Job', () => {
  it('rejects publish (born awarded)', () => {
    const r = transitionJob(jobAt(DM, 'awarded'), { type: 'publish' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/posted/);
  });

  it('rejects award (already awarded by materialisation)', () => {
    const r = transitionJob(jobAt(DM, 'awarded'), { type: 'award' });
    expect(r.ok).toBe(false);
  });

  it('rejects auto-expire (no open state to time out)', () => {
    const r = transitionJob(jobAt(DM, 'awarded'), { type: 'auto-expire' });
    expect(r.ok).toBe(false);
  });

  it('rejects parent-cancel (no pre-Booking phase)', () => {
    const r = transitionJob(jobAt(DM, 'awarded'), { type: 'parent-cancel' });
    expect(r.ok).toBe(false);
  });

  it('accepts materialise-direct-message — yields rebind-thread + create-booking', () => {
    const r = transitionJob(jobAt(DM, 'awarded'), { type: 'materialise-direct-message' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.next).toBe('awarded');
      expect(r.sideEffects).toEqual([
        { type: 'rebind-thread-to-job' },
        { type: 'create-booking-from-offer' },
      ]);
    }
  });

  it('accepts booking-resolved → closed (same as Posted)', () => {
    const r = transitionJob(jobAt(DM, 'awarded'), { type: 'booking-resolved' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next).toBe('closed');
  });

  it('rejects materialise on a Posted Job', () => {
    const r = transitionJob(jobAt(POSTED, 'awarded'), { type: 'materialise-direct-message' });
    expect(r.ok).toBe(false);
  });
});

describe('Terminal states reject all events', () => {
  for (const state of JOB_TERMINAL_STATES) {
    for (const eventType of JOB_EVENT_TYPES) {
      it(`${state} rejects ${eventType}`, () => {
        const r = transitionJob(jobAt(POSTED, state), { type: eventType });
        expect(r.ok).toBe(false);
      });
    }
  }
});

describe('Exhaustive illegal-event matrix — Posted Jobs', () => {
  const LEGAL: Record<JobState, ReadonlyArray<JobEventType>> = {
    draft: ['publish', 'parent-cancel'],
    open: ['award', 'auto-expire', 'parent-cancel'],
    awarded: ['booking-resolved'],
    expired: [],
    cancelled: [],
    closed: [],
  };

  for (const state of JOB_STATES) {
    for (const eventType of JOB_EVENT_TYPES) {
      const expected = LEGAL[state].includes(eventType);
      it(`posted ${state} ⨯ ${eventType} → ${expected ? 'legal' : 'illegal'}`, () => {
        const r = transitionJob(jobAt(POSTED, state), { type: eventType });
        expect(r.ok).toBe(expected);
      });
    }
  }
});

describe('Exhaustive illegal-event matrix — Direct-Message Jobs', () => {
  const LEGAL: Record<JobState, ReadonlyArray<JobEventType>> = {
    draft: [],
    open: [],
    awarded: ['booking-resolved', 'materialise-direct-message'],
    expired: [],
    cancelled: [],
    closed: [],
  };

  for (const state of JOB_STATES) {
    for (const eventType of JOB_EVENT_TYPES) {
      const expected = LEGAL[state].includes(eventType);
      it(`direct-message ${state} ⨯ ${eventType} → ${expected ? 'legal' : 'illegal'}`, () => {
        const r = transitionJob(jobAt(DM, state), { type: eventType });
        expect(r.ok).toBe(expected);
      });
    }
  }
});

describe('Property-based — transitionJob', () => {
  const stateArb = fc.constantFrom(...JOB_STATES);
  const originArb = fc.constantFrom(...JOB_ORIGINS);
  const eventArb: fc.Arbitrary<JobEvent> = fc
    .constantFrom(...JOB_EVENT_TYPES)
    .map((type) => ({ type }));
  const jobArb: fc.Arbitrary<Job> = fc.record({
    origin: originArb,
    state: stateArb,
  });

  it('always returns either ok:true with a valid JobState or ok:false with a reason', () => {
    fc.assert(
      fc.property(jobArb, eventArb, (job, event) => {
        const r = transitionJob(job, event);
        if (r.ok) {
          expect(JOB_STATES).toContain(r.next);
          for (const sfx of r.sideEffects) {
            expect(typeof sfx.type).toBe('string');
          }
        } else {
          expect(typeof r.reason).toBe('string');
          expect(r.reason.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('terminal states never accept any event', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...JOB_TERMINAL_STATES),
        originArb,
        eventArb,
        (state, origin, event) => {
          const r = transitionJob({ state, origin }, event);
          expect(r.ok).toBe(false);
        },
      ),
    );
  });

  it('determinism: identical inputs always produce identical outputs', () => {
    fc.assert(
      fc.property(jobArb, eventArb, (job, event) => {
        const a = transitionJob(job, event);
        const b = transitionJob(job, event);
        expect(a).toEqual(b);
      }),
    );
  });

  it('Direct-Message Jobs never legally transition out of awarded except to closed', () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        const r = transitionJob({ origin: 'direct-message', state: 'awarded' }, event);
        if (!r.ok) return;
        // The only state-changing event is booking-resolved → closed;
        // materialise-direct-message is a no-op (stays awarded).
        expect(['awarded', 'closed']).toContain(r.next);
      }),
    );
  });

  it('Posted Jobs in draft accept only publish and parent-cancel', () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        const r = transitionJob({ origin: 'posted', state: 'draft' }, event);
        if (r.ok) {
          expect(['publish', 'parent-cancel']).toContain(event.type);
        }
      }),
    );
  });

  it('monotonicity along the Posted-Job spine — successful transitions never go backwards', () => {
    const ORDINAL: Record<JobState, number> = {
      draft: 0,
      open: 1,
      awarded: 2,
      expired: 2,
      cancelled: 2,
      closed: 3,
    };
    fc.assert(
      fc.property(jobArb, eventArb, (job, event) => {
        const r = transitionJob(job, event);
        if (!r.ok) return;
        expect(ORDINAL[r.next]).toBeGreaterThanOrEqual(ORDINAL[job.state]);
      }),
    );
  });
});
