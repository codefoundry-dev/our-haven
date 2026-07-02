import { type Kysely, sql } from 'kysely';

/**
 * Marketing opt-in + Job expiry (OH-223; CONTEXT § Notifications, PRD-0001 v1.7
 * stories 30/31/50/76/77).
 *
 * 1. `notification_preferences.marketing_opt_in` — the per-user **marketing
 *    opt-in**, kept strictly separate from transactional notifications. CONTEXT:
 *    "Marketing messages require a separate opt-in distinct from transactional
 *    notifications", and SMS on the four urgent events is "no opt-out". This
 *    column gates ONLY future marketing sends; the `worker-tick` transactional
 *    dispatcher never reads it. Default opted-OUT — marketing is opt-IN.
 *    `marketing_opt_in_at` stamps the moment consent was given/withdrawn for the
 *    audit trail.
 *
 *    ⚠ RECONCILED WITH OH-221 (branch `feat/oh-221-caregiver-account-tab`, its
 *    migration `20260715000001_notification_preferences` — ALREADY APPLIED TO
 *    PROD): that ticket owns this table's per-CHANNEL opt-outs (push / web_push /
 *    email best-effort; sms stored but never suppressing mandatory SMS). Since the
 *    two tickets are on sibling branches, this migration is written to be
 *    order-proof: `CREATE TABLE IF NOT EXISTS` with the full merged shape (a
 *    my-branch-only database gets everything), then `ADD COLUMN IF NOT EXISTS`
 *    for the marketing columns (a database that already ran OH-221's CREATE —
 *    prod — just gains the two marketing columns). Either path converges on the
 *    same final schema; re-running is a no-op.
 *
 * 2. `jobs.expires_at` — the instant a **posted** Job stops being awardable (its
 *    earliest scheduled slot start, stamped at publish; NULL for Direct-Message
 *    Jobs, which never expire on a timer). Drives the two OH-223 job-expiry
 *    sweeps: `job_expiring_48h` (warn the Parent ~48h out with no Applications)
 *    and `job_expired_no_award` (flip `open → expired` once it passes with no
 *    award). NULLable so every existing Job and the Direct-Message path are
 *    untouched.
 *
 * Pure DDL — no stored routine, so the plpgsql canary (check-no-plpgsql.ts)
 * stays green.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Full merged shape (OH-221 channel opt-outs + OH-223 marketing opt-in). A
  // no-op wherever OH-221's CREATE already ran (prod).
  await db.schema
    .createTable('notification_preferences')
    .ifNotExists()
    // Recipient — a Supabase auth user (uuid); one row per user, so it is the PK.
    .addColumn('uid', 'uuid', (c) => c.primaryKey())
    // Best-effort channel opt-outs (OH-221). Default true = "on".
    .addColumn('push', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('web_push', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('email', 'boolean', (c) => c.notNull().defaultTo(true))
    // Stored for symmetry; the dispatcher never suppresses mandatory SMS with it.
    .addColumn('sms', 'boolean', (c) => c.notNull().defaultTo(true))
    // Marketing is opt-IN: default false (transactional is unaffected either way).
    .addColumn('marketing_opt_in', 'boolean', (c) => c.notNull().defaultTo(false))
    // When the current opt-in value was last set — audit trail for consent.
    .addColumn('marketing_opt_in_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  // The prod path: OH-221's table exists without the marketing columns — add them.
  await sql`
    ALTER TABLE public.notification_preferences
      ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false
  `.execute(db);
  await sql`
    ALTER TABLE public.notification_preferences
      ADD COLUMN IF NOT EXISTS marketing_opt_in_at timestamptz
  `.execute(db);

  // Idempotent — already enabled wherever OH-221's migration ran.
  await sql`ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY`.execute(db);

  // ── Job expiry (OH-223 job-expiry sweeps) ───────────────────────────────────
  await db.schema.alterTable('jobs').addColumn('expires_at', 'timestamptz').execute();

  // The sweep claim is `WHERE state = 'open' AND expires_at <= now() …`; a partial
  // index over exactly the still-open, timer-bearing Jobs keeps that scan cheap.
  await sql`
    CREATE INDEX jobs_expires_at_open_idx
      ON public.jobs (expires_at)
      WHERE state = 'open' AND expires_at IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('jobs_expires_at_open_idx').ifExists().execute();
  await db.schema.alterTable('jobs').dropColumn('expires_at').execute();
  // Drop only what OH-223 owns — the marketing columns. The table itself (and its
  // channel columns) belong to OH-221's migration wherever that ran; on a
  // my-branch-only database this leaves the channel-only table behind, which its
  // own down() can drop.
  await sql`ALTER TABLE public.notification_preferences DROP COLUMN IF EXISTS marketing_opt_in_at`.execute(db);
  await sql`ALTER TABLE public.notification_preferences DROP COLUMN IF EXISTS marketing_opt_in`.execute(db);
}
