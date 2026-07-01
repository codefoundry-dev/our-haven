import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
// Cross-tree, Deno-clean domain modules (ADR-0019; explicit-`.ts`).
import {
  cancelBookingTimeReductionRequest,
  canFileBillingComplaint,
  extendBookingTime,
  isDisputable,
  requestReduceBookingTime,
  transitionBooking,
  type AdjustableBooking,
  type BookingState,
  type PendingTimeChange,
} from '../../../../packages/domain/src/booking-lifecycle/index.ts';
import { calculateCancellation } from '../../../../packages/domain/src/cancellation/index.ts';
import {
  captureBooking,
  commissionOn,
  priceBooking,
  reauthorizeBooking,
  type AuthorizeBookingResult,
} from '../services/booking-payments.ts';
import {
  resolveCaregiverConnectAccount,
  resolveParentPaymentSource,
} from '../services/payment-source.ts';

/**
 * Parent-facing Caregiver Booking management (OH-211 + OH-212) — the
 * read/confirm/dispute side of the payment lifecycle plus the adjust-time flow
 * (PRD-0001 v1.7 stories 28/32/34 + 129/130; ADR-0013 + ADR-0014 §A3).
 *
 *   GET    /v1/bookings/{bookingId}                 the Booking detail (payment + schedule + pending change)
 *   GET    /v1/bookings/{bookingId}/cancel-preview  the M2.5 cancellation charge preview
 *   POST   /v1/bookings/{bookingId}/confirm-hours   confirm hours → capture + payout (review window)
 *   POST   /v1/bookings/{bookingId}/dispute         dispute the charge (in-window hold / admin escalation)
 *   POST   /v1/bookings/{bookingId}/extend          buy more time — applies immediately + re-authorizes (OH-212)
 *   POST   /v1/bookings/{bookingId}/reduce-request  request fewer hours — writes a pending shorten (OH-212)
 *   DELETE /v1/bookings/{bookingId}/reduce-request  rescind the Parent's own pending shorten (OH-212)
 *
 * Adjust-time (ADR-0014 §A3) is asymmetric: **extending** is a unilateral Parent
 * purchase, so it applies at once and re-authorizes the larger total;
 * **shortening** cuts the Caregiver's agreed pay, so it only writes a transient
 * `pendingTimeChange` the Caregiver later approves/declines (that caregiver side
 * is deferred to the caregiver-session tickets) — until then the Booking keeps its
 * original duration/pay, and the Parent may rescind their own request.
 *
 * `GET /v1/bookings` (schedule list) and `POST /v1/bookings/{id}/cancel` live in
 * `consultation-bookings.ts` (the shared cancel endpoint handles both kinds). All
 * routes here are Parent-only and owner-scoped (`parent_uid = principal.uid`); a
 * Booking that is not the caller's 404s (never revealed).
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z.object({ error: z.string(), reason: z.string().optional() }).openapi('BookingError');

const BookingStateEnum = z.enum([
  'requested',
  'accepted',
  'declined',
  'expired',
  'in-progress',
  'awaiting-confirmation',
  'completed',
  'disputed',
  'cancelled',
]);
const PaymentStatusEnum = z.enum([
  'scheduled',
  'requires_action',
  'authorized',
  'captured',
  'canceled',
  'refunded',
  'failed',
]);
const CancellationTierEnum = z.enum(['free', 'half', 'full']);
const DisputeReasonEnum = z.enum(['overcharged', 'no-show', 'safety', 'quality', 'other']);

const AddressSchema = z
  .object({
    line1: z.string().nullable(),
    line2: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    postalCode: z.string().nullable(),
  })
  .openapi('BookingServiceAddress');

/**
 * A transient Parent-initiated shorten proposal on an `accepted` Caregiver
 * Booking (ADR-0014 §A3) — present only while a shorten is awaiting the
 * Caregiver's approval (or the Parent's rescind). NOT a top-level Booking status.
 */
const PendingTimeChangeSchema = z
  .object({
    proposedDurationHours: z.number(),
    proposedEndMin: z.number().int(),
    note: z.string().nullable(),
    requestedAt: z.string(),
  })
  .openapi('BookingPendingTimeChange');

const BookingDetailSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['caregiver', 'provider']),
    state: BookingStateEnum,
    providerId: z.string(),
    counterpartyName: z.string().nullable(),
    category: z.enum(['babysitter', 'tutor', 'nanny']).nullable(),
    scheduledDate: z.string(),
    startMin: z.number().int(),
    endMin: z.number().int(),
    childCount: z.number().int().nullable(),
    childAges: z.array(z.number().int()),
    /** Revealed only once the Booking reaches `accepted` (CONTEXT § Service address). */
    serviceAddress: AddressSchema.nullable(),
    agreedRateCents: z.number().int().nullable(),
    computedTotalCents: z.number().int().nullable(),
    authorizedAmountCents: z.number().int().nullable(),
    capturedAmountCents: z.number().int().nullable(),
    commissionBp: z.number().int().nullable(),
    commissionCents: z.number().int().nullable(),
    paymentStatus: PaymentStatusEnum.nullable(),
    /** The client confirms opportunistic 3DS with this when paymentStatus is requires_action. */
    paymentIntentId: z.string().nullable(),
    confirmDeadlineAt: z.string().nullable(),
    requestExpiresAt: z.string().nullable(),
    cancellationTier: CancellationTierEnum.nullable(),
    disputeReason: DisputeReasonEnum.nullable(),
    /** A Parent's pending shorten awaiting Caregiver approval, or null (OH-212). */
    pendingTimeChange: PendingTimeChangeSchema.nullable(),
  })
  .openapi('BookingDetail');

const CancelPreviewSchema = z
  .object({
    chargeCents: z.number().int(),
    refundCents: z.number().int(),
    tier: CancellationTierEnum,
  })
  .openapi('BookingCancelPreview');

const ConfirmHoursResponse = z
  .object({
    id: z.string(),
    state: z.literal('completed'),
    capturedAmountCents: z.number().int(),
  })
  .openapi('BookingConfirmHours');

const DisputeRequest = z
  .object({
    reason: DisputeReasonEnum,
    details: z.string().max(1000).optional(),
  })
  .openapi('BookingDisputeRequest');

const DisputeResponse = z
  .object({
    id: z.string(),
    state: BookingStateEnum,
    /** true when filed OUTSIDE the review window — an admin escalation, no money moved. */
    escalation: z.boolean(),
  })
  .openapi('BookingDispute');

/** A target duration in hours — half-hour granularity, matching the adjust-time
 *  sheet's presets + custom picker (ADR-0014 §A3). */
const DurationHours = z
  .number()
  .positive()
  .max(24)
  .refine((h) => Number.isInteger(h * 2), { message: 'newDurationHours must be in half-hour increments' });

const ExtendRequest = z
  .object({ newDurationHours: DurationHours })
  .openapi('BookingExtendRequest');

const ExtendResponse = z
  .object({
    id: z.string(),
    state: BookingStateEnum,
    startMin: z.number().int(),
    endMin: z.number().int(),
    durationHours: z.number(),
    computedTotalCents: z.number().int(),
    authorizedAmountCents: z.number().int(),
    paymentStatus: PaymentStatusEnum.nullable(),
    paymentIntentId: z.string().nullable(),
    /** Present when the re-auth needs 3DS — the client confirms with this. */
    clientSecret: z.string().nullable(),
  })
  .openapi('BookingExtend');

const ReduceRequestBody = z
  .object({ newDurationHours: DurationHours, note: z.string().max(500).optional() })
  .openapi('BookingReduceRequestBody');

/** Shared shape for the two pending-shorten mutations (request writes it, rescind
 *  clears it to null). */
const AdjustPendingResponse = z
  .object({
    id: z.string(),
    state: BookingStateEnum,
    pendingTimeChange: PendingTimeChangeSchema.nullable(),
  })
  .openapi('BookingAdjustPending');

const BookingIdParam = z.object({
  bookingId: z.string().uuid().openapi({ param: { name: 'bookingId', in: 'path' } }),
});

/* ── row shape + helpers ───────────────────────────────────────────────────── */

