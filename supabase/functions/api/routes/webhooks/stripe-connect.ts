import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import type { AppEnv } from '../../context.ts';
import type { RetrievedConnectAccount } from '../../vendors/stripe.ts';

/**
 * Stripe Connect Express webhook (OH-190; ADR-0019 § Decision 5 — "webhooks
 * terminate on the fat function").
 *
 * Ported from apps/backend/src/routes/webhooks/stripe-connect.ts. Public route
 * (no `requireAuth`), deployed under `--no-verify-jwt`; the Stripe signature is
 * the authentication. The Fastify `addContentTypeParser` raw-body hack is
 * dropped — Hono gives us the raw bytes via `c.req.text()`, which we must read
 * BEFORE anything parses the body so the HMAC matches what Stripe signed (hence
 * this route declares no request-body schema).
 *
 * Configured against a separate Stripe webhook endpoint (Dashboard → Developers
 * → Webhooks → Connect) with its own signing secret (STRIPE_CONNECT_WEBHOOK_SECRET).
 *
 * The interesting event is `account.updated`: Stripe re-emits the full Connect
 * account object after every state change (capability flips, requirement
 * updates, KYC submissions). We mirror the relevant fields onto
 * `provider_connect_accounts` and, when both capabilities first become enabled,
 * stamp `account_ready_at` — the gate on verification activation + search
 * visibility (OH-190 AC #1: "Hosted KYC completes + status synced via webhook").
 *
 * Idempotency: `account.updated` can arrive many times during onboarding (every
 * form-page submit fires one). Mirroring is naturally idempotent — we overwrite
 * the row. `account_ready_at` is stamped only on the first transition into the
 * ready state and never cleared afterward (Trust & Safety can flag the row from
 * admin if Stripe later disables a capability).
 */

const Ack = z.object({ received: z.literal(true) }).openapi('StripeConnectWebhookAck');
const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('StripeConnectWebhookError');

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

interface ConnectAccountRow {
  provider_id: string;
  stripe_account_id: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  account_ready_at: Date | null;
}

const webhookRoute = createRoute({
  method: 'post',
  path: '/webhooks/stripe-connect',
  tags: ['webhooks'],
  summary: 'Stripe Connect Express webhook — mirrors account.updated onto provider_connect_accounts',
  description:
    'Receives Stripe Connect webhook deliveries (separate endpoint + signing secret from the screening webhook). Verifies the `Stripe-Signature` header with STRIPE_CONNECT_WEBHOOK_SECRET, then on `account.updated` mirrors charges_enabled / payouts_enabled / details_submitted / requirements / disabled_reason onto the row keyed by `stripe_account_id`. When both capabilities transition to enabled for the first time, stamps `account_ready_at`. Public route — the Stripe signature is the authentication.',
  responses: {
    200: { description: 'Acknowledged', content: json(Ack) },
    400: { description: 'Invalid signature or payload', content: json(ErrorResponse) },
  },
});

export function registerStripeConnectWebhookRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(webhookRoute, async (c) => {
    const { db, stripe } = c.var.deps;

    const rawBody = await c.req.text();
    const signatureHeader = c.req.header('stripe-signature') ?? null;

    if (!stripe.verifyConnectWebhookSignature(rawBody, signatureHeader)) {
      return c.json({ error: 'invalid_signature' }, 400);
    }

    const event = stripe.parseConnectWebhookEvent(rawBody);
    if (!event) {
      return c.json({ error: 'invalid_payload' }, 400);
    }

    // Only account.updated drives state; ack everything else (deauthorizations,
    // other Connect events) so Stripe stops retrying.
    if (event.type !== 'account.updated') {
      return c.json({ received: true as const }, 200);
    }

    const account = event.data.object as RetrievedConnectAccount;

    const row = (await db
      .selectFrom('provider_connect_accounts')
      .select(['provider_id', 'stripe_account_id', 'charges_enabled', 'payouts_enabled', 'account_ready_at'])
      .where('stripe_account_id', '=', account.id)
      .executeTakeFirst()) as ConnectAccountRow | undefined;

    if (!row) {
      // Stripe can fire account.updated before the create call returns — ack and
      // let the next delivery (or a summary read) reconcile. Webhooks are the
      // primary path; a missing row is benign and self-heals.
      console.warn('[stripe-connect] webhook: no row matches', account.id);
      return c.json({ received: true as const }, 200);
    }

    const now = new Date();
    const becameReady = account.charges_enabled && account.payouts_enabled && !row.account_ready_at;

    const patch: Record<string, unknown> = {
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      disabled_reason: (account.requirements?.disabled_reason as string | undefined) ?? null,
      requirements: (account.requirements ?? {}) as Record<string, unknown>,
      last_webhook_at: now,
      updated_at: now,
    };
    if (becameReady) {
      patch.account_ready_at = now;
    }

    await db
      .updateTable('provider_connect_accounts')
      .set(patch)
      .where('provider_id', '=', row.provider_id)
      .execute();

    return c.json({ received: true as const }, 200);
  });
}
