import { type Kysely, sql } from 'kysely';

/**
 * Parent Subscription (OH-193) — ADR-0011 / CONTEXT.md § Subscription; PRD-0001
 * v1.7 stories 7–9.
 *
 * One greenfield table, the persistence the OH-193 `parent-subscription` deep
 * module + routes were waiting for:
 *
 * `parent_subscriptions` — the Parent's Stripe Billing relationship (the Parent
 * is a Stripe *Customer*; the subscription is sold on **web** to dodge the
 * iOS/Android in-app-purchase rules). The demand-side analogue of
 * `provider_subscriptions`, with one structural difference: there is **no
 * `parents` table** — a Parent is just the Supabase auth user — so the row is
 * keyed by `uid` (the auth user's uuid) directly, with no app-schema FK (the same
 * posture as `notification_outbox.recipient_uid` and `auth_step_up_grants.uid`,
 * which also key on the auth uid without FK-ing into the `auth` schema).
 *
 * The row is created the moment the Parent starts checkout (so the Stripe
 * customer id is stored *before* any webhook fires — the reliable join key);
 * `status` / `current_period_end` / `cancel_at_period_end` / `price_id` are then
 * mirrored from Stripe billing webhooks. `entitled_at` is stamped the first time
 * the subscription becomes access-granting (active/trialing) — the analogue of
 * `provider_subscriptions.listed_at`. The LIVE paywall gate reads `status`
 * through the domain (`isAccessGrantingStatus`), not `entitled_at` — the stamp is
 * a first-unlocked marker for analytics.
 *
 * Pure DDL — no plpgsql (the canary stays green). RLS is enabled; the `api` Edge
 * Function reaches the table over the privileged pooler connection (no end-user
 * RLS policies needed — the same posture as every prior table).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('parent_subscriptions')
    // The Supabase auth user uuid (JWT `sub`). No FK — auth.users lives in the
    // `auth` schema and there is no app-side `parents` table to reference.
    .addColumn('uid', 'uuid', (c) => c.primaryKey())
    // Stripe Customer for the Parent (cus_…). Created + stored at checkout-start,
    // so it is present before the first webhook — the join key the webhook uses.
    .addColumn('stripe_customer_id', 'text')
    // The active Subscription object (sub_…); filled in by checkout.session.completed
    // / customer.subscription.* once the Parent finishes Stripe-hosted checkout.
    .addColumn('stripe_subscription_id', 'text')
    // The Stripe Billing lifecycle status; null until a subscription first exists.
    .addColumn('status', 'text')
    // The Stripe Price the Parent is on (price_…) — echoed for the admin/ops view.
    .addColumn('price_id', 'text')
    .addColumn('current_period_end', 'timestamptz')
    .addColumn('cancel_at_period_end', 'boolean', (c) => c.notNull().defaultTo(false))
    // First-entitled stamp (active/trialing) — never cleared; the live gate reads `status`.
    .addColumn('entitled_at', 'timestamptz')
    .addColumn('last_webhook_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'parent_subscriptions_status_chk',
      sql`status IS NULL OR status IN ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')`,
    )
    .execute();

  // One Stripe customer / subscription maps to at most one Parent row. Partial
  // uniques so the common null (pre-checkout) rows are unconstrained.
  await sql`
    create unique index parent_subscriptions_customer_uniq
      on parent_subscriptions (stripe_customer_id)
      where stripe_customer_id is not null
  `.execute(db);
  await sql`
    create unique index parent_subscriptions_subscription_uniq
      on parent_subscriptions (stripe_subscription_id)
      where stripe_subscription_id is not null
  `.execute(db);

  await sql`ALTER TABLE public.parent_subscriptions ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('parent_subscriptions').ifExists().execute();
}
