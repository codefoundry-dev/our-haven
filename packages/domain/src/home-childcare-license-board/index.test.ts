import { describe, expect, it } from 'vitest';

import { US_STATES_50_PLUS_DC, type UsState } from '@our-haven/shared';

import {
  HOME_CHILDCARE_LICENSE_BOARD_LAUNCH_STATES,
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
