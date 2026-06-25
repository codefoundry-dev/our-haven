import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CAREGIVER_CATEGORIES, SUPPLY_ROLES, US_STATES_50_PLUS_DC } from '@our-haven/shared';

import {
  computeVerificationState,
  isActivated,
  isTerminal,
  VERIFICATION_STATES,
  type ComputeVerificationStateInput,
  type VerificationFacts,
  type VerificationState,
} from './index.js';

const ANY_DATE = new Date('2026-01-01T00:00:00.000Z');

const EMPTY_FACTS: VerificationFacts = {
  emailConfirmedAt: null,
  phoneConfirmedAt: null,
  idDocUploadedAt: null,
  screeningInitiatedAt: null,
  screeningPassedAt: null,
  licenseVerifiedAt: null,
  connectAccountReadyAt: null,
  rejectedAt: null,
};

const ALL_STATES_SET = new Set(US_STATES_50_PLUS_DC);
const FL_NY_ONLY = new Set(['FL', 'NY'] as const);

const dateOrNull = fc.option(
  fc.date({ min: new Date('2026-01-01T00:00:00Z'), max: new Date('2027-01-01T00:00:00Z') }),
  { nil: null },
);

const factsArb: fc.Arbitrary<VerificationFacts> = fc.record({
  emailConfirmedAt: dateOrNull,
  phoneConfirmedAt: dateOrNull,
  idDocUploadedAt: dateOrNull,
  screeningInitiatedAt: dateOrNull,
  screeningPassedAt: dateOrNull,
  licenseVerifiedAt: dateOrNull,
  connectAccountReadyAt: dateOrNull,
  rejectedAt: dateOrNull,
});

const roleArb = fc.constantFrom(...SUPPLY_ROLES);
const stateArb = fc.constantFrom(...US_STATES_50_PLUS_DC);
const supportedStatesArb = fc
  .subarray([...US_STATES_50_PLUS_DC])
  .map((arr) => new Set(arr));

const inputArb: fc.Arbitrary<ComputeVerificationStateInput> = fc.record({
  role: roleArb,
  state: stateArb,
  supportedStates: supportedStatesArb,
  facts: factsArb,
});

