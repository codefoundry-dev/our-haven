import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
import { NotConfiguredError } from '../errors.ts';
import { setBookingTip, type TipStatus } from '../services/booking-payments.ts';
import {
  resolveCaregiverConnectAccount,
  resolveParentPaymentSource,
} from '../services/payment-source.ts';

/**
 * Post-session tipping (OH-215) — ADR-0018; CONTEXT § Tip; PRD-0001 v1.7
 * stories 126/127.
 *
 *   PUT /v1/bookings/{bookingId}/tip   set / edit / clear the Parent's tip
 *
 * A Tip is an optional Parent gratuity on a **completed Caregiver Booking**:
 * 100% pass-through to the Caregiver (a separate zero-application-fee
 * destination charge — no Commission), offered after rating and editable later
 * from the Booking detail. `amountCents: 0` clears a prior tip. The tip stays a
 * mutable card hold until the ~24h settlement cut-off, when the worker-tick
 * captures it (the capture IS the payout) and it becomes immutable — 409
 * `tip_settled` after that. Provider consultations carry no on-platform money
 * (ADR-0011) and can never be tipped (409 `not_tippable`).
 *
 * Tipping never blocks rating, payout, or completion — it is a follow-on money
 * move entirely outside the engagement PaymentIntent and the review window
 * (ADR-0013 / ADR-0018 §4).
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z.object({ error: z.string(), reason: z.string().optional() }).openapi('BookingTipError');

// NOTE: intentionally NOT a named `.openapi()` component — this shape is
// `.nullable()`-wrapped where it embeds (BookingDetail / the PUT result), and
// zod-openapi bakes a `.nullable()` applied to a *registered* schema back into
// the shared component (the OH-214 gotcha). Exported for the booking reads.
export const TipViewSchema = z.object({
  /** The current gratuity, integer cents (> 0 — a cleared tip is `null` overall). */
  amountCents: z.number().int(),
  status: z.enum(['requires_action', 'authorized', 'captured', 'failed']),
  /** true once captured — the tip is final and can no longer be edited (ADR-0018 §3). */
  settled: z.boolean(),
});

const SetTipRequest = z
  .object({
    /** The new tip in cents. `0` clears; otherwise ≥ 50 (the Stripe charge minimum). */
    amountCents: z
      .number()
      .int()
      .min(0)
      .max(50_000)
      .refine((a) => a === 0 || a >= 50, { message: 'a non-zero tip must be at least 50 cents' }),
  })
  .openapi('SetBookingTipRequest');

const SetTipResponse = z
  .object({
    id: z.string(),
    tip: TipViewSchema.nullable(),
    canTip: z.boolean(),
    /** Present when the tip hold needs 3DS — the client confirms with this. */
    clientSecret: z.string().nullable(),
  })
  .openapi('BookingTipResult');

const BookingIdParam = z.object({
  bookingId: z.string().uuid().openapi({ param: { name: 'bookingId', in: 'path' } }),
});

/* ── view helpers (shared with the booking reads that fold the tip in) ───────── */

export interface TipColumns {
  kind: 'caregiver' | 'provider';
  state: string;
  tip_cents: number | null;
  tip_status: TipStatus | null;
}

export type TipView = z.infer<typeof TipViewSchema>;

/** The Parent-facing tip projection, or null when no tip is live. */
export function tipViewOf(row: TipColumns): TipView | null {
  if (row.tip_cents == null || row.tip_status == null) return null;
  return {
    amountCents: row.tip_cents,
    status: row.tip_status,
    settled: row.tip_status === 'captured',
  };
}

/** Whether the Parent may set/edit the tip now: a completed Caregiver Booking
 *  whose tip has not settled (ADR-0018 §3/§5). */
export function canTipOf(row: TipColumns): boolean {
  return row.kind === 'caregiver' && row.state === 'completed' && row.tip_status !== 'captured';
}

/* ── row shape + loader ───────────────────────────────────────────────────────── */

interface BookingRow extends TipColumns {
  id: string;
  parent_uid: string;
  provider_id: string;
  tip_payment_intent_id: string | null;
}

async function loadOwnedBooking(db: Db, id: string, uid: string): Promise<BookingRow | null> {
  const row = (await db
    .selectFrom('bookings')
    .select(['id', 'kind', 'state', 'parent_uid', 'provider_id', 'tip_cents', 'tip_payment_intent_id', 'tip_status'])
    .where('id', '=', id)
    .executeTakeFirst()) as BookingRow | undefined;
  if (!row || row.parent_uid !== uid) return null;
  return row;
}

