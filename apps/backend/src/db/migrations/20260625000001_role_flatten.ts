import { type Kysely, sql } from 'kysely';

/**
 * ADR-0011 role flatten — the `providers` table drops the `Provider`-umbrella
 * `kind` discriminator (`caregiver | specialist`) in favour of the flat supply
 * role (`caregiver | provider`), and the scalar `caregiver_category` becomes a
 * `categories text[]` (a Caregiver picks one or more categories).
 *
 *   kind=caregiver  → role=caregiver, categories[] (was scalar caregiver_category)
 *   kind=specialist → role=provider,  specialty (unchanged)
 *
 * `role` is the only physical store of the supply sub-type on this table; the
 * account-level role still lives in Supabase `app_metadata` (JWT claims).
 * Pure DDL + a data backfill (no plpgsql — the canary stays green).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Drop the constraints that reference the columns we are about to remove.
  await db.schema.alterTable('providers').dropConstraint('providers_kind_chk').execute();
  await db.schema.alterTable('providers').dropConstraint('providers_subtype_chk').execute();

  // New columns, nullable so the backfill can populate them before the
  // not-null + check constraints land.
  await db.schema.alterTable('providers').addColumn('role', 'text').execute();
  await db.schema.alterTable('providers').addColumn('categories', sql`text[]`).execute();

  await sql`
    UPDATE providers
    SET role = CASE kind WHEN 'caregiver' THEN 'caregiver' WHEN 'specialist' THEN 'provider' END,
        categories = CASE
          WHEN caregiver_category IS NOT NULL THEN ARRAY[caregiver_category]
          ELSE NULL
        END
  `.execute(db);

  await db.schema
    .alterTable('providers')
    .alterColumn('role', (c) => c.setNotNull())
    .execute();

  await db.schema.alterTable('providers').dropColumn('kind').execute();
  await db.schema.alterTable('providers').dropColumn('caregiver_category').execute();

  await db.schema
    .alterTable('providers')
    .addCheckConstraint('providers_role_chk', sql`role IN ('caregiver','provider')`)
    .execute();
  await db.schema
    .alterTable('providers')
    .addCheckConstraint(
      'providers_subtype_chk',
      sql`(role = 'caregiver' AND categories IS NOT NULL AND cardinality(categories) > 0 AND specialty IS NULL)
          OR (role = 'provider' AND specialty IS NOT NULL AND categories IS NULL)`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('providers').dropConstraint('providers_role_chk').execute();
  await db.schema.alterTable('providers').dropConstraint('providers_subtype_chk').execute();

  await db.schema.alterTable('providers').addColumn('kind', 'text').execute();
  await db.schema.alterTable('providers').addColumn('caregiver_category', 'text').execute();

  // Best-effort reverse: collapse categories[] back to the first scalar.
  await sql`
    UPDATE providers
    SET kind = CASE role WHEN 'caregiver' THEN 'caregiver' WHEN 'provider' THEN 'specialist' END,
        caregiver_category = CASE
          WHEN role = 'caregiver' AND categories IS NOT NULL THEN categories[1]
          ELSE NULL
        END
  `.execute(db);

  await db.schema
    .alterTable('providers')
    .alterColumn('kind', (c) => c.setNotNull())
    .execute();

  await db.schema.alterTable('providers').dropColumn('role').execute();
  await db.schema.alterTable('providers').dropColumn('categories').execute();

  await db.schema
    .alterTable('providers')
    .addCheckConstraint('providers_kind_chk', sql`kind IN ('caregiver','specialist')`)
    .execute();
  await db.schema
    .alterTable('providers')
    .addCheckConstraint(
      'providers_subtype_chk',
      sql`(kind = 'caregiver' AND caregiver_category IS NOT NULL AND specialty IS NULL)
          OR (kind = 'specialist' AND specialty IS NOT NULL AND caregiver_category IS NULL)`,
    )
    .execute();
}
