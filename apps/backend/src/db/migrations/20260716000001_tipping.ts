import { type Kysely, sql } from 'kysely';

/**
 * Post-session tipping (OH-215) — PRD-0001 v1.7 stories 126/127; ADR-0018;
 * CONTEXT § Tip.
 *
 * A Tip is an optional Parent gratuity on a **completed Caregiver Booking**
 * (Provider consultations carry no on-platform money — ADR-0011 — so they can
 * never hold one). It is 100% pass-through: a SEPARATE manual-capture
 * destination charge to the Caregiver's Connect account with
 * `application_fee_amount = 0` (no Commission skim), never folded into the
 * engagement PaymentIntent. The tip stays a mutable card hold until it settles
 * (`tip_settle_at`, ~24h after the last edit — the ADR-0018 §3 settlement
 * cut-off): editing cancels the old hold and places a new one, setting `0`
 * cancels and clears. The worker-tick `tip_settle` sweep captures due holds —
 * the capture IS the payout — after which the tip is immutable.
 *
 * Columns live on `bookings` (1:1 with the Booking, same posture as the OH-211
 * payment lifecycle columns). All NULL on a provider consultation / untipped
 * Booking.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('bookings')
    // The current Tip amount, integer cents (> 0). NULL = never tipped / cleared.
    .addColumn('tip_cents', 'integer')
    // The tip's own PaymentIntent (`pi_…`) — a zero-application-fee destination
    // charge, distinct from `payment_intent_id` (the engagement charge).
    .addColumn('tip_payment_intent_id', 'text')
    // requires_action (3DS pending) | authorized (hold placed) | captured
    // (settled — immutable) | failed (declined; the Parent may retry).
    .addColumn('tip_status', 'text')
    // When the sweep captures the hold (~24h after the last edit). NULL once
    // captured / cleared — the sweep's scan column.
    .addColumn('tip_settle_at', 'timestamptz')
    // Settlement stamp — set when the tip captures (the pass-through payout).
    .addColumn('tip_captured_at', 'timestamptz')
    .execute();

  await sql`
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_tip_cents_chk CHECK (tip_cents IS NULL OR tip_cents > 0)
  `.execute(db);
  await sql`
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_tip_status_chk CHECK (
        tip_status IS NULL
        OR tip_status IN ('requires_action','authorized','captured','failed')
      )
  `.execute(db);

  // The tip-settle sweep's claim scan (`tip_settle_at <= now()` on live holds).
  await sql`
    CREATE INDEX bookings_tip_settle_idx
      ON public.bookings (tip_settle_at)
      WHERE tip_settle_at IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS bookings_tip_settle_idx`.execute(db);
  await sql`ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_tip_status_chk`.execute(db);
  await sql`ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_tip_cents_chk`.execute(db);
  await db.schema
    .alterTable('bookings')
    .dropColumn('tip_cents')
    .dropColumn('tip_payment_intent_id')
    .dropColumn('tip_status')
    .dropColumn('tip_settle_at')
    .dropColumn('tip_captured_at')
    .execute();
}
