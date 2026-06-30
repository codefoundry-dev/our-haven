import { describe, expect, it } from 'vitest';

import {
  consultationAutoCompleteSweep,
  dueConsultationsQuery,
  dueScreeningsQuery,
  screeningDisposalSweep,
  SWEEPS,
} from './sweeps.ts';
import { compileOnlyDb } from './_test/env.ts';

describe('SWEEPS registry', () => {
  it('includes the screening-disposal + consultation auto-complete sweeps', () => {
    expect(SWEEPS.map((s) => s.name)).toEqual(['screening_disposal', 'consultation_auto_complete']);
    expect(screeningDisposalSweep.name).toBe('screening_disposal');
    expect(consultationAutoCompleteSweep.name).toBe('consultation_auto_complete');
  });
});

describe('dueConsultationsQuery (SKIP LOCKED claim)', () => {
  it('compiles to a FOR UPDATE SKIP LOCKED select bounded by auto_complete_at', () => {
    const { sql } = dueConsultationsQuery(compileOnlyDb(), new Date('2026-07-10T12:00:00Z'), 1000).compile();
    const lower = sql.toLowerCase();

    expect(lower).toContain('for update');
    expect(lower).toContain('skip locked');
    expect(lower).toContain('"auto_complete_at" <=');
    // Only accepted Provider consultations are claimed.
    expect(lower).toContain('"kind" =');
    expect(lower).toContain('"state" =');
  });
});

describe('consultationAutoCompleteSweep', () => {
  it('completes due accepted consultations and reports the count', async () => {
    const updates: Array<{ set: Record<string, unknown>; ids: unknown }> = [];
    const trx = {
      selectFrom: () => trx,
      select: () => trx,
      where: () => trx,
      orderBy: () => trx,
      limit: () => trx,
      forUpdate: () => trx,
      skipLocked: () => trx,
      execute: async () => [
        { id: 'b1', state: 'accepted' },
        { id: 'b2', state: 'accepted' },
      ],
      updateTable: () => ({
        set: (set: Record<string, unknown>) => ({
          where: (_c: unknown, _op: unknown, ids: unknown) => ({
            execute: async () => {
              updates.push({ set, ids });
              return [];
            },
          }),
        }),
      }),
    } as unknown as Parameters<typeof consultationAutoCompleteSweep.run>[0];
    const db = {
      transaction: () => ({ execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx) }),
    } as unknown as Parameters<typeof consultationAutoCompleteSweep.run>[0];

    const result = await consultationAutoCompleteSweep.run(db, { now: new Date('2026-07-10T12:00:00Z'), limit: 1000 });
    expect(result).toEqual({ name: 'consultation_auto_complete', processed: 2 });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.set).toMatchObject({ state: 'completed' });
    expect(updates[0]!.ids).toEqual(['b1', 'b2']);
  });

  it('processes nothing when no consultation is due', async () => {
    const trx = {
      selectFrom: () => trx,
      select: () => trx,
      where: () => trx,
      orderBy: () => trx,
      limit: () => trx,
      forUpdate: () => trx,
      skipLocked: () => trx,
      execute: async () => [],
    } as unknown as Parameters<typeof consultationAutoCompleteSweep.run>[0];
    const db = {
      transaction: () => ({ execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx) }),
    } as unknown as Parameters<typeof consultationAutoCompleteSweep.run>[0];

    const result = await consultationAutoCompleteSweep.run(db, { now: new Date(), limit: 1000 });
    expect(result).toEqual({ name: 'consultation_auto_complete', processed: 0 });
  });
});

describe('dueScreeningsQuery (SKIP LOCKED claim)', () => {
  it('compiles to a FOR UPDATE SKIP LOCKED select bounded by purge_at', () => {
    const { sql } = dueScreeningsQuery(compileOnlyDb(), new Date('2026-06-26T12:00:00Z'), 100).compile();
    const lower = sql.toLowerCase();

    expect(lower).toContain('for update');
    expect(lower).toContain('skip locked');
    expect(lower).toContain('"purge_at" <=');
    // Only rows still holding raw FCRA-disposable detail.
    expect(lower).toContain('"vendor_report_id" is not null');
    expect(lower).toContain('"candidate_action_url" is not null');
    expect(lower).toContain("'{}'::jsonb");
  });
});
