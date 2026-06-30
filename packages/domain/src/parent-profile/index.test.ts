import { describe, expect, it } from 'vitest';

import { isUsState, normaliseSafetyBehaviors } from '@our-haven/shared';

import {
  ADDRESS_CITY_MAX_LEN,
  ADDRESS_LINE_MAX_LEN,
  emptyDefaultAddress,
  eraseSafetyBehaviors,
  hasDefaultAddress,
  hasSafetyBehaviorsConsent,
  resolveConsentGrant,
  resolveSafetyBehaviorsSave,
  sanitiseDefaultAddress,
  PARENT_PROFILE_MODULE_VERSION,
} from './index.js';

const NOW = '2026-06-30T12:00:00.000Z';
const EARLIER = '2026-06-01T08:00:00.000Z';

describe('hasSafetyBehaviorsConsent', () => {
  it('is false until a timestamp is held, true once it is', () => {
    expect(hasSafetyBehaviorsConsent(null)).toBe(false);
    expect(hasSafetyBehaviorsConsent(EARLIER)).toBe(true);
  });
});

describe('resolveSafetyBehaviorsSave (consent-to-store gate)', () => {
  it('rejects ANY save without consent — including an empty list', () => {
    expect(resolveSafetyBehaviorsSave(null, [])).toEqual({ ok: false, reason: 'consent_required' });
    expect(resolveSafetyBehaviorsSave(null, normaliseSafetyBehaviors(['aggression']))).toEqual({
      ok: false,
      reason: 'consent_required',
    });
  });

  it('persists the normalised behaviours once consent is in force', () => {
    const behaviours = normaliseSafetyBehaviors(['pica', 'aggression', 'made-up']);
    const result = resolveSafetyBehaviorsSave(EARLIER, behaviours);
    expect(result).toEqual({ ok: true, safetyBehaviors: ['aggression', 'pica'] });
  });

  it('returns a fresh array (no aliasing of the caller input)', () => {
    const input = normaliseSafetyBehaviors(['wandering']);
    const result = resolveSafetyBehaviorsSave(EARLIER, input);
    if (!result.ok) throw new Error('expected ok');
    expect(result.safetyBehaviors).not.toBe(input);
    expect(result.safetyBehaviors).toEqual(['wandering']);
  });
});

describe('resolveConsentGrant (idempotent stamp)', () => {
  it('stamps `now` on a first grant', () => {
    expect(resolveConsentGrant(null, NOW)).toBe(NOW);
  });
  it('keeps the original timestamp on a repeat grant', () => {
    expect(resolveConsentGrant(EARLIER, NOW)).toBe(EARLIER);
  });
});

describe('eraseSafetyBehaviors (withdrawal)', () => {
  it('clears behaviours AND the consent timestamp', () => {
    expect(eraseSafetyBehaviors()).toEqual({ safetyBehaviors: [], safetyBehaviorsConsentAt: null });
  });
});

describe('sanitiseDefaultAddress', () => {
  it('trims, collapses whitespace, and maps blanks to null', () => {
    const result = sanitiseDefaultAddress(
      { line1: '  221B   Baker  St ', line2: '   ', city: ' Boston ', state: 'ma', postalCode: ' 02118 ' },
      isUsState,
    );
    expect(result).toEqual({
      ok: true,
      address: { line1: '221B Baker St', line2: null, city: 'Boston', state: 'MA', postalCode: '02118' },
    });
  });

  it('allows a partial address (city + state only)', () => {
    const result = sanitiseDefaultAddress({ city: 'Austin', state: 'TX' }, isUsState);
    expect(result).toEqual({
      ok: true,
      address: { line1: null, line2: null, city: 'Austin', state: 'TX', postalCode: null },
    });
  });

  it('treats an all-missing input as a cleared (all-null) address', () => {
    expect(sanitiseDefaultAddress({}, isUsState)).toEqual({ ok: true, address: emptyDefaultAddress() });
  });

  it('rejects a non-US state', () => {
    const result = sanitiseDefaultAddress({ state: 'ZZ' }, isUsState);
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed ZIP', () => {
    expect(sanitiseDefaultAddress({ postalCode: '0211' }, isUsState).ok).toBe(false);
    expect(sanitiseDefaultAddress({ postalCode: 'abcde' }, isUsState).ok).toBe(false);
  });

  it('rejects an over-long line / city', () => {
    expect(sanitiseDefaultAddress({ line1: 'x'.repeat(ADDRESS_LINE_MAX_LEN + 1) }, isUsState).ok).toBe(false);
    expect(sanitiseDefaultAddress({ city: 'x'.repeat(ADDRESS_CITY_MAX_LEN + 1) }, isUsState).ok).toBe(false);
  });

  it('accepts DC as a state', () => {
    expect(sanitiseDefaultAddress({ state: 'dc' }, isUsState)).toMatchObject({ ok: true, address: { state: 'DC' } });
  });
});

describe('hasDefaultAddress', () => {
  it('is false for an all-null address, true once any field is set', () => {
    expect(hasDefaultAddress(emptyDefaultAddress())).toBe(false);
    expect(hasDefaultAddress({ ...emptyDefaultAddress(), city: 'Reno' })).toBe(true);
  });
});

describe('module', () => {
  it('exposes a version marker', () => {
    expect(PARENT_PROFILE_MODULE_VERSION).toMatch(/OH-200/);
  });
});
