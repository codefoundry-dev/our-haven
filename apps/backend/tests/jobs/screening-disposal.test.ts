import { describe, expect, it, vi } from 'vitest';

import { purgeDueScreenings, selectDueForDisposal } from '@/jobs/screening-disposal.js';

interface Row {
  id: string;
  purge_at: Date;
  vendor_report_id: string | null;
  candidate_action_url: string | null;
  raw_payload: Record<string, unknown>;
}

function makeDbStub(rows: Row[]) {
  const captured: { ids?: string[]; patch?: Record<string, unknown> } = {};

  const db = {
    selectFrom() {
      return {
        select: () => ({
          where: (col: string, op: string, val: Date) => {
            // First .where('purge_at', '<=', now) — store predicate
            const dueByPurge = rows.filter((r) => r.purge_at.getTime() <= val.getTime());
            return {
              where: (cb: (eb: unknown) => unknown) => {
                // We don't introspect the .or() — the route filters in SQL.
                // For the test, accept all `dueByPurge` rows that still have raw data.
                void cb;
                const dueByData = dueByPurge.filter(
                  (r) =>
                    r.vendor_report_id !== null ||
                    r.candidate_action_url !== null ||
                    Object.keys(r.raw_payload).length > 0,
                );
                return {
                  limit: () => ({
                    execute: vi.fn(async () => dueByData.map(({ id }) => ({ id }))),
                  }),
                };
              },
            };
          },
        }),
      };
    },
    updateTable() {
      const chain = {
        set: (patch: Record<string, unknown>) => {
          captured.patch = patch;
          return chain;
        },
        where: (col: string, op: string, ids: string[]) => {
          captured.ids = ids;
          return chain;
        },
        execute: vi.fn(async () => undefined),
      };
      return chain;
    },
  };

  return { db, captured };
}

describe('selectDueForDisposal', () => {
  it('returns rows whose purge_at is past and that still carry raw vendor data', async () => {
    const now = new Date('2026-12-01T00:00:00Z');
    const rows: Row[] = [
      {
        id: 'old-with-data',
        purge_at: new Date('2026-06-01T00:00:00Z'),
        vendor_report_id: 'rep_1',
        candidate_action_url: null,
        raw_payload: { type: 'report.completed' },
      },
      {
        id: 'old-empty',
        purge_at: new Date('2026-06-01T00:00:00Z'),
        vendor_report_id: null,
        candidate_action_url: null,
        raw_payload: {},
      },
      {
        id: 'future',
        purge_at: new Date('2027-01-01T00:00:00Z'),
        vendor_report_id: 'rep_2',
        candidate_action_url: null,
        raw_payload: { foo: 1 },
      },
    ];
    const { db } = makeDbStub(rows);
    const due = await selectDueForDisposal(db as never, now);
    expect(due.map((r) => r.id)).toEqual(['old-with-data']);
  });
});

describe('purgeDueScreenings', () => {
  it('nulls vendor identifiers and clears raw_payload on due rows', async () => {
    const now = new Date('2026-12-01T00:00:00Z');
    const rows: Row[] = [
      {
        id: 'old-1',
        purge_at: new Date('2026-06-01T00:00:00Z'),
        vendor_report_id: 'rep_1',
        candidate_action_url: 'https://check.example/inv/1',
        raw_payload: { type: 'report.completed' },
      },
      {
        id: 'old-2',
        purge_at: new Date('2026-06-02T00:00:00Z'),
        vendor_report_id: 'rep_2',
        candidate_action_url: null,
        raw_payload: { foo: 'bar' },
      },
    ];
    const { db, captured } = makeDbStub(rows);
    const result = await purgeDueScreenings(db as never, now);

    expect(result.rowsPurged).toBe(2);
    expect(result.rowIds).toEqual(['old-1', 'old-2']);
    expect(captured.ids).toEqual(['old-1', 'old-2']);
    expect(captured.patch).toMatchObject({
      vendor_report_id: null,
      candidate_action_url: null,
      raw_payload: {},
    });
  });

  it('is a no-op when nothing is due', async () => {
    const { db } = makeDbStub([]);
    const result = await purgeDueScreenings(db as never, new Date('2026-12-01T00:00:00Z'));
    expect(result.rowsPurged).toBe(0);
    expect(result.rowIds).toEqual([]);
  });
});
