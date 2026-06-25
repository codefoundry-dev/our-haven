import { type Kysely, sql } from 'kysely';

/**
 * Caregiver profile builder extensions (OH-188) — ADR-0015 / ADR-0016 / ADR-0017.
 *
 * The profile builder needs three things the OH-109 `provider_profiles` shape
 * (single Published Rate, no negotiable/ages/behaviour) did not carry:
 *
 *   1. Per-category Published Rate (CONTEXT.md § Rate — a Caregiver publishes an
 *      hourly Rate PER category they offer, with an optional per-child surcharge
 *      on Babysitter / Nanny only). `provider_profiles.published_rate_cents`
 *      stays as the Provider's display-only per-session Rate; Caregiver rates
 *      move to the new per-category table → `provider_category_rates`.
 *
 *   2. The Caregiver Credentials umbrella (CONTEXT.md § Credentials —
 *      type ∈ {title, certification, training}, admin-verified, hidden until
 *      approved). Distinct from `specialist_credentials` (Provider license +
 *      insurance) → `caregiver_credentials`.
 *
 *   3. Three person-level profile fields on `provider_profiles`:
 *      - `negotiable` (ADR-0017, default ON),
 *      - `ages_served` + `behaviour_comfort` (ADR-0015 — both draw from the
 *        shared age-band / Safety-Behaviors taxonomy in @our-haven/shared).
 *
 * Taxonomy membership for `ages_served` / `behaviour_comfort` is enforced at the
 * API layer (the handler runs `normaliseAgeBands` / `normaliseSafetyBehaviors`,
 * dropping unknown tokens) — NOT a DB check, so swapping in Ci'erro's final
 * Safety-Behaviors list (M2.10) needs no migration. The surcharge-eligibility
 * rule (Babysitter / Nanny only) IS a DB check here, mirroring the API guard.
 *
 * Pure DDL — no plpgsql (the canary stays green).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Person-level profile fields on provider_profiles.
  await db.schema
    .alterTable('provider_profiles')
    .addColumn('negotiable', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('ages_served', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn('behaviour_comfort', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'::text[]`))
    .execute();

  // 2. Per-category Published Rate (+ optional per-child surcharge).
  await db.schema
    .createTable('provider_category_rates')
    .addColumn('provider_id', 'uuid', (c) => c.references('providers.id').onDelete('cascade').notNull())
    .addColumn('category', 'text', (c) => c.notNull())
    .addColumn('published_rate_cents', 'integer', (c) => c.notNull())
    .addColumn('per_child_surcharge_cents', 'integer')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('provider_category_rates_pkey', ['provider_id', 'category'])
    .addCheckConstraint(
      'provider_category_rates_category_chk',
      sql`category IN ('babysitter','tutor','nanny')`,
    )
    .addCheckConstraint('provider_category_rates_rate_nonneg', sql`published_rate_cents >= 0`)
    .addCheckConstraint(
      'provider_category_rates_surcharge_nonneg',
      sql`per_child_surcharge_cents IS NULL OR per_child_surcharge_cents >= 0`,
    )
    // Surcharge is Babysitter / Nanny only — Tutor engagements are single-child
    // (CONTEXT.md § Rate). Mirrors the API-layer guard in @our-haven/domain.
    .addCheckConstraint(
      'provider_category_rates_surcharge_eligible',
      sql`per_child_surcharge_cents IS NULL OR category IN ('babysitter','nanny')`,
    )
    .execute();

  await sql`ALTER TABLE public.provider_category_rates ENABLE ROW LEVEL SECURITY`.execute(db);

  // 3. Caregiver Credentials umbrella (title / certification / training).
  await db.schema
    .createTable('caregiver_credentials')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('provider_id', 'uuid', (c) => c.references('providers.id').onDelete('cascade').notNull())
    .addColumn('type', 'text', (c) => c.notNull())
    .addColumn('label', 'text', (c) => c.notNull())
    .addColumn('review_state', 'text', (c) => c.notNull().defaultTo('pending'))
    .addColumn('rejection_reason', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'caregiver_credentials_type_chk',
      sql`type IN ('title','certification','training')`,
    )
    .addCheckConstraint(
      'caregiver_credentials_review_chk',
      sql`review_state IN ('pending','approved','rejected')`,
    )
    .addCheckConstraint('caregiver_credentials_label_len', sql`char_length(label) BETWEEN 1 AND 120`)
    .addCheckConstraint(
      'caregiver_credentials_reason_len',
      sql`rejection_reason IS NULL OR char_length(rejection_reason) <= 2000`,
    )
    .execute();

  await db.schema
    .createIndex('caregiver_credentials_provider_id_idx')
    .on('caregiver_credentials')
    .column('provider_id')
    .execute();

  await sql`ALTER TABLE public.caregiver_credentials ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('caregiver_credentials').ifExists().execute();
  await db.schema.dropTable('provider_category_rates').ifExists().execute();
  await db.schema
    .alterTable('provider_profiles')
    .dropColumn('behaviour_comfort')
    .dropColumn('ages_served')
    .dropColumn('negotiable')
    .execute();
}