describe('computeVerificationState — happy-path step-by-step', () => {
  it('starts at unverified with no facts', () => {
    expect(
      computeVerificationState({
        role: 'caregiver',
        state: 'NY',
        supportedStates: ALL_STATES_SET,
        facts: EMPTY_FACTS,
      }),
    ).toBe('unverified');
  });

  const order: Array<{ field: keyof VerificationFacts; reached: VerificationState }> = [
    { field: 'emailConfirmedAt', reached: 'email-verified' },
    { field: 'phoneConfirmedAt', reached: 'phone-verified' },
    { field: 'idDocUploadedAt', reached: 'id-uploaded' },
    { field: 'screeningInitiatedAt', reached: 'screening-initiated' },
  ];

  for (const { field, reached } of order) {
    it(`reaches ${reached} when ${field} is set (and prior steps satisfied)`, () => {
      const facts: VerificationFacts = { ...EMPTY_FACTS };
      for (const earlier of order) {
        (facts as Record<keyof VerificationFacts, Date | null>)[earlier.field] = ANY_DATE;
        if (earlier.field === field) break;
      }
      const state = computeVerificationState({
        role: 'caregiver',
        state: 'NY',
        supportedStates: ALL_STATES_SET,
        facts,
      });
      expect(state).toBe(reached);
    });
  }

  it('caregiver activates after screening passes + Stripe Connect ready', () => {
    const state = computeVerificationState({
      role: 'caregiver',
      state: 'TX',
      supportedStates: ALL_STATES_SET,
      facts: {
        ...EMPTY_FACTS,
        emailConfirmedAt: ANY_DATE,
        phoneConfirmedAt: ANY_DATE,
        idDocUploadedAt: ANY_DATE,
        screeningInitiatedAt: ANY_DATE,
        screeningPassedAt: ANY_DATE,
        connectAccountReadyAt: ANY_DATE,
      },
    });
    expect(state).toBe('activated');
  });

  it('caregiver stalls at connect-pending if Stripe Connect is not yet ready (OH-110 gate)', () => {
    const state = computeVerificationState({
      role: 'caregiver',
      state: 'TX',
      supportedStates: ALL_STATES_SET,
      facts: {
        ...EMPTY_FACTS,
        emailConfirmedAt: ANY_DATE,
        phoneConfirmedAt: ANY_DATE,
        idDocUploadedAt: ANY_DATE,
        screeningInitiatedAt: ANY_DATE,
        screeningPassedAt: ANY_DATE,
      },
    });
    expect(state).toBe('connect-pending');
  });

  it('provider in supported state reaches license-pending after screening', () => {
    const state = computeVerificationState({
      role: 'provider',
      state: 'FL',
      supportedStates: FL_NY_ONLY,
      facts: {
        ...EMPTY_FACTS,
        emailConfirmedAt: ANY_DATE,
        phoneConfirmedAt: ANY_DATE,
        idDocUploadedAt: ANY_DATE,
        screeningInitiatedAt: ANY_DATE,
        screeningPassedAt: ANY_DATE,
      },
    });
    expect(state).toBe('license-pending');
  });

  it('provider activates after license is verified + Stripe Connect ready', () => {
    const state = computeVerificationState({
      role: 'provider',
      state: 'FL',
      supportedStates: FL_NY_ONLY,
      facts: {
        ...EMPTY_FACTS,
        emailConfirmedAt: ANY_DATE,
        phoneConfirmedAt: ANY_DATE,
        idDocUploadedAt: ANY_DATE,
        screeningInitiatedAt: ANY_DATE,
        screeningPassedAt: ANY_DATE,
        licenseVerifiedAt: ANY_DATE,
        connectAccountReadyAt: ANY_DATE,
      },
    });
    expect(state).toBe('activated');
  });

  it('provider with verified license but no Stripe Connect ready stalls at connect-pending', () => {
    const state = computeVerificationState({
      role: 'provider',
      state: 'FL',
      supportedStates: FL_NY_ONLY,
      facts: {
        ...EMPTY_FACTS,
        emailConfirmedAt: ANY_DATE,
        phoneConfirmedAt: ANY_DATE,
        idDocUploadedAt: ANY_DATE,
        screeningInitiatedAt: ANY_DATE,
        screeningPassedAt: ANY_DATE,
        licenseVerifiedAt: ANY_DATE,
      },
    });
    expect(state).toBe('connect-pending');
  });

  it('provider in unsupported state routes to holding after screening', () => {
    const state = computeVerificationState({
      role: 'provider',
      state: 'WY',
      supportedStates: FL_NY_ONLY,
      facts: {
        ...EMPTY_FACTS,
        emailConfirmedAt: ANY_DATE,
        phoneConfirmedAt: ANY_DATE,
        idDocUploadedAt: ANY_DATE,
        screeningInitiatedAt: ANY_DATE,
        screeningPassedAt: ANY_DATE,
      },
    });
    expect(state).toBe('holding-state-not-supported');
  });

  it('rejected wins from any otherwise-clearing fact set', () => {
    const state = computeVerificationState({
      role: 'provider',
      state: 'FL',
      supportedStates: FL_NY_ONLY,
      facts: {
        emailConfirmedAt: ANY_DATE,
        phoneConfirmedAt: ANY_DATE,
        idDocUploadedAt: ANY_DATE,
        screeningInitiatedAt: ANY_DATE,
        screeningPassedAt: ANY_DATE,
        licenseVerifiedAt: ANY_DATE,
        connectAccountReadyAt: ANY_DATE,
        rejectedAt: ANY_DATE,
      },
    });
    expect(state).toBe('rejected');
  });

  it('caregiver who only has the license fact still stalls on email', () => {
    // Caregivers don't need a license — but having one set should not skip
    // earlier gates either.
    const state = computeVerificationState({
      role: 'caregiver',
      state: 'NY',
      supportedStates: ALL_STATES_SET,
      facts: { ...EMPTY_FACTS, licenseVerifiedAt: ANY_DATE },
    });
    expect(state).toBe('unverified');
  });
});

