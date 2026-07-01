import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
// Cross-tree, Deno-clean domain modules (ADR-0019; explicit-`.ts`). The pure
// booking state machine + the adjust-time (pendingTimeChange) sub-state graph.
import {
  approveBookingTimeReduction,
  declineBookingTimeReduction,
  transitionBooking,
  type AdjustableBooking,
  type BookingState,
} from '../../../../packages/domain/src/booking-lifecycle/index.ts';
import { releaseBookingHold, type BookingPaymentStatus } from '../services/booking-payments.ts';
import {
  buildBookingRatingView,
  completionAnchor,
  loadParentRatingAggregates,
  loadRatingsByBooking,
  type RatingAggregate,
  type RatingStatusView,
} from '../services/ratings.ts';
import { RatingAggregateSchema, RatingStatusSchema } from './ratings.ts';

/**
 * Caregiver Schedule (OH-220) — the Caregiver-facing side of the hourly Booking
 * lifecycle (PRD-0001 v1.7 stories 52–54, 82, 130; ADR-0014 amended). It is the
 * mirror of the Parent-facing OH-211 routes (`bookings.ts`): where the Parent
 * *confirms* the proposed hours, the Caregiver *runs the session and proposes*
 * them.
 *
 *   GET  /v1/caregiver/bookings                              the Caregiver's schedule feed
 *   POST /v1/caregiver/bookings/{bookingId}/accept           accept an awarded (requested) Booking
 *   POST /v1/caregiver/bookings/{bookingId}/decline          decline it → release the hold
 *   POST /v1/caregiver/bookings/{bookingId}/start            mark in-progress (session-start)
 *   POST /v1/caregiver/bookings/{bookingId}/propose-hours    end session → propose hours (24h window)
 *   POST /v1/caregiver/bookings/{bookingId}/time-change/approve   approve a Parent shorten request
 *   POST /v1/caregiver/bookings/{bookingId}/time-change/decline   decline it (keep original pay)
 *
 * Every route is Caregiver-only and scoped to `provider_id = <caller's provider
 * id>`; a Booking that is not the caller's 404s (never revealed). The producer
 * of the shorten request (the Parent's `POST /v1/bookings/{id}/request-time-
 * change`) lives in `bookings.ts` alongside the other Parent booking actions.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('CaregiverBookingError');

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

const AddressSchema = z
  .object({
    line1: z.string().nullable(),
    line2: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    postalCode: z.string().nullable(),
  })
  .openapi('CaregiverBookingAddress');

const PendingTimeChangeSchema = z
  .object({
    proposedDurationHours: z.number(),
    proposedEndMin: z.number().int().nullable(),
    note: z.string().nullable(),
    requestedAt: z.string(),
  })
  .openapi('CaregiverBookingPendingTimeChange');

/** One Booking on the Caregiver's schedule (the counterparty is the Parent). */
const CaregiverBookingSchema = z
  .object({
    id: z.string(),
    state: BookingStateEnum,
    origin: z.enum(['posted-job', 'direct-message']).nullable(),
    jobId: z.string().nullable(),
    offerId: z.string().nullable(),
    seriesId: z.string().nullable(),
    parentName: z.string().nullable(),
    category: z.enum(['babysitter', 'tutor', 'nanny']).nullable(),
    scheduledDate: z.string(),
    startMin: z.number().int(),
    endMin: z.number().int(),
    childCount: z.number().int().nullable(),
    childAges: z.array(z.number().int()),
    /** Revealed to the Caregiver from `accepted` onward (they must reach the home). */
    serviceAddress: AddressSchema.nullable(),
    agreedRateCents: z.number().int().nullable(),
    computedTotalCents: z.number().int().nullable(),
    proposedHours: z.number().nullable(),
    proposedAmountCents: z.number().int().nullable(),
    /** 24h Caregiver-accept deadline on a `requested` (awarded) Booking, ISO. */
    requestExpiresAt: z.string().nullable(),
    /** 24h Parent-confirm review window on `awaiting-confirmation`, ISO. */
    confirmDeadlineAt: z.string().nullable(),
    /** A live Parent shorten proposal awaiting approve/decline, or null. */
    pendingTimeChange: PendingTimeChangeSchema.nullable(),
    /** Two-way rating status from the Caregiver's perspective (OH-214). */
    rating: RatingStatusSchema,
    /** The Parent's supply-internal standing (aggregate stars + count, no text) —
     *  the asymmetric parent-rating projection a supply member sees (OH-214). */
    parentRating: RatingAggregateSchema,
  })
  .openapi('CaregiverBooking');

