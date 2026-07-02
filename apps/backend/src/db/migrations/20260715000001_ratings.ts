import { type Kysely, sql } from 'kysely';

/**
 * Two-way Ratings (OH-214) — PRD-0001 v1.7 stories 35/36/59/60; CONTEXT § Rating;
 * the persistence the OH-180 `rating-reveal` deep module was written blind to.
 *
 * A completed Booking may be rated by BOTH parties within a 14-day window: the
 * Parent rates the supply member (Caregiver/Provider) and the supply member rates
 * the Parent. Each side submits BLIND — a rating stays hidden until BOTH sides
 * submit OR the window closes (Airbnb-style mutual reveal). Display is asymmetric:
 * Parent→supply ratings are PUBLIC on the profile (aggregate + count + full text),
 * while supply→Parent ratings surface to supply ONLY as an aggregate (stars +
 * count, never the text). The reveal + projections all live in the pure domain
 * module — this table is just the store.
 *
 *   `ratings` — one row per (Booking, direction). `direction` names who rated
 *   whom; `subject_provider_id` / `subject_parent_uid` denormalise the rated party
 *   (snapshotted from the Booking at submit) so the public per-supply and the
 *   supply-internal per-parent aggregations are single-table index scans. The
 *   14-day window anchor is NOT stored here — it is derived from the Booking's
 *   completion instant (`confirmed_at ?? auto_complete_at`) at read time.
 *
 * Service-role-only (read through the Edge; RLS enabled with no policy — matches
 * `bookings` / `offers` / `disputes`). Pure DDL + raw `sql` for the checks +
 * partial-unique so the plpgsql canary stays green.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('ratings')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // The completed Booking being rated (SET the cascade so ratings die with it).
    .addColumn('booking_id', 'uuid', (c) =>
      c.references('bookings.id').onDelete('cascade').notNull(),
    )
    // Who rated whom. 'parent-to-supply' → a PUBLIC supply rating; 'supply-to-parent'
    // → a supply-internal parent rating (aggregate-only display).
    .addColumn('direction', 'text', (c) => c.notNull())
    // The auth uid of the party who submitted this rating.
    .addColumn('rater_uid', 'uuid', (c) => c.notNull())
    // The rated supply member (providers.id) — set on a 'parent-to-supply' row; the
    // key the public profile aggregation scans. NULL on the other direction.
    .addColumn('subject_provider_id', 'uuid', (c) => c.references('providers.id').onDelete('cascade'))
    // The rated Parent (bare auth uid — no parents table) — set on a 'supply-to-parent'
    // row; the key the supply-internal aggregate scans. NULL on the other direction.
    .addColumn('subject_parent_uid', 'uuid')
    // Integer 1..5 (domain `isValidStars`).
    .addColumn('stars', 'smallint', (c) => c.notNull())
    // Optional free text. Public for a parent→supply rating; internal-only for a
    // supply→parent one (never surfaced to the Parent or to other supply).
    .addColumn('text', 'text')
    .addColumn('submitted_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    ALTER TABLE public.ratings
      ADD CONSTRAINT ratings_direction_chk
      CHECK (direction IN ('parent-to-supply','supply-to-parent'))
  `.execute(db);
  await sql`
    ALTER TABLE public.ratings
      ADD CONSTRAINT ratings_stars_chk CHECK (stars BETWEEN 1 AND 5)
  `.execute(db);
  // The denormalised subject must match the direction: a parent→supply row names a
  // supply subject, a supply→parent row names a parent subject (belt-and-braces).
  await sql`
    ALTER TABLE public.ratings
      ADD CONSTRAINT ratings_subject_chk CHECK (
        (direction = 'parent-to-supply' AND subject_provider_id IS NOT NULL AND subject_parent_uid IS NULL)
        OR
        (direction = 'supply-to-parent' AND subject_parent_uid IS NOT NULL AND subject_provider_id IS NULL)
      )
  `.execute(db);

  // At most one rating per side per Booking — the blind-submit idempotency guard.
  await sql`
    CREATE UNIQUE INDEX ratings_booking_direction_uniq
      ON public.ratings (booking_id, direction)
  `.execute(db);
  // Public per-supply aggregation (profile Ratings).
  await sql`
    CREATE INDEX ratings_subject_provider_idx
      ON public.ratings (subject_provider_id)
      WHERE subject_provider_id IS NOT NULL
  `.execute(db);
  // Supply-internal per-parent aggregation (the "family standing" a supply sees).
  await sql`
    CREATE INDEX ratings_subject_parent_idx
      ON public.ratings (subject_parent_uid)
      WHERE subject_parent_uid IS NOT NULL
  `.execute(db);

  await sql`ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ratings').ifExists().execute();
}
