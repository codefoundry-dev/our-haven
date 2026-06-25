import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { US_STATES_50_PLUS_DC, type UsState } from '@our-haven/shared';

import {
  addDays,
  planErasure,
  RETENTION_HORIZONS,
} from '../retention-planner/index.js';
import {
  comprehensiveLawStates,
  DEFAULT_DELETION_RESPONSE_DAYS,
  deletionDeadline,
  deletionSlaFor,
  listPrivacyRegimes,
  STATE_PRIVACY_PATCHWORK_MODULE_VERSION,
} from './index.js';

const REQUESTED_AT = new Date('2026-06-25T12:00:00.000Z');

describe('deletionSlaFor — total coverage', () => {
  it('resolves a regime for every one of the 50 states + DC', () => {
    for (const state of US_STATES_50_PLUS_DC) {
      const regime = deletionSlaFor(state);
      expect(regime.state).toBe(state);
      expect(regime.deletionResponseDays).toBeGreaterThan(0);
      expect(regime.extensionDays).toBeGreaterThanOrEqual(0);
      expect(regime.lawName.length).toBeGreaterThan(0);
    }
  });

  it('listPrivacyRegimes returns one regime per state, no gaps', () => {
    const regimes = listPrivacyRegimes();
    expect(regimes).toHaveLength(US_STATES_50_PLUS_DC.length);
    expect(new Set(regimes.map((r) => r.state)).size).toBe(US_STATES_50_PLUS_DC.length);
  });
});

describe('regime classification', () => {
  it('California is the CCPA/CPRA statute with a 45-day window', () => {
    const ca = deletionSlaFor('CA');
    expect(ca.source).toBe('statute');
    expect(ca.law).toBe('CCPA/CPRA');
    expect(ca.deletionResponseDays).toBe(45);
  });

  it('Iowa (ICDPA) carries the 90-day outlier window', () => {
    const ia = deletionSlaFor('IA');
    expect(ia.source).toBe('statute');
    expect(ia.deletionResponseDays).toBe(90);
  });

  it('Florida (FDBR) carries the shorter 15-day extension', () => {
    const fl = deletionSlaFor('FL');
    expect(fl.source).toBe('statute');
    expect(fl.law).toBe('FDBR');
    expect(fl.extensionDays).toBe(15);
  });

  it('a no-comprehensive-law state resolves to the federal floor with the house default', () => {
    // Alabama has no comprehensive consumer-privacy statute at the launch window.
    const al = deletionSlaFor('AL');
    expect(al.source).toBe('platform-default');
    expect(al.law).toBeNull();
    expect(al.deletionResponseDays).toBe(DEFAULT_DELETION_RESPONSE_DAYS);
  });

  it('comprehensiveLawStates lists only statute regimes and includes the known wave', () => {
    const states = comprehensiveLawStates();
    for (const s of states) {
      expect(deletionSlaFor(s).source).toBe('statute');
    }
    for (const known of ['CA', 'VA', 'CO', 'CT', 'UT', 'TX', 'FL', 'IA'] as UsState[]) {
      expect(states).toContain(known);
    }
  });
});

describe('deletionDeadline', () => {
  it('adds the response window to the request date', () => {
    expect(deletionDeadline('CA', REQUESTED_AT)).toEqual(addDays(REQUESTED_AT, 45));
  });

  it('adds the extension window when requested', () => {
    // CA: 45 + 45 = 90 days.
    expect(deletionDeadline('CA', REQUESTED_AT, true)).toEqual(addDays(REQUESTED_AT, 90));
    // FL: 45 + 15 = 60 days.
    expect(deletionDeadline('FL', REQUESTED_AT, true)).toEqual(addDays(REQUESTED_AT, 60));
  });

  it('Iowa deadline is 90 days out without an extension', () => {
    expect(deletionDeadline('IA', REQUESTED_AT)).toEqual(addDays(REQUESTED_AT, 90));
  });
});

// ---------------------------------------------------------------------------
// Cross-module compliance invariant: the federal-uniform retention rules must
// satisfy every state's deletion-right SLA. The account is hard-deleted after a
// 30-day grace, which must fall on/before the state's (un-extended) deadline.
// ---------------------------------------------------------------------------

describe('cross-module — account erasure honours every state SLA', () => {
  it('account hard-delete (+30d) is on/before the un-extended deadline in every state', () => {
    for (const state of US_STATES_50_PLUS_DC) {
      const plan = planErasure({
        trigger: 'account-deletion',
        subjectUserId: 'usr_x',
        requestedAt: REQUESTED_AT,
      });
      const accountHardDelete = plan.find((d) => d.category === 'account' && d.action === 'hard-delete')!;
      const deadline = deletionDeadline(state, REQUESTED_AT);
      expect(accountHardDelete.dueAt.getTime()).toBeLessThanOrEqual(deadline.getTime());
    }
  });

  it('the 30-day grace is strictly inside even the strictest state window', () => {
    const strictestDays = Math.min(...US_STATES_50_PLUS_DC.map((s) => deletionSlaFor(s).deletionResponseDays));
    expect(RETENTION_HORIZONS.ACCOUNT_GRACE_DAYS).toBeLessThan(strictestDays);
  });
});

describe('property-based', () => {
  const arbDate = fc
    .integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2030, 0, 1) })
    .map((ms) => new Date(ms));
  const arbState = fc.constantFrom(...US_STATES_50_PLUS_DC);

  it('the extended deadline is always on/after the un-extended deadline', () => {
    fc.assert(
      fc.property(arbState, arbDate, (state, requestedAt) => {
        const base = deletionDeadline(state, requestedAt).getTime();
        const extended = deletionDeadline(state, requestedAt, true).getTime();
        expect(extended).toBeGreaterThanOrEqual(base);
      }),
    );
  });

  it('every deadline is strictly after the request', () => {
    fc.assert(
      fc.property(arbState, arbDate, (state, requestedAt) => {
        expect(deletionDeadline(state, requestedAt).getTime()).toBeGreaterThan(requestedAt.getTime());
      }),
    );
  });
});

describe('module metadata', () => {
  it('exposes a version tagged to OH-182', () => {
    expect(STATE_PRIVACY_PATCHWORK_MODULE_VERSION).toContain('OH-182');
  });
});
