import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';

/**
 * Provider-facing screening initiate route (OH-185; ADR-0007, ADR-0019).
 *
 * `POST /v1/providers/me/verification/screening/initiate`
 *
 * Ported from the Fastify plugin (apps/backend/src/routes/screening.ts) onto the
 * Hono fat Edge Function. Gated to `roles: ['caregiver', 'provider']` (the unified
 * `providers` supply table backs both).
 *
 * Pre-conditions enforced at the route layer (the Verification deep module stays
 * state-agnostic):
 *   1. A provider row exists for this Supabase uid.
 *   2. `provider_verifications.id_doc_uploaded_at` is set — the prior verification
 *      step is done. Without an ID upload Checkr would reject and we'd waste the
 *      Stripe charge.
 *   3. The Provider isn't already cleared (`screening_passed_at`) or terminated
 *      (`rejected_at`).
 *   4. No active screening row exists (status in payment_pending / payment_succeeded
 *      / in_progress) — prevents double-charging.
 *
 * Side effects:
 *   - Inserts a `provider_screenings` row in `payment_pending`.
 *   - Creates a Stripe PaymentIntent for SCREENING_CHARGE_CENTS tagged
 *     `metadata.purpose = 'screening'` + `screening_id` + `provider_id`, so the
 *     payments webhook (routes/webhooks/stripe-payments.ts) can locate the row.
 *
 * Returns `clientSecret` + `paymentIntentId` so the web portal can mount Stripe
 * Elements and confirm the intent client-side. The actual Checkr report is NOT
 * created here: on `payment_intent.succeeded` the payments webhook enqueues a
 * `screening.invite` outbox row, and the worker-tick makes the (slow) Checkr
 * invitation call durably (OH-237 substrate; ADR-0019 § Decision 5).
 */

const SUPPLY_ROLES = ['caregiver', 'provider'] as const;

const InitiateResponse = z
  .object({
    screeningId: z.string().uuid(),
    clientSecret: z.string(),
    paymentIntentId: z.string(),
    amountCents: z.number().int().positive(),
  })
  .openapi('ScreeningInitiateResponse');

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('ScreeningError');

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

interface ProviderRow {
  id: string;
  uid: string;
  role: (typeof SUPPLY_ROLES)[number];
  state: string;
}

interface VerificationGate {
  id_doc_uploaded_at: Date | string | null;
  screening_passed_at: Date | string | null;
  rejected_at: Date | string | null;
}

const ACTIVE_STATUSES = ['payment_pending', 'payment_succeeded', 'in_progress'] as const;

async function loadProvider(db: Db, uid: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'state'])
    .where('uid', '=', uid)
    .executeTakeFirst();
  return row ? (row as ProviderRow) : null;
}

const initiateRoute = createRoute({
  method: 'post',
  path: '/providers/me/verification/screening/initiate',
  tags: ['screening'],
  summary: 'Initiate the $35 Stripe charge + create a background-screening row',
  description:
    "Creates a `provider_screenings` row in `payment_pending` and a Stripe PaymentIntent for the screening fee. The applicant confirms the intent client-side; on `payment_intent.succeeded` the payments webhook enqueues a durable `screening.invite` job and the worker-tick creates the Checkr invitation (writing screening_initiated_at). Returns the PaymentIntent client_secret so the web portal can mount Stripe Elements. Rejects if the prior verification step (ID upload) is incomplete or a screening is already in flight / cleared.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: [...SUPPLY_ROLES] })] as const,
  responses: {
    200: { description: 'Charge created + screening row opened', content: json(InitiateResponse) },
    400: { description: 'Prior verification step incomplete (ID upload)', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (parent / admin)', content: json(ErrorResponse) },
    404: { description: 'Supply (provider) row not found', content: json(ErrorResponse) },
    409: { description: 'Screening already in flight or cleared', content: json(ErrorResponse) },
  },
});

export function registerScreeningRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(initiateRoute, async (c) => {
    const { db, env, stripe } = c.var.deps;
    const principal = c.get('principal')!;

    const provider = await loadProvider(db, principal.uid);
    if (!provider) {
      return c.json(
        { error: 'provider_not_found', reason: 'claim a supply role first (POST /v1/auth/role-claim)' },
        404,
      );
    }

    const verification = (await db
      .selectFrom('provider_verifications')
      .select(['id_doc_uploaded_at', 'screening_passed_at', 'rejected_at'])
      .where('provider_id', '=', provider.id)
      .executeTakeFirst()) as VerificationGate | undefined;

    if (!verification?.id_doc_uploaded_at) {
      return c.json(
        { error: 'id_doc_required', reason: 'upload a government-issued ID before initiating screening' },
        400,
      );
    }
    if (verification.screening_passed_at) {
      return c.json({ error: 'screening_already_cleared' }, 409);
    }
    if (verification.rejected_at) {
      return c.json({ error: 'verification_terminated' }, 409);
    }

    const inFlight = await db
      .selectFrom('provider_screenings')
      .select(['id', 'status'])
      .where('provider_id', '=', provider.id)
      .where('status', 'in', [...ACTIVE_STATUSES])
      .executeTakeFirst();
    if (inFlight) {
      return c.json(
        { error: 'screening_in_flight', reason: `existing screening row ${inFlight.id} is ${inFlight.status}` },
        409,
      );
    }

    const amountCents = env.SCREENING_CHARGE_CENTS;
    const screening = await db
      .insertInto('provider_screenings')
      .values({
        provider_id: provider.id,
        vendor: 'checkr',
        package: env.CHECKR_PACKAGE,
        status: 'payment_pending',
        charge_amount_cents: amountCents,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const pi = await stripe.createScreeningPaymentIntent({
      amountCents,
      description: 'Our Haven background screening',
      metadata: {
        screening_id: screening.id,
        provider_id: provider.id,
        purpose: 'screening',
      },
    });

    await db
      .updateTable('provider_screenings')
      .set({ stripe_payment_intent_id: pi.id, updated_at: new Date() })
      .where('id', '=', screening.id)
      .execute();

    return c.json(
      {
        screeningId: screening.id,
        clientSecret: pi.client_secret,
        paymentIntentId: pi.id,
        amountCents,
      },
      200,
    );
  });
}
