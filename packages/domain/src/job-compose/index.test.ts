import { describe, expect, it } from 'vitest';

import type { OfferSchedule } from '../offer-lifecycle/index.js';
import {
  JOB_COMPOSE_MAX_SLOTS,
  JOB_COMPOSE_MODULE_VERSION,
  planJobPosts,
  validateJobCompose,
  type JobComposeInput,
} from './index.js';

const SLOT = { date: '2026-08-01', startMin: 1080, endMin: 1320 }; // 6:00–10:00 PM
const SLOT_2 = { date: '2026-08-05', startMin: 1020, endMin: 1200 };
const ZIP = { postalCode: '90210', state: 'CA' };
const RULE = {
  startDate: '2026-08-01',
  endDate: '2026-09-30',
  weekdays: [2, 4], // Tue + Thu
  startMin: 900,
  endMin: 1020,
};

function input(overrides: Partial<JobComposeInput> = {}): JobComposeInput {
  return {
    category: 'babysitter',
    description: 'After-school care for two kids',
    childCount: 2,
    childAges: [4, 7],
    safetyBehaviors: [],
    serviceAddress: { ...ZIP },
    budgetHintCents: 2500,
    disclosureConsentAt: '2026-07-01T12:00:00.000Z',
    schedule: { kind: 'one-off', slot: SLOT },
    ...overrides,
  };
}

describe('validateJobCompose', () => {
  it('accepts a well-formed one-off compose', () => {
    expect(validateJobCompose(input())).toEqual({ ok: true });
  });

  it('accepts a recurring compose', () => {
    expect(validateJobCompose(input({ schedule: { kind: 'recurring', rule: RULE } }))).toEqual({
      ok: true,
    });
  });

  it('accepts disclose-none ([]) and a disclosed subset', () => {
    expect(validateJobCompose(input({ safetyBehaviors: [] })).ok).toBe(true);
    expect(validateJobCompose(input({ safetyBehaviors: ['wandering', 'aggression'] })).ok).toBe(
      true,
    );
  });

  it('requires a timestamped disclosure consent', () => {
    const r = validateJobCompose(input({ disclosureConsentAt: '' }));
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: expect.stringContaining('consent') });
  });

  it('requires childAges length to equal childCount', () => {
    expect(validateJobCompose(input({ childCount: 2, childAges: [4] })).ok).toBe(false);
  });

  it('rejects out-of-range child ages', () => {
    expect(validateJobCompose(input({ childCount: 1, childAges: [18] })).ok).toBe(false);
    expect(validateJobCompose(input({ childCount: 1, childAges: [-1] })).ok).toBe(false);
  });

  it('enforces tutor single-child', () => {
    const r = validateJobCompose(
      input({ category: 'tutor', childCount: 2, childAges: [8, 10] }),
    );
    expect(r.ok).toBe(false);
    expect(validateJobCompose(input({ category: 'tutor', childCount: 1, childAges: [10] })).ok).toBe(
      true,
    );
  });

  it('requires a valid 5-digit ZIP', () => {
    expect(validateJobCompose(input({ serviceAddress: { postalCode: '9021' } })).ok).toBe(false);
    expect(validateJobCompose(input({ serviceAddress: { postalCode: 'ABCDE' } })).ok).toBe(false);
    // @ts-expect-error — ZIP is required on the address
    expect(validateJobCompose(input({ serviceAddress: {} })).ok).toBe(false);
  });

  it('rejects a bad 2-letter state when provided', () => {
    expect(
      validateJobCompose(input({ serviceAddress: { postalCode: '90210', state: 'Cal' } })).ok,
    ).toBe(false);
  });

  it('requires a non-empty scope description', () => {
    expect(validateJobCompose(input({ description: '   ' })).ok).toBe(false);
  });

  it('rejects a negative budget hint', () => {
    expect(validateJobCompose(input({ budgetHintCents: -1 })).ok).toBe(false);
  });

  it('rejects a window whose start is not before its end', () => {
    const bad: OfferSchedule = { kind: 'one-off', slot: { date: '2026-08-01', startMin: 600, endMin: 600 } };
    expect(validateJobCompose(input({ schedule: bad })).ok).toBe(false);
  });

  it('rejects a recurrence rule with no weekdays or an inverted date range', () => {
    expect(
      validateJobCompose(input({ schedule: { kind: 'recurring', rule: { ...RULE, weekdays: [] } } }))
        .ok,
    ).toBe(false);
    expect(
      validateJobCompose(
        input({ schedule: { kind: 'recurring', rule: { ...RULE, endDate: '2026-07-01' } } }),
      ).ok,
    ).toBe(false);
  });

  it('rejects more than the multi-day cap', () => {
    const slots = Array.from({ length: JOB_COMPOSE_MAX_SLOTS + 1 }, (_, i) => ({
      date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
      startMin: 600,
      endMin: 720,
    }));
    expect(validateJobCompose(input({ schedule: { kind: 'multi-day', slots } })).ok).toBe(false);
  });
});

describe('planJobPosts — fan-out (ADR-0014 §A1)', () => {
  it('one-off single date → exactly one Job', () => {
    const r = planJobPosts(input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]).toMatchObject({
      scheduleKind: 'one-off',
      slots: [SLOT],
      recurrence: null,
      childCount: 2,
    });
  });

  it('multi-day (N dates) → N one-off Jobs, one per date', () => {
    const r = planJobPosts(input({ schedule: { kind: 'multi-day', slots: [SLOT, SLOT_2] } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posts).toHaveLength(2);
    expect(r.posts.map((p) => p.slots[0])).toEqual([SLOT, SLOT_2]);
    expect(r.posts.every((p) => p.scheduleKind === 'one-off' && p.recurrence === null)).toBe(true);
  });

  it('recurring → a single Job carrying the un-expanded rule', () => {
    const r = planJobPosts(input({ schedule: { kind: 'recurring', rule: RULE } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]).toMatchObject({ scheduleKind: 'recurring', slots: [], recurrence: RULE });
  });

  it('propagates a validation failure instead of planning', () => {
    const r = planJobPosts(input({ disclosureConsentAt: '' }));
    expect(r.ok).toBe(false);
  });

  it('trims the description and defaults an absent budget hint to null', () => {
    const r = planJobPosts(input({ description: '  hi  ', budgetHintCents: null }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posts[0]!.description).toBe('hi');
    expect(r.posts[0]!.budgetHintCents).toBeNull();
  });

  it('carries the disclosed behaviors + consent onto every fanned-out Job', () => {
    const r = planJobPosts(
      input({
        safetyBehaviors: ['wandering'],
        schedule: { kind: 'multi-day', slots: [SLOT, SLOT_2] },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posts.every((p) => p.safetyBehaviors.length === 1 && p.disclosureConsentAt !== '')).toBe(
      true,
    );
  });
});

it('exposes a module version', () => {
  expect(JOB_COMPOSE_MODULE_VERSION).toMatch(/OH-209/);
});
