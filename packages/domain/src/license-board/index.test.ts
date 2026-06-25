import { describe, expect, it } from 'vitest';

import { SPECIALTIES, US_STATES_50_PLUS_DC, type UsState } from '@our-haven/shared';

import {
  LICENSE_BOARD_LAUNCH_STATES,
  boardsForState,
  createPortalLicenseBoardAdapter,
  createStubApiLicenseBoardAdapter,
  findLicenseBoard,
  isLicenseBoardLaunchState,
  licenseBoardAdapterFor,
  listBoardSlate,
  reduceLicenseVerificationEvent,
  type LicenseVerificationEvent,
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

describe('license-board adapter contract (OH-181)', () => {
  it('the launch adapter is portal-only and surfaces the board for a specialty', () => {
    const adapter = createPortalLicenseBoardAdapter('CA');
    expect(adapter.state).toBe('CA');
    expect(adapter.mode).toBe('portal-only');
    const board = adapter.boardFor('slp');
    expect(board).not.toBeNull();
    expect(board!.state).toBe('CA');
    expect(board!.specialty).toBe('slp');
  });

  it('a portal-only lookup rejects — admin verifies out-of-band', async () => {
    const adapter = createPortalLicenseBoardAdapter('NY');
    await expect(
      adapter.lookup({ specialty: 'ot', licenseNumber: 'X', holderName: 'Jane', correlationId: 'c1' }),
    ).rejects.toThrow(/portal-only/);
  });

  it('refuses to build a launch adapter for an out-of-slate state', () => {
    expect(() => createPortalLicenseBoardAdapter('WY')).toThrow(/outside the launch slate/);
  });

  it('the stub api adapter advertises api mode but is not implemented', async () => {
    const adapter = createStubApiLicenseBoardAdapter('CA');
    expect(adapter.mode).toBe('api');
    await expect(
      adapter.lookup({ specialty: 'aba', licenseNumber: 'X', holderName: 'Jo', correlationId: 'c2' }),
    ).rejects.toThrow(/not implemented/);
  });

  it('licenseBoardAdapterFor yields an adapter for slate states and null otherwise', () => {
    expect(licenseBoardAdapterFor('FL')).not.toBeNull();
    expect(licenseBoardAdapterFor('FL')!.mode).toBe('portal-only');
    expect(licenseBoardAdapterFor('WY')).toBeNull(); // → verification holding-state-not-supported
  });
});

describe('reduceLicenseVerificationEvent', () => {
  const T = new Date('2026-06-25T10:00:00.000Z');

  it('verified → license_verified_at patch', () => {
    const event: LicenseVerificationEvent = {
      kind: 'verified',
      occurredAt: T,
      boardName: 'California Board of Occupational Therapy',
      licenseNumber: 'OT-12345',
    };
    expect(reduceLicenseVerificationEvent(event)).toEqual({ license_verified_at: T });
  });

  it('rejected → rejected_at + a reason naming the outcome', () => {
    const patch = reduceLicenseVerificationEvent({
      kind: 'rejected',
      occurredAt: T,
      outcome: 'name-mismatch',
      detail: 'Smith vs Smyth',
    });
    expect(patch.rejected_at).toBe(T);
    expect(patch.rejection_reason).toBe('license name-mismatch: Smith vs Smyth');
    expect(patch.license_verified_at).toBeUndefined();
  });

  it('rejected without detail still produces a reason', () => {
    expect(
      reduceLicenseVerificationEvent({ kind: 'rejected', occurredAt: T, outcome: 'expired' }).rejection_reason,
    ).toBe('license expired');
  });
});
