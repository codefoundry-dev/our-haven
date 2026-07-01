import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../../auth/middleware.ts';
import type { AppEnv } from '../../context.ts';
import type { Db } from '../../db/kysely.ts';
import { transitionBooking } from '../../../../../packages/domain/src/booking-lifecycle/index.ts';
import {
  captureBooking,
  commissionOn,
  releaseBookingHold,
  type BookingPaymentStatus,
} from '../../services/booking-payments.ts';
import { reconcileSupplyStanding } from '../../services/supply-flags.ts';

/**
 * Admin dispute queue + resolution (OH-213) — the missing "route to admin + let
 * admin resolve" half of ADR-0013 (amended). No admin-app (Next.js) UI ships
 * here; these are the backend endpoints the console will call, and the way a
 * held in-window payout finally gets released or refunded.
 *
 *   GET  /v1/admin/disputes?status=open   the queue (oldest-open first)
 *   POST /v1/admin/disputes/{id}/resolve  release / refund / clawback / dismiss
 *
 * Both are `admin`-role (the auth middleware additionally requires aal2+TOTP);
 * resolve — because it moves money — layers a 5-minute step-up window on top.
 *
 * The resolution branches on the subject's state, NOT blindly on the action:
 *   - a `disputed` Booking (in-window held payout) → run the domain
 *     `admin-resolve-dispute` transition: `released` captures the payout to the
 *     Caregiver (dispute rejected), `refunded`/`clawback` refunds the Parent
 *     (dispute upheld). A held payout MUST move — `dismissed` is rejected there.
 *   - an out-of-window escalation (`accepted`/`completed`) → payment-only:
 *     `refunded`/`clawback` releases/refunds; `completed` stays terminal (no
 *     domain call). `dismissed` = no money.
 *   - a no-show (`cancelled`, already refunded) → `dismissed` CLEARS the linked
 *     supply flag(s) + re-evaluates suspension (the recovery path).
 *   - a `job` subject carries no on-platform money → `dismissed` only.
 */

const ADMIN_STEP_UP_MAX_AGE_SEC = 5 * 60;

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('AdminDisputeError');

const DisputeStatusEnum = z.enum(['open', 'resolved', 'dismissed']);
const DisputeSubjectEnum = z.enum(['booking', 'job']);
const DisputeReasonEnum = z.enum(['overcharged', 'no-show', 'safety', 'quality', 'other']);
const ResolutionEnum = z.enum(['released', 'refunded', 'clawback', 'dismissed']);

const DisputeItemSchema = z
  .object({
    id: z.string(),
    subjectType: DisputeSubjectEnum,
    subjectId: z.string(),
    filedByUid: z.string(),
    reason: DisputeReasonEnum,
    details: z.string().nullable(),
    inWindow: z.boolean(),
    holdApplied: z.boolean(),
    status: DisputeStatusEnum,
    createdAt: z.string(),
  })
  .openapi('AdminDispute');

const DisputeListResponse = z
  .object({ disputes: z.array(DisputeItemSchema) })
  .openapi('AdminDisputeList');

const ResolveRequest = z
  .object({ resolution: ResolutionEnum, note: z.string().max(1000).optional() })
  .openapi('AdminDisputeResolveRequest');

const ResolveResponse = z
  .object({ id: z.string(), status: DisputeStatusEnum, resolution: ResolutionEnum })
  .openapi('AdminDisputeResolved');

const DisputeIdParam = z.object({
  disputeId: z.string().uuid().openapi({ param: { name: 'disputeId', in: 'path' } }),
});

const ListQuery = z.object({ status: DisputeStatusEnum.optional() });

/* ── row shapes + helpers ─────────────────────────────────────────────────────── */

interface DisputeRow {
  id: string;
  subject_type: 'booking' | 'job';
  subject_id: string;
  filed_by_uid: string;
  reason: z.infer<typeof DisputeReasonEnum>;
  details: string | null;
  in_window: boolean;
  hold_applied: boolean;
  status: z.infer<typeof DisputeStatusEnum>;
  created_at: Date | string;
}

const DISPUTE_COLUMNS = [
  'id',
  'subject_type',
  'subject_id',
  'filed_by_uid',
  'reason',
  'details',
  'in_window',
  'hold_applied',
  'status',
  'created_at',
] as const;

interface AdminBookingRow {
  id: string;
  kind: 'caregiver' | 'provider';
  state: string;
  origin: 'posted-job' | 'direct-message' | null;
  provider_id: string;
  parent_uid: string;
  payment_intent_id: string | null;
  payment_status: string | null;
  authorized_amount_cents: number | null;
  captured_amount_cents: number | null;
  computed_total_cents: number | null;
  proposed_amount_cents: number | null;
  commission_bp: number | null;
}

