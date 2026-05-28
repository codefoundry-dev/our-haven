import { type Kysely, sql } from 'kysely';

/**
 * Provider Stripe Connect Express accounts (OH-110).
 *
 * One row per Provider. Captures everything we need to:
 *   1. Resume an in-flight Stripe-hosted KYC flow (we re-fetch the account
 *      object after onboarding to read capabilities + requirements).
 *   2. Gate the verification state machine on `charges_enabled` AND
 *      `payouts_enabled` — both must be true before the Provider's profile
 *      flips to `activated` and appears in search (per OH-110 AC: "Verification
 *      flow gates appearance in search on `connect_account_status=enabled`").
 *   3. Render the read-only summary card on the verification page (status +
 *      requirements snapshot).
 *
 * The Stripe Express dashboard handles bank-detail editing and withdrawal
 * initiation — both gated server-side behind step-up MFA on the dashboard-link
 * endpoint (`POST /v1/providers/me/stripe-connect/dashboard-link`).
 *
 * `account_ready_at` is the timestamp at which we first observed both
 * capabilities enabled; it's what the verification deep module folds into
 * `VerificationFacts.connectAccountReadyAt`.
 *
 * Form 1099-K issuance is handled automatically by Stripe Connect; no extra
 * persistence is needed here.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('provider_connect_accounts')
    .addColumn('provider_id', 'uuid', (c) =>
      c.primaryKey().references('providers.id').onDelete('cascade'),
    )
    .addColumn('stripe_account_id', 'text', (c) => c.unique())
    .addColumn('charges_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('payouts_enabled', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('details_submitted', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('disabled_reason', 'text')
    .addColumn('requirements', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('account_ready_at', 'timestamptz')
    .addColumn('last_webhook_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`ALTER TABLE public.provider_connect_accounts ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('provider_connect_accounts').execute();
}
