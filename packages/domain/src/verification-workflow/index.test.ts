import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { SUPPLY_ROLES, US_STATES_50_PLUS_DC } from '@our-haven/shared';

import {
  CAREGIVER_VERIFICATION_PATH,
  computeVerificationState,
  isActivated,
  isAwaitingPhoneOnly,
  isTerminal,
  PROVIDER_VERIFICATION_PATH,
  unmetVerificationGates,
  VERIFICATION_GATE_KEYS,
  VERIFICATION_STATES,
  verificationGates,
  verificationPath,
  type ComputeVerificationStateInput,
  type VerificationFacts,
  type VerificationGateKey,
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
  insuranceVerifiedAt: null,
  connectAccountReadyAt: null,
  rejectedAt: null,
};

const ALL_STATES_SET: ReadonlySet<(typeof US_STATES_50_PLUS_DC)[number]> = new Set(US_STATES_50_PLUS_DC);
const FL_NY_ONLY = new Set(['FL', 'NY'] as const);

/** Which fact satisfies each gate — the seam between gate keys and facts. */
const GATE_FACT: Record<VerificationGateKey, keyof VerificationFacts> = {
  email: 'emailConfirmedAt',
  id: 'idDocUploadedAt',
  'screening-initiated': 'screeningInitiatedAt',
  'screening-passed': 'screeningPassedAt',
  connect: 'connectAccountReadyAt',
  license: 'licenseVerifiedAt',
  insurance: 'insuranceVerifiedAt',
  phone: 'phoneConfirmedAt',
};

/** Facts that satisfy the first `n` gates of a role (in gate order). */
function factsSatisfyingFirst(role: 'caregiver' | 'provider', n: number): VerificationFacts {
  const facts: VerificationFacts = { ...EMPTY_FACTS };
  verificationGates(role)
    .slice(0, n)
    .forEach((gate) => {
      facts[GATE_FACT[gate.key]] = ANY_DATE;
    });
  return facts;
}

describe('computeVerificationState — Caregiver spine (per-role coverage)', () => {
  it('walks exactly CAREGIVER_VERIFICATION_PATH as gates are satisfied in order', () => {
    const gates = verificationGates('caregiver');
    expect(gates.map((g) => g.key)).toEqual(['email', 'id', 'screening-initiated', 'screening-passed', 'connect', 'phone']);

    for (let n = 0; n <= gates.length; n++) {
      const state = computeVerificationState({
        role: 'caregiver',
        state: 'TX',
        supportedStates: ALL_STATES_SET,
        facts: factsSatisfyingFirst('caregiver', n),
      });
      expect(state).toBe(CAREGIVER_VERIFICATION_PATH[n]);
    }
  });

  it('a Caregiver who has cleared screening but has no Stripe Connect rests at connect-pending', () => {
    const state = computeVerificationState({
      role: 'caregiver',
      state: 'TX',
      supportedStates: ALL_STATES_SET,
      facts: {
        ...EMPTY_FACTS,
        emailConfirmedAt: ANY_DATE,
        idDocUploadedAt: ANY_DATE,
        screeningInitiatedAt: ANY_DATE,
        screeningPassedAt: ANY_DATE,
        phoneConfirmedAt: ANY_DATE,
      },
    });
    expect(state).toBe('connect-pending');
  });
});

