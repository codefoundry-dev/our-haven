import { describe, expect, it } from 'vitest';

import { US_STATES_50_PLUS_DC, type UsState } from '@our-haven/shared';

import {
  HOME_CHILDCARE_LICENSE_BOARD_LAUNCH_STATES,
  deriveStateRegisteredHomeChildcareBadge,
  findHomeChildcareLicenseBoard,
  isHomeChildcareLicenseBoardLaunchState,
  listHomeChildcareLicenseBoardSlate,
} from './index.js';

describe('home-childcare-license-board adapter slate', () => {
  it('lists exactly 12 launch states', () => {
    expect(HOME_CHILDCARE_LICENSE_BOARD_LAUNCH_STATES).toHaveLength(12);
    expect(new Set(HOME_CHILDCARE_LICENSE_BOARD_LAUNCH_STATES).size).toBe(12);
  });

  it('only contains valid US states', () => {
    for (const s of HOME_CHILDCARE_LICENSE_BOARD_LAUNCH_STATES) {
      expect((US_STATES_50_PLUS_DC as readonly string[]).includes(s)).toBe(true);
    }
  });

  it('covers each launch state with a board exactly once', () => {
    const slate = listHomeChildcareLicenseBoardSlate();
    expect(slate).toHaveLength(HOME_CHILDCARE_LICENSE_BOARD_LAUNCH_STATES.length);
    const states = new Set(slate.map((b) => b.state));
    expect(states.size).toBe(slate.length);
    for (const state of HOME_CHILDCARE_LICENSE_BOARD_LAUNCH_STATES) {
      const board = findHomeChildcareLicenseBoard(state);
      expect(board, `${state} missing`).not.toBeNull();
      expect(board!.state).toBe(state);
      expect(board!.agencyName.length).toBeGreaterThan(0);
      expect(board!.programName.length).toBeGreaterThan(0);
      expect(board!.registerUrl).toMatch(/^https:\/\//);
      expect(board!.hint.length).toBeGreaterThan(0);
    }
  });

  it('returns null for non-slate states', () => {
    const nonSlate: UsState[] = (US_STATES_50_PLUS_DC as readonly UsState[]).filter(
      (s) => !(HOME_CHILDCARE_LICENSE_BOARD_LAUNCH_STATES as readonly UsState[]).includes(s),
    );
    expect(nonSlate.length).toBeGreaterThan(0);
    for (const state of nonSlate) {
      expect(findHomeChildcareLicenseBoard(state)).toBeNull();
      expect(isHomeChildcareLicenseBoardLaunchState(state)).toBe(false);
    }
  });

  it('isHomeChildcareLicenseBoardLaunchState returns true for every launch state', () => {
    for (const state of HOME_CHILDCARE_LICENSE_BOARD_LAUNCH_STATES) {
      expect(isHomeChildcareLicenseBoardLaunchState(state)).toBe(true);
    }
  });
});

describe('deriveStateRegisteredHomeChildcareBadge', () => {
  const VERIFIED_AT = new Date('2026-05-20T12:00:00.000Z');

  it('names the upload-time agency + programme on a verified decision', () => {
    const badge = deriveStateRegisteredHomeChildcareBadge('FL', 'verified', VERIFIED_AT);
    expect(badge).not.toBeNull();
    expect(badge!.state).toBe('FL');
    expect(badge!.agencyName).toMatch(/Florida/);
    expect(badge!.programName).toMatch(/FCCH|Family Child Care/);
    expect(badge!.verifiedAt).toBe(VERIFIED_AT.toISOString());
  });

  it('accepts an ISO string decision timestamp (as it comes off the DB row)', () => {
    const badge = deriveStateRegisteredHomeChildcareBadge('CA', 'verified', VERIFIED_AT.toISOString());
    expect(badge?.verifiedAt).toBe(VERIFIED_AT.toISOString());
    expect(badge?.agencyName).toMatch(/California/);
  });

  it('returns null when the decision is not verified', () => {
    expect(deriveStateRegisteredHomeChildcareBadge('FL', 'rejected', VERIFIED_AT)).toBeNull();
    expect(deriveStateRegisteredHomeChildcareBadge('FL', null, VERIFIED_AT)).toBeNull();
  });

  it('returns null when state-at-upload or decision timestamp is missing', () => {
    expect(deriveStateRegisteredHomeChildcareBadge(null, 'verified', VERIFIED_AT)).toBeNull();
    expect(deriveStateRegisteredHomeChildcareBadge('FL', 'verified', null)).toBeNull();
  });

  it('returns null for an upload-time state outside the launch slate', () => {
    // A verified row whose upload-time state has no agency in the slate names
    // nothing — so no badge (defensive; uploads from non-slate states are gated
    // upstream, but the registration row could outlive a slate change).
    expect(deriveStateRegisteredHomeChildcareBadge('AK', 'verified', VERIFIED_AT)).toBeNull();
  });
});