interface BookingRow {
  id: string;
  kind: 'caregiver' | 'provider';
  state: BookingState;
  parent_uid: string;
  provider_id: string;
  origin: 'posted-job' | 'direct-message' | null;
  category: 'babysitter' | 'tutor' | 'nanny' | null;
  scheduled_date: Date | string;
  start_min: number;
  end_min: number;
  child_count: number | null;
  child_ages: number[] | null;
  service_address_line1: string | null;
  service_address_line2: string | null;
  service_city: string | null;
  service_state: string | null;
  service_postal_code: string | null;
  agreed_rate_cents: number | null;
  computed_total_cents: number | null;
  authorized_amount_cents: number | null;
  captured_amount_cents: number | null;
  proposed_amount_cents: number | null;
  commission_bp: number | null;
  commission_cents: number | null;
  payment_intent_id: string | null;
  payment_status: string | null;
  confirm_deadline_at: Date | string | null;
  request_expires_at: Date | string | null;
  cancellation_tier: 'free' | 'half' | 'full' | null;
  dispute_reason: string | null;
  pending_time_change_hours: string | number | null;
  pending_time_change_note: string | null;
  pending_time_change_requested_at: Date | string | null;
  per_child_surcharge_cents: number | null;
}

const BOOKING_COLUMNS = [
  'id',
  'kind',
  'state',
  'parent_uid',
  'provider_id',
  'origin',
  'category',
  'scheduled_date',
  'start_min',
  'end_min',
  'child_count',
  'child_ages',
  'service_address_line1',
  'service_address_line2',
  'service_city',
  'service_state',
  'service_postal_code',
  'agreed_rate_cents',
  'computed_total_cents',
  'authorized_amount_cents',
  'captured_amount_cents',
  'proposed_amount_cents',
  'commission_bp',
  'commission_cents',
  'payment_intent_id',
  'payment_status',
  'confirm_deadline_at',
  'request_expires_at',
  'cancellation_tier',
  'dispute_reason',
  'pending_time_change_hours',
  'pending_time_change_note',
  'pending_time_change_requested_at',
  'per_child_surcharge_cents',
] as const;

function toDateStr(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function toIsoOrNull(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
/** A slot's wall-clock start as a UTC instant (v1 tz-agnostic). */
function slotStartAtUtc(date: string, startMin: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 0, startMin, 0, 0));
}
/** The address reveals to the Parent from `accepted` onward (never on `requested`). */
const ADDRESS_REVEALED: ReadonlySet<BookingState> = new Set<BookingState>([
  'accepted',
  'in-progress',
  'awaiting-confirmation',
  'completed',
  'disputed',
  'cancelled',
]);

/** Load a Booking and authorise the caller as its Parent (else null → 404). */
async function loadOwnedBooking(db: Db, id: string, uid: string): Promise<BookingRow | null> {
  const row = (await db
    .selectFrom('bookings')
    .select(BOOKING_COLUMNS)
    .where('id', '=', id)
    .executeTakeFirst()) as BookingRow | undefined;
  if (!row || row.parent_uid !== uid) return null;
  return row;
}

/* ── adjust-time helpers (OH-212, ADR-0014 §A3) ─────────────────────────────── */

function currentDurationHours(row: BookingRow): number {
  return (row.end_min - row.start_min) / 60;
}

/** The persisted pending shorten as the domain `PendingTimeChange`, or undefined.
 *  `proposedEndMin` is derived from the fixed `start_min` + the proposed hours. */
function readPendingTimeChange(row: BookingRow): PendingTimeChange | undefined {
  if (row.pending_time_change_requested_at == null || row.pending_time_change_hours == null) {
    return undefined;
  }
  const hours =
    typeof row.pending_time_change_hours === 'string'
      ? Number(row.pending_time_change_hours)
      : row.pending_time_change_hours;
  const requestedAt =
    row.pending_time_change_requested_at instanceof Date
      ? row.pending_time_change_requested_at
      : new Date(row.pending_time_change_requested_at);
  return {
    proposedDurationHours: hours,
    proposedEndMin: row.start_min + Math.round(hours * 60),
    note: row.pending_time_change_note ?? undefined,
    requestedAt,
  };
}

/** Project a Booking row onto the domain's `AdjustableBooking` (caregiver only). */
function toAdjustable(row: BookingRow, pending?: PendingTimeChange): AdjustableBooking {
  return {
    kind: 'caregiver',
    origin: row.origin ?? 'posted-job',
    state: row.state,
    schedule: { durationHours: currentDurationHours(row), endMin: row.end_min },
    ...(pending ? { pendingTimeChange: pending } : {}),
  };
}

