/**
 * Stripe webhook handler (OH-106).
 *
 * Fires after the Provider confirms the screening PaymentIntent client-side.
 * On `payment_intent.succeeded` for an intent tagged
 * `metadata.purpose=screening`, the handler:
 *   1. Marks the `provider_screenings` row `payment_succeeded`.
 *   2. Calls the background-check adapter to create the vendor's actual
 *      report invitation (Checkr `POST /candidates` + `POST /invitations`).
 *   3. Writes the vendor report id back onto the screening row, flips it to
 *      `in_progress`, and stamps `provider_verifications.screening_initiated_at`.
 *
 * Encapsulation:
 *   - This sub-plugin registers a content-type parser that hands the raw JSON
 *     body to the route as a string — Stripe signature verification requires
 *     the unparsed bytes. The parser only affects routes inside this plugin;
 *     the global JSON parser keeps doing JSON for every other endpoint.
 *
 * Idempotency:
 *   - Stripe retries the webhook on non-2xx. The handler is idempotent: if
 *     the row is already `payment_succeeded` (or further along), the second
 *     delivery is a no-op. Vendor invitations are only attempted while the
 *     row is in `payment_pending`.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { reduceBackgroundCheckEvent } from '@our-haven/domain';

const Ack = z.object({ received: z.literal(true) });
const ErrorResponse = z.object({ error: z.string(), reason: z.string().optional() });

interface ScreeningRow {
  id: string;
  provider_id: string;
  status: string;
  vendor_report_id: string | null;
  stripe_payment_intent_id: string | null;
}

interface ProviderForScreening {
  id: string;
  uid: string;
  state: string;
}

export const stripeWebhookRoutes: FastifyPluginAsyncZod = async (app) => {
  // Keep the raw body around for HMAC verification.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => done(null, body),
  );

  app.post(
    '/webhooks/stripe',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'Stripe webhook — completes the OH-106 screening charge',
        description:
          'Receives Stripe webhook deliveries. Verifies the `Stripe-Signature` header (HMAC-SHA256 of `t.payload` with the webhook signing secret), then handles `payment_intent.succeeded` events whose metadata.purpose is `screening` by creating the Checkr invitation and stamping `screening_initiated_at`. Other event types acknowledge with 200.',
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

      if (!app.deps.stripe.verifyWebhookSignature(rawBody, signatureHeader)) {
        reply.code(400);
        return { error: 'invalid_signature' };
      }

      const event = app.deps.stripe.parseWebhookEvent(rawBody);
      if (!event) {
        reply.code(400);
        return { error: 'invalid_payload' };
      }

      if (event.type !== 'payment_intent.succeeded') {
        return { received: true as const };
      }

      const pi = event.data.object;
      if (pi.metadata?.purpose !== 'screening') {
        return { received: true as const };
      }

      const screening = (await app.deps.db
        .selectFrom('provider_screenings')
        .select(['id', 'provider_id', 'status', 'vendor_report_id', 'stripe_payment_intent_id'])
        .where('stripe_payment_intent_id', '=', pi.id)
        .executeTakeFirst()) as ScreeningRow | undefined;

      if (!screening) {
        req.log.warn({ paymentIntentId: pi.id }, 'stripe webhook: no screening row matches');
        return { received: true as const };
      }

      if (screening.status !== 'payment_pending') {
        return { received: true as const };
      }

      const provider = (await app.deps.db
        .selectFrom('providers')
        .select(['id', 'uid', 'state'])
        .where('id', '=', screening.provider_id)
        .executeTakeFirst()) as ProviderForScreening | undefined;
      if (!provider) {
        req.log.error({ screeningId: screening.id }, 'stripe webhook: provider row missing for screening');
        return { received: true as const };
      }

      const paidAt = new Date();
      await app.deps.db
        .updateTable('provider_screenings')
        .set({ status: 'payment_succeeded', paid_at: paidAt, updated_at: new Date() })
        .where('id', '=', screening.id)
        .execute();

      const { user, names } = await loadProviderIdentity(app, provider.uid);

      const result = await app.deps.backgroundCheck.initiateScreening({
        providerId: provider.id,
        email: user.email ?? '',
        firstName: names.firstName,
        lastName: names.lastName,
        state: provider.state,
        correlationId: screening.id,
      });

      const initiatedAt = new Date();
      await app.deps.db
        .updateTable('provider_screenings')
        .set({
          status: 'in_progress',
          vendor_report_id: result.vendorReportId,
          candidate_action_url: result.candidateActionUrl ?? null,
          initiated_at: initiatedAt,
          updated_at: new Date(),
        })
        .where('id', '=', screening.id)
        .execute();

      const factsPatch = reduceBackgroundCheckEvent({
        kind: 'initiated',
        vendorReportId: result.vendorReportId,
        occurredAt: initiatedAt,
      });
      await app.deps.db
        .updateTable('provider_verifications')
        .set({ ...factsPatch, updated_at: new Date() })
        .where('provider_id', '=', provider.id)
        .execute();

      return { received: true as const };
    },
  );
};

interface SupabaseUserShape {
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}

async function loadProviderIdentity(
  app: { deps: { supabase: { admin: { auth: { admin: { getUserById: (uid: string) => Promise<{ data: { user: SupabaseUserShape | null } | null; error: { message: string } | null }> } } } } } },
  uid: string,
): Promise<{ user: SupabaseUserShape; names: { firstName: string; lastName: string } }> {
  const { data, error } = await app.deps.supabase.admin.auth.admin.getUserById(uid);
  if (error || !data?.user) {
    throw new Error(`supabase getUserById failed: ${error?.message ?? 'no user'}`);
  }
  const user = data.user;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const firstName = typeof meta.first_name === 'string' ? meta.first_name : '';
  const lastName = typeof meta.last_name === 'string' ? meta.last_name : '';
  return { user, names: { firstName, lastName } };
}
