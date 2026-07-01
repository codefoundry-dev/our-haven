import { type Kysely, sql } from 'kysely';

/**
 * Booking payment lifecycle (OH-211) — the persistence the real Stripe money
 * lifecycle needs on a Caregiver Booking (PRD-0001 v1.7 stories 28/32/33/34;
 * ADR-0001 / ADR-0013). OH-210 materialised Bookings at Award with **mock
 * payment** (no PaymentIntent, `commissionBp: 0`); OH-211 replaces that with an
 * authorize-at-booking → capture-at-session-end destination charge, a ~24h
 * confirm-hours review window, and cancellation execution.
 *
 * ── What lands here ─────────────────────────────────────────────────────────
 * The `bookings` table (OH-203 base + OH-207 Job-chain columns) had NO payment
 * columns at all. We ADD them, all NULLable so the provider consultation path
 * (null payment — ADR-0011) and any pre-existing rows are untouched:
 *
 *   - the Stripe PaymentIntent handle + its lifecycle status + the authorized /
 *     captured / refunded amounts and the Commission snapshot (rate + cents),
 *   - the Caregiver's session-end hours proposal (set by OH-218/219; capture
 *     falls back to the `computed_total_cents` estimate until then),
 *   - the three deadline columns the worker-tick sweeps scan: `authorize_at`
 *     (lazy authorize for far-future / Series occurrences — avoids card-auth
 *     expiry + huge multi-occurrence holds), `request_expires_at` (the 24h
 *     Caregiver-accept deadline — closes the hole OH-210 flagged), and
 *     `confirm_deadline_at` (the ~24h post-session review window, ADR-0013),
 *   - the confirm/dispute/cancel stamps + the cancellation tier + the dispute
 *     reason/details (self-serve dispute surface, ADR-0013 amended).
 *
 * One Booking = one PaymentIntent (each Series occurrence is an independent
 * Booking with its own payment — CONTEXT § Booking Series), so no separate
 * payments/ledger table is needed in v1.
 *
 * Pure DDL + partial indexes — no stored routine, so the plpgsql canary
 * (check-no-plpgsql.ts) stays green. RLS is already enabled on `bookings`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('bookings')
    // ── Stripe PaymentIntent (the destination charge) ─────────────────────────
    // The manual-capture PI id (`pi_…`). NULL on a provider consultation and on a
    // caregiver Booking still awaiting its lazy authorize (`payment_status='scheduled'`).
    .addColumn('payment_intent_id', 'text')
    // The PI lifecycle as the platform tracks it (a projection of Stripe's status
    // + our 'scheduled' pre-authorize state). NULL for provider consultations.
    .addColumn('payment_status', 'text')
    // Amounts, integer cents. `authorized` = the held total; `captured` = what the
    // Parent was actually charged at session end (≤ authorized after a partial
    // capture); `refunded` = returned to the Parent (rare captured-then-refund path).
    .addColumn('authorized_amount_cents', 'integer')
    .addColumn('captured_amount_cents', 'integer')
    .addColumn('refunded_amount_cents', 'integer')
    // Commission snapshot at authorize time (basis points + the cents skim on the
    // authorized total) — the destination charge's application_fee. Tips are
    // commission-exempt and never flow through here (ADR-0018).
    .addColumn('commission_bp', 'integer')
    .addColumn('commission_cents', 'integer')
    // The Caregiver's session-end hours proposal (session-end-propose-hours,
    // OH-218/219). Until that lands, capture uses the booked `computed_total_cents`.
    .addColumn('proposed_hours', 'numeric')
    .addColumn('proposed_amount_cents', 'integer')
    // ── Deadline columns the worker-tick sweeps scan ──────────────────────────
    // Lazy-authorize deadline: a Booking born 'scheduled' is authorized off-session
    // ~48h before its start (far-future one-offs + every Series occurrence).
    .addColumn('authorize_at', 'timestamptz')
    // The 24h Caregiver-accept window on a 'requested' (posted-Job award) Booking;
    // on expiry the request auto-declines and the authorization hold is released.
    .addColumn('request_expires_at', 'timestamptz')
    // The ~24h post-session review window (ADR-0013): set on entry to
    // 'awaiting-confirmation'; on lapse with no dispute the Booking auto-confirms,
    // captures, and releases the payout.
    .addColumn('confirm_deadline_at', 'timestamptz')
    // ── Confirm / dispute / cancel stamps ─────────────────────────────────────
    .addColumn('confirmed_at', 'timestamptz')
    .addColumn('disputed_at', 'timestamptz')
    .addColumn('cancelled_at', 'timestamptz')
    // Which cancellation tier the calculator applied (free ≥24h / half <24h /
    // full <2h-or-after) — snapshotted for the receipt + audit.
    .addColumn('cancellation_tier', 'text')
    // Self-serve dispute record (ADR-0013 amended): reason chip + free text. The
    // *consequence* is state-dependent (in-window hold vs admin escalation) and is
    // decided at the handler, not here.
    .addColumn('dispute_reason', 'text')
    .addColumn('dispute_details', 'text')
    // Last Stripe failure message surfaced to the Parent (declined card, etc.).
    .addColumn('payment_error', 'text')
    .execute();

  await sql`
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_payment_status_chk
      CHECK (
        payment_status IS NULL OR payment_status IN (
          'scheduled','requires_action','authorized','captured','canceled','refunded','failed'
        )
      )
  `.execute(db);

  await sql`
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_cancellation_tier_chk
      CHECK (cancellation_tier IS NULL OR cancellation_tier IN ('free','half','full'))
  `.execute(db);

  // ── Partial deadline indexes (one per sweep) ────────────────────────────────
  // Each sweep scans a single deadline column filtered to the state it acts on,
  // so the indexes are partial + tiny (only rows still awaiting the deadline).
  await sql`
    CREATE INDEX bookings_authorize_due_idx
      ON public.bookings (authorize_at)
      WHERE payment_status = 'scheduled'
  `.execute(db);
  await sql`
    CREATE INDEX bookings_request_expiry_idx
      ON public.bookings (request_expires_at)
      WHERE state = 'requested'
  `.execute(db);
  await sql`
    CREATE INDEX bookings_confirm_deadline_idx
      ON public.bookings (confirm_deadline_at)
      WHERE state = 'awaiting-confirmation'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('bookings_authorize_due_idx').ifExists().execute();
  await db.schema.dropIndex('bookings_request_expiry_idx').ifExists().execute();
  await db.schema.dropIndex('bookings_confirm_deadline_idx').ifExists().execute();
  await sql`ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_chk`.execute(
    db,
  );
  await sql`ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_cancellation_tier_chk`.execute(
    db,
  );
  for (const col of [
    'payment_intent_id',
    'payment_status',
    'authorized_amount_cents',
    'captured_amount_cents',
    'refunded_amount_cents',
    'commission_bp',
    'commission_cents',
    'proposed_hours',
    'proposed_amount_cents',
    'authorize_at',
    'request_expires_at',
    'confirm_deadline_at',
    'confirmed_at',
    'disputed_at',
    'cancelled_at',
    'cancellation_tier',
    'dispute_reason',
    'dispute_details',
    'payment_error',
  ]) {
    await db.schema.alterTable('bookings').dropColumn(col).execute();
  }
}
