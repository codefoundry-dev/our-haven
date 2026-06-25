import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  addYears,
  dueDirectives,
  ERASURE_ACTIONS,
  isDirectiveDue,
  planErasure,
  pseudonymForUser,
  RETENTION_CATEGORIES,
  RETENTION_HORIZONS,
  RETENTION_PLANNER_MODULE_VERSION,
  type ErasureAction,
  type ErasureDirective,
  type PlanErasureInput,
  type RetentionCategory,
} from './index.js';

const REQUESTED_AT = new Date('2026-06-25T12:00:00.000Z');
const SUBJECT = 'usr_abc123';

function baseInput(overrides: Partial<PlanErasureInput> = {}): PlanErasureInput {
  return {
    trigger: 'account-deletion',
    subjectUserId: SUBJECT,
    requestedAt: REQUESTED_AT,
    ...overrides,
  };
}

function byCategory(plan: ErasureDirective[], category: RetentionCategory): ErasureDirective[] {
  return plan.filter((d) => d.category === category);
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

describe('date helpers — UTC + end-of-month clamping', () => {
  it('addDays adds calendar days', () => {
    expect(addDays(REQUESTED_AT, 30).toISOString()).toBe('2026-07-25T12:00:00.000Z');
  });

  it('addMonths clamps Jan 31 + 1 month to Feb 28 (non-leap)', () => {
    expect(addMonths(new Date('2026-01-31T00:00:00.000Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });

  it('addMonths clamps Jan 31 + 1 month to Feb 29 (leap year)', () => {
    expect(addMonths(new Date('2028-01-31T00:00:00.000Z'), 1).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });

  it('addMonths(6) preserves the day when the target month is long enough', () => {
    expect(addMonths(REQUESTED_AT, 6).toISOString()).toBe('2026-12-25T12:00:00.000Z');
  });

  it('addYears clamps Feb 29 to Feb 28 in a non-leap target year', () => {
    expect(addYears(new Date('2028-02-29T00:00:00.000Z'), 1).toISOString()).toBe(
      '2029-02-28T00:00:00.000Z',
    );
  });

  it('addYears(7) advances the year', () => {
    expect(addYears(REQUESTED_AT, 7).toISOString()).toBe('2033-06-25T12:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Consent withdrawal — sensitive category only
// ---------------------------------------------------------------------------

describe('planErasure — consent withdrawal', () => {
  it('erases ONLY Safety Behaviors, immediately, hard-delete', () => {
    const plan = planErasure(baseInput({ trigger: 'consent-withdrawal' }));
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      category: 'safety_behaviors',
      action: 'hard-delete',
      dueAt: REQUESTED_AT,
      pseudonym: null,
    });
  });

  it('does not touch account, financial, messages or background-check categories', () => {
    const plan = planErasure(baseInput({ trigger: 'consent-withdrawal' }));
    const categories = new Set(plan.map((d) => d.category));
    expect(categories).toEqual(new Set(['safety_behaviors']));
  });

  it('is due immediately at requestedAt', () => {
    const plan = planErasure(baseInput({ trigger: 'consent-withdrawal' }));
    expect(isDirectiveDue(plan[0]!, REQUESTED_AT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Account deletion — full policy table
// ---------------------------------------------------------------------------

describe('planErasure — account deletion', () => {
  it('covers every retention category', () => {
    const plan = planErasure(baseInput());
    const categories = new Set(plan.map((d) => d.category));
    expect(categories).toEqual(new Set(RETENTION_CATEGORIES));
  });

  it('account: soft-delete now, hard-delete after the 30-day grace', () => {
    const account = byCategory(planErasure(baseInput()), 'account');
    expect(account.map((d) => d.action)).toEqual(['soft-delete', 'hard-delete']);
    expect(account[0]!.dueAt).toEqual(REQUESTED_AT);
    expect(account[1]!.dueAt).toEqual(addDays(REQUESTED_AT, RETENTION_HORIZONS.ACCOUNT_GRACE_DAYS));
    expect(account[1]!.dueAt.toISOString()).toBe('2026-07-25T12:00:00.000Z');
  });

  it('financial: pseudonymize to "Deleted user {id}" now, hard-delete after 7 years', () => {
    const financial = byCategory(planErasure(baseInput()), 'financial');
    expect(financial.map((d) => d.action)).toEqual(['pseudonymize', 'hard-delete']);
    expect(financial[0]!.pseudonym).toBe('Deleted user usr_abc123');
    expect(financial[0]!.pseudonym).toBe(pseudonymForUser(SUBJECT));
    expect(financial[0]!.dueAt).toEqual(REQUESTED_AT);
    expect(financial[1]!.dueAt).toEqual(
      addYears(REQUESTED_AT, RETENTION_HORIZONS.FINANCIAL_RETENTION_YEARS),
    );
    expect(financial[1]!.dueAt.toISOString()).toBe('2033-06-25T12:00:00.000Z');
  });

  it('safety_behaviors: hard-deleted immediately on account deletion too', () => {
    const sensitive = byCategory(planErasure(baseInput()), 'safety_behaviors');
    expect(sensitive).toHaveLength(1);
    expect(sensitive[0]!).toMatchObject({ action: 'hard-delete', dueAt: REQUESTED_AT });
  });

  it('messages: hard-deleted 3 years after last activity (defaults to requestedAt)', () => {
    const messages = byCategory(planErasure(baseInput()), 'messages');
    expect(messages).toHaveLength(1);
    expect(messages[0]!.action).toBe('hard-delete');
    expect(messages[0]!.dueAt).toEqual(addYears(REQUESTED_AT, RETENTION_HORIZONS.MESSAGE_RETENTION_YEARS));
  });

  it('messages: clock runs from the supplied last-activity date, not requestedAt', () => {
    const lastActivity = new Date('2025-01-10T00:00:00.000Z');
    const messages = byCategory(planErasure(baseInput({ messagesLastActivityAt: lastActivity })), 'messages');
    expect(messages[0]!.dueAt).toEqual(addYears(lastActivity, 3));
    expect(messages[0]!.dueAt.toISOString()).toBe('2028-01-10T00:00:00.000Z');
  });

  it('messages: an active-investigation hold suspends the clock → retain, never due', () => {
    const messages = byCategory(planErasure(baseInput({ investigationHold: true })), 'messages');
    expect(messages).toHaveLength(1);
    expect(messages[0]!.action).toBe('retain');
    expect(isDirectiveDue(messages[0]!, addYears(REQUESTED_AT, 100))).toBe(false);
  });

  it('background_check_raw: hard-deleted 6 months after completion (defaults to requestedAt)', () => {
    const bg = byCategory(planErasure(baseInput()), 'background_check_raw');
    expect(bg).toHaveLength(1);
    expect(bg[0]!.action).toBe('hard-delete');
    expect(bg[0]!.dueAt).toEqual(
      addMonths(REQUESTED_AT, RETENTION_HORIZONS.BACKGROUND_CHECK_RAW_RETENTION_MONTHS),
    );
    expect(bg[0]!.dueAt.toISOString()).toBe('2026-12-25T12:00:00.000Z');
  });

  it('background_check_raw: clock runs from the supplied completion date', () => {
    const completed = new Date('2026-03-01T00:00:00.000Z');
    const bg = byCategory(planErasure(baseInput({ backgroundCheckCompletedAt: completed })), 'background_check_raw');
    expect(bg[0]!.dueAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Due-directive seam (worker-tick sweep consumer)
// ---------------------------------------------------------------------------

describe('dueDirectives / isDirectiveDue', () => {
  it('at requestedAt only the immediate actions are due', () => {
    const plan = planErasure(baseInput());
    const due = dueDirectives(plan, REQUESTED_AT);
    // soft-delete account, hard-delete safety_behaviors, pseudonymize financial.
    expect(due.map((d) => `${d.category}:${d.action}`).sort()).toEqual(
      ['account:soft-delete', 'financial:pseudonymize', 'safety_behaviors:hard-delete'].sort(),
    );
  });

  it('after 30 days the account hard-delete becomes due', () => {
    const plan = planErasure(baseInput());
    const at = addDays(REQUESTED_AT, 30);
    expect(dueDirectives(plan, at).some((d) => d.category === 'account' && d.action === 'hard-delete')).toBe(
      true,
    );
  });

  it('after 7 years every account-deletion directive except a retain hold is due', () => {
    const plan = planErasure(baseInput());
    const at = addYears(REQUESTED_AT, 7);
    expect(dueDirectives(plan, at)).toHaveLength(plan.filter((d) => d.action !== 'retain').length);
  });

  it('isDirectiveDue is false the instant before dueAt and true at dueAt', () => {
    const plan = planErasure(baseInput());
    const hardDelete = byCategory(plan, 'account').find((d) => d.action === 'hard-delete')!;
    expect(isDirectiveDue(hardDelete, new Date(hardDelete.dueAt.getTime() - 1))).toBe(false);
    expect(isDirectiveDue(hardDelete, hardDelete.dueAt)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property-based invariants
// ---------------------------------------------------------------------------

const arbDate = fc
  .integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2030, 0, 1) })
  .map((ms) => new Date(ms));

const arbInput: fc.Arbitrary<PlanErasureInput> = fc.record({
  trigger: fc.constantFrom('account-deletion', 'consent-withdrawal') as fc.Arbitrary<
    PlanErasureInput['trigger']
  >,
  subjectUserId: fc.string({ minLength: 1, maxLength: 24 }),
  requestedAt: arbDate,
  messagesLastActivityAt: fc.option(arbDate, { nil: undefined }),
  backgroundCheckCompletedAt: fc.option(arbDate, { nil: undefined }),
  investigationHold: fc.option(fc.boolean(), { nil: undefined }),
});

describe('planErasure — property-based', () => {
  it('every directive uses a known category and a known action', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        for (const d of planErasure(input)) {
          expect(RETENTION_CATEGORIES).toContain(d.category);
          expect(ERASURE_ACTIONS).toContain(d.action);
        }
      }),
    );
  });

  it('a pseudonym is present iff the action is pseudonymize, and matches the label', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        for (const d of planErasure(input)) {
          if (d.action === 'pseudonymize') {
            expect(d.pseudonym).toBe(pseudonymForUser(input.subjectUserId));
          } else {
            expect(d.pseudonym).toBeNull();
          }
        }
      }),
    );
  });

  it('is deterministic — identical input yields an identical plan', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        expect(planErasure(input)).toEqual(planErasure(input));
      }),
    );
  });

  it('consent withdrawal NEVER plans anything beyond Safety Behaviors', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = planErasure({ ...input, trigger: 'consent-withdrawal' });
        expect(plan.map((d) => d.category)).toEqual(['safety_behaviors']);
      }),
    );
  });

  it('account deletion always covers every category exactly once at the planning level for single-phase ones', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = planErasure({ ...input, trigger: 'account-deletion' });
        const categories = new Set(plan.map((d) => d.category));
        expect(categories).toEqual(new Set(RETENTION_CATEGORIES));
      }),
    );
  });

  it('requestedAt-anchored actions (account/financial/safety) are never scheduled before requestedAt', () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const plan = planErasure({ ...input, trigger: 'account-deletion' });
        const anchored = plan.filter(
          (d) => d.category === 'account' || d.category === 'financial' || d.category === 'safety_behaviors',
        );
        for (const d of anchored) {
          expect(d.dueAt.getTime()).toBeGreaterThanOrEqual(input.requestedAt.getTime());
        }
      }),
    );
  });
});

describe('module metadata', () => {
  it('exposes a version tagged to OH-182', () => {
    expect(RETENTION_PLANNER_MODULE_VERSION).toContain('OH-182');
  });

  it('lists exactly the four allowed actions', () => {
    const expected: ErasureAction[] = ['soft-delete', 'pseudonymize', 'hard-delete', 'retain'];
    expect([...ERASURE_ACTIONS]).toEqual(expected);
  });
});
