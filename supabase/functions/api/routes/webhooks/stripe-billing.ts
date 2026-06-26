import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import type { AppEnv } from '../../context.ts';
import type { Db } from '../../db/kysely.ts';
import type {
  StripeCheckoutSessionObject,
  StripeSubscriptionObject,
} from '../../vendors/stripe.ts';
// Cross-tree, Deno-clean domain modules — the gates are the single source of
// truth for when a subscription's status first makes the subject "listed"
// (Provider, search-visible) / "entitled" (Parent, marketplace unlocked).
import {
  isListedStatus,
  isStripeSubscriptionStatus,
  type StripeSubscriptionStatus,
} from '../../../../../packages/domain/src/provider-subscription/index.ts';
import { isAccessGrantingStatus } from '../../../../../packages/domain/src/parent-subscription/index.ts';

/**
 * Stripe Billing webhook (OH-191 / OH-193; ADR-0019 § Decision 5 — "webhooks
 * terminate on the fat function").
 *
 * Public route (no `requireAuth`), deployed under `--no-verify-jwt`; the Stripe
 * signature is the authentication. Raw bytes via `c.req.text()` BEFORE anything
 * parses the body (the HMAC is over the unparsed payload). A SEPARATE Stripe
 * endpoint + signing secret (STRIPE_BILLING_WEBHOOK_SECRET) from the Connect
 * (OH-190) and payments (OH-185) webhooks.
 *
 * ONE endpoint serves BOTH subscription products — Provider and Parent are the
 * same Stripe billing event family on the same account, so they share a single
 * webhook (one endpoint, one secret), and the handler routes each event to the
 * right table:
 *   - Provider Subscription (OH-191) → `provider_subscriptions`, keyed by
 *     `provider_id`; first listed (active/trialing) stamps `listed_at`.
 *   - Parent Subscription (OH-193) → `parent_subscriptions`, keyed by the auth
 *     `uid`; first entitled (active/trialing) stamps `entitled_at`.
 *
 * Routing uses the checkout/subscription metadata we stamp at checkout-start
 * (`purpose` + `uid`/`provider_id`), falling back to a probe of which table
 * already holds the Stripe customer id (stamped at checkout-start, so it precedes
 * every webhook). Mirroring is idempotent (we overwrite the row); the
 * first-access stamp is set once and never cleared — the LIVE gates read
 * `status`, not the stamp.
 *
 * Events handled:
 *   - `checkout.session.completed` (subscription mode) — links the subscription
 *     id onto the row (the Customer was already stored at checkout-start).
 *   - `customer.subscription.created | updated | deleted` — mirrors status,
 *     current_period_end, cancel_at_period_end, price.
 */

const Ack = z.object({ received: z.literal(true) }).openapi('StripeBillingWebhookAck');
const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('StripeBillingWebhookError');

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

type SubscriptionKind = 'provider' | 'parent';

interface ProviderRow {
  provider_id: string;
  stripe_customer_id: string | null;
  price_id: string | null;
  listed_at: Date | string | null;
}

interface ParentRow {
  uid: string;
  stripe_customer_id: string | null;
  price_id: string | null;
  entitled_at: Date | string | null;
}

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

const webhookRoute = createRoute({
  method: 'post',
  path: '/webhooks/stripe-billing',
  tags: ['webhooks'],
  summary: 'Stripe Billing webhook — mirrors the Provider + Parent Subscription lifecycles onto their tables',
  description:
    'Receives Stripe Billing webhook deliveries (separate endpoint + signing secret from the Connect + payments webhooks) for BOTH the Provider Subscription (OH-191) and the Parent Subscription (OH-193). Verifies the `Stripe-Signature` header with STRIPE_BILLING_WEBHOOK_SECRET, then routes each event by its metadata (`purpose` + `uid`/`provider_id`, falling back to a customer-id probe) to provider_subscriptions or parent_subscriptions — on checkout.session.completed linking the subscription id and on customer.subscription.* mirroring status / current_period_end / cancel_at_period_end / price, stamping the first-access marker on the first active/trialing transition. Public route — the Stripe signature is the authentication.',
  responses: {
    200: { description: 'Acknowledged', content: json(Ack) },
    400: { description: 'Invalid signature or payload', content: json(ErrorResponse) },
  },
});

