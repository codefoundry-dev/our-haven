import { describe, expect, it } from 'vitest';

import { SPECIALTIES, US_STATES_50_PLUS_DC, type UsState } from '@our-haven/shared';

import {
  LICENSE_BOARD_LAUNCH_STATES,
  boardsForState,
  findLicenseBoard,
  isLicenseBoardLaunchState,
  listBoardSlate,
} from './index.js';

describe('license-board adapter slate', () => {
  it('lists exactly 12 launch states', () => {
    expect(LICENSE_BOARD_LAUNCH_STATES).toHaveLength(12);
    expect(new Set(LICENSE_BOARD_LAUNCH_STATES).size).toBe(12);
  });

  it('only contains valid US states', () => {
    for (const s of LICENSE_BOARD_LAUNCH_STATES) {
      expect((US_STATES_50_PLUS_DC as readonly string[]).includes(s)).toBe(true);
    }
  });

  it('covers every (state, specialty) pair — 12 × 5 = 60 entries', () => {
    const slate = listBoardSlate();
    expect(slate).toHaveLength(LICENSE_BOARD_LAUNCH_STATES.length * SPECIALTIES.length);
    for (const state of LICENSE_BOARD_LAUNCH_STATES) {
      for (const specialty of SPECIALTIES) {
        const board = findLicenseBoard(state, specialty);
        expect(board, `${state}/${specialty} missing`).not.toBeNull();
        expect(board!.state).toBe(state);
        expect(board!.specialty).toBe(specialty);
        expect(board!.boardName.length).toBeGreaterThan(0);
        expect(board!.registerUrl).toMatch(/^https:\/\//);
      }
    }
  });

  it('returns null for non-slate states', () => {
    const nonSlate: UsState[] = (US_STATES_50_PLUS_DC as readonly UsState[]).filter(
      (s) => !(LICENSE_BOARD_LAUNCH_STATES as readonly UsState[]).includes(s),
    );
    expect(nonSlate.length).toBeGreaterThan(0);
    for (const state of nonSlate) {
      for (const specialty of SPECIALTIES) {
        expect(findLicenseBoard(state, specialty)).toBeNull();
      }
      expect(isLicenseBoardLaunchState(state)).toBe(false);
    }
  });

  it('boardsForState returns 5 entries (one per specialty) for a launch state', () => {
    for (const state of LICENSE_BOARD_LAUNCH_STATES) {
      expect(boardsForState(state)).toHaveLength(SPECIALTIES.length);
    }
  });

  it('boardsForState returns empty for non-slate states', () => {
    expect(boardsForState('AK')).toHaveLength(0);
    expect(boardsForState('VT')).toHaveLength(0);
  });
});
