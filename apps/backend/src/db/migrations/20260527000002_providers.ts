import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('providers')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('uid', 'text', (c) => c.notNull().unique())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('caregiver_category', 'text')
    .addColumn('specialty', 'text')
    .addColumn('state', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('providers_kind_chk', sql`kind IN ('caregiver','specialist')`)
    .addCheckConstraint(
      'providers_subtype_chk',
      sql`(kind = 'caregiver' AND caregiver_category IS NOT NULL AND specialty IS NULL)
          OR (kind = 'specialist' AND specialty IS NOT NULL AND caregiver_category IS NULL)`,
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('providers').execute();
}
