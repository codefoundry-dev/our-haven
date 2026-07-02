import type { Db } from '../db/kysely.ts';
// Cross-tree, Deno-clean domain module (ADR-0019; explicit-`.ts`). The blind
// mutual-reveal rules + asymmetric projections live in the pure domain; this
// service is only the persistence + the viewer-relative presentation glue.
import {
  isRevealed,
  isWindowOpen,
  projectParentRatingForSupply,
  projectPublicSupplyRating,
  windowClosesAt,
  type PublicSupplyRatingDisplay,
  type RatingExchange,
} from '../../../../packages/domain/src/rating-reveal/index.ts';

/**
 * Two-way Ratings persistence + presentation (OH-214; CONTEXT § Rating).
 *
 * The `rating-reveal` deep module (OH-180) already encodes every rule — the
 * 14-day window, the blind mutual reveal, the asymmetric public-vs-internal
 * projections, and dispute-withholding. This service:
 *   - snapshots a submitted rating into `ratings` (one row per Booking×direction),
 *   - projects a single Booking into the viewer-relative reveal state that drives
 *     each side's "Rate / You rated / their rating" surface, and
 *   - aggregates the two directions into the public per-supply profile Rating and
 *     the supply-internal per-parent "family standing".
 *
 * The 14-day window anchor is NOT stored on the rating — it is the Booking's
 * completion instant, derived at read time as `confirmed_at ?? auto_complete_at`
 * (a Caregiver Booking stamps `confirmed_at`; a Provider consultation only has
 * `auto_complete_at`).
 */

export type RatingDirection = 'parent-to-supply' | 'supply-to-parent';

/** A submitted rating as it crosses the wire (no submittedAt — reveal is
 *  presence + window only). */
export interface SubmittedRating {
  stars: number;
  text: string | null;
}

/** Both directions of one Booking's exchange, either side possibly absent. */
export interface BookingRatingPair {
  parentToSupply: SubmittedRating | null;
  supplyToParent: SubmittedRating | null;
}

/** The viewer-relative per-Booking rating status the client renders. */
export interface RatingStatusView {
  /** The viewer may still submit their side (completed + window open + not yet rated). */
  canRate: boolean;
  /** When the 14-day window closes (ISO), or null when the Booking isn't completed. */
  windowClosesAt: string | null;
  /** What the viewer submitted, or null. */
  mine: SubmittedRating | null;
  /** Both sides submitted OR the window closed — the blind veil is lifted. */
  revealed: boolean;
  /** The counterparty's rating OF the viewer, once revealed. A Parent viewer sees
   *  stars only (supply→parent text is internal); a supply viewer sees the full
   *  (public) parent→supply rating. Null before reveal. */
  counterparty: SubmittedRating | null;
}

/** An aggregate stars + count (the public profile Rating header, or the
 *  supply-internal parent standing). */
export interface RatingAggregate {
  averageStars: number | null;
  count: number;
}

/* ── completion anchor ────────────────────────────────────────────────────── */

interface CompletionAnchorRow {
  confirmed_at: Date | string | null;
  auto_complete_at: Date | string | null;
  updated_at?: Date | string | null;
}

/** The Booking's completion instant — the 14-day window anchor. Caregiver Bookings
 *  stamp `confirmed_at`; Provider consultations carry `auto_complete_at`. */
export function completionAnchor(row: CompletionAnchorRow): Date | null {
  const v = row.confirmed_at ?? row.auto_complete_at ?? row.updated_at ?? null;
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v);
}

/* ── pure per-Booking view ────────────────────────────────────────────────── */

export interface BookingRatingViewInput {
  state: string;
  /** From {@link completionAnchor}. */
  completedAt: Date | null;
  pair: BookingRatingPair;
  viewerDirection: RatingDirection;
  now: Date;
}

/** A placeholder submit-time — `isRevealed` / `revealExchange` key only on
 *  presence + the window, never on when a side submitted. */
function toExchange(input: BookingRatingViewInput): RatingExchange {
  const at = input.completedAt ?? new Date(0);
  return {
    completedAt: at,
    parentToSupply: input.pair.parentToSupply
      ? { stars: input.pair.parentToSupply.stars, text: input.pair.parentToSupply.text ?? undefined, submittedAt: at }
      : undefined,
    supplyToParent: input.pair.supplyToParent
      ? { stars: input.pair.supplyToParent.stars, text: input.pair.supplyToParent.text ?? undefined, submittedAt: at }
      : undefined,
  };
}