const CaregiverBookingListResponse = z
  .object({ bookings: z.array(CaregiverBookingSchema) })
  .openapi('CaregiverBookingList');

const TransitionResponse = z
  .object({ id: z.string(), state: BookingStateEnum })
  .openapi('CaregiverBookingTransition');

const ProposeHoursRequest = z
  .object({
    hours: z.number().positive().max(24),
    note: z.string().max(1000).optional(),
  })
  .openapi('CaregiverBookingProposeHours');

const ProposeHoursResponse = z
  .object({
    id: z.string(),
    state: z.literal('awaiting-confirmation'),
    proposedHours: z.number(),
    proposedAmountCents: z.number().int(),
    confirmDeadlineAt: z.string(),
  })
  .openapi('CaregiverBookingProposeHoursResult');

const BookingIdParam = z.object({
  bookingId: z.string().uuid().openapi({ param: { name: 'bookingId', in: 'path' } }),
});

/* ── row shape + helpers ───────────────────────────────────────────────────── */

interface CaregiverRow {
  id: string;
  uid: string;
  role: 'caregiver' | 'provider';
  suspended_at: Date | string | null;
}

interface BookingRow {
  id: string;
  kind: 'caregiver' | 'provider';
  state: BookingState;
  parent_uid: string;
  provider_id: string;
  origin: 'posted-job' | 'direct-message' | null;
  job_id: string | null;
  offer_id: string | null;
  series_id: string | null;
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
  commission_bp: number | null;
  payment_intent_id: string | null;
  payment_status: string | null;
  proposed_hours: string | number | null;
  proposed_amount_cents: number | null;
  request_expires_at: Date | string | null;
  confirm_deadline_at: Date | string | null;
  pending_time_change_hours: string | number | null;
  pending_time_change_note: string | null;
  pending_time_change_requested_at: Date | string | null;
  confirmed_at: Date | string | null;
  auto_complete_at: Date | string | null;
  updated_at: Date | string | null;
}

const BOOKING_COLUMNS = [
  'id',
  'kind',
  'state',
  'parent_uid',
  'provider_id',
  'origin',
  'job_id',
  'offer_id',
  'series_id',
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
  'commission_bp',
  'payment_intent_id',
  'payment_status',
  'proposed_hours',
  'proposed_amount_cents',
  'request_expires_at',
  'confirm_deadline_at',
  'pending_time_change_hours',
  'pending_time_change_note',
  'pending_time_change_requested_at',
  'confirmed_at',
  'auto_complete_at',
  'updated_at',
] as const;

/** The proposed shorter end-of-window, derived (OH-212 stores hours only). */
function derivedProposedEndMin(row: BookingRow): number {
  const hrs = toNumOrNull(row.pending_time_change_hours) ?? 0;
  return row.start_min + Math.round(hrs * 60);
}

/** The Caregiver reaches the home from `accepted` onward (never on `requested`). */
const ADDRESS_REVEALED: ReadonlySet<BookingState> = new Set<BookingState>([
  'accepted',
  'in-progress',
  'awaiting-confirmation',
  'completed',
  'disputed',
  'cancelled',
]);

const REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

function toDateStr(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function toIsoOrNull(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function toNumOrNull(value: string | number | null): number | null {
  if (value == null) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}
function fullName(first: string | null, last: string | null): string | null {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name.length > 0 ? name : null;
}

/** Resolve a Caregiver principal to its `providers` row (else null → 404/403). */
async function loadCaregiverByUid(db: Db, uid: string): Promise<CaregiverRow | null> {
  const row = (await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'suspended_at'])
    .where('uid', '=', uid)
    .executeTakeFirst()) as CaregiverRow | undefined;
  if (!row || row.role !== 'caregiver') return null;
  return row;
}

/** Load a Booking and authorise the caller as its Caregiver (else null → 404). */
async function loadOwnedBooking(
  db: Db,
  id: string,
  providerId: string,
): Promise<BookingRow | null> {
  const row = (await db
    .selectFrom('bookings')
    .select(BOOKING_COLUMNS)
    .where('id', '=', id)
    .executeTakeFirst()) as BookingRow | undefined;
  // 404 (never 403) when it is not the caller's — a foreign Booking is invisible.
  if (!row || row.provider_id !== providerId || row.kind !== 'caregiver') return null;
  return row;
}

