import { type Kysely, sql } from 'kysely';

/**
 * Provider background-screening records (OH-106).
 *
 * Holds the **raw FCRA-disposable details** for each background-check
 * attempt — vendor identifiers, status, the Stripe charge id, and the full
 * webhook payload. Per CONTEXT.md § Retention policy + ADR-0007, these rows
 * are hard-deleted at 6 months by the disposal job (`screening-disposal.ts`,
 * scheduled in OH-2.14). The cleared/not status survives on
 * `provider_verifications.screening_passed_at` / `rejected_at`, which is
 * what every downstream consumer (search ranking, admin queue) reads.
 *
 * `vendor` is a free-text column constrained by check rather than a Postgres
 * enum, so adding a second vendor (Sterling, GoodHire, manual upload) is a
 * migration that relaxes the check — no enum-rebuild dance.
 *
 * `status` mirrors the lifecycle the route + webhook handlers move the row
 * through:
 *   payment_pending → payment_succeeded → in_progress → (clear | consider | suspended | cancelled)
 * `payment_succeeded` is the moment the Checkr invitation is created and
 * `provider_verifications.screening_initiated_at` is written.
 *
 * The unique partial index on `vendor_report_id` lets the webhook handler
 * idempotently locate the row by Checkr's id without colliding with rows
 * that are still in `payment_pending` (`vendor_report_id` is NULL until
 * Checkr returns it).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('provider_screenings')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('provider_id', 'uuid', (c) =>
      c.notNull().references('providers.id').onDelete('cascade'),
    )
    .addColumn('vendor', 'text', (c) => c.notNull())
    .addColumn('package', 'text', (c) => c.notNull())
    .addColumn('vendor_report_id', 'text')
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('payment_pending'))
    .addColumn('stripe_payment_intent_id', 'text')
    .addColumn('charge_amount_cents', 'integer', (c) => c.notNull())
    .addColumn('paid_at', 'timestamptz')
    .addColumn('initiated_at', 'timestamptz')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('candidate_action_url', 'text')
    .addColumn('raw_payload', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('purge_at', 'timestamptz', (c) =>
      c.notNull().defaultTo(sql`now() + interval '6 months'`),
    )
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'provider_screenings_vendor_chk',
      sql`vendor IN ('checkr','sterling','goodhire','manual')`,
    )
    .addCheckConstraint(
      'provider_screenings_status_chk',
      sql`status IN (
        'payment_pending',
        'payment_succeeded',
        'in_progress',
        'clear',
        'consider',
        'suspended',
        'cancelled'
      )`,
    )
    .addCheckConstraint(
      'provider_screenings_amount_chk',
      sql`charge_amount_cents > 0`,
    )
    .execute();

  await db.schema
    .createIndex('provider_screenings_provider_idx')
    .on('provider_screenings')
    .column('provider_id')
    .execute();

  await sql`
    CREATE UNIQUE INDEX provider_screenings_vendor_report_uniq
    ON public.provider_screenings (vendor, vendor_report_id)
    WHERE vendor_report_id IS NOT NULL
  `.execute(db);

  await db.schema
    .createIndex('provider_screenings_purge_at_idx')
    .on('provider_screenings')
    .column('purge_at')
    .execute();

  await sql`
    CREATE UNIQUE INDEX provider_screenings_stripe_pi_uniq
    ON public.provider_screenings (stripe_payment_intent_id)
    WHERE stripe_payment_intent_id IS NOT NULL
  `.execute(db);

  await sql`ALTER TABLE public.provider_screenings ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('provider_screenings').execute();
}
