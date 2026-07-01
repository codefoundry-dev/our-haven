import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
import {
  buildBookingRatingView,
  completionAnchor,
  insertRating,
  loadRatingsByBooking,
  type BookingRatingPair,
  type RatingDirection,
} from '../services/ratings.ts';
// Cross-tree, Deno-clean domain module (ADR-0019; explicit-`.ts`).
import { isWindowOpen } from '../../../../packages/domain/src/rating-reveal/index.ts';

/**
 * Two-way Ratings (OH-214) — CONTEXT § Rating; PRD-0001 v1.7 stories 35/36/59/60.
 *
 *   POST /v1/bookings/{bookingId}/rating   submit this side's 1–5 star rating (+text)
 *
 * ONE route serves both directions. Which side the caller is rating is derived
 * from their role + relation to the Booking: a Parent rates the supply member
 * (Caregiver/Provider) → a PUBLIC supply rating; the supply member rates the
 * Parent → a supply-internal parent rating. Ratings are BLIND — the reveal +
 * asymmetric display are computed at read time (`services/ratings.ts` over the
 * `rating-reveal` domain module); this route only captures a submission.
 *
 * Guards: the Booking must be `completed`, within the 14-day window, and the
 * caller must not have already rated their side (409 otherwise). The per-Booking
 * rating status returned mirrors what the read surfaces (booking detail, schedule
 * feeds) fold in, so the client can update in place without a refetch.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z.object({ error: z.string(), reason: z.string().optional() }).openapi('RatingError');

// NOTE: intentionally NOT a named `.openapi()` component. zod-openapi bakes a
// `.nullable()` applied to a *registered* schema back into the shared component
// (making it nullable everywhere it is $ref'd), so `mine`/`counterparty` below —
// and `RatingAggregate` — stay plain inline objects that each field nullably
// wraps on its own.
const SubmittedRatingSchema = z.object({
  stars: z.number().int().min(1).max(5),
  text: z.string().nullable(),
});

/**
 * The viewer-relative per-Booking rating status, folded into every surface that
 * shows a Booking (this submit result, the Parent booking detail, the Caregiver
 * schedule feed, the consultation schedule). Shared so the surfaces can't drift.
 */
export const RatingStatusSchema = z
  .object({
    canRate: z.boolean(),
    windowClosesAt: z.string().nullable(),
    mine: SubmittedRatingSchema.nullable(),
    revealed: z.boolean(),
    /** The counterparty's rating of the viewer, once revealed. A Parent viewer sees
     *  `text: null` (supply→parent text is internal). Null before reveal. */
    counterparty: SubmittedRatingSchema.nullable(),
  })
  .openapi('RatingStatus');

/** An aggregate stars + count — the supply-internal "family standing" a supply
 *  member sees next to a Parent (the asymmetric, text-free parent projection).
 *  Plain (not a named component) so a `.nullable()` usage doesn't poison it — see
 *  the SubmittedRating note above. */
export const RatingAggregateSchema = z.object({
  averageStars: z.number().nullable(),
  count: z.number().int(),
});

const SubmitRatingRequest = z
  .object({
    stars: z.number().int().min(1).max(5),
    text: z.string().max(1000).optional(),
  })
  .openapi('SubmitRatingRequest');

const BookingIdParam = z.object({
  bookingId: z.string().uuid().openapi({ param: { name: 'bookingId', in: 'path' } }),
});

/* ── row shape + helpers ───────────────────────────────────────────────────── */

interface BookingRow {
  id: string;
  kind: 'caregiver' | 'provider';
  state: string;
  parent_uid: string;
  provider_id: string;
  confirmed_at: Date | string | null;
  auto_complete_at: Date | string | null;
  updated_at: Date | string | null;
}

async function loadBooking(db: Db, id: string): Promise<BookingRow | null> {
  const row = (await db
    .selectFrom('bookings')
    .select(['id', 'kind', 'state', 'parent_uid', 'provider_id', 'confirmed_at', 'auto_complete_at', 'updated_at'])
    .where('id', '=', id)
    .executeTakeFirst()) as BookingRow | undefined;
  return row ?? null;
}

/** The supply member's auth uid (the notify recipient when a Parent rates them). */
async function providerUid(db: Db, providerId: string): Promise<string | null> {
  const r = (await db
    .selectFrom('providers')
    .select(['uid'])
    .where('id', '=', providerId)
    .executeTakeFirst()) as { uid: string } | undefined;
  return r?.uid ?? null;
}

