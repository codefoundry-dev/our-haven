import { type Kysely, sql } from 'kysely';

/**
 * Bookings (OH-203) — the persistence the OH-177 booking-lifecycle deep module
 * was waiting for, scoped to the **Provider consultation** slice.
 *
 * A Parent books an open consultation slot (provider-slot-scheduler / OH-189):
 * the act holds the slot and creates a per-session Provider Booking born
 * `accepted`, NULL payment (off-platform, ADR-0011) — no Job/Application/Offer,
 * no payment intent. It auto-completes after the slot end (`auto_complete_at`,
 * the column the minute-tick sweep scans) and shows on both the Parent's and the
 * Provider's schedule.
 *
 * The table is shaped for the full Booking model (the discriminated
 * caregiver|provider `kind` + the nine lifecycle states), but only the
 * `provider` consultation path writes to it in v1. The Caregiver hourly /
 * on-platform-payment columns (origin, Job/Offer refs, payment-intent id, the
 * confirm-hours deadline) land with their owning persistence ticket (OH-179
 * jobs/offers). The slot + Booking LIFECYCLE rules live in the domain
 * (`booking-lifecycle` / `provider-slot-scheduler`); this table is the store the
 * handler reads/writes.
 *
 * `parent_uid` is the Supabase auth user uuid — a Parent is just an auth user
 * (no `parents` table, matching `parent_subscriptions.uid`), so no FK.
 * `provider_id` + `slot_id` FK the supply rows. `auto_complete_at` is the
 * absolute deadline the sweep claims rows by; v1 interprets the slot's
 * wall-clock end as UTC — the same tz-agnostic simplification the slots
 * themselves carry (precise per-Provider timezone is deferred).
 *
 * Pure DDL — no plpgsql (the canary stays green).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('bookings')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // The supply fork (ADR-0011). Only 'provider' is written in v1.
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('state', 'text', (c) => c.notNull())
    // The booking Parent (auth user uuid) — no FK (auth schema is protected).
    .addColumn('parent_uid', 'uuid', (c) => c.notNull())
    .addColumn('provider_id', 'uuid', (c) => c.references('providers.id').onDelete('cascade').notNull())
    // The held consultation slot (provider track). SET NULL so a slot row that is
    // ever removed leaves the historical Booking intact.
    .addColumn('slot_id', 'uuid', (c) => c.references('provider_slots.id').onDelete('set null'))
    // Denormalised slot window so a schedule lists without a join.
    .addColumn('scheduled_date', 'date', (c) => c.notNull())
    .addColumn('start_min', 'integer', (c) => c.notNull())
    .addColumn('end_min', 'integer', (c) => c.notNull())
    // Display-only per-session Rate snapshot — Provider payment is off-platform.
    .addColumn('rate_cents', 'integer')
    // The slot-end deadline the auto-complete sweep scans (provider consultations).
    .addColumn('auto_complete_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('bookings_kind_chk', sql`kind IN ('caregiver','provider')`)
    .addCheckConstraint(
      'bookings_state_chk',
      sql`state IN ('requested','accepted','declined','expired','in-progress','awaiting-confirmation','completed','disputed','cancelled')`,
    )
    .addCheckConstraint(
      'bookings_window_chk',
      sql`start_min >= 0 AND end_min <= 1440 AND start_min < end_min`,
    )
    .execute();

  // The Provider's schedule — their consultation Bookings by day.
  await db.schema
    .createIndex('bookings_provider_idx')
    .on('bookings')
    .columns(['provider_id', 'scheduled_date'])
    .execute();

  // The Parent's schedule — the Bookings they made by day.
  await db.schema
    .createIndex('bookings_parent_idx')
    .on('bookings')
    .columns(['parent_uid', 'scheduled_date'])
    .execute();

  // The minute-tick auto-complete sweep claim (mirrors provider_screenings.purge_at).
  await db.schema
    .createIndex('bookings_auto_complete_idx')
    .on('bookings')
    .column('auto_complete_at')
    .execute();

  await sql`ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('bookings').ifExists().execute();
}