describe('computeVerificationState — Provider spine (per-role coverage)', () => {
  it('walks exactly PROVIDER_VERIFICATION_PATH as gates are satisfied in order', () => {
    const gates = verificationGates('provider');
    expect(gates.map((g) => g.key)).toEqual([
      'email',
      'id',
      'screening-initiated',
      'screening-passed',
      'license',
      'insurance',
      'phone',
    ]);

    for (let n = 0; n <= gates.length; n++) {
      const state = computeVerificationState({
        role: 'provider',
        state: 'FL',
        supportedStates: FL_NY_ONLY,
        facts: factsSatisfyingFirst('provider', n),
      });
      expect(state).toBe(PROVIDER_VERIFICATION_PATH[n]);
    }
  });

  it('Provider reaches license-pending after screening, then insurance-pending after license', () => {
    const base = {
      role: 'provider' as const,
      state: 'FL' as const,
      supportedStates: FL_NY_ONLY,
    };
    const screened: VerificationFacts = {
      ...EMPTY_FACTS,
      emailConfirmedAt: ANY_DATE,
      idDocUploadedAt: ANY_DATE,
      screeningInitiatedAt: ANY_DATE,
      screeningPassedAt: ANY_DATE,
    };
    expect(computeVerificationState({ ...base, facts: screened })).toBe('license-pending');
    expect(
      computeVerificationState({ ...base, facts: { ...screened, licenseVerifiedAt: ANY_DATE } }),
    ).toBe('insurance-pending');
  });

  it('Provider activates WITHOUT any Stripe Connect (ADR-0011 — off-platform clinical payment)', () => {
    const state = computeVerificationState({
      role: 'provider',
      state: 'FL',
      supportedStates: FL_NY_ONLY,
      facts: {
        ...EMPTY_FACTS,
        emailConfirmedAt: ANY_DATE,
        idDocUploadedAt: ANY_DATE,
        screeningInitiatedAt: ANY_DATE,
        screeningPassedAt: ANY_DATE,
        licenseVerifiedAt: ANY_DATE,
        insuranceVerifiedAt: ANY_DATE,
        phoneConfirmedAt: ANY_DATE,
        connectAccountReadyAt: null, // explicitly absent — Providers have no Connect
      },
    });
    expect(state).toBe('activated');
  });

  it('Provider in an out-of-slate state routes to holding after screening', () => {
    const state = computeVerificationState({
      role: 'provider',
      state: 'WY',
      supportedStates: FL_NY_ONLY,
      facts: {
        ...EMPTY_FACTS,
        emailConfirmedAt: ANY_DATE,
        idDocUploadedAt: ANY_DATE,
        screeningInitiatedAt: ANY_DATE,
        screeningPassedAt: ANY_DATE,
      },
    });
    expect(state).toBe('holding-state-not-supported');
  });

  it('an out-of-slate Provider NEVER activates, even if license/insurance/phone facts are present', () => {
    const state = computeVerificationState({
      role: 'provider',
      state: 'WY',
      supportedStates: FL_NY_ONLY,
      facts: {
        ...EMPTY_FACTS,
        emailConfirmedAt: ANY_DATE,
        idDocUploadedAt: ANY_DATE,
        screeningInitiatedAt: ANY_DATE,
        screeningPassedAt: ANY_DATE,
        licenseVerifiedAt: ANY_DATE,
        insuranceVerifiedAt: ANY_DATE,
        phoneConfirmedAt: ANY_DATE,
      },
    });
    expect(state).toBe('holding-state-not-supported');
  });
});

describe('phoneVerified is a hard activation gate (ADR-0015), not a linear step', () => {
  const caregiverButPhone: ComputeVerificationStateInput = {
    role: 'caregiver',
    state: 'TX',
    supportedStates: ALL_STATES_SET,
    facts: {
      ...EMPTY_FACTS,
      emailConfirmedAt: ANY_DATE,
      idDocUploadedAt: ANY_DATE,
      screeningInitiatedAt: ANY_DATE,
      screeningPassedAt: ANY_DATE,
      connectAccountReadyAt: ANY_DATE,
      phoneConfirmedAt: null,
    },
  };

  it('a Caregiver who has cleared everything except phone rests at awaiting-phone-verification', () => {
    expect(computeVerificationState(caregiverButPhone)).toBe('awaiting-phone-verification');
    expect(isAwaitingPhoneOnly(caregiverButPhone)).toBe(true);
  });

  it('confirming the phone flips it to activated', () => {
    const activated = computeVerificationState({
      ...caregiverButPhone,
      facts: { ...caregiverButPhone.facts, phoneConfirmedAt: ANY_DATE },
    });
    expect(activated).toBe('activated');
    expect(isActivated(activated)).toBe(true);
  });

  it('a verified phone EARLY does not advance the spine (phone is off-spine)', () => {
    // email + phone confirmed, but no ID yet → still email-verified (next spine
    // gate is ID), proving phone is not the OH-105 linear step-2 anymore.
    const state = computeVerificationState({
      role: 'caregiver',
      state: 'TX',
      supportedStates: ALL_STATES_SET,
      facts: { ...EMPTY_FACTS, emailConfirmedAt: ANY_DATE, phoneConfirmedAt: ANY_DATE },
    });
    expect(state).toBe('email-verified');
  });

  it('every role only activates once phone is verified', () => {
    for (const role of SUPPLY_ROLES) {
      const cleared: VerificationFacts = {
        ...EMPTY_FACTS,
        emailConfirmedAt: ANY_DATE,
        idDocUploadedAt: ANY_DATE,
        screeningInitiatedAt: ANY_DATE,
        screeningPassedAt: ANY_DATE,
        licenseVerifiedAt: ANY_DATE,
        insuranceVerifiedAt: ANY_DATE,
        connectAccountReadyAt: ANY_DATE,
      };
      const input = { role, state: 'FL' as const, supportedStates: FL_NY_ONLY };
      expect(computeVerificationState({ ...input, facts: { ...cleared, phoneConfirmedAt: null } })).toBe(
        'awaiting-phone-verification',
      );
      expect(computeVerificationState({ ...input, facts: { ...cleared, phoneConfirmedAt: ANY_DATE } })).toBe(
        'activated',
      );
    }
  });
});