describe('computeVerificationState — property-based', () => {
  it('always returns a declared VerificationState', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = computeVerificationState(input);
        expect(VERIFICATION_STATES).toContain(result);
      }),
    );
  });

  it('returns rejected whenever rejectedAt is set, regardless of other facts', () => {
    fc.assert(
      fc.property(
        inputArb,
        fc.date({ min: new Date('2026-01-01T00:00:00Z'), max: new Date('2027-01-01T00:00:00Z') }),
        (input, rejectedAt) => {
          const withRejection: ComputeVerificationStateInput = {
            ...input,
            facts: { ...input.facts, rejectedAt },
          };
          expect(computeVerificationState(withRejection)).toBe('rejected');
        },
      ),
    );
  });

  it('caregiver never reaches license-pending, license-verified, or holding-state-not-supported', () => {
    const caregiverInputArb = fc.record({
      role: fc.constant<'caregiver'>('caregiver'),
      state: stateArb,
      supportedStates: supportedStatesArb,
      facts: factsArb,
    });
    fc.assert(
      fc.property(caregiverInputArb, (input) => {
        const result = computeVerificationState(input);
        expect(result).not.toBe('license-pending');
        expect(result).not.toBe('license-verified');
        expect(result).not.toBe('holding-state-not-supported');
      }),
    );
  });

  it('provider in unsupported state never reaches activated (without rejection)', () => {
    const specialistInputArb = fc.record({
      role: fc.constant<'provider'>('provider'),
      state: stateArb,
      facts: factsArb.map((f) => ({ ...f, rejectedAt: null })),
    });
    fc.assert(
      fc.property(specialistInputArb, (input) => {
        const result = computeVerificationState({
          ...input,
          supportedStates: new Set(),
        });
        expect(result).not.toBe('activated');
        expect(result).not.toBe('license-pending');
        expect(result).not.toBe('license-verified');
      }),
    );
  });

  it('monotonicity: adding a new fact never moves the state earlier in the linear order', () => {
    // Linear ordering used for monotonicity comparison. The four "side" states
    // (rejected, holding-state-not-supported, license-pending, license-verified)
    // are scored alongside the main spine — see explanatory mapping below.
    const ORDINAL: Record<VerificationState, number> = {
      unverified: 0,
      'email-verified': 1,
      'phone-verified': 2,
      'id-uploaded': 3,
      'screening-initiated': 4,
      'screening-passed': 5,
      'license-pending': 6,
      'license-verified': 7,
      'connect-pending': 8, // Stripe Connect Express gate (OH-110) — sits just below activated
      activated: 9,
      'holding-state-not-supported': 6, // a "stuck at license-board" sibling of license-pending
      rejected: 10, // terminal, sits at the top — adding any fact when rejected stays rejected
    };

    const factOrder: Array<keyof VerificationFacts> = [
      'emailConfirmedAt',
      'phoneConfirmedAt',
      'idDocUploadedAt',
      'screeningInitiatedAt',
      'screeningPassedAt',
      'licenseVerifiedAt',
      'connectAccountReadyAt',
    ];

    fc.assert(
      fc.property(
        roleArb,
        stateArb,
        supportedStatesArb,
        fc.constantFrom(...factOrder),
        fc.date({ min: new Date('2026-01-01T00:00:00Z'), max: new Date('2027-01-01T00:00:00Z') }),
        factsArb.map((f) => ({ ...f, rejectedAt: null })),
        (role, state, supportedStates, field, when, baseFacts) => {
          const before = computeVerificationState({ role, state, supportedStates, facts: baseFacts });
          const after = computeVerificationState({
            role,
            state,
            supportedStates,
            facts: { ...baseFacts, [field]: when },
          });
          expect(ORDINAL[after]).toBeGreaterThanOrEqual(ORDINAL[before]);
        },
      ),
    );
  });
});

describe('isActivated / isTerminal helpers', () => {
  it('isActivated is true only for activated', () => {
    for (const s of VERIFICATION_STATES) {
      expect(isActivated(s)).toBe(s === 'activated');
    }
  });

  it('isTerminal is true only for rejected', () => {
    for (const s of VERIFICATION_STATES) {
      expect(isTerminal(s)).toBe(s === 'rejected');
    }
  });
});

// Reference unused imports to keep tsc happy if shared exports rotate.
void CAREGIVER_CATEGORIES;
