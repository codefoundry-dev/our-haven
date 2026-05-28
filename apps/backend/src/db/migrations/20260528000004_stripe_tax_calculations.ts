import { type Kysely, sql } from 'kysely';

/**
 * Stripe Tax calculation audit (OH-111).
 *
 * Every call to Stripe's Tax Calculations API leaves a row here so admins can
 * answer "what tax did we quote on Subscription S for state ST at time T?"
 * without re-querying Stripe. Stripe Tax Calculation objects expire (the
 * `expires_at` field — typically 48h); we keep the snapshot indefinitely for
 * 7-year financial retention parity with CONTEXT.md § Retention policy.
 *
 * Two purposes (CONTEXT.md § Sales tax model, ADR-0009):
 *   - `subscription` — Parent Subscription line item; state = subscriber's
 *     resident state; subject_uid = the Supabase uid of the Parent.
 *   - `commission` — B2B Commission line item; state = Provider's resident
 *     state; subject_uid = the Supabase uid of the Provider.
 *
 * Bookings are deliberately NOT a valid purpose — Our Haven is a marketplace
 * agent and does not collect sales tax on Bookings. The CHECK constraint
 * makes that invariant enforceable at the DB layer.
 *
 * `tax_amount_cents = 0` is a perfectly valid (and expected!) outcome — many
 * US states do not tax SaaS subscriptions, and B2B services are commonly
 * exempt. The row records that Stripe Tax was asked and answered "zero",
 * which is itself the auditable fact.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('stripe_tax_calculations')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('stripe_calculation_id', 'text', (c) => c.notNull().unique())
    .addColumn('purpose', 'text', (c) =>
      c.notNull().check(sql`purpose IN ('subscription', 'commission')`),
    )
    .addColumn('reference', 'text', (c) => c.notNull())
    .addColumn('subject_uid', 'uuid')
    .addColumn('customer_state', 'text', (c) =>
      c.notNull().check(sql`length(customer_state) = 2`),
    )
    .addColumn('customer_postal_code', 'text')
    .addColumn('amount_cents', 'integer', (c) => c.notNull().check(sql`amount_cents >= 0`))
    .addColumn('tax_amount_cents', 'integer', (c) =>
      c.notNull().defaultTo(0).check(sql`tax_amount_cents >= 0`),
    )
    .addColumn('amount_total_cents', 'integer', (c) => c.notNull())
    .addColumn('tax_behavior', 'text', (c) =>
      c.notNull().defaultTo('exclusive').check(sql`tax_behavior IN ('inclusive', 'exclusive')`),
    )
    .addColumn('tax_code', 'text', (c) => c.notNull())
    .addColumn('tax_breakdown', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('raw_payload', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('stripe_expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('stripe_tax_calculations_subject_idx')
    .on('stripe_tax_calculations')
    .columns(['subject_uid', 'purpose'])
    .execute();

  await db.schema
    .createIndex('stripe_tax_calculations_state_idx')
    .on('stripe_tax_calculations')
    .columns(['customer_state', 'purpose'])
    .execute();

  await sql`ALTER TABLE public.stripe_tax_calculations ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('stripe_tax_calculations').execute();
}
