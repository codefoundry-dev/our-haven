import { describe, expect, it } from 'vitest';

import { SPECIALTIES } from '@our-haven/shared';

import {
  deriveCredentialStatus,
  isKnownSpecialty,
  sanitisePerSessionRateCents,
  validateSpecialty,
  type ClinicalCredentialFacts,
} from './index.js';

const NO_FACTS: ClinicalCredentialFacts = {
  licenseVerified: false,
  insuranceVerified: false,
  screeningPassed: false,
  rejected: false,
  licenseUploaded: false,
  insuranceUploaded: false,
};

describe('specialty validation', () => {
  it('accepts every canonical specialty', () => {
    for (const s of SPECIALTIES) {
      expect(isKnownSpecialty(s)).toBe(true);
      expect(validateSpecialty(s)).toEqual({ ok: true, specialty: s });
    }
  });

  it('rejects an unknown specialty', () => {
    expect(isKnownSpecialty('astrology')).toBe(false);
    expect(validateSpecialty('astrology')).toEqual({ ok: false, reason: "unknown specialty 'astrology'" });
  });
});

describe('sanitisePerSessionRateCents', () => {
  it('accepts null (clears the rate)', () => {
    expect(sanitisePerSessionRateCents(null)).toEqual({ ok: true, cents: null });
    expect(sanitisePerSessionRateCents(undefined)).toEqual({ ok: true, cents: null });
  });

  it('accepts a non-negative integer', () => {
    expect(sanitisePerSessionRateCents(0)).toEqual({ ok: true, cents: 0 });
    expect(sanitisePerSessionRateCents(15000)).toEqual({ ok: true, cents: 15000 });
  });

  it('rejects a negative or non-integer rate', () => {
    expect(sanitisePerSessionRateCents(-1).ok).toBe(false);
    expect(sanitisePerSessionRateCents(99.5).ok).toBe(false);
  });
});

describe('deriveCredentialStatus', () => {
  it('is unverified with no facts', () => {
    expect(deriveCredentialStatus(NO_FACTS)).toEqual({
      license: 'missing',
      insurance: 'missing',
      screening: 'pending',
      overall: 'unverified',
      publiclyVerified: false,
    });
  });

  it('is in-review once a doc is uploaded but gates are not all cleared', () => {
    const s = deriveCredentialStatus({ ...NO_FACTS, licenseUploaded: true });
    expect(s.overall).toBe('in-review');
    expect(s.license).toBe('uploaded');
    expect(s.publiclyVerified).toBe(false);
  });

  it('is in-review when screening passed but license/insurance not yet verified', () => {
    expect(deriveCredentialStatus({ ...NO_FACTS, screeningPassed: true }).overall).toBe('in-review');
  });

  it('is verified only when license + insurance + screening all cleared', () => {
    const s = deriveCredentialStatus({
      ...NO_FACTS,
      licenseVerified: true,
      insuranceVerified: true,
      screeningPassed: true,
      licenseUploaded: true,
      insuranceUploaded: true,
    });
    expect(s).toEqual({
      license: 'verified',
      insurance: 'verified',
      screening: 'passed',
      overall: 'verified',
      publiclyVerified: true,
    });
  });

  it('is not publicly verified if insurance is still pending', () => {
    const s = deriveCredentialStatus({
      ...NO_FACTS,
      licenseVerified: true,
      screeningPassed: true,
    });
    expect(s.overall).toBe('in-review');
    expect(s.publiclyVerified).toBe(false);
  });

  it('rejection wins over any verified gate', () => {
    const s = deriveCredentialStatus({
      ...NO_FACTS,
      licenseVerified: true,
      insuranceVerified: true,
      screeningPassed: true,
      rejected: true,
    });
    expect(s.overall).toBe('rejected');
    expect(s.publiclyVerified).toBe(false);
  });
});
