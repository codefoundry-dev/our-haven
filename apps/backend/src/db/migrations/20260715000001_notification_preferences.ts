import { type Kysely, sql } from 'kysely';

/**
 * Notification channel preferences (OH-221) — the store behind the Caregiver
 * Account tab's "Notifications" settings (and reusable by every role's Account
 * surface). One row per recipient `uid` (the Supabase auth user, matching
 * `notification_outbox.recipient_uid`); a **missing row means all channels on**,
 * so the dispatcher only suppresses a channel it holds an explicit `false` for.
 *
 * The worker-tick notifications dispatcher (OH-194) honours `push` / `web_push`
 * / `email` as best-effort opt-outs. `sms` is stored for symmetry + forward
 * compatibility but is NEVER consulted to suppress the mandatory-SMS event set
 * (safety-critical — CONTEXT § Notifications): mandatory SMS always sends.
 *
 * Pure DDL — no plpgsql (the canary stays green). RLS is enabled; the Edge
 * Functions reach the table over the privileged pooler connection (the client
 * reads/writes only through GET/PATCH /v1/me/notification-preferences).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('notification_preferences')
    // Recipient — a Supabase auth user (uuid); one row per user, so it is the PK.
    .addColumn('uid', 'uuid', (c) => c.primaryKey())
    // Best-effort channel opt-outs. Default true = "on" so a fresh row (or the
    // absence of one) delivers on every channel.
    .addColumn('push', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('web_push', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('email', 'boolean', (c) => c.notNull().defaultTo(true))
    // Stored for symmetry; the dispatcher never suppresses mandatory SMS with it.
    .addColumn('sms', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('notification_preferences').ifExists().execute();
}