async function loadBooking(db: Db, id: string): Promise<AdminBookingRow | null> {
  const row = (await db
    .selectFrom('bookings')
    .select([
      'id',
      'kind',
      'state',
      'origin',
      'provider_id',
      'parent_uid',
      'payment_intent_id',
      'payment_status',
      'authorized_amount_cents',
      'captured_amount_cents',
      'computed_total_cents',
      'proposed_amount_cents',
      'commission_bp',
    ])
    .where('id', '=', id)
    .executeTakeFirst()) as AdminBookingRow | undefined;
  return row ?? null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Stamp the dispute row terminal (idempotent — only flips an `open` row). */
async function stampResolved(
  db: Db,
  id: string,
  status: 'resolved' | 'dismissed',
  resolution: z.infer<typeof ResolutionEnum>,
  note: string | undefined,
  adminUid: string,
  now: Date,
): Promise<void> {
  await db
    .updateTable('disputes')
    .set({
      status,
      resolution,
      resolution_note: note ?? null,
      resolved_by_uid: adminUid,
      resolved_at: now,
      updated_at: now,
    })
    .where('id', '=', id)
    .where('status', '=', 'open')
    .execute();
}

/* ── route definitions ────────────────────────────────────────────────────────── */

const listRoute = createRoute({
  method: 'get',
  path: '/admin/disputes',
  tags: ['admin'],
  summary: 'List disputes (admin queue) — OH-213',
  description:
    'The dispute queue — in-window holds, out-of-window escalations, past-Job complaints, and no-shows. Defaults to `open`; pass `?status=` to view resolved/dismissed.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['admin'] })] as const,
  request: { query: ListQuery },
  responses: {
    200: { description: 'The dispute queue', content: json(DisputeListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Not an admin (or no aal2/TOTP)', content: json(ErrorResponse) },
  },
});

const resolveRoute = createRoute({
  method: 'post',
  path: '/admin/disputes/{disputeId}/resolve',
  tags: ['admin'],
  summary: 'Resolve a dispute — release / refund / clawback / dismiss — OH-213',
  description:
    "Resolves an open dispute. For a `disputed` Booking (held payout) `released` captures the payout to the Caregiver and `refunded`/`clawback` refunds the Parent; an out-of-window escalation refunds (or dismisses); a no-show `dismissed` clears the supply flag + lifts any suspension. Step-up-MFA gated (money movement).",
  security: [{ supabaseAccessToken: [] }],
  middleware: [
    requireAuth({ roles: ['admin'], stepUpMaxAgeSec: ADMIN_STEP_UP_MAX_AGE_SEC }),
  ] as const,
  request: { params: DisputeIdParam, body: { content: json(ResolveRequest), required: true } },
  responses: {
    200: { description: 'Resolved', content: json(ResolveResponse) },
    400: { description: 'Invalid resolution for this subject', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Not an admin / step-up required', content: json(ErrorResponse) },
    404: { description: 'Dispute not found', content: json(ErrorResponse) },
    409: { description: 'Already resolved, or not resolvable that way', content: json(ErrorResponse) },
  },
});

/* ── handlers ─────────────────────────────────────────────────────────────────── */

export function registerAdminDisputeRoutes(app: OpenAPIHono<AppEnv>): void {
  // ── GET /v1/admin/disputes ──────────────────────────────────────────────────
  app.openapi(listRoute, async (c) => {
    const { db } = c.var.deps;
    const { status } = c.req.valid('query');
    const rows = (await db
      .selectFrom('disputes')
      .select(DISPUTE_COLUMNS)
      .where('status', '=', status ?? 'open')
      .orderBy('created_at', 'asc')
      .limit(200)
      .execute()) as DisputeRow[];
    return c.json(
      {
        disputes: rows.map((r) => ({
          id: r.id,
          subjectType: r.subject_type,
          subjectId: r.subject_id,
          filedByUid: r.filed_by_uid,
          reason: r.reason,
          details: r.details,
          inWindow: r.in_window,
          holdApplied: r.hold_applied,
          status: r.status,
          createdAt: toIso(r.created_at),
        })),
      },
      200,
    );
  });

  // ── POST /v1/admin/disputes/{disputeId}/resolve ─────────────────────────────
  app.openapi(resolveRoute, async (c) => {
    const { db, stripe } = c.var.deps;
    const admin = c.get('principal')!;
    const { disputeId } = c.req.valid('param');
    const { resolution, note } = c.req.valid('json');

    const dispute = (await db
      .selectFrom('disputes')
      .select(DISPUTE_COLUMNS)
      .where('id', '=', disputeId)
      .executeTakeFirst()) as DisputeRow | undefined;
    if (!dispute) return c.json({ error: 'dispute_not_found' }, 404);
    if (dispute.status !== 'open') return c.json({ error: 'already_resolved' }, 409);

    const now = new Date();

    // A Job carries no on-platform money — escalation record only.
    if (dispute.subject_type === 'job') {
      if (resolution !== 'dismissed') {
        return c.json(
          { error: 'invalid_resolution', reason: 'a Job dispute carries no money — resolve as dismissed' },
          400,
        );
      }
      await stampResolved(db, dispute.id, 'dismissed', resolution, note, admin.uid, now);
      return c.json({ id: dispute.id, status: 'dismissed' as const, resolution }, 200);
    }

    const b = await loadBooking(db, dispute.subject_id);
    if (!b) return c.json({ error: 'booking_not_found' }, 409);

    // ── In-window held payout → the domain resolves it (money MUST move) ────────
    if (b.state === 'disputed') {
      if (resolution === 'released') {
        const t = transitionBooking(
          { kind: 'caregiver', origin: b.origin ?? 'posted-job', state: 'disputed' },
          { type: 'admin-resolve-dispute', outcome: 'rejected' },
        );
        if (!t.ok) return c.json({ error: 'not_resolvable', reason: t.reason }, 409);
        if (!b.payment_intent_id) {
          return c.json({ error: 'not_resolvable', reason: 'no authorized payment to capture' }, 409);
        }
        const authorized = b.authorized_amount_cents ?? b.computed_total_cents ?? 0;
        const captureAmountCents =
          b.proposed_amount_cents != null ? Math.min(b.proposed_amount_cents, authorized) : authorized;
        const commissionCents = commissionOn(captureAmountCents, b.commission_bp ?? 0);
        let patch;
        try {
          ({ patch } = await captureBooking(stripe, {
            bookingId: b.id,
            paymentIntentId: b.payment_intent_id,
            captureAmountCents,
            commissionCents,
          }));
        } catch (e) {
          // Manual-capture authorizations expire (~7d). Flag for manual handling.
          await db
            .updateTable('bookings')
            .set({ payment_error: `dispute-capture failed: ${String((e as Error)?.message ?? e)}`, updated_at: now })
            .where('id', '=', b.id)
            .execute();
          return c.json(
            { error: 'capture_failed', reason: 'the authorization may have expired — settle the payout manually in Stripe' },
            409,
          );
        }
        await db.transaction().execute(async (trx) => {
          await trx
            .updateTable('bookings')
            .set({ state: 'completed', confirmed_at: now, ...patch, updated_at: now })
            .where('id', '=', b.id)
            .execute();
          await stampResolved(trx, dispute.id, 'resolved', resolution, note, admin.uid, now);
        });
        return c.json({ id: dispute.id, status: 'resolved' as const, resolution }, 200);
      }
      if (resolution === 'refunded' || resolution === 'clawback') {
        const t = transitionBooking(
          { kind: 'caregiver', origin: b.origin ?? 'posted-job', state: 'disputed' },
          { type: 'admin-resolve-dispute', outcome: 'upheld' },
        );
        if (!t.ok) return c.json({ error: 'not_resolvable', reason: t.reason }, 409);
        const { patch } = await releaseBookingHold(stripe, {
          bookingId: b.id,
          paymentIntentId: b.payment_intent_id,
          paymentStatus: (b.payment_status as BookingPaymentStatus | null) ?? null,
          authorizedAmountCents: b.authorized_amount_cents,
        });
        await db.transaction().execute(async (trx) => {
          await trx
            .updateTable('bookings')
            .set({ state: 'cancelled', cancelled_at: now, ...patch, updated_at: now })
            .where('id', '=', b.id)
            .execute();
          await stampResolved(trx, dispute.id, 'resolved', resolution, note, admin.uid, now);
        });
        return c.json({ id: dispute.id, status: 'resolved' as const, resolution }, 200);
      }
      return c.json(
        { error: 'invalid_resolution', reason: 'a held in-window dispute must be released or refunded, not dismissed' },
        409,
      );
    }

    // ── Out-of-window escalation / no-show → payment-only or flag-recovery ───────
    if (resolution === 'refunded' || resolution === 'clawback') {
      const { patch } = await releaseBookingHold(stripe, {
        bookingId: b.id,
        paymentIntentId: b.payment_intent_id,
        paymentStatus: (b.payment_status as BookingPaymentStatus | null) ?? null,
        authorizedAmountCents: b.authorized_amount_cents,
      });
      await db.transaction().execute(async (trx) => {
        await trx.updateTable('bookings').set({ ...patch, updated_at: now }).where('id', '=', b.id).execute();
        await stampResolved(trx, dispute.id, 'resolved', resolution, note, admin.uid, now);
      });
      return c.json({ id: dispute.id, status: 'resolved' as const, resolution }, 200);
    }
    if (resolution === 'dismissed') {
      await db.transaction().execute(async (trx) => {
        // Clear any no-show flag this Booking raised, then re-evaluate suspension.
        await trx
          .updateTable('supply_flags')
          .set({ status: 'cleared' })
          .where('booking_id', '=', b.id)
          .where('reason', '=', 'no-show')
          .where('status', '=', 'active')
          .execute();
        await reconcileSupplyStanding(trx, b.provider_id, now);
        await stampResolved(trx, dispute.id, 'dismissed', resolution, note, admin.uid, now);
      });
      return c.json({ id: dispute.id, status: 'dismissed' as const, resolution }, 200);
    }
    // `released` only applies to an in-window held payout.
    return c.json(
      { error: 'invalid_resolution', reason: 'released only applies to an in-window held dispute' },
      409,
    );
  });
}
