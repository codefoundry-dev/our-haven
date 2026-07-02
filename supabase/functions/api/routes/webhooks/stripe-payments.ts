import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import {
  SCREENING_INVITE_EVENT,
  screeningInviteDedupeKey,
  type ScreeningInvitePayload,
} from '../../../_shared/screening-invite.ts';
import type { AppEnv } from '../../context.ts';
import type { Db } from '../../db/kysely.ts';
import type { SupabaseHandles } from '../../supabase/admin.ts';

/**
 * Stripe payments webhook (OH-185; ADR-0019 § Decision 5 — "webhooks terminate
 * on the fat function").
 *
 * Public route (no `requireAuth`), deployed under `--no-verify-jwt`; the Stripe
 * signature is the authentication. Raw bytes via `c.req.text()` BEFORE anything
 * parses the body (the HMAC is over the unparsed payload). A SEPARATE Stripe
 * endpoint + signing secret (STRIPE_PAYMENTS_WEBHOOK_SECRET) from the Connect
 * webhook (OH-190).
 *
 * On `payment_intent.succeeded` for an intent tagged `metadata.purpose=screening`:
 *   1. Find the `provider_screenings` row by `stripe_payment_intent_id`; ignore
 *      anything not still in `payment_pending` (idempotent against Stripe retries).
 *   2. Resolve the applicant's identity from Supabase Auth (the api host has the
 *      admin client; the worker-tick does not).
 *   3. In ONE transaction: flip the row to `payment_succeeded` AND enqueue a
 *      `screening.invite` notification-outbox row carrying that identity.
 *
 * The slow Checkr invitation call is NOT made here — ephemeral isolates make
 * post-response work non-durable (ADR-0019 § Decision 5). The worker-tick drains
 * the outbox row and makes the call durably (OH-237 substrate). The webhook acks
 * fast.
 */

const Ack = z.object({ received: z.literal(true) }).openapi('StripePaymentsWebhookAck');
const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('StripePaymentsWebhookError');

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

interface ScreeningRow {
  id: string;
  provider_id: string;
  status: string;
}

interface ProviderRow {
  id: string;
  uid: string;
  state: string;
}

interface SupabaseIdentity {
  email: string;
  firstName: string;
  lastName: string;
}

async function loadIdentity(supabase: SupabaseHandles, uid: string): Promise<SupabaseIdentity> {
  const { data, error } = await supabase.admin.auth.admin.getUserById(uid);
  if (error || !data?.user) {
    throw new Error(`supabase getUserById failed: ${error?.message ?? 'no user'}`);
  }
  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    email: data.user.email ?? '',
    firstName: typeof meta.first_name === 'string' ? meta.first_name : '',
    lastName: typeof meta.last_name === 'string' ? meta.last_name : '',
  };
}

interface BookingPaymentRow {
  id: string;
  parent_uid: string;
  payment_status: string | null;
}

interface WebhookPaymentIntent {
  id: string;
  amount: number;
  amount_capturable?: number;
  amount_received?: number;
  last_payment_error?: { code?: string; message?: string } | null;
}

/**
 * Mirror a booking PaymentIntent's Stripe lifecycle onto its `bookings` row
 * (OH-211). Keyed by payment_intent_id; every branch is guarded so a duplicate
 * or out-of-order delivery is a no-op once the booking has reached a terminal
 * payment state (captured / refunded / canceled). The Booking's domain `state`
 * is owned by the routes/sweeps that drive `transitionBooking` — the webhook
 * only reconciles the payment columns.
 */