/** Resolve the caller's `providers.id` (a Caregiver/Provider account), or null. */
async function callerProviderId(db: Db, uid: string): Promise<string | null> {
  const r = (await db
    .selectFrom('providers')
    .select(['id'])
    .where('uid', '=', uid)
    .executeTakeFirst()) as { id: string } | undefined;
  return r?.id ?? null;
}

/* ── route ─────────────────────────────────────────────────────────────────── */

const submitRoute = createRoute({
  method: 'post',
  path: '/bookings/{bookingId}/rating',
  tags: ['ratings'],
  summary: 'Submit this side of a two-way Booking rating — OH-214',
  description:
    "Submits the caller's 1–5 star rating (+ optional text) for a `completed` Booking. Direction is derived from the caller: a Parent rates the supply member (a PUBLIC profile rating); a Caregiver/Provider rates the Parent (a supply-internal, aggregate-only rating). Ratings are BLIND — the mutual reveal happens once both sides submit or the 14-day window closes. 409 when the Booking isn't completed, the window has closed, or the caller already rated their side; 404 when the Booking isn't the caller's.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'caregiver', 'provider'] })] as const,
  request: { params: BookingIdParam, body: { content: json(SubmitRatingRequest), required: true } },
  responses: {
    200: { description: 'Rating submitted', content: json(RatingStatusSchema) },
    400: { description: 'Invalid rating', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Booking not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Not ratable (not completed / window closed / already rated)', content: json(ErrorResponse) },
  },
});

export function registerRatingRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(submitRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { bookingId } = c.req.valid('param');
    const { stars, text } = c.req.valid('json');

    const booking = await loadBooking(db, bookingId);
    if (!booking) return c.json({ error: 'booking_not_found' }, 404);

    // Which side is the caller rating? Derived from role + relation (404 if neither).
    let direction: RatingDirection;
    let subjectProviderId: string | null = null;
    let subjectParentUid: string | null = null;
    let recipientUid: string | null;
    if (principal.role === 'parent') {
      if (booking.parent_uid !== principal.uid) return c.json({ error: 'booking_not_found' }, 404);
      direction = 'parent-to-supply';
      subjectProviderId = booking.provider_id;
      recipientUid = await providerUid(db, booking.provider_id);
    } else {
      const myProviderId = await callerProviderId(db, principal.uid);
      if (!myProviderId || myProviderId !== booking.provider_id) {
        return c.json({ error: 'booking_not_found' }, 404);
      }
      direction = 'supply-to-parent';
      subjectParentUid = booking.parent_uid;
      recipientUid = booking.parent_uid;
    }

    // Only a completed Booking, still inside its 14-day window, is ratable.
    if (booking.state !== 'completed') {
      return c.json({ error: 'not_ratable', reason: 'the booking is not completed' }, 409);
    }
    const completedAt = completionAnchor(booking);
    if (completedAt == null || !isWindowOpen({ completedAt }, new Date())) {
      return c.json({ error: 'not_ratable', reason: 'the 14-day rating window has closed' }, 409);
    }

    // Existing pair — pre-check the caller's side + build the post-insert view.
    const pair: BookingRatingPair =
      (await loadRatingsByBooking(db, [bookingId])).get(bookingId) ??
      { parentToSupply: null, supplyToParent: null };
    const already = direction === 'parent-to-supply' ? pair.parentToSupply : pair.supplyToParent;
    if (already != null) return c.json({ error: 'already_rated', reason: 'you have already rated this booking' }, 409);

    const now = new Date();
    const inserted = await db.transaction().execute(async (trx) => {
      const ok = await insertRating(trx, {
        bookingId,
        direction,
        raterUid: principal.uid,
        subjectProviderId,
        subjectParentUid,
        stars,
        text,
        now,
      });
      // Notify the counterparty their rating window is live (BLIND — no stars).
      if (ok && recipientUid) {
        await trx
          .insertInto('notification_outbox')
          .values({
            recipient_uid: recipientUid,
            event_type: 'booking_rated',
            payload: { bookingId, direction },
            dedupe_key: `booking_rated:${bookingId}:${direction}`,
          })
          .onConflict((oc) => oc.column('dedupe_key').doNothing())
          .execute();
      }
      return ok;
    });
    // Lost a submit race (the unique index caught a concurrent duplicate).
    if (!inserted) return c.json({ error: 'already_rated', reason: 'you have already rated this booking' }, 409);

    // Reflect the just-submitted rating in the returned view.
    const submitted = { stars, text: text ?? null };
    if (direction === 'parent-to-supply') pair.parentToSupply = submitted;
    else pair.supplyToParent = submitted;

    const view = buildBookingRatingView({
      state: booking.state,
      completedAt,
      pair,
      viewerDirection: direction,
      now,
    });
    return c.json(view, 200);
  });
}
