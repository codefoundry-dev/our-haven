import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CAREGIVER_CATEGORIES } from '@our-haven/shared';

import {
  CREDENTIAL_REVIEW_STATES,
  CREDENTIAL_TYPES,
  caregiverFacingStatusLabel,
  clinicalTitleMatches,
  hasClinicalTitleConflict,
  initialCredentialReview,
  isClinicalSoundingTitle,
  isCredentialPubliclyVisible,
  isTaxCreditFriendlyBadgeEligible,
  reviewCredential,
  type CredentialReviewState,
} from './index.js';

describe('credential review state machine', () => {
  it('is born pending', () => {
    expect(initialCredentialReview()).toBe('pending');
  });

  it('pending → approved on admin-approve, with no rejection reason', () => {
    const result = reviewCredential('pending', { type: 'admin-approve' });
    expect(result).toEqual({ ok: true, next: 'approved', rejectionReason: null });
  });

  it('pending → rejected on admin-reject, carrying the reason', () => {
    const result = reviewCredential('pending', { type: 'admin-reject', reason: 'clinical-sounding title' });
    expect(result).toEqual({ ok: true, next: 'rejected', rejectionReason: 'clinical-sounding title' });
  });

  it('admin-reject with a blank reason falls back to a default', () => {
    expect(reviewCredential('pending', { type: 'admin-reject', reason: '   ' })).toEqual({
      ok: true,
      next: 'rejected',
      rejectionReason: 'rejected',
    });
    expect(reviewCredential('pending', { type: 'admin-reject' })).toEqual({
      ok: true,
      next: 'rejected',
      rejectionReason: 'rejected',
    });
  });

  it('approved and rejected are terminal — re-review is refused', () => {
    for (const terminal of ['approved', 'rejected'] as const) {
      for (const type of ['admin-approve', 'admin-reject'] as const) {
        const result = reviewCredential(terminal, { type });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain(terminal);
      }
    }
  });
});

describe('visibility — hidden until approved (CONTEXT § Credentials)', () => {
  it('only an approved credential is publicly visible', () => {
    expect(isCredentialPubliclyVisible('approved')).toBe(true);
    expect(isCredentialPubliclyVisible('pending')).toBe(false);
    expect(isCredentialPubliclyVisible('rejected')).toBe(false);
  });

  it('the Caregiver sees "Pending review" until a decision', () => {
    expect(caregiverFacingStatusLabel('pending')).toBe('Pending review');
    expect(caregiverFacingStatusLabel('approved')).toBe('Approved');
    expect(caregiverFacingStatusLabel('rejected')).toBe('Not approved');
  });
});

describe('clinical-title classifier (clinical-title rejection path)', () => {
  it('flags the canonical example "Pediatric Nurse"', () => {
    expect(isClinicalSoundingTitle('Pediatric Nurse')).toBe(true);
    expect(clinicalTitleMatches('Pediatric Nurse')).toEqual(expect.arrayContaining(['nurse', 'pediatric']));
  });

  it('flags assorted licensed-clinical titles', () => {
    for (const label of [
      'Registered Nurse',
      'RN',
      'Speech-Language Pathologist',
      'Occupational Therapist',
      'Physical Therapy Assistant',
      'Licensed Psychologist',
      'Board Certified Behavior Analyst (BCBA)',
      'Pediatrician',
      'Clinical Social Worker',
      'Medical Assistant',
    ]) {
      expect(isClinicalSoundingTitle(label), `${label} should be flagged`).toBe(true);
    }
  });

  it('does NOT flag legitimate caregiver qualifications (word-boundary safe)', () => {
    for (const label of [
      'CPR & First Aid Certified',
      'Early Childhood Education',
      'Newborn Care Specialist',
      'Montessori Training',
      'Child Development Associate (CDA)',
      'Lead Teacher',
      'Nursery Teacher', //   contains "nurse" but not as a word
      'Learning Specialist', //   contains "rn" but not as a word
      'Doctorate in Special Education', //   "doctorate" ≠ "doctor"; "special" not listed
      'Aromatherapy Certificate', //   "aromatherapy" ≠ "therapy" as a word
      'Tutor — Math & Science',
    ]) {
      expect(isClinicalSoundingTitle(label), `${label} should NOT be flagged`).toBe(false);
    }
  });

  it('hasClinicalTitleConflict fires for a clinical TITLE but exempts certifications/trainings', () => {
    expect(hasClinicalTitleConflict({ type: 'title', label: 'Pediatric Nurse' })).toBe(true);
    // Same clinical-domain words in a certification/training are legitimate.
    expect(hasClinicalTitleConflict({ type: 'certification', label: 'Pediatric First Aid' })).toBe(false);
    expect(hasClinicalTitleConflict({ type: 'training', label: 'Medication Administration Training' })).toBe(false);
    // A perfectly ordinary title is fine.
    expect(hasClinicalTitleConflict({ type: 'title', label: 'Lead Teacher' })).toBe(false);
  });
});

describe('Tax-credit-friendly (W-10) badge eligibility', () => {
  it('eligible for a self-attesting Babysitter or Nanny', () => {
    expect(isTaxCreditFriendlyBadgeEligible(['babysitter'], true)).toBe(true);
    expect(isTaxCreditFriendlyBadgeEligible(['nanny'], true)).toBe(true);
    expect(isTaxCreditFriendlyBadgeEligible(['tutor', 'babysitter'], true)).toBe(true);
  });

  it('not eligible for a Tutor-only Caregiver', () => {
    expect(isTaxCreditFriendlyBadgeEligible(['tutor'], true)).toBe(false);
  });

  it('not eligible without self-attestation', () => {
    expect(isTaxCreditFriendlyBadgeEligible(['babysitter', 'nanny'], false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property-based
// ---------------------------------------------------------------------------

describe('credentials — property-based', () => {
  const reviewStateArb = fc.constantFrom<CredentialReviewState>(...CREDENTIAL_REVIEW_STATES);

  it('a review decision succeeds iff the credential is pending', () => {
    fc.assert(
      fc.property(reviewStateArb, fc.constantFrom('admin-approve' as const, 'admin-reject' as const), (state, type) => {
        const result = reviewCredential(state, { type });
        expect(result.ok).toBe(state === 'pending');
      }),
    );
  });

  it('isClinicalSoundingTitle never throws and returns a boolean for any string', () => {
    fc.assert(
      fc.property(fc.string(), (label) => {
        expect(typeof isClinicalSoundingTitle(label)).toBe('boolean');
      }),
    );
  });

  it('a non-title credential is never a clinical-title conflict', () => {
    const nonTitleType = fc.constantFrom(...CREDENTIAL_TYPES.filter((t) => t !== 'title'));
    fc.assert(
      fc.property(nonTitleType, fc.string(), (type, label) => {
        expect(hasClinicalTitleConflict({ type, label })).toBe(false);
      }),
    );
  });
});

// Keep tsc honest if shared exports rotate.
void CAREGIVER_CATEGORIES;