/** Route an event to a table from the metadata we stamp at checkout-start. */
function kindFromMetadata(meta: Record<string, string> | undefined): SubscriptionKind | null {
  if (!meta) return null;
  if (meta.purpose === 'parent_subscription') return 'parent';
  if (meta.purpose === 'provider_subscription') return 'provider';
  if (meta.uid) return 'parent';
  if (meta.provider_id) return 'provider';
  return null;
}

/** Fallback: probe which table already holds the Stripe customer id. */
async function kindFromCustomer(db: Db, customerId: string | null): Promise<SubscriptionKind | null> {
  if (!customerId) return null;
  const prov = await db
    .selectFrom('provider_subscriptions')
    .select('provider_id')
    .where('stripe_customer_id', '=', customerId)
    .executeTakeFirst();
  if (prov) return 'provider';
  const par = await db
    .selectFrom('parent_subscriptions')
    .select('uid')
    .where('stripe_customer_id', '=', customerId)
    .executeTakeFirst();
  if (par) return 'parent';
  return null;
}

/** Resolve the provider row by customer id, falling back to provider id. */
async function findProviderRow(
  db: Db,
  keys: { customerId: string | null; providerId: string | null },
): Promise<ProviderRow | undefined> {
  if (keys.customerId) {
    const byCustomer = (await db
      .selectFrom('provider_subscriptions')
      .select(['provider_id', 'stripe_customer_id', 'price_id', 'listed_at'])
      .where('stripe_customer_id', '=', keys.customerId)
      .executeTakeFirst()) as ProviderRow | undefined;
    if (byCustomer) return byCustomer;
  }
  if (keys.providerId) {
    return (await db
      .selectFrom('provider_subscriptions')
      .select(['provider_id', 'stripe_customer_id', 'price_id', 'listed_at'])
      .where('provider_id', '=', keys.providerId)
      .executeTakeFirst()) as ProviderRow | undefined;
  }
  return undefined;
}

/** Resolve the parent row by customer id, falling back to the auth uid. */
async function findParentRow(
  db: Db,
  keys: { customerId: string | null; uid: string | null },
): Promise<ParentRow | undefined> {
  if (keys.customerId) {
    const byCustomer = (await db
      .selectFrom('parent_subscriptions')
      .select(['uid', 'stripe_customer_id', 'price_id', 'entitled_at'])
      .where('stripe_customer_id', '=', keys.customerId)
      .executeTakeFirst()) as ParentRow | undefined;
    if (byCustomer) return byCustomer;
  }
  if (keys.uid) {
    return (await db
      .selectFrom('parent_subscriptions')
      .select(['uid', 'stripe_customer_id', 'price_id', 'entitled_at'])
      .where('uid', '=', keys.uid)
      .executeTakeFirst()) as ParentRow | undefined;
  }
  return undefined;
}

function priceFromSubscription(sub: StripeSubscriptionObject, fallback: string | null): string | null {
  return sub.items?.data?.[0]?.price?.id ?? fallback ?? null;
}

function periodEnd(sub: StripeSubscriptionObject): Date | null {
  return typeof sub.current_period_end === 'number' ? new Date(sub.current_period_end * 1000) : null;
}

export function registerStripeBillingWebhookRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(webhookRoute, async (c) => {
    const { db, stripe } = c.var.deps;

    const rawBody = await c.req.text();
    const signatureHeader = c.req.header('stripe-signature') ?? null;

    if (!stripe.verifyBillingWebhookSignature(rawBody, signatureHeader)) {
      return c.json({ error: 'invalid_signature' }, 400);
    }

    const event = stripe.parseBillingWebhookEvent(rawBody);
    if (!event) {
      return c.json({ error: 'invalid_payload' }, 400);
    }

    const now = new Date();
    const ack = () => c.json({ received: true as const }, 200);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as StripeCheckoutSessionObject;
      // Only subscription-mode sessions concern us (a future one-off checkout
      // would carry mode=payment). Treat a missing mode as subscription.
      if (session.mode && session.mode !== 'subscription') return ack();

      const customerId = typeof session.customer === 'string' ? session.customer : null;
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
      const kind = kindFromMetadata(session.metadata) ?? (await kindFromCustomer(db, customerId));

      if (kind === 'parent') {
        const uid = session.metadata?.uid ?? session.client_reference_id ?? null;
        const row = await findParentRow(db, { customerId, uid });
        if (!row) {
          console.warn('[stripe-billing] parent checkout.session.completed: no row matches', customerId, uid);
          return ack();
        }
        const patch: Record<string, unknown> = { last_webhook_at: now, updated_at: now };
        if (customerId) patch.stripe_customer_id = customerId;
        if (subscriptionId) patch.stripe_subscription_id = subscriptionId;
        await db.updateTable('parent_subscriptions').set(patch).where('uid', '=', row.uid).execute();
        return ack();
      }

      // Provider (the default / OH-191 path).
      const providerId = session.client_reference_id ?? session.metadata?.provider_id ?? null;
      const row = await findProviderRow(db, { customerId, providerId });
      if (!row) {
        console.warn('[stripe-billing] provider checkout.session.completed: no row matches', customerId, providerId);
        return ack();
      }
      const patch: Record<string, unknown> = { last_webhook_at: now, updated_at: now };
      if (customerId) patch.stripe_customer_id = customerId;
      if (subscriptionId) patch.stripe_subscription_id = subscriptionId;
      await db.updateTable('provider_subscriptions').set(patch).where('provider_id', '=', row.provider_id).execute();
      return ack();
    }

    if (SUBSCRIPTION_EVENTS.has(event.type)) {
      const sub = event.data.object as StripeSubscriptionObject;
      const customerId = typeof sub.customer === 'string' ? sub.customer : null;

      if (!isStripeSubscriptionStatus(sub.status)) {
        // An unknown status would violate the DB check; ack so Stripe stops
        // retrying rather than 500-looping on a status we do not model.
        console.warn('[stripe-billing] unknown subscription status', sub.status);
        return ack();
      }
      const status: StripeSubscriptionStatus = sub.status;
      const kind = kindFromMetadata(sub.metadata) ?? (await kindFromCustomer(db, customerId));

      if (kind === 'parent') {
        const uid = sub.metadata?.uid ?? null;
        const row = await findParentRow(db, { customerId, uid });
        if (!row) {
          console.warn('[stripe-billing] parent subscription event: no row matches', customerId, uid);
          return ack();
        }
        const becameEntitled = isAccessGrantingStatus(status) && row.entitled_at == null;
        const patch: Record<string, unknown> = {
          stripe_subscription_id: sub.id,
          status,
          price_id: priceFromSubscription(sub, row.price_id),
          current_period_end: periodEnd(sub),
          cancel_at_period_end: !!sub.cancel_at_period_end,
          last_webhook_at: now,
          updated_at: now,
        };
        if (customerId) patch.stripe_customer_id = customerId;
        if (becameEntitled) patch.entitled_at = now;
        await db.updateTable('parent_subscriptions').set(patch).where('uid', '=', row.uid).execute();
        return ack();
      }

      // Provider (the default / OH-191 path).
      const providerId = sub.metadata?.provider_id ?? null;
      const row = await findProviderRow(db, { customerId, providerId });
      if (!row) {
        console.warn('[stripe-billing] provider subscription event: no row matches', customerId, providerId);
        return ack();
      }
      const becameListed = isListedStatus(status) && row.listed_at == null;
      const patch: Record<string, unknown> = {
        stripe_subscription_id: sub.id,
        status,
        price_id: priceFromSubscription(sub, row.price_id),
        current_period_end: periodEnd(sub),
        cancel_at_period_end: !!sub.cancel_at_period_end,
        last_webhook_at: now,
        updated_at: now,
      };
      if (customerId) patch.stripe_customer_id = customerId;
      if (becameListed) patch.listed_at = now;
      await db.updateTable('provider_subscriptions').set(patch).where('provider_id', '=', row.provider_id).execute();
      return ack();
    }

    // Ack everything else (invoice.*, etc.) so Stripe stops retrying.
    return ack();
  });
}