describe('rejection', () => {
  it('rejected wins from any otherwise-clearing fact set, for either role', () => {
    for (const role of SUPPLY_ROLES) {
      const state = computeVerificationState({
        role,
        state: 'FL',
        supportedStates: FL_NY_ONLY,
        facts: {
          emailConfirmedAt: ANY_DATE,
          phoneConfirmedAt: ANY_DATE,
          idDocUploadedAt: ANY_DATE,
          screeningInitiatedAt: ANY_DATE,
          screeningPassedAt: ANY_DATE,
          licenseVerifiedAt: ANY_DATE,
          insuranceVerifiedAt: ANY_DATE,
          connectAccountReadyAt: ANY_DATE,
          rejectedAt: ANY_DATE,
        },
      });
      expect(state).toBe('rejected');
    }
  });
});

describe('unmetVerificationGates (UI checklist affordance)', () => {
  it('lists every gate for a fresh member, in order', () => {
    expect(
      unmetVerificationGates({
        role: 'caregiver',
        state: 'TX',
        supportedStates: ALL_STATES_SET,
        facts: EMPTY_FACTS,
      }),
    ).toEqual(['email', 'id', 'screening-initiated', 'screening-passed', 'connect', 'phone']);
  });

  it('returns just [phone] when only the activation gate remains', () => {
    expect(
      unmetVerificationGates({
        role: 'provider',
        state: 'FL',
        supportedStates: FL_NY_ONLY,
        facts: {
          ...EMPTY_FACTS,
          emailConfirmedAt: ANY_DATE,
          idDocUploadedAt: ANY_DATE,
          screeningInitiatedAt: ANY_DATE,
          screeningPassedAt: ANY_DATE,
          licenseVerifiedAt: ANY_DATE,
          insuranceVerifiedAt: ANY_DATE,
        },
      }),
    ).toEqual(['phone']);
  });

  it('is empty for a rejected member', () => {
    expect(
      unmetVerificationGates({
        role: 'caregiver',
        state: 'TX',
        supportedStates: ALL_STATES_SET,
        facts: { ...EMPTY_FACTS, rejectedAt: ANY_DATE },
      }),
    ).toEqual([]);
  });
});

