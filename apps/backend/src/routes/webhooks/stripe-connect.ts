/**
 * Stripe Connect Express webhook handler (OH-110).
 *
 * Distinct from the OH-106 screening webhook (`/v1/webhooks/stripe`):
 *   - This endpoint is configured against a separate Stripe webhook endpoint
 *     (Dashboard → Developers → Webhooks → Connect tab) with its own
 *     signing secret (`STRIPE_CONNECT_WEBHOOK_SECRET`).
 *   - The interesting event is `account.updated` — Stripe re-emits the full
 *     Connect account object after every state change (capability flips,
 *     requirement updates, KYC submissions). The handler mirrors the relevant
 *     fields onto `provider_connect_accounts` and, when both capabilities
 *     first become enabled, stamps `account_ready_at` — that's the OH-110
 *     gate on verification activation + search visibility.
 *
 * Encapsulation: the content-type parser registered here only affects routes
 * in this plugin's scope, leaving the global JSON parser intact elsewhere.
 *
 * Idempotency: an `account.updated` may arrive multiple times during onboarding
 * (every form-page submit fires one). Mirroring is naturally idempotent — we
 * just overwrite the row. `account_ready_at` is stamped only on the first
 * transition into the ready state and never cleared afterward, even if Stripe
 * later flips a capability off (Trust & Safety can flag the row from admin).
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { RetrievedConnectAccount } from '@/vendors/stripe.js';

const Ack = z.object({ received: z.literal(true) });
const ErrorResponse = z.object({ error: z.string(), reason: z.string().optional() });

interface ConnectAccountRow {
  provider_id: string;
  stripe_account_id: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  account_ready_at: Date | null;
}

const HANDLED_EVENT_TYPES = new Set<string>([
  'account.updated',
  'account.application.deauthorized',
]);

export const stripeConnectWebhookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => done(null, body),
  );

  app.post(
    '/webhooks/stripe-connect',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'Stripe Connect Express webhook — mirrors account.updated onto provider_connect_accounts',
        description:
          'Receives Stripe Connect webhook deliveries (separate endpoint + signing secret from the screening webhook). Verifies the `Stripe-Signature` header using `STRIPE_CONNECT_WEBHOOK_SECRET`, then on `account.updated` mirrors charges_enabled / payouts_enabled / details_submitted / requirements / disabled_reason onto the row keyed by `stripe_account_id`. When both capabilities transition to enabled for the first time, stamps `account_ready_at` — that timestamp is the OH-110 gate on verification activation and search visibility.',
        consumes: ['application/json'],
        response: {
          200: Ack,
          400: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const rawBody = typeof req.body === 'string' ? req.body : '';
      const signature = req.headers['stripe-signature'];
      const signatureHeader =
        typeof signature === 'string' ? signature : Array.isArray(signature) ? signature[0] ?? null : null;

      if (!app.deps.stripe.verifyConnectWebhookSignature(rawBody, signatureHeader)) {
        reply.code(400);
        return { error: 'invalid_signature' };
      }

      const event = app.deps.stripe.parseConnectWebhookEvent(rawBody);
      if (!event) {
        reply.code(400);
        return { error: 'invalid_payload' };
      }

      if (!HANDLED_EVENT_TYPES.has(event.type)) {
        return { received: true as const };
      }

      const account = event.data.object as RetrievedConnectAccount;

      const row = (await app.deps.db
        .selectFrom('provider_connect_accounts')
        .select(['provider_id', 'stripe_account_id', 'charges_enabled', 'payouts_enabled', 'account_ready_at'])
        .where('stripe_account_id', '=', account.id)
        .executeTakeFirst()) as ConnectAccountRow | undefined;

      if (!row) {
        // Stripe sometimes fires account.updated before the API call that
        // created the account returns — log + ack. The summary endpoint will
        // reconcile on next read by re-fetching from Stripe (not implemented
        // here yet; webhooks are the primary path).
        req.log.warn({ stripeAccountId: account.id, type: event.type }, 'stripe-connect webhook: no row matches');
        return { received: true as const };
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

      await app.deps.db
        .updateTable('provider_connect_accounts')
        .set(patch)
        .where('provider_id', '=', row.provider_id)
        .execute();

      return { received: true as const };
    },
  );
};
