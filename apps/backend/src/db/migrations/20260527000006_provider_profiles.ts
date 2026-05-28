import { type Kysely, sql } from 'kysely';

/**
 * Provider public-profile editor surface (OH-109).
 *
 * One row per Provider. Holds everything the Provider edits on the web portal
 * profile builder + availability editor:
 *
 *   - Identity: display_name, headline, bio, languages[], specialty_tags[]
 *   - Photo: photo_object_path (Supabase Storage key — uploaded via signed URL)
 *   - Rate: published_rate_cents (hourly for Caregiver, per-session for Specialist)
 *   - Per-child surcharge_cents (Babysitter/Nanny only — enforced at the API layer)
 *   - Availability: 7-day × 3-band JSONB grid + free-text note ≤200 chars + paused flag
 *   - CDCTC: w10_tax_credit_friendly self-attestation (Babysitter/Nanny only — enforced at the API layer)
 *
 * Per CONTEXT.md § Rate, § Availability, § CDCTC-eligibility.
 *
 * Conditional fields (per-child surcharge, W-10) are enforced in the API
 * handler rather than via DB constraint because they cross to the providers
 * table; an INSERT-time check would require a trigger. The API layer rejects
 * mismatches with HTTP 400.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('provider_profiles')
    .addColumn('provider_id', 'uuid', (c) =>
      c.primaryKey().references('providers.id').onDelete('cascade'),
    )
    .addColumn('display_name', 'text')
    .addColumn('headline', 'text')
    .addColumn('bio', 'text')
    .addColumn('languages', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn('specialty_tags', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn('photo_object_path', 'text')
    .addColumn('published_rate_cents', 'integer')
    .addColumn('per_child_surcharge_cents', 'integer')
    .addColumn('availability_grid', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('availability_note', 'text')
    .addColumn('paused', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('w10_tax_credit_friendly', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('provider_profiles_rate_nonneg', sql`published_rate_cents IS NULL OR published_rate_cents >= 0`)
    .addCheckConstraint(
      'provider_profiles_surcharge_nonneg',
      sql`per_child_surcharge_cents IS NULL OR per_child_surcharge_cents >= 0`,
    )
    .addCheckConstraint(
      'provider_profiles_note_len',
      sql`availability_note IS NULL OR char_length(availability_note) <= 200`,
    )
    .addCheckConstraint(
      'provider_profiles_headline_len',
      sql`headline IS NULL OR char_length(headline) <= 120`,
    )
    .addCheckConstraint(
      'provider_profiles_bio_len',
      sql`bio IS NULL OR char_length(bio) <= 600`,
    )
    .addCheckConstraint(
      'provider_profiles_display_name_len',
      sql`display_name IS NULL OR char_length(display_name) <= 80`,
    )
    .execute();

  await sql`ALTER TABLE public.provider_profiles ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('provider_profiles').execute();
}
