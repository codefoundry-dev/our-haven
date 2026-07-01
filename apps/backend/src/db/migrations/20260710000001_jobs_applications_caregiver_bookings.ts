import { type Kysely, sql } from 'kysely';

/**
 * Jobs + Applications + caregiver Bookings (OH-207) — the persistence the
 * Direct-Message Book-request **acceptance** was waiting for. OH-206 shipped the
 * Offer object + Offer-level transitions (accept flips `status` to `accepted`);
 * OH-207 makes that accept **materialise the Job chain atomically** and rebind
 * the chat thread to the new Job (CONTEXT § Job / § Application / § Booking /
 * § Offer; ADR-0006 §§ 2,6; ADR-0011; ADR-0014). The pure contract already
 * exists as domain (`direct-message-materialisation`, `booking-lifecycle`,
 * `job-lifecycle`, `application-lifecycle`); this migration is its store.
 *
 * ── The Caregiver Booking chain (CONTEXT § Job) ─────────────────────────────
 * Every Caregiver Booking traces back to a Job, an Application, and an accepted
 * Offer. For a Direct-Message Booking none of those exist pre-acceptance — on
 * Accept the Edge handler INSERTs, in one `db.transaction()`:
 *   job (origin 'direct-message', born 'awarded')
 *     → application (origin 'direct-message', born 'awarded', accepted_offer_id)
 *       → booking_series? (recurring only — a stateless grouping row)
 *         → booking(s) (kind 'caregiver', born 'accepted', one per slot/occurrence)
 * and flips the accepted Offer's `job_id` + repoints `message_threads.job_id`.
 *
 * ── Supply identity = `providers.id` (ADR-0011) ─────────────────────────────
 * A Caregiver is a `providers` row, so the Job/Application/Series/Booking supply
 * FK is `provider_id → providers.id` (mirrors the existing `bookings.provider_id`
 * and every other supply table). The Parent is a bare auth uid (`parent_uid`, no
 * FK — matches `bookings.parent_uid` / `parent_subscriptions.uid`).
 *
 * ── bookings: caregiver columns land here ───────────────────────────────────
 * The `bookings` table (OH-203) was shaped for the full model but only the
 * `provider` consultation path wrote to it; its own comment defers the Caregiver
 * hourly / Job-chain columns to "OH-179 jobs/offers" — this ticket. We ADD them
 * as NULLable so the existing provider path is untouched; a caregiver Booking
 * sets `kind='caregiver'` + `origin` + the Job-chain FKs + the Agreed-Rate /
 * computed-total snapshot + the reveal-at-accept service address + child detail.
 *
 * Pure DDL + RLS (service-role-only, read through the Edge) — no stored routine,
 * so the plpgsql canary stays green.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ── jobs ───────────────────────────────────────────────────────────────────
  await db.schema
    .createTable('jobs')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // How the Job came to exist (job-lifecycle JobOrigin). Direct-Message Jobs are
    // born 'awarded' at acceptance; posted Jobs (a later ticket) start 'draft'.
    .addColumn('origin', 'text', (c) => c.notNull())
    .addColumn('state', 'text', (c) => c.notNull())
    // The Parent who owns the need (auth uid — no parents table) + the Caregiver
    // (providers.id) it was awarded to. For a posted Job the caregiver is NULL
    // until award; a Direct-Message Job is born awarded, so it is always set here.
    .addColumn('parent_uid', 'uuid', (c) => c.notNull())
    .addColumn('provider_id', 'uuid', (c) => c.references('providers.id').onDelete('cascade'))
    .addColumn('category', 'text', (c) => c.notNull())
    .addColumn('description', 'text', (c) => c.notNull())
    // Set when the Job reaches 'awarded' (= created_at for a Direct-Message Job).
    .addColumn('awarded_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('jobs_origin_chk', sql`origin IN ('posted','direct-message')`)
    .addCheckConstraint(
      'jobs_state_chk',
      sql`state IN ('draft','open','awarded','expired','cancelled','closed')`,
    )
    .addCheckConstraint('jobs_category_chk', sql`category IN ('babysitter','tutor','nanny')`)
    .execute();

  await db.schema.createIndex('jobs_parent_idx').on('jobs').column('parent_uid').execute();
  await db.schema.createIndex('jobs_provider_idx').on('jobs').column('provider_id').execute();

  // ── applications ─────────────────────────────────────────────────────────────
  await db.schema
    .createTable('applications')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('job_id', 'uuid', (c) => c.references('jobs.id').onDelete('cascade').notNull())
    // The applying Caregiver (providers.id).
    .addColumn('provider_id', 'uuid', (c) =>
      c.references('providers.id').onDelete('cascade').notNull(),
    )
    .addColumn('origin', 'text', (c) => c.notNull())
    .addColumn('state', 'text', (c) => c.notNull())
    // The Offer this Application was awarded on (the accepted Book-request for a
    // Direct-Message Job). SET NULL keeps the historical Application if the Offer
    // row is ever removed.
    .addColumn('accepted_offer_id', 'uuid', (c) => c.references('offers.id').onDelete('set null'))
    // Free-text proposal (posted-Job applications). NULL for Direct-Message.
    .addColumn('proposal', 'text')
    .addColumn('awarded_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('applications_origin_chk', sql`origin IN ('posted','direct-message')`)
    .addCheckConstraint(
      'applications_state_chk',
      sql`state IN ('submitted','countered','awarded','declined','withdrawn','expired')`,
    )
    .execute();

  // One Application per Caregiver per Job (CONTEXT § Application).
  await db.schema
    .createIndex('applications_job_provider_uidx')
    .on('applications')
    .columns(['job_id', 'provider_id'])
    .unique()
    .execute();

  // ── booking_series (recurring only; stateless grouping — ADR-0014 §5) ─────────
  await db.schema
    .createTable('booking_series')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('job_id', 'uuid', (c) => c.references('jobs.id').onDelete('cascade').notNull())
    .addColumn('parent_uid', 'uuid', (c) => c.notNull())
    .addColumn('provider_id', 'uuid', (c) =>
      c.references('providers.id').onDelete('cascade').notNull(),
    )
    .addColumn('category', 'text', (c) => c.notNull())
    // The RecurrenceRule (booking-lifecycle shape): {startDate,endDate,weekdays,startMin,endMin}.
    .addColumn('rule', 'jsonb', (c) => c.notNull())
    // Agreed Rate applied per occurrence (integer cents).
    .addColumn('agreed_rate_cents', 'integer', (c) => c.notNull())
    // Back-link to the Book-request Offer that materialised the Series (for the
    // withdraw-cascade). NULL for a posted recurring Job (a later ticket).
    .addColumn('offer_id', 'uuid', (c) => c.references('offers.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('booking_series_category_chk', sql`category IN ('babysitter','tutor','nanny')`)
    .addCheckConstraint('booking_series_rate_chk', sql`agreed_rate_cents >= 0`)
    .execute();

  await db.schema
    .createIndex('booking_series_job_idx')
    .on('booking_series')
    .column('job_id')
    .execute();

  // ── bookings: add the Caregiver / Job-chain columns (all NULLable) ───────────
  // The provider consultation path (OH-203) leaves every one of these NULL; a
  // caregiver Booking sets them. Kept NULLable rather than cross-column CHECKed to
  // stay pure DDL (the Edge validates the invariants richly at the handler).
  await db.schema
    .alterTable('bookings')
    // How a caregiver Booking was created (CaregiverOrigin). NULL for provider.
    .addColumn('origin', 'text')
    // The Job chain (CONTEXT § Job). SET NULL preserves history if a parent row goes.
    .addColumn('job_id', 'uuid', (c) => c.references('jobs.id').onDelete('set null'))
    .addColumn('application_id', 'uuid', (c) => c.references('applications.id').onDelete('set null'))
    // The Book-request that materialised this Booking — withdrawing it cascade-cancels here.
    .addColumn('offer_id', 'uuid', (c) => c.references('offers.id').onDelete('set null'))
    // Set on recurring occurrences; NULL for a one-off / multi-day one-off bundle.
    .addColumn('series_id', 'uuid', (c) => c.references('booking_series.id').onDelete('set null'))
    // The Agreed Rate baked in from the accepted Offer + the per-slot parent-charge
    // snapshot (Pricing calculator, pre-commission). Integer cents.
    .addColumn('agreed_rate_cents', 'integer')
    .addColumn('computed_total_cents', 'integer')
    .addColumn('category', 'text')
    // Ad-hoc child detail snapshot (no Child entity — ADR-0012/0016).
    .addColumn('child_count', 'integer')
    .addColumn('child_ages', sql`integer[]`)
    // The service address, revealed on the Booking detail at 'accepted' (CONTEXT § Service address).
    .addColumn('service_address_line1', 'text')
    .addColumn('service_address_line2', 'text')
    .addColumn('service_city', 'text')
    .addColumn('service_state', 'text')
    .addColumn('service_postal_code', 'text')
    // When the Book-request was accepted (a Direct-Message Booking is born accepted).
    .addColumn('accepted_at', 'timestamptz')
    .execute();

  await sql`
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_origin_chk
      CHECK (origin IS NULL OR origin IN ('posted-job','direct-message'))
  `.execute(db);

  // The withdraw-cascade lookup (every Booking a given Offer materialised).
  await db.schema.createIndex('bookings_offer_idx').on('bookings').column('offer_id').execute();
  // A Job's Bookings.
  await db.schema.createIndex('bookings_job_idx').on('bookings').column('job_id').execute();

  // ── RLS: service-role-only (read through the Edge), matching offers/bookings ──
  await sql`ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.booking_series ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_origin_chk`.execute(db);
  await db.schema.dropIndex('bookings_offer_idx').ifExists().execute();
  await db.schema.dropIndex('bookings_job_idx').ifExists().execute();
  for (const col of [
    'origin',
    'job_id',
    'application_id',
    'offer_id',
    'series_id',
    'agreed_rate_cents',
    'computed_total_cents',
    'category',
    'child_count',
    'child_ages',
    'service_address_line1',
    'service_address_line2',
    'service_city',
    'service_state',
    'service_postal_code',
    'accepted_at',
  ]) {
    await db.schema.alterTable('bookings').dropColumn(col).execute();
  }
  await db.schema.dropTable('booking_series').ifExists().execute();
  await db.schema.dropTable('applications').ifExists().execute();
  await db.schema.dropTable('jobs').ifExists().execute();
}