/**
 * Project one Booking into the viewer's rating status. Only a `completed` Booking
 * carries an exchange; anything else is an inert "cannot rate" view.
 */
export function buildBookingRatingView(input: BookingRatingViewInput): RatingStatusView {
  if (input.state !== 'completed' || input.completedAt == null) {
    return { canRate: false, windowClosesAt: null, mine: null, revealed: false, counterparty: null };
  }
  const exchange = toExchange(input);
  const mine = input.viewerDirection === 'parent-to-supply' ? input.pair.parentToSupply : input.pair.supplyToParent;
  const other = input.viewerDirection === 'parent-to-supply' ? input.pair.supplyToParent : input.pair.parentToSupply;
  const revealed = isRevealed(exchange, input.now);
  const windowOpen = isWindowOpen(exchange, input.now);

  let counterparty: SubmittedRating | null = null;
  if (revealed && other) {
    // A Parent never sees the supply→parent free text (internal to admin/ranking).
    counterparty =
      input.viewerDirection === 'parent-to-supply'
        ? { stars: other.stars, text: null }
        : { stars: other.stars, text: other.text };
  }

  return {
    canRate: windowOpen && mine == null,
    windowClosesAt: windowClosesAt(input.completedAt).toISOString(),
    mine,
    revealed,
    counterparty,
  };
}

/* ── persistence ──────────────────────────────────────────────────────────── */

interface RatingRow {
  booking_id: string;
  direction: RatingDirection;
  stars: number;
  text: string | null;
}

/** Load both directions of a set of Bookings' ratings, keyed by booking id. Every
 *  requested id is present in the map (empty pair when unrated). */
export async function loadRatingsByBooking(
  db: Db,
  bookingIds: readonly string[],
): Promise<Map<string, BookingRatingPair>> {
  const byBooking = new Map<string, BookingRatingPair>();
  for (const id of bookingIds) byBooking.set(id, { parentToSupply: null, supplyToParent: null });
  if (bookingIds.length === 0) return byBooking;

  const rows = (await db
    .selectFrom('ratings')
    .select(['booking_id', 'direction', 'stars', 'text'])
    .where('booking_id', 'in', bookingIds as string[])
    .execute()) as RatingRow[];

  for (const r of rows) {
    const pair = byBooking.get(r.booking_id);
    if (!pair) continue;
    const rating: SubmittedRating = { stars: r.stars, text: r.text };
    if (r.direction === 'parent-to-supply') pair.parentToSupply = rating;
    else pair.supplyToParent = rating;
  }
  return byBooking;
}

export interface InsertRatingInput {
  bookingId: string;
  direction: RatingDirection;
  raterUid: string;
  subjectProviderId: string | null;
  subjectParentUid: string | null;
  stars: number;
  text?: string | null;
  now: Date;
}

/**
 * Insert one direction of a Booking's rating. The `(booking_id, direction)` unique
 * index makes a re-submit a no-op; returns `true` when a row was actually written
 * (so the caller can 409 a duplicate without a race). Pass the surrounding `trx`.
 */
export async function insertRating(trx: Db, input: InsertRatingInput): Promise<boolean> {
  const row = await trx
    .insertInto('ratings')
    .values({
      booking_id: input.bookingId,
      direction: input.direction,
      rater_uid: input.raterUid,
      subject_provider_id: input.subjectProviderId,
      subject_parent_uid: input.subjectParentUid,
      stars: input.stars,
      text: input.text ?? null,
      submitted_at: input.now,
      updated_at: input.now,
    })
    // A duplicate `(booking_id, direction)` is skipped → no row returned → false.
    .onConflict((oc) => oc.columns(['booking_id', 'direction']).doNothing())
    .returning(['id'])
    .executeTakeFirst();
  return row != null;
}

/* ── aggregate projections ────────────────────────────────────────────────── */

interface CompletedBookingRow {
  id: string;
  parent_uid: string;
  confirmed_at: Date | string | null;
  auto_complete_at: Date | string | null;
  updated_at: Date | string | null;
}

