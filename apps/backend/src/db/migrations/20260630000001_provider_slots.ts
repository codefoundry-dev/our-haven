import { type Kysely, sql } from 'kysely';

/**
 * Provider consultation slots (OH-189) — the persistence the OH-180
 * `provider-slot-scheduler` deep module was waiting for.
 *
 * A Provider (clinical tier) publishes concrete dated consultation windows
 * (CONTEXT.md § Booking — slot-pick resurrected for the Provider role, ADR-0011).
 * Booking an `open` slot holds it (`held`, stamping the holding Booking id) and
 * backs a per-session Provider Booking; cancellation releases it (`released`).
 * The slot LIFECYCLE + validation rules live in the domain module; this table is
 * the store the handler reads/writes.
 *
 * `held_by_booking_id` is a plain uuid (no FK) — the Booking table is pure-domain
 * for now (no physical table yet), so a constraint would be premature.
 *
 * The window invariant (0 ≤ start < end ≤ 1440) is DB-checked here, mirroring the
 * domain's `isValidWindow`. Overlap rejection (two slots colliding on the same
 * day) is an API-layer guard (`findSlotConflicts`) — not a DB constraint, since
 * range-overlap exclusion needs btree_gist we deliberately avoid in v1.
 *
 * Pure DDL — no plpgsql (the canary stays green).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('provider_slots')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('provider_id', 'uuid', (c) => c.references('providers.id').onDelete('cascade').notNull())
    .addColumn('slot_date', 'date', (c) => c.notNull())
    .addColumn('start_min', 'integer', (c) => c.notNull())
    .addColumn('end_min', 'integer', (c) => c.notNull())
    .addColumn('state', 'text', (c) => c.notNull().defaultTo('open'))
    .addColumn('held_by_booking_id', 'uuid')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('provider_slots_state_chk', sql`state IN ('open','held','released')`)
    .addCheckConstraint(
      'provider_slots_window_chk',
      sql`start_min >= 0 AND end_min <= 1440 AND start_min < end_min`,
    )
    // A held slot must name its holding Booking; open/released must not.
    .addCheckConstraint(
      'provider_slots_held_booking_chk',
      sql`(state = 'held') = (held_by_booking_id IS NOT NULL)`,
    )
    .execute();

  await db.schema
    .createIndex('provider_slots_provider_date_idx')
    .on('provider_slots')
    .columns(['provider_id', 'slot_date'])
    .execute();

  await sql`ALTER TABLE public.provider_slots ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('provider_slots').ifExists().execute();
}
