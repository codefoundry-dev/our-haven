/**
 * Provider-facing screening route (OH-106).
 *
 * `POST /providers/me/verification/screening/initiate`
 *
 * Pre-conditions enforced at the route layer (the Verification deep module
 * stays state-agnostic):
 *   1. Provider exists for this Supabase uid.
 *   2. `provider_verifications.id_doc_uploaded_at` is set — i.e. the prior
 *      verification step is done. Without ID upload the screening cannot
 *      proceed (Checkr will reject and we'd waste a Stripe charge).
 *   3. No active screening row exists (status in `payment_pending` /
 *      `payment_succeeded` / `in_progress`) — prevents double-charging.
 *   4. No prior screening has already cleared the Provider.
 *
 * Side effects:
 *   - Creates a `provider_screenings` row in `payment_pending`.
 *   - Creates a Stripe PaymentIntent for SCREENING_CHARGE_CENTS with
 *     metadata `{ screening_id, provider_id }` so the Stripe webhook handler
 *     can find the row.
 *
 * Returns `client_secret` + `payment_intent_id`. The web portal confirms the
 * intent client-side; the actual Checkr report is created by the Stripe
 * webhook handler on `payment_intent.succeeded` (see
 * routes/webhooks/stripe.ts) — that is what writes `screening_initiated_at`.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const InitiateResponse = z.object({
  screeningId: z.uuid(),
  clientSecret: z.string(),
  paymentIntentId: z.string(),
  amountCents: z.number().int().positive(),
});

const ErrorResponse = z.object({
  error: z.string(),
  reason: z.string().optional(),
});

interface ProviderRow {
  id: string;
  uid: string;
  kind: 'caregiver' | 'specialist';
  state: string;
}

export const screeningRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/providers/me/verification/screening/initiate',
    {
      preHandler: app.requireAuth({ roles: ['provider'] }),
      schema: {
        tags: ['screening'],
        summary: 'Initiate the $35 Stripe charge + create a background-screening row',
        description:
          "Creates a `provider_screenings` row in `payment_pending` and a Stripe PaymentIntent for the screening fee. The Provider confirms the intent client-side; on `payment_intent.succeeded` the Stripe webhook handler creates the Checkr invitation and records `screening_initiated_at`. Returns the PaymentIntent client_secret so the web portal can mount Stripe Elements. Rejects if the Provider hasn't completed the prior verification steps (ID upload) or already has an in-flight / cleared screening.",
        security: [{ supabaseAccessToken: [] }],
        response: {
          200: InitiateResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;

      const provider = (await app.deps.db
        .selectFrom('providers')
        .select(['id', 'uid', 'kind', 'state'])
        .where('uid', '=', principal.uid)
        .executeTakeFirst()) as ProviderRow | undefined;
      if (!provider) {
        reply.code(404);
        return { error: 'provider_not_found' };
      }

      const verification = await app.deps.db
        .selectFrom('provider_verifications')
        .select([
          'id_doc_uploaded_at',
          'screening_initiated_at',
          'screening_passed_at',
          'rejected_at',
        ])
        .where('provider_id', '=', provider.id)
        .executeTakeFirst();

      if (!verification?.id_doc_uploaded_at) {
        reply.code(400);
        return {
          error: 'id_doc_required',
          reason: 'upload a government-issued ID before initiating screening',
        };
      }
      if (verification.screening_passed_at) {
        reply.code(409);
        return { error: 'screening_already_cleared' };
      }
      if (verification.rejected_at) {
        reply.code(409);
        return { error: 'verification_terminated' };
      }

      const inFlight = await app.deps.db
        .selectFrom('provider_screenings')
        .select(['id', 'status'])
        .where('provider_id', '=', provider.id)
        .where('status', 'in', ['payment_pending', 'payment_succeeded', 'in_progress'])
        .executeTakeFirst();
      if (inFlight) {
        reply.code(409);
        return {
          error: 'screening_in_flight',
          reason: `existing screening row ${inFlight.id} is ${inFlight.status}`,
        };
      }

      const amountCents = app.deps.env.SCREENING_CHARGE_CENTS;
      const screening = await app.deps.db
        .insertInto('provider_screenings')
        .values({
          provider_id: provider.id,
          vendor: 'checkr',
          package: app.deps.env.CHECKR_PACKAGE,
          status: 'payment_pending',
          charge_amount_cents: amountCents,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      const pi = await app.deps.stripe.createScreeningPaymentIntent({
        amountCents,
        currency: 'usd',
        description: 'Our Haven background screening',
        metadata: {
          screening_id: screening.id,
          provider_id: provider.id,
          purpose: 'screening',
        },
      });

      await app.deps.db
        .updateTable('provider_screenings')
        .set({
          stripe_payment_intent_id: pi.id,
          updated_at: new Date(),
        })
        .where('id', '=', screening.id)
        .execute();

      return {
        screeningId: screening.id,
        clientSecret: pi.client_secret,
        paymentIntentId: pi.id,
        amountCents,
      };
    },
  );
};