async function handleBookingPaymentEvent(
  db: Db,
  eventType: string,
  pi: WebhookPaymentIntent,
): Promise<void> {
  const booking = (await db
    .selectFrom('bookings')
    .select(['id', 'parent_uid', 'payment_status'])
    .where('payment_intent_id', '=', pi.id)
    .executeTakeFirst()) as BookingPaymentRow | undefined;
  if (!booking) {
    console.warn('[stripe-payments] booking webhook: no booking matches PI', pi.id);
    return;
  }
  const now = new Date();
  const captured = booking.payment_status === 'captured';
  const refunded = booking.payment_status === 'refunded';
  const canceled = booking.payment_status === 'canceled';

  switch (eventType) {
    case 'payment_intent.amount_capturable_updated': {
      // The hold is placed — authorize is confirmed.
      if (captured || refunded || canceled) return;
      await db
        .updateTable('bookings')
        .set({
          payment_status: 'authorized',
          authorized_amount_cents: pi.amount_capturable ?? pi.amount,
          updated_at: now,
        })
        .where('id', '=', booking.id)
        .execute();
      return;
    }
    case 'payment_intent.succeeded': {
      // Captured — the payout transferred to the Caregiver's connected account.
      if (refunded) return;
      await db
        .updateTable('bookings')
        .set({
          payment_status: 'captured',
          captured_amount_cents: pi.amount_received ?? pi.amount,
          updated_at: now,
        })
        .where('id', '=', booking.id)
        .execute();
      return;
    }
    case 'payment_intent.canceled': {
      if (captured || refunded) return;
      await db
        .updateTable('bookings')
        .set({ payment_status: 'canceled', updated_at: now })
        .where('id', '=', booking.id)
        .execute();
      return;
    }
    case 'payment_intent.payment_failed': {
      if (captured || refunded || canceled) return;
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('bookings')
          .set({
            payment_status: 'failed',
            payment_error: pi.last_payment_error?.message ?? 'payment failed',
            updated_at: now,
          })
          .where('id', '=', booking.id)
          .execute();
        await trx
          .insertInto('notification_outbox')
          .values({
            recipient_uid: booking.parent_uid,
            event_type: 'booking_payment_failed',
            payload: { bookingId: booking.id },
            dedupe_key: `booking_payment_failed:${pi.id}`,
          })
          .onConflict((oc) => oc.column('dedupe_key').doNothing())
          .execute();
      });
      return;
    }
    default:
      return; // any other booking PI event → ack, no-op
  }
}

interface TipPaymentRow {
  id: string;
  parent_uid: string;
  tip_status: string | null;
}

/**
 * Mirror a TIP PaymentIntent's Stripe lifecycle onto its `bookings` tip columns
 * (OH-215; ADR-0018). Keyed by `tip_payment_intent_id` — an event for a
 * superseded tip PI (already replaced by an edit, or cleared) matches no row
 * and is a no-op. A settled (`captured`) tip is terminal and never walked back.
 */
async function handleTipPaymentEvent(
  db: Db,
  eventType: string,
  pi: WebhookPaymentIntent,
): Promise<void> {
  const booking = (await db
    .selectFrom('bookings')
    .select(['id', 'parent_uid', 'tip_status'])
    .where('tip_payment_intent_id', '=', pi.id)
    .executeTakeFirst()) as TipPaymentRow | undefined;
  if (!booking) return; // a stale (edited-away / cleared) tip PI — expected noise
  const now = new Date();
  const settled = booking.tip_status === 'captured';

  switch (eventType) {
    case 'payment_intent.amount_capturable_updated': {
      // The tip hold is placed — a 3DS challenge completed (requires_action →
      // authorized). `tip_settle_at` keeps its original last-edit anchor.
      if (settled) return;
      await db
        .updateTable('bookings')
        .set({ tip_status: 'authorized', updated_at: now })
        .where('id', '=', booking.id)
        .execute();
      return;
    }
    case 'payment_intent.succeeded': {
      // Captured — the zero-fee pass-through transferred to the Caregiver. The
      // sweep is the usual capturer; this reconciles it (or a Dashboard capture).
      await db
        .updateTable('bookings')
        .set({ tip_status: 'captured', tip_settle_at: null, tip_captured_at: now, updated_at: now })
        .where('id', '=', booking.id)
        .execute();
      return;
    }
    case 'payment_intent.canceled': {
      // The hold died outside our edit flow (e.g. the ~7-day hold expiry) — the
      // tip never settled, so clear it; the Parent may tip again.
      if (settled) return;
      await db
        .updateTable('bookings')
        .set({
          tip_cents: null,
          tip_payment_intent_id: null,
          tip_status: null,
          tip_settle_at: null,
          updated_at: now,
        })
        .where('id', '=', booking.id)
        .execute();
      return;
    }
    case 'payment_intent.payment_failed': {
      if (settled) return;
      await db
        .updateTable('bookings')
        .set({ tip_status: 'failed', tip_settle_at: null, updated_at: now })
        .where('id', '=', booking.id)
        .execute();
      return;
    }
    default:
      return; // any other tip PI event → ack, no-op
  }
}

