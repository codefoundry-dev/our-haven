import { type Kysely, sql } from 'kysely';

/**
 * Application proposal redaction + job-anchored thread uniqueness (OH-219) —
 * CONTEXT § Message ("Job descriptions, Application proposals, and Offer
 * `scope_note`s follow the same rule") / § Application; PRD-0001 v1.7 story 98.
 *
 * Two things the Caregiver Application composer (OH-219) needs, that the read side
 * (OH-210, seeded on fixtures) never had to create for real:
 *
 * 1. PROPOSAL REDACTION. The free-text `proposal` shown to the Parent is a
 *    cross-party disclosure surface, so it passes through the SAME disintermediation
 *    detector as a message body or an Offer `scope_note`: the delivery-safe REDACTED
 *    text is stored, and the UNREDACTED original is queued to the service-role-only
 *    T&S flag queue (`message_flags`).
 *      - `applications.proposal_redacted` — mirrors `offers.scope_note_redacted`.
 *      - `message_flags.application_id` — a THIRD flag subject beside `message_id`
 *        (OH-205) and `offer_id` (OH-206); the 2-way XOR widens to "exactly one".
 *
 * 2. JOB-ANCHORED THREAD UNIQUENESS. OH-205 created ONE thread per (parent,
 *    provider) — `message_threads_parent_provider_uniq` — correct for the single
 *    pre-acceptance Direct-Message thread. But a posted-Job Application's companion
 *    thread is keyed by (job_id, provider_id) (OH-210 § APPLICATION ↔ OFFER
 *    CONTRACT): one Parent can have many posted Jobs a given Caregiver applies to,
 *    each its own job-anchored thread. So the single-pair unique index splits into
 *    two PARTIAL uniques — one pre-acceptance DM thread per pair (job_id NULL), and
 *    one thread per (job, provider) for job-anchored threads (job_id NOT NULL). The
 *    messaging DM get-or-create narrows to `job_id IS NULL` to match.
 *
 * Pure DDL + raw `sql` for the constraint/index swaps — no stored routine, so the
 * plpgsql canary stays green.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ── 1. proposal redaction ────────────────────────────────────────────────────
  // The proposal is stored REDACTED (delivery-safe); this flags when it was.
  await db.schema
    .alterTable('applications')
    .addColumn('proposal_redacted', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();

  // A flagged Application proposal joins the same T&S queue as messages + Offers.
  // CASCADE so withdrawing/deleting an Application clears its queued original.
  await sql`
    ALTER TABLE public.message_flags
      ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES public.applications (id) ON DELETE CASCADE
  `.execute(db);

  // Widen the subject invariant from the 2-way XOR (message_id vs offer_id, set by
  // the OH-206 offers migration) to "exactly one of the three subject FKs is set".
  await sql`ALTER TABLE public.message_flags DROP CONSTRAINT IF EXISTS message_flags_subject_chk`.execute(db);
  await sql`
    ALTER TABLE public.message_flags
      ADD CONSTRAINT message_flags_subject_chk
      CHECK (
        (message_id IS NOT NULL)::int
        + (offer_id IS NOT NULL)::int
        + (application_id IS NOT NULL)::int
        = 1
      )
  `.execute(db);

  // ── 2. job-anchored thread uniqueness ────────────────────────────────────────
  // Replace the single (parent, provider) unique with two partial uniques: one DM
  // thread per pair (job_id NULL) + one thread per (job, provider) (job_id NOT NULL).
  await db.schema.dropIndex('message_threads_parent_provider_uniq').ifExists().execute();
  await sql`
    CREATE UNIQUE INDEX message_threads_parent_provider_dm_uniq
      ON public.message_threads (parent_uid, provider_id)
      WHERE job_id IS NULL
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX message_threads_job_provider_uniq
      ON public.message_threads (job_id, provider_id)
      WHERE job_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Restore the OH-205 single-pair unique (a dev down assumes no job-anchored
  // threads survive that would violate it).
  await sql`DROP INDEX IF EXISTS public.message_threads_job_provider_uniq`.execute(db);
  await sql`DROP INDEX IF EXISTS public.message_threads_parent_provider_dm_uniq`.execute(db);
  await db.schema
    .createIndex('message_threads_parent_provider_uniq')
    .unique()
    .on('message_threads')
    .columns(['parent_uid', 'provider_id'])
    .execute();

  // Restore the offers-migration 2-way XOR before dropping application_id (a dev
  // down assumes no application-subject flag rows survive the rollback).
  await sql`ALTER TABLE public.message_flags DROP CONSTRAINT IF EXISTS message_flags_subject_chk`.execute(db);
  await sql`
    ALTER TABLE public.message_flags
      ADD CONSTRAINT message_flags_subject_chk
      CHECK ((message_id IS NOT NULL) <> (offer_id IS NOT NULL))
  `.execute(db);
  await sql`ALTER TABLE public.message_flags DROP COLUMN IF EXISTS application_id`.execute(db);

  await db.schema.alterTable('applications').dropColumn('proposal_redacted').execute();
}