/* ── route ─────────────────────────────────────────────────────────────────────── */

const setTipRoute = createRoute({
  method: 'put',
  path: '/bookings/{bookingId}/tip',
  tags: ['bookings'],
  summary: 'Set, edit, or clear the post-session tip — OH-215',
  description:
    "Sets the Parent's optional gratuity on a completed Caregiver Booking (ADR-0018): a separate zero-fee destination charge — 100% to the Caregiver, no Commission. `amountCents: 0` clears a prior tip. The tip is a mutable card hold until it settles (~24h after the last edit), then immutable. When the hold needs 3DS the response carries a `clientSecret`. 409 when the Booking isn't a completed Caregiver Booking (`not_tippable`) or the tip has settled (`tip_settled`); 404 when it isn't the caller's.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: BookingIdParam, body: { content: json(SetTipRequest), required: true } },
  responses: {
    200: { description: 'Tip set / updated / cleared', content: json(SetTipResponse) },
    400: { description: 'Invalid tip amount', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    402: { description: 'Card declined on the tip hold', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Booking not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Not tippable (kind/state) or the tip already settled', content: json(ErrorResponse) },
  },
});

export function registerBookingTipRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(setTipRoute, async (c) => {
    const { db, stripe } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');
    const { amountCents } = c.req.valid('json');

    const row = await loadOwnedBooking(db, bookingId, principal.uid);
    if (!row) return c.json({ error: 'booking_not_found' }, 404);

    // ADR-0018 §5: Caregiver-only, completed state; §3: immutable once settled.
    if (row.kind !== 'caregiver') {
      return c.json({ error: 'not_tippable', reason: 'provider consultations carry no on-platform payment' }, 409);
    }
    if (row.state !== 'completed') {
      return c.json({ error: 'not_tippable', reason: 'only a completed booking can be tipped' }, 409);
    }
    if (row.tip_status === 'captured') {
      return c.json({ error: 'tip_settled', reason: 'this tip has already been paid out and can no longer be changed' }, 409);
    }

    // A non-zero tip needs both money counterparties — same gates as Award (OH-211).
    let connectAccountId: string | null = null;
    let paySource: { customerId: string; paymentMethodId: string } | null = null;
    if (amountCents > 0) {
      connectAccountId = await resolveCaregiverConnectAccount(db, row.provider_id);
      if (!connectAccountId) {
        return c.json({ error: 'caregiver_payout_unavailable', reason: 'the caregiver has not finished payout setup' }, 409);
      }
      paySource = await resolveParentPaymentSource(db, stripe, principal.uid);
      if (!paySource) {
        return c.json({ error: 'payment_method_required', reason: 'add a payment method to tip' }, 409);
      }
    }

    const now = new Date();
    let patch;
    let clientSecret: string | null = null;
    try {
      const result = await setBookingTip(stripe, {
        bookingId: row.id,
        tipCents: amountCents,
        oldTipPaymentIntentId: row.tip_payment_intent_id,
        // Unused on a clear (amountCents 0 cancels the old hold and stops).
        connectAccountId: connectAccountId ?? '',
        customerId: paySource?.customerId ?? '',
        paymentMethodId: paySource?.paymentMethodId ?? '',
        description: `Our Haven tip — booking ${row.id}`,
        now,
      });
      patch = result.patch;
      clientSecret = result.clientSecret;
    } catch (e) {
      if (e instanceof NotConfiguredError) throw e; // → 503 not_configured
      // The old hold may already be released but the new one failed — park the
      // row on `failed` (sweep-inert; the tip stays editable so the Parent can
      // retry) rather than leaving a stale `authorized` pointing at a dead PI.
      if (row.tip_status != null) {
        await db
          .updateTable('bookings')
          .set({ tip_status: 'failed', tip_settle_at: null, updated_at: now })
          .where('id', '=', row.id)
          .execute();
      }
      return c.json({ error: 'payment_failed', reason: (e as Error).message }, 402);
    }

    await db
      .updateTable('bookings')
      .set({ ...patch, updated_at: now })
      .where('id', '=', row.id)
      .execute();

    const view: TipColumns = {
      kind: row.kind,
      state: row.state,
      tip_cents: patch.tip_cents ?? null,
      tip_status: patch.tip_status ?? null,
    };
    return c.json({ id: row.id, tip: tipViewOf(view), canTip: canTipOf(view), clientSecret }, 200);
  });
}
