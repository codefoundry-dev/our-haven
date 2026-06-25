import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from './config/env.ts';
import { createDb, type Db } from './db/kysely.ts';
import { drainOutboxTx, type NotificationDispatcher, type OutboxRow } from './outbox.ts';

/**
 * Real-Postgres proof that `FOR UPDATE SKIP LOCKED` prevents double-processing
 * under overlapping ticks (OH-237 acceptance criterion). Skipped unless
 * OUTBOX_IT_DATABASE_URL points at a migrated database — the unit suite covers
 * everything else without a DB.
 *
 *   OUTBOX_IT_DATABASE_URL=postgres://… npm run test:edge
 */
const IT_URL = process.env.OUTBOX_IT_DATABASE_URL;
const EVENT_TYPE = 'it.skip_locked_probe';

describe.skipIf(!IT_URL)('worker-tick outbox drain (integration)', () => {
  let db: Db;

  beforeAll(() => {
    db = createDb(
      loadEnv({
        NODE_ENV: 'test',
        DATABASE_URL: IT_URL,
        DATABASE_SSL: process.env.OUTBOX_IT_DATABASE_SSL ?? 'false',
        WORKER_TICK_SECRET: 'integration',
      }),
    );
  });

  afterAll(async () => {
    if (db) {
      await db.deleteFrom('notification_outbox').where('event_type', '=', EVENT_TYPE).execute();
      await db.destroy();
    }
  });

  it('dispatches each due row exactly once across two concurrent drains', async () => {
    const recipient = randomUUID();
    const count = 8;
    await db
      .insertInto('notification_outbox')
      .values(
        Array.from({ length: count }, () => ({
          recipient_uid: recipient,
          event_type: EVENT_TYPE,
          payload: {},
        })),
      )
      .execute();

    // Slow dispatcher so the first drain holds its row locks while the second
    // drain's claim runs — that overlap is exactly what SKIP LOCKED must handle.
    const dispatched: string[] = [];
    const slowDispatcher: NotificationDispatcher = {
      async dispatch(row: OutboxRow) {
        dispatched.push(row.id);
        await new Promise((r) => setTimeout(r, 150));
      },
    };

    const now = new Date();
    const [a, b] = await Promise.all([
      drainOutboxTx(db, slowDispatcher, { now, limit: count }),
      drainOutboxTx(db, slowDispatcher, { now, limit: count }),
    ]);

    // Every row sent once and only once — no id dispatched twice.
    expect(a.sent + b.sent).toBe(count);
    expect(new Set(dispatched).size).toBe(dispatched.length);
    expect(dispatched).toHaveLength(count);

    const remaining = await db
      .selectFrom('notification_outbox')
      .select(({ fn }) => fn.countAll<string>().as('pending'))
      .where('event_type', '=', EVENT_TYPE)
      .where('sent_at', 'is', null)
      .executeTakeFirstOrThrow();
    expect(Number(remaining.pending)).toBe(0);
  });
});
