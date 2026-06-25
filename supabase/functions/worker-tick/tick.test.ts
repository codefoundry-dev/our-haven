import { describe, expect, it } from 'vitest';

import type { DrainResult } from './outbox.ts';
import type { Sweep } from './sweeps.ts';
import { runTick } from './tick.ts';
import type { Db } from './db/kysely.ts';

// runTick only passes `db` through to the injected drain + sweeps; with both
// faked it is never touched, so a throwing Proxy proves the DB stays untouched.
const stubDb = new Proxy({} as never, {
  get() {
    throw new Error('runTick must not touch the db when drain + sweeps are injected');
  },
}) as Db;

const fixedDrain: DrainResult = { claimed: 2, sent: 2, retried: 0, failed: 0 };
const drainStub = () => Promise.resolve(fixedDrain);

const okSweep: Sweep = { name: 'ok', run: () => Promise.resolve({ name: 'ok', processed: 3 }) };
const boomSweep: Sweep = {
  name: 'boom',
  run: () => Promise.reject(new Error('kaboom')),
};

describe('runTick', () => {
  const now = new Date('2026-06-26T12:00:00.000Z');

  it('drains then runs sweeps and aggregates the summary', async () => {
    const summary = await runTick(stubDb, { now, drain: drainStub, sweeps: [okSweep] });

    expect(summary.ranAt).toBe(now.toISOString());
    expect(summary.drain).toEqual(fixedDrain);
    expect(summary.sweeps).toEqual([{ name: 'ok', processed: 3 }]);
  });

  it('isolates a throwing sweep without aborting the others or the drain', async () => {
    const summary = await runTick(stubDb, {
      now,
      drain: drainStub,
      sweeps: [okSweep, boomSweep],
    });

    expect(summary.drain).toEqual(fixedDrain);
    expect(summary.sweeps).toHaveLength(2);
    expect(summary.sweeps[0]).toEqual({ name: 'ok', processed: 3 });
    expect(summary.sweeps[1]).toMatchObject({ name: 'boom', processed: 0 });
    expect(summary.sweeps[1]?.error).toContain('kaboom');
  });
});
