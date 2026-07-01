import { type Kysely, sql } from 'kysely';

/**
 * Adjust booked time (OH-212) — the persistence the Parent adjust-time flow needs
 * on an `accepted`, non-consultation Booking (PRD-0001 v1.7 stories 129/130;
 * ADR-0014 §A3 amendment). The OH-177 `booking-lifecycle` deep module already
 * encodes the pure mechanic (`extendBookingTime` / `requestReduceBookingTime` /
 * `approveBookingTimeReduction` / `declineBookingTimeReduction` /
 * `cancelBookingTimeReductionRequest`); this ticket wires it to the API + UI and
 * needs two additions on `bookings`, both NULLable so every existing row and the
 * provider-consultation path (no adjust-time) are untouched:
 *
 *   1. The transient **`pendingTimeChange`** proposal. Shortening removes paid
 *      hours the Caregiver agreed to, so it does NOT apply immediately — it writes
 *      a proposal the Caregiver later approves/declines (deferred to the
 *      caregiver-session tickets) or the Parent rescinds. It is a sub-state on an
 *      `accepted` Booking, NOT a top-level status: presence of
 *      `pending_time_change_requested_at` means "a shorten is in flight". All
 *      three columns are cleared back to NULL on resolve. (Extending applies
 *      immediately by re-authorizing the larger total, so it needs no proposal
 *      columns — it just mutates `start_min`/`end_min` + the amount in place.)
 *
 *      The domain `PendingTimeChange.proposedEndMin` is derivable from the fixed
 *      `start_min` + `pending_time_change_hours`, so it is not stored.
 *
 *   2. `per_child_surcharge_cents` — the Offer's per-child, per-hour surcharge
 *      snapshot (Babysitter/Nanny; 0 for Tutor), copied onto the Booking at Award.
 *      Adjust-time re-prices the Booking for the new duration via the OH-178
 *      Pricing calculator (`base = rate×hours`, `surcharge = perChild×hours×
 *      (childCount-1)`), and both terms scale with hours — so an exact re-auth
 *      total needs the surcharge rate. It lives on the Offer today; snapshotting
 *      it keeps the re-price self-contained (no Offer join, no coupling to the
 *      Offer's later lifecycle). NULL is read as 0 (pre-OH-212 rows / single-child).
 *
 * Pure DDL — no stored routine, so the plpgsql canary (check-no-plpgsql.ts) stays
 * green. RLS is already enabled on `bookings`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('bookings')
    // ── Pending shorten proposal (transient sub-state on `accepted`) ──────────
    // The proposed NEW duration in hours (numeric — half-hour granularity from the
    // adjust-time sheet). Strictly less than the current duration (a shorten).
    .addColumn('pending_time_change_hours', 'numeric')
    // Optional free-text note the Parent attaches to the shorten request.
    .addColumn('pending_time_change_note', 'text')
    // When the Parent filed the request. Presence = "a shorten is pending".
    .addColumn('pending_time_change_requested_at', 'timestamptz')
    // ── Pricing snapshot for the re-auth re-price ─────────────────────────────
    // The Offer's per-child, per-hour surcharge, snapshotted at Award. NULL ⇒ 0.
    .addColumn('per_child_surcharge_cents', 'integer')
    .execute();

  // Partial index for a future caregiver-facing "pending shorten" queue + so a
  // Parent's booking list can cheaply surface the pending badge. Tiny: only the
  // handful of rows with a shorten in flight.
  await sql`
    CREATE INDEX bookings_pending_time_change_idx
      ON public.bookings (pending_time_change_requested_at)
      WHERE pending_time_change_requested_at IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('bookings_pending_time_change_idx').ifExists().execute();
  for (const col of [
    'pending_time_change_hours',
    'pending_time_change_note',
    'pending_time_change_requested_at',
    'per_child_surcharge_cents',
  ]) {
    await db.schema.alterTable('bookings').dropColumn(col).execute();
  }
}