/** The `AdjustableBooking` view the adjust-time domain fns operate on. */
function toAdjustable(row: BookingRow): AdjustableBooking {
  return {
    kind: 'caregiver',
    origin: row.origin ?? 'posted-job',
    state: row.state,
    schedule: {
      durationHours: Math.max(0, (row.end_min - row.start_min) / 60),
      endMin: row.end_min,
    },
    pendingTimeChange:
      row.pending_time_change_requested_at != null
        ? {
            proposedDurationHours: toNumOrNull(row.pending_time_change_hours) ?? 0,
            proposedEndMin: derivedProposedEndMin(row),
            note: row.pending_time_change_note ?? undefined,
            requestedAt: new Date(row.pending_time_change_requested_at),
          }
        : undefined,
  };
}

function serialiseBooking(
  row: BookingRow,
  parentName: string | null,
  rating: RatingStatusView,
  parentRating: RatingAggregate,
): z.infer<typeof CaregiverBookingSchema> {
  const revealed = ADDRESS_REVEALED.has(row.state);
  return {
    id: row.id,
    state: row.state,
    origin: row.origin,
    jobId: row.job_id,
    offerId: row.offer_id,
    seriesId: row.series_id,
    parentName,
    category: row.category,
    scheduledDate: toDateStr(row.scheduled_date),
    startMin: row.start_min,
    endMin: row.end_min,
    childCount: row.child_count,
    childAges: row.child_ages ?? [],
    serviceAddress: revealed
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
    proposedHours: toNumOrNull(row.proposed_hours),
    proposedAmountCents: row.proposed_amount_cents,
    requestExpiresAt: toIsoOrNull(row.request_expires_at),
    confirmDeadlineAt: toIsoOrNull(row.confirm_deadline_at),
    pendingTimeChange:
      row.pending_time_change_requested_at != null
        ? {
            proposedDurationHours: toNumOrNull(row.pending_time_change_hours) ?? 0,
            proposedEndMin: derivedProposedEndMin(row),
            note: row.pending_time_change_note,
            requestedAt: toIsoOrNull(row.pending_time_change_requested_at)!,
          }
        : null,
    rating,
    parentRating,
  };
}

async function notify(
  db: Db,
  recipientUid: string,
  eventType: string,
  bookingId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db
    .insertInto('notification_outbox')
    .values({
      recipient_uid: recipientUid,
      event_type: eventType,
      payload,
      dedupe_key: `${eventType}:${bookingId}`,
    })
    .onConflict((oc) => oc.column('dedupe_key').doNothing())
    .execute();
}

/* ── route definitions ──────────────────────────────────────────────────────── */

