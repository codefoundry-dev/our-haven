import { sql } from 'kysely';

import type { Db } from './db/kysely.ts';

/**
 * Consumer side of the transactional outbox (ADR-0019 § Decision 4; OH-237).
 *
 * The drain runs inside ONE transaction per batch: it claims due rows with
 * `FOR UPDATE SKIP LOCKED`, dispatches each, and marks the outcome — all before
 * commit. Because the claimed rows stay row-locked for the life of the tx, an
 * overlapping tick's `SKIP LOCKED` simply skips them, so no notification is ever
 * dispatched twice.
 *
 * The orchestrator (`drainOutbox`) is split from persistence (`OutboxStore`) and
 * delivery (`NotificationDispatcher`) so its retry/backoff/give-up logic is
 * unit-tested against in-memory fakes; the Kysely store's SKIP-LOCKED claim is
 * covered by the integration test (`outbox.integration.test.ts`).
 */

/** The minimal projection the drain needs from a claimed row. */
export interface OutboxRow {
  id: string;
  recipient_uid: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** Delivery seam. OH-194 supplies the real channel fan-out (Expo Push / VAPID /
 *  Resend / Twilio); a throw means "delivery failed, retry/back off". */
export interface NotificationDispatcher {
  dispatch(row: OutboxRow): Promise<void>;
}

/** Persistence seam — the Kysely impl runs the SKIP-LOCKED claim + the marks. */
export interface OutboxStore {
  claimDue(now: Date, limit: number): Promise<OutboxRow[]>;
  markSent(id: string, now: Date): Promise<void>;
  markRetry(id: string, nextAttemptAt: Date, error: string): Promise<void>;
  markFailed(id: string, now: Date, error: string): Promise<void>;
}

export interface DrainResult {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
}

/**
 * Deterministic exponential backoff (no jitter, so it is testable): 1m, 2m, 4m…
 * capped at 1h. `attempts` is the just-incremented count (1 after the first
 * failure).
 */
export function backoffDelayMs(attempts: number): number {
  const baseMs = 60_000; // 1 minute
  const capMs = 60 * 60_000; // 1 hour
  return Math.min(capMs, baseMs * 2 ** Math.max(0, attempts - 1));
}

/**
 * Default dispatcher: log and succeed. OH-237 ships only the substrate, so the
 * tick proves the drain end-to-end (rows get marked sent) without yet sending
 * real notifications. OH-194 replaces this with the channel matrix.
 */
export const loggingDispatcher: NotificationDispatcher = {
  async dispatch(row) {
    console.log('[worker-tick] dispatch (noop)', {
      id: row.id,
      event_type: row.event_type,
      recipient_uid: row.recipient_uid,
    });
  },
};

/**
 * Orchestrate one drain pass over an already-claimed batch's store. Each row:
 * dispatch → markSent on success; on failure bump attempts and either back off
 * (`markRetry`) or, once the attempt budget is spent, give up (`markFailed`).
 * A single row's failure never blocks the rest of the batch.
 */
export async function drainOutbox(
  store: OutboxStore,
  dispatcher: NotificationDispatcher,
  opts: { now?: Date; limit?: number } = {},
): Promise<DrainResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 100;

  const rows = await store.claimDue(now, limit);
  const result: DrainResult = { claimed: rows.length, sent: 0, retried: 0, failed: 0 };

  for (const row of rows) {
    try {
      await dispatcher.dispatch(row);
      await store.markSent(row.id, now);
      result.sent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = row.attempts + 1;
      if (attempts >= row.max_attempts) {
        await store.markFailed(row.id, now, message);
        result.failed += 1;
      } else {
        const nextAttemptAt = new Date(now.getTime() + backoffDelayMs(attempts));
        await store.markRetry(row.id, nextAttemptAt, message);
        result.retried += 1;
      }
    }
  }

  return result;
}

/** The claim query, factored out so a unit test can assert the generated SQL
 *  carries `for update` + `skip locked` without a live database. */
export function dueOutboxQuery(db: Db, now: Date, limit: number) {
  return db
    .selectFrom('notification_outbox')
    .select(['id', 'recipient_uid', 'event_type', 'payload', 'attempts', 'max_attempts'])
    .where('sent_at', 'is', null)
    .where('failed_at', 'is', null)
    .where('next_attempt_at', '<=', now)
    .orderBy('next_attempt_at', 'asc')
    .limit(limit)
    .forUpdate()
    .skipLocked();
}

const MAX_ERROR_LEN = 2000;

/** Kysely-backed store over a transaction handle. Claim + marks share the tx so
 *  the row locks hold across dispatch (the SKIP-LOCKED guarantee). */
export function makeKyselyOutboxStore(db: Db): OutboxStore {
  return {
    async claimDue(now, limit) {
      const rows = await dueOutboxQuery(db, now, limit).execute();
      return rows.map((r) => ({
        id: r.id,
        recipient_uid: r.recipient_uid,
        event_type: r.event_type,
        payload: (r.payload ?? {}) as Record<string, unknown>,
        attempts: r.attempts,
        max_attempts: r.max_attempts,
      }));
    },
    async markSent(id, now) {
      await db
        .updateTable('notification_outbox')
        .set({ sent_at: now, last_error: null })
        .where('id', '=', id)
        .execute();
    },
    async markRetry(id, nextAttemptAt, error) {
      await db
        .updateTable('notification_outbox')
        .set({
          attempts: sql<number>`attempts + 1`,
          next_attempt_at: nextAttemptAt,
          last_error: error.slice(0, MAX_ERROR_LEN),
        })
        .where('id', '=', id)
        .execute();
    },
    async markFailed(id, now, error) {
      await db
        .updateTable('notification_outbox')
        .set({
          attempts: sql<number>`attempts + 1`,
          failed_at: now,
          last_error: error.slice(0, MAX_ERROR_LEN),
        })
        .where('id', '=', id)
        .execute();
    },
  };
}

/**
 * Drain one batch transactionally. The whole claim → dispatch → mark cycle runs
 * inside `db.transaction()` so the `FOR UPDATE SKIP LOCKED` row locks are held
 * until commit, which is what prevents a concurrent tick from double-sending.
 */
export function drainOutboxTx(
  db: Db,
  dispatcher: NotificationDispatcher,
  opts: { now?: Date; limit?: number } = {},
): Promise<DrainResult> {
  return db.transaction().execute((trx) =>
    drainOutbox(makeKyselyOutboxStore(trx), dispatcher, opts),
  );
}
