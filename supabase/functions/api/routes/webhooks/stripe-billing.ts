import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import type { AppEnv } from '../../context.ts';
import type { Db } from '../../db/kysely.ts';
import type {
  StripeCheckoutSessionObject,
  StripeSubscriptionObject,
} from '../../vendors/stripe.ts';
// Cross-tree, Deno-clean domain module — the listing gate is the single source
// of truth for when the subscription's status first makes the Provider "listed".
import {
  isListedStatus,
  isStripeSubscriptionStatus,
  type StripeSubscriptionStatus,
} from '../../../../../packages/domain/src/provider-subscription/index.ts';

/**
 * Stripe Billing webhook (OH-191; ADR-0019 § Decision 5 — "webhooks terminate
 * on the fat function").
 *
 * Public route (no `requireAuth`), deployed under `--no-verify-jwt`; the Stripe
 * signature is the authentication. Raw bytes via `c.req.text()` BEFORE anything
 * parses the body (the HMAC is over the unparsed payload). A SEPARATE Stripe
 * endpoint + signing secret (STRIPE_BILLING_WEBHOOK_SECRET) from the Connect
 * (OH-190) and payments (OH-185) webhooks.
 *
 * Mirrors the Provider Subscription lifecycle onto `provider_subscriptions`:
 *   - `checkout.session.completed` (subscription mode) — links the subscription
 *     id onto the row (the Customer was already stored at checkout-start).
 *   - `customer.subscription.created | updated | deleted` — mirrors status,
 *     current_period_end, cancel_at_period_end, price. When the status first
 *     becomes listed (active/trialing) stamps `listed_at` — the analogue of
 *     `provider_connect_accounts.account_ready_at` (OH-191 AC #1 / AC #2).
 *
 * The row is ALWAYS keyed by `stripe_customer_id` (which we stamp at
 * checkout-start, so it precedes every webhook), with `provider_id`
 * (client_reference_id / subscription metadata) as a fallback. Mirroring is
 * idempotent (we overwrite the row); `listed_at` is stamped once and never
 * cleared — the LIVE gate reads `status`, not the stamp.
 */

const Ack = z.object({ received: z.literal(true) }).openapi('StripeBillingWebhookAck');
const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('StripeBillingWebhookError');

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

interface SubscriptionRow {
  provider_id: string;
  stripe_customer_id: string | null;
  price_id: string | null;
  listed_at: Date | string | null;
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
  summary: 'Stripe Billing webhook — mirrors the Provider Subscription lifecycle onto provider_subscriptions',
  description:
    'Receives Stripe Billing webhook deliveries (separate endpoint + signing secret from the Connect + payments webhooks). Verifies the `Stripe-Signature` header with STRIPE_BILLING_WEBHOOK_SECRET, then on checkout.session.completed links the subscription id and on customer.subscription.* mirrors status / current_period_end / cancel_at_period_end / price onto the row keyed by stripe_customer_id, stamping listed_at on the first listed transition. Public route — the Stripe signature is the authentication.',
  responses: {
    200: { description: 'Acknowledged', content: json(Ack) },
    400: { description: 'Invalid signature or payload', content: json(ErrorResponse) },
  },
});

/** Resolve the subscription row by customer id, falling back to provider id. */
async function findRow(
  db: Db,
  keys: { customerId: string | null; providerId: string | null },
): Promise<SubscriptionRow | undefined> {
  if (keys.customerId) {
    const byCustomer = (await db
      .selectFrom('provider_subscriptions')
      .select(['provider_id', 'stripe_customer_id', 'price_id', 'listed_at'])
      .where('stripe_customer_id', '=', keys.customerId)
      .executeTakeFirst()) as SubscriptionRow | undefined;
    if (byCustomer) return byCustomer;
  }
  if (keys.providerId) {
    return (await db
      .selectFrom('provider_subscriptions')
      .select(['provider_id', 'stripe_customer_id', 'price_id', 'listed_at'])
      .where('provider_id', '=', keys.providerId)
      .executeTakeFirst()) as SubscriptionRow | undefined;
  }
  return undefined;
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

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as StripeCheckoutSessionObject;
      // Only subscription-mode sessions concern us (a future one-off checkout
      // would carry mode=payment). Treat a missing mode as subscription.
      if (session.mode && session.mode !== 'subscription') {
        return c.json({ received: true as const }, 200);
      }
      const customerId = typeof session.customer === 'string' ? session.customer : null;
      const providerId =
        session.client_reference_id ?? session.metadata?.provider_id ?? null;
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;

      const row = await findRow(db, { customerId, providerId });
      if (!row) {
        console.warn('[stripe-billing] checkout.session.completed: no row matches', customerId, providerId);
        return c.json({ received: true as const }, 200);
      }

      const patch: Record<string, unknown> = { last_webhook_at: now, updated_at: now };
      if (customerId) patch.stripe_customer_id = customerId;
      if (subscriptionId) patch.stripe_subscription_id = subscriptionId;
      await db
        .updateTable('provider_subscriptions')
        .set(patch)
        .where('provider_id', '=', row.provider_id)
        .execute();

      return c.json({ received: true as const }, 200);
    }

    if (SUBSCRIPTION_EVENTS.has(event.type)) {
      const sub = event.data.object as StripeSubscriptionObject;
      const customerId = typeof sub.customer === 'string' ? sub.customer : null;
      const providerId = sub.metadata?.provider_id ?? null;

      if (!isStripeSubscriptionStatus(sub.status)) {
        // An unknown status would violate the DB check; ack so Stripe stops
        // retrying rather than 500-looping on a status we do not model.
        console.warn('[stripe-billing] unknown subscription status', sub.status);
        return c.json({ received: true as const }, 200);
      }
      const status: StripeSubscriptionStatus = sub.status;

      const row = await findRow(db, { customerId, providerId });
      if (!row) {
        console.warn('[stripe-billing] subscription event: no row matches', customerId, providerId);
        return c.json({ received: true as const }, 200);
      }

      const becameListed = isListedStatus(status) && row.listed_at == null;
      const priceId = sub.items?.data?.[0]?.price?.id ?? row.price_id ?? null;

      const patch: Record<string, unknown> = {
        stripe_subscription_id: sub.id,
        status,
        price_id: priceId,
        current_period_end:
          typeof sub.current_period_end === 'number' ? new Date(sub.current_period_end * 1000) : null,
        cancel_at_period_end: !!sub.cancel_at_period_end,
        last_webhook_at: now,
        updated_at: now,
      };
      if (customerId) patch.stripe_customer_id = customerId;
      if (becameListed) patch.listed_at = now;

      await db
        .updateTable('provider_subscriptions')
        .set(patch)
        .where('provider_id', '=', row.provider_id)
        .execute();

      return c.json({ received: true as const }, 200);
    }

    // Ack everything else (invoice.*, etc.) so Stripe stops retrying.
    return c.json({ received: true as const }, 200);
  });
}