/** Re-price a Booking for a new duration via the OH-178 Pricing calculator. */
function repriceForHours(row: BookingRow, hours: number, commissionBp: number) {
  return priceBooking({
    agreedRateCents: row.agreed_rate_cents ?? 0,
    hours,
    childCount: row.child_count ?? 1,
    perChildSurchargeCents: row.per_child_surcharge_cents ?? 0,
    commissionBp,
    category: row.category ?? 'babysitter',
  });
}

/** The Caregiver's auth uid (for the notify-caregiver side-effect), or null. */
async function caregiverUid(db: Db, providerId: string): Promise<string | null> {
  const r = (await db
    .selectFrom('providers')
    .select(['uid'])
    .where('id', '=', providerId)
    .executeTakeFirst()) as { uid: string } | undefined;
  return r?.uid ?? null;
}

/** Serialise a `PendingTimeChange` for the wire (dates → ISO strings). */
function pendingToWire(p: PendingTimeChange, startMin: number) {
  return {
    proposedDurationHours: p.proposedDurationHours,
    proposedEndMin: p.proposedEndMin ?? startMin + Math.round(p.proposedDurationHours * 60),
    note: p.note ?? null,
    requestedAt: p.requestedAt.toISOString(),
  };
}

/* ── route definitions ──────────────────────────────────────────────────────── */