describe('helpers', () => {
  it('verificationPath maps role → exported spine', () => {
    expect(verificationPath('caregiver')).toBe(CAREGIVER_VERIFICATION_PATH);
    expect(verificationPath('provider')).toBe(PROVIDER_VERIFICATION_PATH);
  });

  it('isActivated is true only for activated', () => {
    for (const s of VERIFICATION_STATES) expect(isActivated(s)).toBe(s === 'activated');
  });

  it('isTerminal is true only for rejected', () => {
    for (const s of VERIFICATION_STATES) expect(isTerminal(s)).toBe(s === 'rejected');
  });

  it('both spines start at unverified and end at activated', () => {
    for (const path of [CAREGIVER_VERIFICATION_PATH, PROVIDER_VERIFICATION_PATH]) {
      expect(path[0]).toBe('unverified');
      expect(path[path.length - 1]).toBe('activated');
    }
  });

  it('every gate key has a fact mapping', () => {
    for (const key of VERIFICATION_GATE_KEYS) {
      expect(GATE_FACT[key]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Property-based
// ---------------------------------------------------------------------------

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
  insuranceVerifiedAt: dateOrNull,
  connectAccountReadyAt: dateOrNull,
  rejectedAt: dateOrNull,
});

const roleArb = fc.constantFrom(...SUPPLY_ROLES);
const stateArb = fc.constantFrom(...US_STATES_50_PLUS_DC);
const supportedStatesArb = fc.subarray([...US_STATES_50_PLUS_DC]).map((arr) => new Set(arr));

const inputArb: fc.Arbitrary<ComputeVerificationStateInput> = fc.record({
  role: roleArb,
  state: stateArb,
  supportedStates: supportedStatesArb,
  facts: factsArb,
});

describe('computeVerificationState — property-based', () => {
  it('always returns a declared VerificationState', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(VERIFICATION_STATES).toContain(computeVerificationState(input));
      }),
    );
  });

  it('returns rejected whenever rejectedAt is set, regardless of other facts', () => {
    fc.assert(
      fc.property(
        inputArb,
        fc.date({ min: new Date('2026-01-01T00:00:00Z'), max: new Date('2027-01-01T00:00:00Z') }),
        (input, rejectedAt) => {
          expect(
            computeVerificationState({ ...input, facts: { ...input.facts, rejectedAt } }),
          ).toBe('rejected');
        },
      ),
    );
  });

  it('a Caregiver never reaches a Provider-only state', () => {
    const caregiverArb = fc.record({
      role: fc.constant<'caregiver'>('caregiver'),
      state: stateArb,
      supportedStates: supportedStatesArb,
      facts: factsArb,
    });
    fc.assert(
      fc.property(caregiverArb, (input) => {
        const result = computeVerificationState(input);
        expect(result).not.toBe('license-pending');
        expect(result).not.toBe('insurance-pending');
        expect(result).not.toBe('holding-state-not-supported');
      }),
    );
  });

  it('a Provider never reaches the Caregiver-only connect-pending state', () => {
    const providerArb = fc.record({
      role: fc.constant<'provider'>('provider'),
      state: stateArb,
      supportedStates: supportedStatesArb,
      facts: factsArb,
    });
    fc.assert(
      fc.property(providerArb, (input) => {
        expect(computeVerificationState(input)).not.toBe('connect-pending');
      }),
    );
  });

  it('an out-of-slate Provider never activates (without rejection)', () => {
    fc.assert(
      fc.property(stateArb, factsArb, (state, facts) => {
        const result = computeVerificationState({
          role: 'provider',
          state,
          supportedStates: new Set(), // nothing supported
          facts: { ...facts, rejectedAt: null },
        });
        expect(result).not.toBe('activated');
      }),
    );
  });

  it('monotonicity: adding a fact never moves the state earlier in the per-role order', () => {
    const ORDINAL: Record<VerificationState, number> = {
      unverified: 0,
      'email-verified': 1,
      'id-uploaded': 2,
      'screening-initiated': 3,
      'connect-pending': 4, // caregiver 4th-stage rest
      'license-pending': 4, // provider 4th-stage rest
      'holding-state-not-supported': 4, // provider (unsupported) 4th-stage rest
      'insurance-pending': 5,
      'awaiting-phone-verification': 6,
      activated: 7,
      rejected: 8,
    };

    const factField = fc.constantFrom<keyof VerificationFacts>(
      'emailConfirmedAt',
      'phoneConfirmedAt',
      'idDocUploadedAt',
      'screeningInitiatedAt',
      'screeningPassedAt',
      'licenseVerifiedAt',
      'insuranceVerifiedAt',
      'connectAccountReadyAt',
    );

    fc.assert(
      fc.property(
        roleArb,
        stateArb,
        supportedStatesArb,
        factField,
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