const listRoute = createRoute({
  method: 'get',
  path: '/caregiver/bookings',
  tags: ['caregiver-bookings'],
  summary: "The Caregiver's schedule feed — OH-220",
  description:
    "Returns all of the authenticated Caregiver's hourly Bookings (`kind = caregiver`, `provider_id = caller`) across every state, newest first. The client buckets them into Today / Upcoming / needs-attention (awarded confirm, live session, pending shorten).",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  responses: {
    200: { description: 'The schedule', content: json(CaregiverBookingListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
  },
});

const acceptRoute = createRoute({
  method: 'post',
  path: '/caregiver/bookings/{bookingId}/accept',
  tags: ['caregiver-bookings'],
  summary: 'Accept an awarded (requested) Booking — OH-220',
  description:
    'Confirms a posted-Job award within the 24h window (`requested → accepted`). The service address reveals to the Caregiver from here on.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { params: BookingIdParam },
  responses: {
    200: { description: 'Accepted', content: json(TransitionResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role, or the Caregiver is suspended', content: json(ErrorResponse) },
    404: { description: "Not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Not acceptable from the current state', content: json(ErrorResponse) },
  },
});

const declineRoute = createRoute({
  method: 'post',
  path: '/caregiver/bookings/{bookingId}/decline',
  tags: ['caregiver-bookings'],
  summary: 'Decline an awarded (requested) Booking — OH-220',
  description:
    'Declines a posted-Job award (`requested → declined`) and releases any authorization hold back to the Parent.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { params: BookingIdParam },
  responses: {
    200: { description: 'Declined', content: json(TransitionResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Not declinable from the current state', content: json(ErrorResponse) },
  },
});

const startRoute = createRoute({
  method: 'post',
  path: '/caregiver/bookings/{bookingId}/start',
  tags: ['caregiver-bookings'],
  summary: 'Mark the session in-progress — OH-220',
  description: 'Starts the session (`accepted → in-progress`); the active-session banner + timer begin.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { params: BookingIdParam },
  responses: {
    200: { description: 'In session', content: json(TransitionResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Not startable from the current state', content: json(ErrorResponse) },
  },
});

const proposeHoursRoute = createRoute({
  method: 'post',
  path: '/caregiver/bookings/{bookingId}/propose-hours',
  tags: ['caregiver-bookings'],
  summary: 'End session → propose hours — OH-220',
  description:
    'Ends the session and proposes the hours worked (`in-progress → awaiting-confirmation`), opening the ~24h Parent review window (ADR-0013). Records `proposed_hours` + the derived `proposed_amount_cents` (capped at the authorized hold); the Parent confirms (OH-211) or it auto-confirms + captures on lapse.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { params: BookingIdParam, body: { content: json(ProposeHoursRequest), required: true } },
  responses: {
    200: { description: 'Proposed', content: json(ProposeHoursResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Not in-progress', content: json(ErrorResponse) },
  },
});

const approveTimeChangeRoute = createRoute({
  method: 'post',
  path: '/caregiver/bookings/{bookingId}/time-change/approve',
  tags: ['caregiver-bookings'],
  summary: "Approve the Parent's shorten request — OH-220",
  description:
    "Approves a pending shorten (ADR-0014 §A3): applies the proposed shorter window + re-derives the estimate, and clears the proposal. The existing authorization hold already covers the smaller amount, so no re-authorize is needed — capture-at-session-end simply captures less.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { params: BookingIdParam },
  responses: {
    200: { description: 'Approved', content: json(TransitionResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'No pending change / not accepted', content: json(ErrorResponse) },
  },
});

const declineTimeChangeRoute = createRoute({
  method: 'post',
  path: '/caregiver/bookings/{bookingId}/time-change/decline',
  tags: ['caregiver-bookings'],
  summary: "Decline the Parent's shorten request — OH-220",
  description: 'Declines a pending shorten: drops the proposal; the Booking keeps its original window + pay.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { params: BookingIdParam },
  responses: {
    200: { description: 'Declined', content: json(TransitionResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'No pending change', content: json(ErrorResponse) },
  },
});

/* ── handlers ───────────────────────────────────────────────────────────────── */

export function registerCaregiverBookingRoutes(app: OpenAPIHono<AppEnv>): void {
  // ── GET /v1/caregiver/bookings ──────────────────────────────────────────────
  app.openapi(listRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;

    const caregiver = await loadCaregiverByUid(db, principal.uid);
    if (!caregiver) return c.json({ bookings: [] }, 200);

    const rows = (await db
      .selectFrom('bookings')
      .select(BOOKING_COLUMNS)
      .where('provider_id', '=', caregiver.id)
      .where('kind', '=', 'caregiver')
      .orderBy('scheduled_date', 'desc')
      .orderBy('start_min', 'asc')
      .execute()) as BookingRow[];

    const parentUids = [...new Set(rows.map((r) => r.parent_uid))];
    const nameByUid = new Map<string, string | null>();
    const now = new Date();
    // Two-way ratings (OH-214): each Booking's viewer-relative status + the Parent's
    // supply-internal standing (batched — one query each, not per row).
    const [pairs, parentAggs] = await Promise.all([
      loadRatingsByBooking(db, rows.map((r) => r.id)),
      loadParentRatingAggregates(db, parentUids, now),
    ]);
    if (parentUids.length > 0) {
      const profs = (await db
        .selectFrom('profiles')
        .select(['id', 'first_name', 'last_name'])
        .where('id', 'in', parentUids)
        .execute()) as { id: string; first_name: string | null; last_name: string | null }[];
      profs.forEach((p) => nameByUid.set(p.id, fullName(p.first_name, p.last_name)));
    }

    const bookings = rows.map((r) => {
      const pair = pairs.get(r.id) ?? { parentToSupply: null, supplyToParent: null };
      const rating = buildBookingRatingView({
        state: r.state,
        completedAt: completionAnchor(r),
        pair,
        viewerDirection: 'supply-to-parent',
        now,
      });
      const parentRating = parentAggs.get(r.parent_uid) ?? { averageStars: null, count: 0 };
      return serialiseBooking(r, nameByUid.get(r.parent_uid) ?? null, rating, parentRating);
    });
    return c.json({ bookings }, 200);
  });

  // ── POST /v1/caregiver/bookings/{bookingId}/accept ──────────────────────────
  app.openapi(acceptRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');

    const caregiver = await loadCaregiverByUid(db, principal.uid);
    if (!caregiver) return c.json({ error: 'booking_not_found' }, 404);
    // A suspended Caregiver (OH-213 — 3 no-show flags) cannot take on new work;
    // in-flight already-accepted Bookings are unaffected so Parents aren't stranded.
    if (caregiver.suspended_at != null) {
      return c.json({ error: 'suspended', reason: 'your listing is suspended pending review' }, 403);
    }
    const row = await loadOwnedBooking(db, bookingId, caregiver.id);
    if (!row) return c.json({ error: 'booking_not_found' }, 404);

    const res = transitionBooking(
      { kind: 'caregiver', origin: row.origin ?? 'posted-job', state: row.state },
      { type: 'caregiver-accept' },
    );
    if (!res.ok) return c.json({ error: 'not_acceptable', reason: res.reason }, 409);

    const now = new Date();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('bookings')
        .set({ state: 'accepted', accepted_at: now, updated_at: now })
        .where('id', '=', row.id)
        .execute();
      await notify(trx, row.parent_uid, 'booking_accepted', row.id, { bookingId: row.id });
    });
    return c.json({ id: row.id, state: 'accepted' as const }, 200);
  });

  // ── POST /v1/caregiver/bookings/{bookingId}/decline ─────────────────────────
  app.openapi(declineRoute, async (c) => {
    const { db, stripe } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');

    const caregiver = await loadCaregiverByUid(db, principal.uid);
    if (!caregiver) return c.json({ error: 'booking_not_found' }, 404);
    const row = await loadOwnedBooking(db, bookingId, caregiver.id);
    if (!row) return c.json({ error: 'booking_not_found' }, 404);

    const res = transitionBooking(
      { kind: 'caregiver', origin: row.origin ?? 'posted-job', state: row.state },
      { type: 'caregiver-decline' },
    );
    if (!res.ok) return c.json({ error: 'not_declinable', reason: res.reason }, 409);

    // Release any authorization hold (a `scheduled` Booking with no PI is a no-op).
    const { patch } = await releaseBookingHold(stripe, {
      bookingId: row.id,
      paymentIntentId: row.payment_intent_id,
      paymentStatus: (row.payment_status as BookingPaymentStatus | null) ?? null,
      authorizedAmountCents: row.authorized_amount_cents,
    });
    const now = new Date();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('bookings')
        .set({ state: 'declined', ...patch, updated_at: now })
        .where('id', '=', row.id)
        .execute();
      await notify(trx, row.parent_uid, 'booking_declined', row.id, { bookingId: row.id });
    });
    return c.json({ id: row.id, state: 'declined' as const }, 200);
  });

  // ── POST /v1/caregiver/bookings/{bookingId}/start ───────────────────────────
  app.openapi(startRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');

    const caregiver = await loadCaregiverByUid(db, principal.uid);
    if (!caregiver) return c.json({ error: 'booking_not_found' }, 404);
    const row = await loadOwnedBooking(db, bookingId, caregiver.id);
    if (!row) return c.json({ error: 'booking_not_found' }, 404);

    const res = transitionBooking(
      { kind: 'caregiver', origin: row.origin ?? 'posted-job', state: row.state },
      { type: 'session-start' },
    );
    if (!res.ok) return c.json({ error: 'not_startable', reason: res.reason }, 409);

    const now = new Date();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('bookings')
        .set({ state: 'in-progress', updated_at: now })
        .where('id', '=', row.id)
        .execute();
      await notify(trx, row.parent_uid, 'booking_session_started', row.id, { bookingId: row.id });
    });
    return c.json({ id: row.id, state: 'in-progress' as const }, 200);
  });

  // ── POST /v1/caregiver/bookings/{bookingId}/propose-hours ───────────────────
  app.openapi(proposeHoursRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');
    const { hours, note } = c.req.valid('json');

    const caregiver = await loadCaregiverByUid(db, principal.uid);
    if (!caregiver) return c.json({ error: 'booking_not_found' }, 404);
    const row = await loadOwnedBooking(db, bookingId, caregiver.id);
    if (!row) return c.json({ error: 'booking_not_found' }, 404);

    const res = transitionBooking(
      { kind: 'caregiver', origin: row.origin ?? 'posted-job', state: row.state },
      { type: 'session-end-propose-hours' },
    );
    if (!res.ok) return c.json({ error: 'not_in_progress', reason: res.reason }, 409);

    // Derive the proposed charge. The booked estimate is `agreed_rate × bookedHours`
    // (+ per-child surcharge, folded into `computed_total_cents`); scale it to the
    // proposed hours, then CAP at the authorized hold — capture can never exceed it.
    const bookedHours = Math.max(0, (row.end_min - row.start_min) / 60);
    const rate = row.agreed_rate_cents ?? 0;
    const bookedTotal = row.computed_total_cents ?? Math.round(rate * bookedHours);
    const scaled =
      bookedHours > 0 ? Math.round((bookedTotal * hours) / bookedHours) : Math.round(rate * hours);
    const cap = row.authorized_amount_cents ?? bookedTotal;
    const proposedAmountCents = Math.max(0, Math.min(scaled, cap));

    const now = new Date();
    const confirmDeadlineAt = new Date(now.getTime() + REVIEW_WINDOW_MS);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('bookings')
        .set({
          state: 'awaiting-confirmation',
          proposed_hours: hours,
          proposed_amount_cents: proposedAmountCents,
          confirm_deadline_at: confirmDeadlineAt,
          updated_at: now,
        })
        .where('id', '=', row.id)
        .execute();
      await notify(trx, row.parent_uid, 'booking_hours_proposed', row.id, {
        bookingId: row.id,
        hours,
        amountCents: proposedAmountCents,
        note: note ?? null,
      });
    });
    return c.json(
      {
        id: row.id,
        state: 'awaiting-confirmation' as const,
        proposedHours: hours,
        proposedAmountCents,
        confirmDeadlineAt: confirmDeadlineAt.toISOString(),
      },
      200,
    );
  });

  // ── POST /v1/caregiver/bookings/{bookingId}/time-change/approve ─────────────
  app.openapi(approveTimeChangeRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');

    const caregiver = await loadCaregiverByUid(db, principal.uid);
    if (!caregiver) return c.json({ error: 'booking_not_found' }, 404);
    const row = await loadOwnedBooking(db, bookingId, caregiver.id);
    if (!row) return c.json({ error: 'booking_not_found' }, 404);

    const res = approveBookingTimeReduction(toAdjustable(row));
    if (!res.ok) return c.json({ error: 'no_pending_change', reason: res.reason }, 409);

    // Apply the shorter window: new endMin + a proportionally re-derived estimate.
    // The hold already covers the (larger) original, so no re-authorize is needed.
    const newHours = res.booking.schedule.durationHours;
    const newEndMin = res.booking.schedule.endMin ?? row.start_min + Math.round(newHours * 60);
    const bookedHours = Math.max(0, (row.end_min - row.start_min) / 60);
    const bookedTotal = row.computed_total_cents ?? 0;
    const newTotal = bookedHours > 0 ? Math.round((bookedTotal * newHours) / bookedHours) : bookedTotal;

    const now = new Date();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('bookings')
        .set({
          end_min: newEndMin,
          computed_total_cents: newTotal,
          pending_time_change_hours: null,          pending_time_change_note: null,
          pending_time_change_requested_at: null,
          updated_at: now,
        })
        .where('id', '=', row.id)
        .execute();
      await notify(trx, row.parent_uid, 'booking_time_change_approved', row.id, {
        bookingId: row.id,
        durationHours: newHours,
      });
    });
    return c.json({ id: row.id, state: row.state }, 200);
  });

  // ── POST /v1/caregiver/bookings/{bookingId}/time-change/decline ─────────────
  app.openapi(declineTimeChangeRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');

    const caregiver = await loadCaregiverByUid(db, principal.uid);
    if (!caregiver) return c.json({ error: 'booking_not_found' }, 404);
    const row = await loadOwnedBooking(db, bookingId, caregiver.id);
    if (!row) return c.json({ error: 'booking_not_found' }, 404);

    const res = declineBookingTimeReduction(toAdjustable(row));
    if (!res.ok) return c.json({ error: 'no_pending_change', reason: res.reason }, 409);

    const now = new Date();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('bookings')
        .set({
          pending_time_change_hours: null,          pending_time_change_note: null,
          pending_time_change_requested_at: null,
          updated_at: now,
        })
        .where('id', '=', row.id)
        .execute();
      await notify(trx, row.parent_uid, 'booking_time_change_declined', row.id, { bookingId: row.id });
    });
    return c.json({ id: row.id, state: row.state }, 200);
  });
}
