import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`.execute(db);

  await db.schema
    .createTable('auth_email_otps')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('uid', 'text', (c) => c.notNull())
    .addColumn('email', 'text', (c) => c.notNull())
    .addColumn('code_hash', 'text', (c) => c.notNull())
    .addColumn('salt', 'text', (c) => c.notNull())
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .addColumn('attempts', 'smallint', (c) => c.notNull().defaultTo(0))
    .addColumn('consumed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('auth_email_otps_uid_active_idx')
    .on('auth_email_otps')
    .columns(['uid', 'consumed_at', 'expires_at'])
    .execute();

  await db.schema
    .createTable('auth_step_up_grants')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('uid', 'text', (c) => c.notNull())
    .addColumn('second_factor', 'text', (c) => c.notNull())
    .addColumn('granted_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex('auth_step_up_grants_uid_recent_idx')
    .on('auth_step_up_grants')
    .columns(['uid', 'granted_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('auth_step_up_grants').execute();
  await db.schema.dropTable('auth_email_otps').execute();
}
