import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
// Reuse the SINGLE listability definition from Search/supply-profile so a Parent
// can never book a Provider that Search would not surface (a paused / unverified /
// unsubscribed Provider 404s here exactly as it is hidden there).
import { isListable, type ProviderSubRow, type VerificationRow } from './search.ts';
// Cross-tree, Deno-clean domain modules (ADR-0019; explicit-`.ts`). The booking
// LIFECYCLE (born `accepted`, null payment, auto-complete, cancel→release) lives
// in booking-lifecycle; the SLOT lifecycle (open→held→released) in the slot
// scheduler; the Parent subscription GATE in parent-subscription. The handler
// composes the three — no new domain code (OH-177/180/193 already deepened them).
import {
  initialBookingState,
  transitionBooking,
  type BookingState,
} from '../../../../packages/domain/src/booking-lifecycle/index.ts';
import {
  holdSlot,
  isBookable,
  type ConsultationSlot,
  type SlotState,
} from '../../../../packages/domain/src/provider-slot-scheduler/index.ts';
import {
  deriveAccessDecision,
  type StripeSubscriptionStatus,
} from '../../../../packages/domain/src/parent-subscription/index.ts';
import { calculateCancellation } from '../../../../packages/domain/src/cancellation/index.ts';
import { applyCancellationCharge } from '../services/booking-payments.ts';
import {
  buildBookingRatingView,
  completionAnchor,
  loadParentRatingAggregates,
  loadRatingsByBooking,
  type RatingAggregate,
  type RatingDirection,
} from '../services/ratings.ts';
import { RatingAggregateSchema, RatingStatusSchema } from './ratings.ts';

/**
 * Provider consultation booking (OH-203) — CONTEXT.md § Booking (slot-pick,
 * resurrected for the Provider role; ADR-0011); PRD-0001 v1.7 stories 24a, 29,
 * 57b–57d.
 *
 *   POST /v1/supply/{providerId}/consultation-bookings   book an open slot
 *   GET  /v1/bookings                                     the caller's schedule
 *   POST /v1/bookings/{bookingId}/cancel                  cancel + release slot
 *
 * A Parent books one of a listed Provider's **open** consultation slots. The act
 * is the commitment: it creates a per-session Provider Booking born `accepted`
 * with **NULL payment** — no card charge, no payment intent, no Job/Application/
 * Offer (ADR-0011: the clinical tier is a directory, not a payment rail) — and
 * **holds** the slot (`open → held`) atomically. The Booking appears on both the
 * Parent's and the Provider's schedule (`GET /v1/bookings`) and **auto-completes**
 * after the slot end, swept by the minute tick (`bookings.auto_complete_at`).
 * Either party may cancel while it is still `accepted`, which **releases** the
 * held slot back to the Provider.
 *
 * GATE (M3.7): booking is a Parent-Subscription-gated action — the same
 * `deriveAccessDecision` gate the paywall reads (OH-193). A Parent on the free
 * browse account is rejected with 402; the demand-side paywall *UI* that turns
 * that into an upsell is OH-204. The Provider side is gated by the listing
 * Subscription, already folded into `isListable`.
 *
 * Scope: v1 persists only the Provider-consultation Booking slice. The Caregiver
 * hourly/payment tracks (Jobs/Offers → Bookings) land with OH-179's persistence.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('ConsultationBookingError');

const KindEnum = z.enum(['caregiver', 'provider']);
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

/**
 * One Booking as it appears on a schedule, from the VIEWER's perspective. The
 * counterparty is the OTHER party: the Provider for a Parent viewer, the Parent
 * for a Provider viewer.
 */
