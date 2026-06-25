import type { Insertable } from 'kysely';

import type { Db } from '@/db/kysely.js';
import type { NotificationOutboxTable } from '@/db/schema.js';

/**
 * Producer side of the transactional outbox (ADR-0019 § Decision 4; OH-237) —
 * replaces the pgmq `enqueue`. Notifications are no longer pushed onto a queue
 * after the write; they are written as `notification_outbox` rows inside the
 * SAME transaction as the domain change, so the row and its side-effect commit
 * atomically. The `worker-tick` Edge Function drains them; OH-194 wires the
 * concrete channels.
 */
export interface OutboxNotification {
  /** Supabase auth uid of the recipient. */
  recipientUid: string;
  /** Domain event, e.g. 'booking.requested'. The dispatcher maps it to channels. */
  eventType: string;
  /** Channel-agnostic template params + deep-link payload. */
  payload?: Record<string, unknown>;
  /** Optional idempotency key — at most one live row per key (unique partial index). */
  dedupeKey?: string;
  /** Override the per-row delivery attempt budget (default 8, set by the column). */
  maxAttempts?: number;
}

/**
 * Write a notification side-effect into the transactional outbox.
 *
 * MUST be called with the same Kysely transaction (`db.transaction().execute`)
 * as the domain change that triggers it, so the outbox row and the domain row
 * commit together — there is no dual-write window. Returns the new row id, or
 * `null` when a `dedupeKey` collision means an equivalent notification is
 * already queued (the insert is a no-op).
 */
export function enqueueInsertQuery(trx: Db, input: OutboxNotification) {
  const values: Insertable<NotificationOutboxTable> = {
    recipient_uid: input.recipientUid,
    event_type: input.eventType,
    payload: input.payload ?? {},
    dedupe_key: input.dedupeKey ?? null,
    ...(input.maxAttempts !== undefined ? { max_attempts: input.maxAttempts } : {}),
  };

  return (
    trx
      .insertInto('notification_outbox')
      .values(values)
      // Idempotent enqueue: a repeated (dedupe_key) collides on the partial
      // unique index and is silently skipped. The `where` predicate must mirror
      // the index's `WHERE dedupe_key IS NOT NULL` so Postgres matches the
      // partial index; rows without a dedupe_key never conflict.
      .onConflict((oc) => oc.column('dedupe_key').where('dedupe_key', 'is not', null).doNothing())
      .returning('id')
  );
}

export async function enqueueNotification(
  trx: Db,
  input: OutboxNotification,
): Promise<string | null> {
  const inserted = await enqueueInsertQuery(trx, input).executeTakeFirst();
  return inserted?.id ?? null;
}