/** Build one exchange per completed Booking from its anchor + rating pair. */
function toExchanges(
  bookings: readonly CompletedBookingRow[],
  ratingsByBooking: Map<string, BookingRatingPair>,
  disputeActiveIds: ReadonlySet<string>,
): RatingExchange[] {
  const exchanges: RatingExchange[] = [];
  for (const b of bookings) {
    const at = completionAnchor(b);
    if (at == null) continue;
    const pair = ratingsByBooking.get(b.id) ?? { parentToSupply: null, supplyToParent: null };
    exchanges.push({
      completedAt: at,
      parentToSupply: pair.parentToSupply
        ? { stars: pair.parentToSupply.stars, text: pair.parentToSupply.text ?? undefined, submittedAt: at }
        : undefined,
      supplyToParent: pair.supplyToParent
        ? { stars: pair.supplyToParent.stars, text: pair.supplyToParent.text ?? undefined, submittedAt: at }
        : undefined,
      disputeActive: disputeActiveIds.has(b.id),
    });
  }
  return exchanges;
}

/** The booking ids (from the given set) with a still-open dispute — those
 *  Bookings' PUBLIC ratings are withheld until it resolves. */
async function openDisputeBookingIds(db: Db, bookingIds: readonly string[]): Promise<Set<string>> {
  if (bookingIds.length === 0) return new Set();
  const rows = (await db
    .selectFrom('disputes')
    .select(['subject_id'])
    .where('subject_type', '=', 'booking')
    .where('status', '=', 'open')
    .where('subject_id', 'in', bookingIds as string[])
    .execute()) as { subject_id: string }[];
  return new Set(rows.map((r) => r.subject_id));
}

/**
 * The public profile Rating for a supply member — aggregate + count + full text of
 * every revealed Parent→supply rating, EXCLUDING any tied to a Booking under an
 * active Dispute (the domain `projectPublicSupplyRating` rule).
 */
export async function loadPublicSupplyRating(
  db: Db,
  providerId: string,
  now: Date,
): Promise<PublicSupplyRatingDisplay> {
  const bookings = (await db
    .selectFrom('bookings')
    .select(['id', 'parent_uid', 'confirmed_at', 'auto_complete_at', 'updated_at'])
    .where('provider_id', '=', providerId)
    .where('state', '=', 'completed')
    .execute()) as CompletedBookingRow[];
  if (bookings.length === 0) return projectPublicSupplyRating([], now);

  const ids = bookings.map((b) => b.id);
  const [ratingsByBooking, disputeIds] = await Promise.all([
    loadRatingsByBooking(db, ids),
    openDisputeBookingIds(db, ids),
  ]);
  return projectPublicSupplyRating(toExchanges(bookings, ratingsByBooking, disputeIds), now);
}

/**
 * The supply-internal "family standing" for each Parent — aggregate stars + count
 * of every revealed supply→Parent rating (the text never crosses this surface).
 * Batched: every requested uid is present in the returned map. Dispute-withholding
 * is a PUBLIC rule only, so it does not apply here.
 */
export async function loadParentRatingAggregates(
  db: Db,
  parentUids: readonly string[],
  now: Date,
): Promise<Map<string, RatingAggregate>> {
  const byParent = new Map<string, RatingAggregate>();
  for (const uid of parentUids) byParent.set(uid, { averageStars: null, count: 0 });
  if (parentUids.length === 0) return byParent;

  const bookings = (await db
    .selectFrom('bookings')
    .select(['id', 'parent_uid', 'confirmed_at', 'auto_complete_at', 'updated_at'])
    .where('parent_uid', 'in', parentUids as string[])
    .where('state', '=', 'completed')
    .execute()) as CompletedBookingRow[];
  if (bookings.length === 0) return byParent;

  const ratingsByBooking = await loadRatingsByBooking(db, bookings.map((b) => b.id));

  // Group the Parent's completed Bookings, then project each Parent's exchanges.
  const bookingsByParent = new Map<string, CompletedBookingRow[]>();
  for (const b of bookings) {
    const list = bookingsByParent.get(b.parent_uid) ?? [];
    list.push(b);
    bookingsByParent.set(b.parent_uid, list);
  }
  for (const [uid, list] of bookingsByParent) {
    const exchanges = toExchanges(list, ratingsByBooking, new Set());
    const agg = projectParentRatingForSupply(exchanges, now);
    byParent.set(uid, { averageStars: agg.averageStars, count: agg.count });
  }
  return byParent;
}
