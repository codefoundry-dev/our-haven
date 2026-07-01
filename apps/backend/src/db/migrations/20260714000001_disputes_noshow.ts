import { type Kysely, sql } from 'kysely';

/**
 * Dispute surface + Caregiver no-show (OH-213) — PRD-0001 v1.7 stories 38/39/132;
 * ADR-0013 (amended) § No-show / § Dispute.
 *
 * OH-211 shipped the in-window vs out-of-window dispute *branching* on the
 * `bookings.dispute_*` columns, but a filed dispute had nowhere to be *queued*
 * for admin and no way to be *resolved* (a held payout sat forever), and a
 * past-Job dispute (`Job.dispute`) had no home. No-show did not exist at all.
 * This migration lays the two tables + two columns those flows need:
 *
 *   - `disputes` — the single durable admin queue. One row per filed dispute
 *     (in-window hold, out-of-window escalation, or a no-show), polymorphic over
 *     its subject (`booking` | `job`). The booking's own `dispute_*` columns stay
 *     as the cheap Booking-detail projection; this table is the audit/queue record
 *     and the only place a *Job* dispute or a resolution can live.
 *   - `supply_flags` — the supply-quality auto-flag ledger. A Caregiver/Provider
 *     no-show inserts one `active` row; the count of active no-show flags drives
 *     the standing (2 → manual review, 3 → suspend — CONTEXT § No-show). Clearing
 *     a flag (admin dismiss) recomputes standing, giving suspension a recovery path.
 *   - `bookings.no_show_at` — the stamp on the cancelled Booking a no-show produced.
 *   - `providers.suspended_at` — the listing-suspension marker (`isListable` honours
 *     it), set at the 3-flag threshold and lifted when the count drops below it.
 *
 * Both new tables are service-role-only (read through the Edge, RLS enabled with
 * no policy — matches `jobs` / `applications` / `offers` / `bookings`). Pure DDL +
 * raw `sql` for the checks/partial-unique, so the plpgsql canary stays green.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ── disputes (the admin queue) ──────────────────────────────────────────────
  await db.schema
    .createTable('disputes')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // What the dispute is about. Polymorphic so a past-Job complaint (no Booking)
    // and a Booking dispute share one queue.
    .addColumn('subject_type', 'text', (c) => c.notNull())
    .addColumn('subject_id', 'uuid', (c) => c.notNull())
    // The Parent who filed it (bare auth uid — no parents table).
    .addColumn('filed_by_uid', 'uuid', (c) => c.notNull())
    // The reason chip (shared with the OH-211 DisputeSheet) + optional free text.
    .addColumn('reason', 'text', (c) => c.notNull())
    .addColumn('details', 'text')
    // Was this the in-window review dispute that auto-held the Payout? Only that
    // case moves money on file; every other entry point is escalation-only.
    .addColumn('in_window', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('hold_applied', 'boolean', (c) => c.notNull().defaultTo(false))
    // Queue lifecycle: open → resolved | dismissed (admin decision).
    .addColumn('status', 'text', (c) => c.notNull().defaultTo(sql`'open'`))
    // The admin's action, once resolved (NULL while open).
    .addColumn('resolution', 'text')
    .addColumn('resolution_note', 'text')
    .addColumn('resolved_by_uid', 'uuid')
    .addColumn('resolved_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    ALTER TABLE public.disputes
      ADD CONSTRAINT disputes_subject_type_chk CHECK (subject_type IN ('booking','job'))
  `.execute(db);
  await sql`
    ALTER TABLE public.disputes
      ADD CONSTRAINT disputes_reason_chk
      CHECK (reason IN ('overcharged','no-show','safety','quality','other'))
  `.execute(db);
  await sql`
    ALTER TABLE public.disputes
      ADD CONSTRAINT disputes_status_chk CHECK (status IN ('open','resolved','dismissed'))
  `.execute(db);
  await sql`
    ALTER TABLE public.disputes
      ADD CONSTRAINT disputes_resolution_chk
      CHECK (resolution IS NULL OR resolution IN ('released','refunded','clawback','dismissed'))
  `.execute(db);

  // At most one OPEN dispute per subject — blocks double-filing while one is live.
  await sql`
    CREATE UNIQUE INDEX disputes_open_subject_uniq
      ON public.disputes (subject_type, subject_id)
      WHERE status = 'open'
  `.execute(db);
  // The admin queue scan (oldest-open first).
  await sql`CREATE INDEX disputes_status_idx ON public.disputes (status, created_at)`.execute(db);
  // A Parent's filed disputes.
  await sql`CREATE INDEX disputes_filed_by_idx ON public.disputes (filed_by_uid)`.execute(db);

  await sql`ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY`.execute(db);

  // ── supply_flags (the supply-quality auto-flag ledger) ──────────────────────
  await db.schema
    .createTable('supply_flags')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // The flagged Caregiver/Provider (providers.id — a Caregiver is a providers row).
    .addColumn('provider_id', 'uuid', (c) =>
      c.references('providers.id').onDelete('cascade').notNull(),
    )
    // The supply sub-type at flag time (caregiver | provider).
    .addColumn('kind', 'text', (c) => c.notNull())
    // Why flagged (v1: 'no-show'). Free text so future flag sources need no DDL.
    .addColumn('reason', 'text', (c) => c.notNull())
    // The Booking that produced the flag (SET NULL keeps the flag if the row goes).
    .addColumn('booking_id', 'uuid', (c) => c.references('bookings.id').onDelete('set null'))
    .addColumn('filed_by_uid', 'uuid', (c) => c.notNull())
    // active → cleared (admin dismiss). Only `active` flags count toward standing.
    .addColumn('status', 'text', (c) => c.notNull().defaultTo(sql`'active'`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    ALTER TABLE public.supply_flags
      ADD CONSTRAINT supply_flags_kind_chk CHECK (kind IN ('caregiver','provider'))
  `.execute(db);
  await sql`
    ALTER TABLE public.supply_flags
      ADD CONSTRAINT supply_flags_status_chk CHECK (status IN ('active','cleared'))
  `.execute(db);

  // The standing recompute scans a supply's active flags.
  await sql`
    CREATE INDEX supply_flags_provider_status_idx
      ON public.supply_flags (provider_id, status)
  `.execute(db);

  await sql`ALTER TABLE public.supply_flags ENABLE ROW LEVEL SECURITY`.execute(db);

  // ── new columns on existing tables ──────────────────────────────────────────
  // The cancelled-Booking no-show stamp.
  await db.schema.alterTable('bookings').addColumn('no_show_at', 'timestamptz').execute();
  // The supply listing-suspension marker (honoured by isListable).
  await db.schema.alterTable('providers').addColumn('suspended_at', 'timestamptz').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('providers').dropColumn('suspended_at').execute();
  await db.schema.alterTable('bookings').dropColumn('no_show_at').execute();
  await db.schema.dropTable('supply_flags').ifExists().execute();
  await db.schema.dropTable('disputes').ifExists().execute();
}