const BookingSummarySchema = z
  .object({
    id: z.string(),
    kind: KindEnum,
    state: BookingStateEnum,
    /** Whose schedule this is (the authenticated caller's role). */
    viewerRole: z.enum(['parent', 'provider']),
    providerId: z.string(),
    /** The other party's display name (Provider name, or the Parent's name). */
    counterpartyName: z.string().nullable(),
    /** The Provider's specialty when the counterparty is a Provider; else null. */
    counterpartySpecialty: z.string().nullable(),
    /** Slot day, ISO `YYYY-MM-DD`. */
    scheduledDate: z.string(),
    /** Window start/end, minutes-since-midnight (0..1440). */
    startMin: z.number().int(),
    endMin: z.number().int(),
    /** Display-only per-session Rate snapshot, integer cents (null payment). */
    rateCents: z.number().int().nullable(),
    /** When the consultation auto-completes (ISO), or null. */
    autoCompleteAt: z.string().nullable(),
    /** Two-way rating status from the viewer's perspective (OH-214). */
    rating: RatingStatusSchema,
    /** For a Provider viewer, the Parent counterparty's supply-internal standing
     *  (aggregate stars + count); null for a Parent viewer (OH-214). */
    counterpartyRating: RatingAggregateSchema.nullable(),
  })
  .openapi('ConsultationBookingSummary');

const BookRequest = z
  .object({ slotId: z.string().uuid() })
  .openapi('ConsultationBookRequest');

const BookingListResponse = z
  .object({ bookings: z.array(BookingSummarySchema) })
  .openapi('ConsultationBookingList');

const CancelResponse = z
  .object({
    id: z.string(),
    state: BookingStateEnum,
    /** Caregiver cancellations: the applied M2.5 tier + charge/refund split. */
    tier: z.enum(['free', 'half', 'full']).optional(),
    chargeCents: z.number().int().optional(),
    refundCents: z.number().int().optional(),
  })
  .openapi('BookingCancel');

const ProviderIdParam = z.object({
  providerId: z.string().uuid().openapi({ param: { name: 'providerId', in: 'path' } }),
});
const BookingIdParam = z.object({
  bookingId: z.string().uuid().openapi({ param: { name: 'bookingId', in: 'path' } }),
});

/* ── row shapes + helpers ───────────────────────────────────────────────────── */

interface ProviderRow {
  id: string;
  uid: string;
  role: 'caregiver' | 'provider';
  specialty: string | null;
  suspended_at: Date | string | null;
}
interface SlotRow {
  id: string;
  provider_id: string;
  slot_date: Date | string;
  start_min: number;
  end_min: number;
  state: SlotState;
  held_by_booking_id: string | null;
}
interface BookingRow {
  id: string;
  kind: 'caregiver' | 'provider';
  state: BookingState;
  parent_uid: string;
  provider_id: string;
  slot_id: string | null;
  scheduled_date: Date | string;
  start_min: number;
  end_min: number;
  rate_cents: number | null;
  auto_complete_at: Date | string | null;
  confirmed_at: Date | string | null;
  updated_at: Date | string | null;
}

/** The cancel handler additionally reads the caregiver payment columns (OH-211). */
interface CancelBookingRow extends BookingRow {
  origin: 'posted-job' | 'direct-message' | null;
  payment_intent_id: string | null;
  payment_status: string | null;
  authorized_amount_cents: number | null;
  computed_total_cents: number | null;
  commission_bp: number | null;
}

/** Thrown inside the booking transaction when the slot was concurrently taken. */
class SlotUnavailableError extends Error {}

function toDateStr(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * The slot's wall-clock end as an absolute UTC instant — the deadline the
 * auto-complete sweep claims rows by. v1 interprets the slot's date+minute as UTC
 * (the same tz-agnostic simplification slots themselves carry; precise
 * per-Provider timezone is deferred).
 */
function slotEndAtUtc(date: string, endMin: number): Date {
  const parts = date.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  return new Date(Date.UTC(y, m - 1, d, 0, endMin, 0, 0));
}

/** A slot's wall-clock START as a UTC instant (mirror of slotEndAtUtc). */
function slotStartAtUtc(date: string, startMin: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 0, startMin, 0, 0));
}

function toSlot(row: SlotRow): ConsultationSlot {
  return {
    id: row.id,
    date: toDateStr(row.slot_date),
    startMin: row.start_min,
    endMin: row.end_min,
    state: row.state,
    heldByBookingId: row.held_by_booking_id,
  };
}

