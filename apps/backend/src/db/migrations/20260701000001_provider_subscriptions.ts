import { type Kysely, sql } from 'kysely';

/**
 * Provider Subscription + corporate Contact-Us intake (OH-191) — ADR-0011 /
 * CONTEXT.md § Subscription; PRD-0001 v1.7 story 49a.
 *
 * Two greenfield tables, the persistence the OH-191 `provider-subscription`
 * deep module + routes were waiting for:
 *
 * 1. `provider_subscriptions` — the Provider's Stripe Billing relationship (the
 *    Provider is a Stripe *Customer*, NOT a Connect account — Providers receive
 *    no Payouts; ADR-0011). One row per Provider (PK = provider_id), the billing
 *    analogue of `provider_connect_accounts`. The row is created the moment the
 *    Provider starts checkout (so the Stripe customer id is stored *before* any
 *    webhook fires — the reliable join key); `status` / `current_period_end` /
 *    `cancel_at_period_end` are then mirrored from Stripe billing webhooks.
 *    `listed_at` is stamped the first time the subscription becomes listed
 *    (active/trialing) — the analogue of `provider_connect_accounts.account_ready_at`.
 *    The LIVE listing gate reads `status` through the domain (`isListedStatus`),
 *    not `listed_at` — the stamp is a first-listed marker for analytics.
 *
 * 2. `provider_contact_intakes` — the corporate "Contact Us" intake (v1 ships the
 *    intake form only — no self-serve org onboarding / multi-seat model; contract
 *    terms are a sales/legal matter handled manually). A captured row is what
 *    "routed" enqueues a notification-outbox handoff against (sales follow-up).
 *    Deliberately NOT keyed to a `providers` row: corporate leads are pre-account.
 *
 * Pure DDL — no plpgsql (the canary stays green). RLS is enabled on both tables;
 * the `api` Edge Function reaches them over the privileged pooler connection
 * (no end-user RLS policies needed — the same posture as every prior table).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('provider_subscriptions')
    .addColumn('provider_id', 'uuid', (c) =>
      c.primaryKey().references('providers.id').onDelete('cascade'),
    )
    // Stripe Customer for the Provider (cus_…). Created + stored at checkout-start,
    // so it is present before the first webhook — the join key the webhook uses.
    .addColumn('stripe_customer_id', 'text')
    // The active Subscription object (sub_…); filled in by checkout.session.completed
    // / customer.subscription.* once the Provider finishes Stripe-hosted checkout.
    .addColumn('stripe_subscription_id', 'text')
    // The Stripe Billing lifecycle status; null until a subscription first exists.
    .addColumn('status', 'text')
    // The Stripe Price the Provider is on (price_…) — echoed for the admin/ops view.
    .addColumn('price_id', 'text')
    .addColumn('current_period_end', 'timestamptz')
    .addColumn('cancel_at_period_end', 'boolean', (c) => c.notNull().defaultTo(false))
    // First-listed stamp (active/trialing) — never cleared; the live gate reads `status`.
    .addColumn('listed_at', 'timestamptz')
    .addColumn('last_webhook_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'provider_subscriptions_status_chk',
      sql`status IS NULL OR status IN ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')`,
    )
    .execute();

  // One Stripe customer / subscription maps to at most one Provider row. Partial
  // uniques so the common null (pre-checkout) rows are unconstrained.
  await sql`
    create unique index provider_subscriptions_customer_uniq
      on provider_subscriptions (stripe_customer_id)
      where stripe_customer_id is not null
  `.execute(db);
  await sql`
    create unique index provider_subscriptions_subscription_uniq
      on provider_subscriptions (stripe_subscription_id)
      where stripe_subscription_id is not null
  `.execute(db);

  await sql`ALTER TABLE public.provider_subscriptions ENABLE ROW LEVEL SECURITY`.execute(db);

  await db.schema
    .createTable('provider_contact_intakes')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('organization_name', 'text', (c) => c.notNull())
    .addColumn('contact_name', 'text', (c) => c.notNull())
    .addColumn('contact_email', 'text', (c) => c.notNull())
    .addColumn('contact_phone', 'text')
    // Rough headcount the corporation expects to list — sizes the sales follow-up.
    .addColumn('estimated_seats', 'integer')
    // 2-letter US state, optional (a multi-state corporation may leave it blank).
    .addColumn('state', 'text')
    .addColumn('message', 'text')
    // new → captured, awaiting sales; routed → outbox handoff enqueued; closed → ops-resolved.
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('new'))
    .addColumn('routed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('provider_contact_intakes_status_chk', sql`status IN ('new','routed','closed')`)
    .addCheckConstraint(
      'provider_contact_intakes_seats_chk',
      sql`estimated_seats IS NULL OR estimated_seats >= 0`,
    )
    .execute();

  // Ops triages newest-first over the still-open leads.
  await sql`
    create index provider_contact_intakes_open_idx
      on provider_contact_intakes (created_at desc)
      where status <> 'closed'
  `.execute(db);

  await sql`ALTER TABLE public.provider_contact_intakes ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('provider_contact_intakes').ifExists().execute();
  await db.schema.dropTable('provider_subscriptions').ifExists().execute();
}