const detailRoute = createRoute({
  method: 'get',
  path: '/bookings/{bookingId}',
  tags: ['bookings'],
  summary: 'A Booking detail (payment + schedule) — OH-211',
  description:
    "Returns one of the caller's Bookings with its payment lifecycle, pricing, schedule and (from `accepted` onward) the service address. 404 when it is not the caller's.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: BookingIdParam },
  responses: {
    200: { description: 'The Booking', content: json(BookingDetailSchema) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Booking not found (or not the caller's)", content: json(ErrorResponse) },
  },
});

const cancelPreviewRoute = createRoute({
  method: 'get',
  path: '/bookings/{bookingId}/cancel-preview',
  tags: ['bookings'],
  summary: 'Preview the cancellation charge (M2.5 calculator) — OH-211',
  description:
    'Returns what the Parent will be charged if they cancel now (free ≥24h before start / 50% <24h / 100% <2h-or-after), against the authorized amount. A Provider consultation carries no fee (always free).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: BookingIdParam },
  responses: {
    200: { description: 'The cancellation preview', content: json(CancelPreviewSchema) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Booking not found (or not the caller's)", content: json(ErrorResponse) },
  },
});

const confirmHoursRoute = createRoute({
  method: 'post',
  path: '/bookings/{bookingId}/confirm-hours',
  tags: ['bookings'],
  summary: 'Confirm the session hours → capture + payout (review window) — OH-211',
  description:
    "Confirms the Caregiver's proposed hours within the ~24h review window (ADR-0013): the Booking → `completed`, the held amount is captured, and the payout releases. 409 when the Booking is not in the review window.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: BookingIdParam },
  responses: {
    200: { description: 'Confirmed + captured', content: json(ConfirmHoursResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Booking not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Not in the review window', content: json(ErrorResponse) },
  },
});

const disputeRoute = createRoute({
  method: 'post',
  path: '/bookings/{bookingId}/dispute',
  tags: ['bookings'],
  summary: 'Dispute the charge (in-window hold / admin escalation) — OH-211',
  description:
    'Files a charge/billing dispute (ADR-0013 amended). Inside the ~24h review window this HOLDS the payout and routes to admin (Booking → `disputed`). On `accepted` / `completed` it is an admin escalation with no automatic money movement (the payout-hold semantics are unchanged). 409 from any other state.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: BookingIdParam, body: { content: json(DisputeRequest), required: true } },
  responses: {
    200: { description: 'Dispute filed', content: json(DisputeResponse) },
    400: { description: 'Invalid dispute', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Booking not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Not disputable from the current state', content: json(ErrorResponse) },
  },
});

const extendRoute = createRoute({
  method: 'post',
  path: '/bookings/{bookingId}/extend',
  tags: ['bookings'],
  summary: 'Extend a booked session — applies immediately + re-authorizes — OH-212',
  description:
    "Buys more of the Caregiver's time on an `accepted` Caregiver Booking. Applies at once (no Caregiver approval needed — ADR-0014 §A3): the duration/end grows and the larger total is re-authorized on the Parent's card. A card hold can't be raised in place, so the old hold is released and a new one placed; when 3DS is needed the response carries a `clientSecret`. A still-`scheduled` Booking just raises the amount the lazy authorize sweep will hold. 409 unless `accepted`, the target adds time, and no shorten is pending.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: BookingIdParam, body: { content: json(ExtendRequest), required: true } },
  responses: {
    200: { description: 'Extended + re-authorized', content: json(ExtendResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    402: { description: 'Card declined on re-authorization', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Booking not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Not extendable from the current state', content: json(ErrorResponse) },
  },
});

const reduceRequestRoute = createRoute({
  method: 'post',
  path: '/bookings/{bookingId}/reduce-request',
  tags: ['bookings'],
  summary: 'Request to shorten a booked session (Caregiver approval) — OH-212',
  description:
    "Requests fewer paid hours on an `accepted` Caregiver Booking. Does NOT apply immediately — it removes hours the Caregiver agreed to, so it writes a transient `pendingTimeChange` the Caregiver approves/declines (ADR-0014 §A3). The Booking keeps its original duration and pay until approved. 409 unless `accepted`, the target shortens, and no shorten is already pending.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: BookingIdParam, body: { content: json(ReduceRequestBody), required: true } },
  responses: {
    200: { description: 'Shorten requested (pending)', content: json(AdjustPendingResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Booking not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Not reducible from the current state', content: json(ErrorResponse) },
  },
});

const rescindReduceRoute = createRoute({
  method: 'delete',
  path: '/bookings/{bookingId}/reduce-request',
  tags: ['bookings'],
  summary: 'Rescind the Parent’s own pending shorten — OH-212',
  description:
    'Drops a pending shorten the Parent filed, before the Caregiver has acted (ADR-0014 §A3). The Booking resolves back to a plain `accepted` with its original duration/pay. 409 when there is no pending shorten.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: BookingIdParam },
  responses: {
    200: { description: 'Pending shorten rescinded', content: json(AdjustPendingResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Booking not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'No pending shorten to rescind', content: json(ErrorResponse) },
  },
});

/* ── handlers ───────────────────────────────────────────────────────────────── */

export function registerBookingRoutes(app: OpenAPIHono<AppEnv>): void {
  // ── GET /v1/bookings/{bookingId} ────────────────────────────────────────────
  app.openapi(detailRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');

    const row = await loadOwnedBooking(db, bookingId, principal.uid);
    if (!row) return c.json({ error: 'booking_not_found' }, 404);

    // Counterparty (Caregiver/Provider) display name.
    const profile = (await db
      .selectFrom('provider_profiles')
      .select(['display_name'])
      .where('provider_id', '=', row.provider_id)
      .executeTakeFirst()) as { display_name: string | null } | undefined;

    const addressRevealed = ADDRESS_REVEALED.has(row.state);
    return c.json(
      {
        id: row.id,
        kind: row.kind,
        state: row.state,
        providerId: row.provider_id,
        counterpartyName: profile?.display_name ?? null,
        category: row.category,
        scheduledDate: toDateStr(row.scheduled_date),
        startMin: row.start_min,
        endMin: row.end_min,
        childCount: row.child_count,
        childAges: row.child_ages ?? [],
        serviceAddress: addressRevealed
          ? {
              line1: row.service_address_line1,
              line2: row.service_address_line2,
              city: row.service_city,
              state: row.service_state,
              postalCode: row.service_postal_code,
            }
          : null,
        agreedRateCents: row.agreed_rate_cents,
        computedTotalCents: row.computed_total_cents,
        authorizedAmountCents: row.authorized_amount_cents,
        capturedAmountCents: row.captured_amount_cents,
        commissionBp: row.commission_bp,
        commissionCents: row.commission_cents,
        paymentStatus: (row.payment_status as z.infer<typeof PaymentStatusEnum> | null) ?? null,
        paymentIntentId: row.payment_intent_id,
        confirmDeadlineAt: toIsoOrNull(row.confirm_deadline_at),
        requestExpiresAt: toIsoOrNull(row.request_expires_at),
        cancellationTier: row.cancellation_tier,
        disputeReason: (row.dispute_reason as z.infer<typeof DisputeReasonEnum> | null) ?? null,
        pendingTimeChange: (() => {
          const p = readPendingTimeChange(row);
          return p ? pendingToWire(p, row.start_min) : null;
        })(),
      },
      200,
    );
  });

  // ── GET /v1/bookings/{bookingId}/cancel-preview ─────────────────────────────
  app.openapi(cancelPreviewRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');

    const row = await loadOwnedBooking(db, bookingId, principal.uid);
    if (!row) return c.json({ error: 'booking_not_found' }, 404);

    // Provider consultations carry no fee math — cancellation is always free.
    if (row.kind === 'provider') {
      return c.json({ chargeCents: 0, refundCents: 0, tier: 'free' as const }, 200);
    }

    const preview = calculateCancellation({
      originalAuthorizedCents: row.authorized_amount_cents ?? row.computed_total_cents ?? 0,
      bookingStartAt: slotStartAtUtc(toDateStr(row.scheduled_date), row.start_min),
      cancellationAt: new Date(),
      cancelledBy: 'parent',
    });
    return c.json(
      { chargeCents: preview.chargeCents, refundCents: preview.refundCents, tier: preview.tier },
      200,
    );
  });

  // ── POST /v1/bookings/{bookingId}/confirm-hours ─────────────────────────────
  app.openapi(confirmHoursRoute, async (c) => {
    const { db, stripe } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');

    const row = await loadOwnedBooking(db, bookingId, principal.uid);
    if (!row) return c.json({ error: 'booking_not_found' }, 404);

    const res = transitionBooking(
      { kind: 'caregiver', origin: row.origin ?? 'posted-job', state: row.state },
      { type: 'parent-confirm-hours' },
    );
    if (!res.ok) return c.json({ error: 'not_confirmable', reason: res.reason }, 409);
    if (!row.payment_intent_id) {
      return c.json({ error: 'not_confirmable', reason: 'no authorized payment to capture' }, 409);
    }

    const authorized = row.authorized_amount_cents ?? row.computed_total_cents ?? 0;
    const captureAmountCents =
      row.proposed_amount_cents != null ? Math.min(row.proposed_amount_cents, authorized) : authorized;
    const commissionCents = commissionOn(captureAmountCents, row.commission_bp ?? 0);
    const now = new Date();
    const { patch } = await captureBooking(stripe, {
      bookingId: row.id,
      paymentIntentId: row.payment_intent_id,
      captureAmountCents,
      commissionCents,
    });
    await db
      .updateTable('bookings')
      .set({ state: 'completed', confirmed_at: now, ...patch, updated_at: now })
      .where('id', '=', row.id)
      .execute();

    return c.json({ id: row.id, state: 'completed' as const, capturedAmountCents: captureAmountCents }, 200);
  });

  // ── POST /v1/bookings/{bookingId}/dispute ───────────────────────────────────
  app.openapi(disputeRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');
    const { reason, details } = c.req.valid('json');

    const row = await loadOwnedBooking(db, bookingId, principal.uid);
    if (!row) return c.json({ error: 'booking_not_found' }, 404);
    if (row.kind !== 'caregiver') return c.json({ error: 'booking_not_found' }, 404);

    const now = new Date();

    // Inside the ~24h review window → the SOLE payout-holding dispute (ADR-0013):
    // transition to `disputed`, hold the payout (no capture), flag admin.
    if (isDisputable(row.state)) {
      const res = transitionBooking(
        { kind: 'caregiver', origin: row.origin ?? 'posted-job', state: row.state },
        { type: 'parent-dispute' },
      );
      if (!res.ok) return c.json({ error: 'not_disputable', reason: res.reason }, 409);
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('bookings')
          .set({ state: 'disputed', disputed_at: now, dispute_reason: reason, dispute_details: details ?? null, updated_at: now })
          .where('id', '=', row.id)
          .execute();
        await trx
          .insertInto('notification_outbox')
          .values({
            recipient_uid: row.parent_uid,
            event_type: 'booking_disputed',
            payload: { bookingId: row.id, reason, inWindow: true },
            dedupe_key: `booking_disputed:${row.id}`,
          })
          .onConflict((oc) => oc.column('dedupe_key').doNothing())
          .execute();
      });
      return c.json({ id: row.id, state: 'disputed' as const, escalation: false }, 200);
    }

    // Outside the window (`accepted` / `completed`) → admin escalation only: record
    // the dispute + route to admin, NO automatic money movement, NO state change.
    if (canFileBillingComplaint(row.state)) {
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('bookings')
          .set({ dispute_reason: reason, dispute_details: details ?? null, disputed_at: now, updated_at: now })
          .where('id', '=', row.id)
          .execute();
        await trx
          .insertInto('notification_outbox')
          .values({
            recipient_uid: row.parent_uid,
            event_type: 'booking_disputed',
            payload: { bookingId: row.id, reason, inWindow: false },
            dedupe_key: `booking_disputed:${row.id}`,
          })
          .onConflict((oc) => oc.column('dedupe_key').doNothing())
          .execute();
      });
      return c.json({ id: row.id, state: row.state, escalation: true }, 200);
    }

    return c.json({ error: 'not_disputable', reason: `cannot dispute from ${row.state}` }, 409);
  });

  // ── POST /v1/bookings/{bookingId}/extend ────────────────────────────────────
  app.openapi(extendRoute, async (c) => {
    const { db, stripe, env } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');
    const { newDurationHours } = c.req.valid('json');

    const row = await loadOwnedBooking(db, bookingId, principal.uid);
    if (!row) return c.json({ error: 'booking_not_found' }, 404);
    if (row.kind !== 'caregiver') {
      return c.json({ error: 'not_adjustable', reason: 'provider consultations have no adjust-time' }, 409);
    }

    // Run the pure state machine (guards accepted / no pending / adds time).
    const addHours = Math.round((newDurationHours - currentDurationHours(row)) * 100) / 100;
    const res = extendBookingTime(toAdjustable(row, readPendingTimeChange(row)), addHours);
    if (!res.ok) return c.json({ error: 'not_extendable', reason: res.reason }, 409);

    const commissionBp = row.commission_bp ?? env.BOOKING_COMMISSION_BP;
    let price: ReturnType<typeof repriceForHours>;
    try {
      price = repriceForHours(row, newDurationHours, commissionBp);
    } catch (e) {
      return c.json({ error: 'not_extendable', reason: `invalid pricing: ${(e as Error).message}` }, 409);
    }
    const newEndMin = row.start_min + Math.round(newDurationHours * 60);
    const now = new Date();
    const cgUid = await caregiverUid(db, row.provider_id);

    const notifyExtend = async (trx: Db) => {
      if (!cgUid) return;
      await trx
        .insertInto('notification_outbox')
        .values({
          recipient_uid: cgUid,
          event_type: 'booking_time_extended',
          payload: { bookingId: row.id, newDurationHours },
          dedupe_key: `booking_time_extended:${row.id}:${now.getTime()}`,
        })
        .onConflict((oc) => oc.column('dedupe_key').doNothing())
        .execute();
    };

    // Still `scheduled` (no hold placed yet): just raise the amount the lazy
    // authorize-due sweep will hold off-session — no Stripe call now.
    if (!row.payment_intent_id || row.payment_status === 'scheduled') {
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('bookings')
          .set({
            end_min: newEndMin,
            computed_total_cents: price.parentChargeCents,
            authorized_amount_cents: price.parentChargeCents,
            commission_bp: commissionBp,
            commission_cents: price.commissionCents,
            updated_at: now,
          })
          .where('id', '=', row.id)
          .execute();
        await notifyExtend(trx);
      });
      return c.json(
        {
          id: row.id,
          state: row.state,
          startMin: row.start_min,
          endMin: newEndMin,
          durationHours: newDurationHours,
          computedTotalCents: price.parentChargeCents,
          authorizedAmountCents: price.parentChargeCents,
          paymentStatus: 'scheduled' as const,
          paymentIntentId: null,
          clientSecret: null,
        },
        200,
      );
    }

    // Authorized (or requires_action / failed): re-authorize the larger total now.
    // Gate on both counterparties being payable — same gates as Award (OH-211).
    const connectAccountId = await resolveCaregiverConnectAccount(db, row.provider_id);
    if (!connectAccountId) {
      return c.json({ error: 'caregiver_payout_unavailable', reason: 'the caregiver has not finished payout setup' }, 409);
    }
    const paySource = await resolveParentPaymentSource(db, stripe, principal.uid);
    if (!paySource) {
      return c.json({ error: 'payment_method_required', reason: 'add a payment method to extend' }, 409);
    }

    let authResult: AuthorizeBookingResult;
    try {
      authResult = await reauthorizeBooking(stripe, {
        bookingId: row.id,
        oldPaymentIntentId: row.payment_intent_id,
        amountCents: price.parentChargeCents,
        commissionCents: price.commissionCents,
        commissionBp,
        connectAccountId,
        customerId: paySource.customerId,
        paymentMethodId: paySource.paymentMethodId,
        description: `Our Haven booking ${row.id} (extended)`,
        offSession: false,
      });
    } catch (e) {
      return c.json({ error: 'payment_failed', reason: (e as Error).message }, 402);
    }
    const { patch, clientSecret } = authResult;

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('bookings')
        .set({ end_min: newEndMin, computed_total_cents: price.parentChargeCents, ...patch, updated_at: now })
        .where('id', '=', row.id)
        .execute();
      await notifyExtend(trx);
    });

    return c.json(
      {
        id: row.id,
        state: row.state,
        startMin: row.start_min,
        endMin: newEndMin,
        durationHours: newDurationHours,
        computedTotalCents: price.parentChargeCents,
        authorizedAmountCents: patch.authorized_amount_cents ?? price.parentChargeCents,
        paymentStatus: patch.payment_status ?? 'authorized',
        paymentIntentId: patch.payment_intent_id ?? row.payment_intent_id,
        clientSecret,
      },
      200,
    );
  });

  // ── POST /v1/bookings/{bookingId}/reduce-request ────────────────────────────
  app.openapi(reduceRequestRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');
    const { newDurationHours, note } = c.req.valid('json');

    const row = await loadOwnedBooking(db, bookingId, principal.uid);
    if (!row) return c.json({ error: 'booking_not_found' }, 404);
    if (row.kind !== 'caregiver') {
      return c.json({ error: 'not_adjustable', reason: 'provider consultations have no adjust-time' }, 409);
    }

    const now = new Date();
    const res = requestReduceBookingTime(
      toAdjustable(row, readPendingTimeChange(row)),
      newDurationHours,
      now,
      note,
    );
    if (!res.ok) return c.json({ error: 'not_reducible', reason: res.reason }, 409);
    const pending = res.booking.pendingTimeChange!;
    const cgUid = await caregiverUid(db, row.provider_id);

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('bookings')
        .set({
          pending_time_change_hours: pending.proposedDurationHours,
          pending_time_change_note: note ?? null,
          pending_time_change_requested_at: now,
          updated_at: now,
        })
        .where('id', '=', row.id)
        .execute();
      if (cgUid) {
        await trx
          .insertInto('notification_outbox')
          .values({
            recipient_uid: cgUid,
            event_type: 'booking_time_reduce_requested',
            payload: { bookingId: row.id, proposedDurationHours: pending.proposedDurationHours },
            dedupe_key: `booking_time_reduce_requested:${row.id}:${now.getTime()}`,
          })
          .onConflict((oc) => oc.column('dedupe_key').doNothing())
          .execute();
      }
    });

    return c.json({ id: row.id, state: row.state, pendingTimeChange: pendingToWire(pending, row.start_min) }, 200);
  });

  // ── DELETE /v1/bookings/{bookingId}/reduce-request ──────────────────────────
  app.openapi(rescindReduceRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');

    const row = await loadOwnedBooking(db, bookingId, principal.uid);
    if (!row) return c.json({ error: 'booking_not_found' }, 404);

    const res = cancelBookingTimeReductionRequest(toAdjustable(row, readPendingTimeChange(row)));
    if (!res.ok) return c.json({ error: 'no_pending_change', reason: res.reason }, 409);

    const now = new Date();
    const cgUid = await caregiverUid(db, row.provider_id);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('bookings')
        .set({
          pending_time_change_hours: null,
          pending_time_change_note: null,
          pending_time_change_requested_at: null,
          updated_at: now,
        })
        .where('id', '=', row.id)
        .execute();
      if (cgUid) {
        await trx
          .insertInto('notification_outbox')
          .values({
            recipient_uid: cgUid,
            event_type: 'booking_time_reduce_rescinded',
            payload: { bookingId: row.id },
            dedupe_key: `booking_time_reduce_rescinded:${row.id}:${now.getTime()}`,
          })
          .onConflict((oc) => oc.column('dedupe_key').doNothing())
          .execute();
      }
    });

    return c.json({ id: row.id, state: row.state, pendingTimeChange: null }, 200);
  });
}