function fullName(first: string | null, last: string | null): string | null {
  const name = [first, last].filter((p) => p && p.length > 0).join(' ').trim();
  return name.length > 0 ? name : null;
}

async function loadProviderById(db: Db, providerId: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'specialty', 'suspended_at'])
    .where('id', '=', providerId)
    .executeTakeFirst();
  return row ? (row as unknown as ProviderRow) : null;
}

async function loadProviderByUid(db: Db, uid: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'specialty', 'suspended_at'])
    .where('uid', '=', uid)
    .executeTakeFirst();
  return row ? (row as unknown as ProviderRow) : null;
}

const BOOKING_COLUMNS = [
  'id',
  'kind',
  'state',
  'parent_uid',
  'provider_id',
  'slot_id',
  'scheduled_date',
  'start_min',
  'end_min',
  'rate_cents',
  'auto_complete_at',
  'confirmed_at',
  'updated_at',
] as const;

/* ── route definitions ──────────────────────────────────────────────────────── */

const bookRoute = createRoute({
  method: 'post',
  path: '/supply/{providerId}/consultation-bookings',
  tags: ['bookings'],
  summary: 'Book an open consultation slot (off-platform payment) — OH-203',
  description:
    'Books one of a listed Provider\'s OPEN consultation slots. Creates a per-session Provider Booking born `accepted` with NULL payment (no card charge, no payment intent, no Job/Offer) and holds the slot (open → held) atomically. Parent-only and Parent-Subscription-gated (402 on the free browse account). 404 if the Provider is unknown / not listable, or the slot does not belong to them; 409 if the slot is no longer open.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: ProviderIdParam, body: { content: json(BookRequest), required: true } },
  responses: {
    201: { description: 'Booking created', content: json(BookingSummarySchema) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    402: { description: 'No active Parent Subscription — booking gated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (caregiver / provider / admin)', content: json(ErrorResponse) },
    404: { description: 'Provider not found / not listable, or slot not found', content: json(ErrorResponse) },
    409: { description: 'Slot is no longer open', content: json(ErrorResponse) },
  },
});

const listRoute = createRoute({
  method: 'get',
  path: '/bookings',
  tags: ['bookings'],
  summary: "The caller's schedule (their consultation Bookings) — OH-203",
  description:
    'Returns the authenticated caller\'s Bookings — a Parent sees the ones they made; a Provider sees the ones on their calendar — each from the viewer\'s perspective with the counterparty\'s display name. v1 contains only Provider consultations.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'provider'] })] as const,
  responses: {
    200: { description: "The caller's bookings", content: json(BookingListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
  },
});

const cancelRoute = createRoute({
  method: 'post',
  path: '/bookings/{bookingId}/cancel',
  tags: ['bookings'],
  summary: 'Cancel a consultation Booking (releases the held slot) — OH-203',
  description:
    'Cancels a still-`accepted` Provider consultation — Parent (`parent-cancel`) or Provider (`provider-cancel`). NULL payment, so cancellation just releases the held slot (held → released). 404 if the Booking is not the caller\'s; 409 if it is past the cancellable window (already completed/cancelled).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'provider'] })] as const,
  request: { params: BookingIdParam },
  responses: {
    200: { description: 'Booking cancelled', content: json(CancelResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Booking not found (or not the caller\'s)', content: json(ErrorResponse) },
    409: { description: 'Not cancellable from its current state', content: json(ErrorResponse) },
  },
});

/* ── handlers ───────────────────────────────────────────────────────────────── */

export function registerConsultationBookingRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(bookRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { providerId } = c.req.valid('param');
    const { slotId } = c.req.valid('json');

    // The supply member must exist, be a Provider, and be listable — a hidden
    // Provider 404s exactly as Search would omit them (never reveal them).
    const provider = await loadProviderById(db, providerId);
    if (!provider || provider.role !== 'provider') {
      return c.json({ error: 'provider_not_found' }, 404);
    }

    const [profile, ver, sub, parentSub] = await Promise.all([
      db
        .selectFrom('provider_profiles')
        .select(['display_name', 'published_rate_cents'])
        .where('provider_id', '=', provider.id)
        .executeTakeFirst() as Promise<unknown> as Promise<
        { display_name: string | null; published_rate_cents: number | null } | undefined
      >,
      db
        .selectFrom('provider_verifications')
        .select([
          'provider_id',
          'phone_confirmed_at',
          'screening_passed_at',
          'license_verified_at',
          'insurance_verified_at',
          'rejected_at',
        ])
        .where('provider_id', '=', provider.id)
        .executeTakeFirst() as Promise<unknown> as Promise<VerificationRow | undefined>,
      db
        .selectFrom('provider_subscriptions')
        .select(['provider_id', 'status'])
        .where('provider_id', '=', provider.id)
        .executeTakeFirst() as Promise<unknown> as Promise<ProviderSubRow | undefined>,
      db
        .selectFrom('parent_subscriptions')
        .select(['status'])
        .where('uid', '=', principal.uid)
        .executeTakeFirst() as Promise<unknown> as Promise<
        { status: StripeSubscriptionStatus | null } | undefined
      >,
    ]);

    if (!isListable(provider.role, ver, sub, provider.suspended_at)) {
      return c.json({ error: 'provider_not_found' }, 404);
    }

    // Subscription gate (M3.7) — the same gate the paywall reads (OH-193).
    const access = deriveAccessDecision({ status: parentSub?.status ?? null });
    if (!access.entitled) {
      return c.json(
        {
          error: 'subscription_required',
          reason: 'an active Parent Subscription is required to book a consultation',
        },
        402,
      );
    }

    // The slot must belong to this Provider and still be open (domain isBookable).
    const slotRow = (await db
      .selectFrom('provider_slots')
      .select(['id', 'provider_id', 'slot_date', 'start_min', 'end_min', 'state', 'held_by_booking_id'])
      .where('id', '=', slotId)
      .where('provider_id', '=', provider.id)
      .executeTakeFirst()) as SlotRow | undefined;
    if (!slotRow) return c.json({ error: 'slot_not_found' }, 404);

    const slot = toSlot(slotRow);
    if (!isBookable(slot)) {
      return c.json({ error: 'slot_unavailable', reason: 'this slot is no longer open' }, 409);
    }

    const now = new Date();
    const autoCompleteAt = slotEndAtUtc(slot.date, slot.endMin);
    const state = initialBookingState({ kind: 'provider' }); // 'accepted'

    let bookingId: string;
    try {
      bookingId = await db.transaction().execute(async (trx) => {
        const inserted = (await trx
          .insertInto('bookings')
          .values({
            kind: 'provider',
            state,
            parent_uid: principal.uid,
            provider_id: provider.id,
            slot_id: slot.id,
            scheduled_date: slot.date,
            start_min: slot.startMin,
            end_min: slot.endMin,
            rate_cents: profile?.published_rate_cents ?? null,
            auto_complete_at: autoCompleteAt,
          })
          .returning(['id'])
          .executeTakeFirstOrThrow()) as { id: string };

        // Hold the slot — domain validates the transition; the `state = 'open'`
        // WHERE clause is the concurrency guard (a second concurrent booking finds
        // 0 rows → SlotUnavailable → the whole transaction rolls back).
        if (!holdSlot(slot, inserted.id).ok) throw new SlotUnavailableError();
        const held = await trx
          .updateTable('provider_slots')
          .set({ state: 'held', held_by_booking_id: inserted.id, updated_at: now })
          .where('id', '=', slot.id)
          .where('provider_id', '=', provider.id)
          .where('state', '=', 'open')
          .returning(['id'])
          .executeTakeFirst();
        if (!held) throw new SlotUnavailableError();

        return inserted.id;
      });
    } catch (err) {
      if (err instanceof SlotUnavailableError) {
        return c.json({ error: 'slot_unavailable', reason: 'this slot was just taken' }, 409);
      }
      throw err;
    }

    const summary: z.infer<typeof BookingSummarySchema> = {
      id: bookingId,
      kind: 'provider',
      state,
      viewerRole: 'parent',
      providerId: provider.id,
      counterpartyName: profile?.display_name ?? null,
      counterpartySpecialty: provider.specialty,
      scheduledDate: slot.date,
      startMin: slot.startMin,
      endMin: slot.endMin,
      rateCents: profile?.published_rate_cents ?? null,
      autoCompleteAt: autoCompleteAt.toISOString(),
      // A freshly-`accepted` Booking is never completed → the inert rating view.
      rating: buildBookingRatingView({
        state,
        completedAt: null,
        pair: { parentToSupply: null, supplyToParent: null },
        viewerDirection: 'parent-to-supply',
        now,
      }),
      counterpartyRating: null,
    };
    return c.json(summary, 201);
  });

  app.openapi(listRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const viewerRole = principal.role === 'provider' ? 'provider' : 'parent';

    let rows: BookingRow[] = [];
    const nameByKey = new Map<string, string | null>();
    const specialtyByProvider = new Map<string, string | null>();

    if (viewerRole === 'parent') {
      rows = (await db
        .selectFrom('bookings')
        .select(BOOKING_COLUMNS)
        .where('parent_uid', '=', principal.uid)
        .orderBy('scheduled_date', 'desc')
        .orderBy('start_min', 'asc')
        .execute()) as BookingRow[];

      const providerIds = [...new Set(rows.map((r) => r.provider_id))];
      if (providerIds.length > 0) {
        const provs = (await db
          .selectFrom('providers')
          .select(['id', 'specialty'])
          .where('id', 'in', providerIds)
          .execute()) as { id: string; specialty: string | null }[];
        provs.forEach((p) => specialtyByProvider.set(p.id, p.specialty));
        const profs = (await db
          .selectFrom('provider_profiles')
          .select(['provider_id', 'display_name'])
          .where('provider_id', 'in', providerIds)
          .execute()) as { provider_id: string; display_name: string | null }[];
        profs.forEach((p) => nameByKey.set(p.provider_id, p.display_name));
      }
    } else {
      const provider = await loadProviderByUid(db, principal.uid);
      if (!provider) return c.json({ bookings: [] }, 200);

      rows = (await db
        .selectFrom('bookings')
        .select(BOOKING_COLUMNS)
        .where('provider_id', '=', provider.id)
        .orderBy('scheduled_date', 'desc')
        .orderBy('start_min', 'asc')
        .execute()) as BookingRow[];

      const parentUids = [...new Set(rows.map((r) => r.parent_uid))];
      if (parentUids.length > 0) {
        const profs = (await db
          .selectFrom('profiles')
          .select(['id', 'first_name', 'last_name'])
          .where('id', 'in', parentUids)
          .execute()) as { id: string; first_name: string | null; last_name: string | null }[];
        profs.forEach((p) => nameByKey.set(p.id, fullName(p.first_name, p.last_name)));
      }
    }

    // Two-way ratings (OH-214): each Booking's viewer-relative status, plus — for a
    // Provider viewer — the Parent counterparty's supply-internal standing (batched).
    const now = new Date();
    const viewerDirection: RatingDirection =
      viewerRole === 'parent' ? 'parent-to-supply' : 'supply-to-parent';
    const [pairs, parentAggs] = await Promise.all([
      loadRatingsByBooking(db, rows.map((r) => r.id)),
      viewerRole === 'provider'
        ? loadParentRatingAggregates(db, [...new Set(rows.map((r) => r.parent_uid))], now)
        : Promise.resolve(new Map<string, RatingAggregate>()),
    ]);

    const bookings: z.infer<typeof BookingSummarySchema>[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      state: r.state,
      viewerRole,
      providerId: r.provider_id,
      counterpartyName:
        viewerRole === 'parent'
          ? nameByKey.get(r.provider_id) ?? null
          : nameByKey.get(r.parent_uid) ?? null,
      counterpartySpecialty: viewerRole === 'parent' ? specialtyByProvider.get(r.provider_id) ?? null : null,
      scheduledDate: toDateStr(r.scheduled_date),
      startMin: r.start_min,
      endMin: r.end_min,
      rateCents: r.rate_cents,
      autoCompleteAt: r.auto_complete_at != null ? toIso(r.auto_complete_at) : null,
      rating: buildBookingRatingView({
        state: r.state,
        completedAt: completionAnchor(r),
        pair: pairs.get(r.id) ?? { parentToSupply: null, supplyToParent: null },
        viewerDirection,
        now,
      }),
      counterpartyRating:
        viewerRole === 'provider' ? parentAggs.get(r.parent_uid) ?? { averageStars: null, count: 0 } : null,
    }));

    return c.json({ bookings }, 200);
  });

  app.openapi(cancelRoute, async (c) => {
    const { db, stripe } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');

    const row = (await db
      .selectFrom('bookings')
      .select([
        ...BOOKING_COLUMNS,
        'origin',
        'payment_intent_id',
        'payment_status',
        'authorized_amount_cents',
        'computed_total_cents',
        'commission_bp',
      ])
      .where('id', '=', bookingId)
      .executeTakeFirst()) as CancelBookingRow | undefined;
    // 404 (not 403) when it is not the caller's — never reveal another's booking.
    if (!row) return c.json({ error: 'booking_not_found' }, 404);

    const now = new Date();

    // ── Provider consultation — NULL payment; cancel just releases the slot. ────
    if (row.kind === 'provider') {
      let event: 'parent-cancel' | 'provider-cancel';
      if (principal.role === 'parent') {
        if (row.parent_uid !== principal.uid) return c.json({ error: 'booking_not_found' }, 404);
        event = 'parent-cancel';
      } else {
        const provider = await loadProviderByUid(db, principal.uid);
        if (!provider || row.provider_id !== provider.id) {
          return c.json({ error: 'booking_not_found' }, 404);
        }
        event = 'provider-cancel';
      }

      const result = transitionBooking({ kind: 'provider', state: row.state }, { type: event });
      if (!result.ok) return c.json({ error: 'cannot_cancel', reason: result.reason }, 409);
      const next = result.next;
      const releasesSlot = result.sideEffects.some((s) => s.type === 'release-consultation-slot');

      await db.transaction().execute(async (trx) => {
        await trx.updateTable('bookings').set({ state: next, updated_at: now }).where('id', '=', bookingId).execute();
        if (releasesSlot && row.slot_id) {
          await trx
            .updateTable('provider_slots')
            .set({ state: 'released', held_by_booking_id: null, updated_at: now })
            .where('id', '=', row.slot_id)
            .where('state', '=', 'held')
            .execute();
        }
      });

      return c.json({ id: bookingId, state: next }, 200);
    }

    // ── Caregiver Booking — parent-initiated cancel with the M2.5 charge (OH-211). ─
    // Only the Parent cancels via this route (the caregiver-cancel surface is OH-218/219).
    if (principal.role !== 'parent' || row.parent_uid !== principal.uid) {
      return c.json({ error: 'booking_not_found' }, 404);
    }
    const cancelRes = transitionBooking(
      { kind: 'caregiver', origin: row.origin ?? 'posted-job', state: row.state },
      { type: 'parent-cancel' },
    );
    if (!cancelRes.ok) return c.json({ error: 'cannot_cancel', reason: cancelRes.reason }, 409);

    const cancellation = calculateCancellation({
      originalAuthorizedCents: row.authorized_amount_cents ?? row.computed_total_cents ?? 0,
      bookingStartAt: slotStartAtUtc(toDateStr(row.scheduled_date), row.start_min),
      cancellationAt: now,
      cancelledBy: 'parent',
    });
    const { patch } = await applyCancellationCharge(stripe, {
      bookingId: row.id,
      paymentIntentId: row.payment_intent_id,
      cancellation,
      commissionBp: row.commission_bp ?? 0,
    });
    await db
      .updateTable('bookings')
      .set({ state: 'cancelled', cancelled_at: now, ...patch, updated_at: now })
      .where('id', '=', row.id)
      .execute();

    return c.json(
      {
        id: row.id,
        state: 'cancelled' as const,
        tier: cancellation.tier,
        chargeCents: cancellation.chargeCents,
        refundCents: cancellation.refundCents,
      },
      200,
    );
  });
}
