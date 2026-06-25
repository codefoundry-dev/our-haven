import { type Kysely, sql } from 'kysely';

/**
 * Transactional notification outbox (ADR-0019 § Decision 4; OH-237).
 *
 * The serverless replacement for "enqueue a pgmq message after the write": an
 * event-driven side-effect (a push / email / SMS to send) is written as a row
 * in THIS table inside the SAME Kysely transaction as the domain change that
 * triggers it. There is no dual-write window — either both the domain row and
 * its outbox row commit, or neither does (the bug the planned "enqueue after
 * the write" carried).
 *
 * The `worker-tick` Edge Function drains the table every minute, claiming due
 * rows with `FOR UPDATE SKIP LOCKED` so overlapping ticks never double-send,
 * dispatching each, then marking it `sent_at` (success) or bumping `attempts`
 * and backing off `next_attempt_at` (failure), giving up at `max_attempts`
 * (`failed_at`). The concrete channel fan-out (Expo Push / VAPID / Resend /
 * Twilio) is wired by OH-194 against the dispatcher seam; this migration lays
 * only the substrate table.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('notification_outbox')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // Recipient is a Supabase auth user (uuid) — matches messages.sender_uid.
    .addColumn('recipient_uid', 'uuid', (c) => c.notNull())
    // The domain event that produced this side-effect, e.g. 'booking.requested'.
    .addColumn('event_type', 'text', (c) => c.notNull())
    // Channel-agnostic template params + deep-link payload (OH-194 shapes it).
    .addColumn('payload', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    // Optional idempotency key — the unique partial index below makes a re-run
    // of the producing transaction enqueue at most one row per logical event.
    .addColumn('dedupe_key', 'text')
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('max_attempts', 'integer', (c) => c.notNull().defaultTo(8))
    // When the row becomes eligible to (re)send — drives exponential backoff.
    .addColumn('next_attempt_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // Terminal success marker — non-null = delivered, never re-claimed.
    .addColumn('sent_at', 'timestamptz')
    // Terminal failure marker — non-null = attempts exhausted, stops draining.
    .addColumn('failed_at', 'timestamptz')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('notification_outbox_attempts_chk', sql`attempts >= 0`)
    .execute();

  // The drain claim is
  //   WHERE sent_at IS NULL AND failed_at IS NULL AND next_attempt_at <= now()
  //   ORDER BY next_attempt_at … FOR UPDATE SKIP LOCKED
  // A partial index over exactly the still-pending rows keeps the per-tick scan
  // cheap as the delivered backlog grows unbounded.
  await sql`
    create index notification_outbox_due_idx
      on notification_outbox (next_attempt_at)
      where sent_at is null and failed_at is null
  `.execute(db);

  // At most one live row per logical event (idempotent enqueue). Partial so the
  // common dedupe_key-less rows are unconstrained.
  await sql`
    create unique index notification_outbox_dedupe_uniq
      on notification_outbox (dedupe_key)
      where dedupe_key is not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('notification_outbox').ifExists().execute();
}