const webhookRoute = createRoute({
  method: 'post',
  path: '/webhooks/stripe-payments',
  tags: ['webhooks'],
  summary: 'Stripe payments webhook — completes the screening charge + enqueues the Checkr invite',
  description:
    'Receives Stripe payments webhook deliveries (separate endpoint + signing secret from the Connect webhook). Verifies the `Stripe-Signature` header with STRIPE_PAYMENTS_WEBHOOK_SECRET, then on `payment_intent.succeeded` for a screening charge flips the screening row to `payment_succeeded` and enqueues a durable `screening.invite` outbox row (resolving the applicant identity from Supabase Auth). The worker-tick makes the slow Checkr invitation call. Public route — the Stripe signature is the authentication.',
  responses: {
    200: { description: 'Acknowledged', content: json(Ack) },
    400: { description: 'Invalid signature or payload', content: json(ErrorResponse) },
  },
});

export function registerStripePaymentsWebhookRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(webhookRoute, async (c) => {
    const { db, stripe, supabase } = c.var.deps;

    const rawBody = await c.req.text();
    const signatureHeader = c.req.header('stripe-signature') ?? null;

    if (!stripe.verifyPaymentsWebhookSignature(rawBody, signatureHeader)) {
      return c.json({ error: 'invalid_signature' }, 400);
    }

    const event = stripe.parsePaymentsWebhookEvent(rawBody);
    if (!event) {
      return c.json({ error: 'invalid_payload' }, 400);
    }

    const pi = event.data.object;
    const purpose = pi.metadata?.purpose;

    // ── Booking payment lifecycle (OH-211) ────────────────────────────────────
    // Mirror the Stripe PaymentIntent's lifecycle onto the `bookings` row (keyed
    // by payment_intent_id). Idempotent + out-of-order safe: terminal payment
    // states are never walked back by a late / duplicate delivery.
    if (purpose === 'booking') {
      await handleBookingPaymentEvent(db as Db, event.type, pi);
      return c.json({ received: true as const }, 200);
    }

    // ── Tip lifecycle (OH-215): the zero-fee pass-through hold, keyed by
    // tip_payment_intent_id. Same idempotent / out-of-order posture as bookings.
    if (purpose === 'tip') {
      await handleTipPaymentEvent(db as Db, event.type, pi);
      return c.json({ received: true as const }, 200);
    }

    // ── Screening charge (OH-185): only the succeeded event advances a row ─────
    if (event.type !== 'payment_intent.succeeded' || purpose !== 'screening') {
      return c.json({ received: true as const }, 200);
    }

    const screening = (await db
      .selectFrom('provider_screenings')
      .select(['id', 'provider_id', 'status'])
      .where('stripe_payment_intent_id', '=', pi.id)
      .executeTakeFirst()) as ScreeningRow | undefined;

    if (!screening) {
      console.warn('[stripe-payments] webhook: no screening row matches', pi.id);
      return c.json({ received: true as const }, 200);
    }
    // Idempotent: a redelivery (or a row already moving down the lifecycle) is a no-op.
    if (screening.status !== 'payment_pending') {
      return c.json({ received: true as const }, 200);
    }

    const provider = (await db
      .selectFrom('providers')
      .select(['id', 'uid', 'state'])
      .where('id', '=', screening.provider_id)
      .executeTakeFirst()) as ProviderRow | undefined;
    if (!provider) {
      console.error('[stripe-payments] webhook: provider row missing for screening', screening.id);
      return c.json({ received: true as const }, 200);
    }

    // Resolve identity BEFORE the write transaction. A transient failure throws →
    // 500 → Stripe retries; the row is still payment_pending, so the retry is safe.
    const identity = await loadIdentity(supabase, provider.uid);

    const payload: ScreeningInvitePayload = {
      screeningId: screening.id,
      providerId: provider.id,
      email: identity.email,
      firstName: identity.firstName,
      lastName: identity.lastName,
      state: provider.state,
    };

    // Transactional outbox: flip the screening row AND enqueue the invite in one
    // transaction so a redelivery can never enqueue twice (and so we never enqueue
    // without advancing the row). The dedupe key is a second belt-and-braces guard.
    const now = new Date();
    await (db as Db).transaction().execute(async (trx) => {
      await trx
        .updateTable('provider_screenings')
        .set({ status: 'payment_succeeded', paid_at: now, updated_at: now })
        .where('id', '=', screening.id)
        .where('status', '=', 'payment_pending')
        .execute();

      await trx
        .insertInto('notification_outbox')
        .values({
          recipient_uid: provider.uid,
          event_type: SCREENING_INVITE_EVENT,
          payload: payload as unknown as Record<string, unknown>,
          dedupe_key: screeningInviteDedupeKey(screening.id),
        })
        .onConflict((oc) => oc.column('dedupe_key').doNothing())
        .execute();
    });

    return c.json({ received: true as const }, 200);
  });
}
