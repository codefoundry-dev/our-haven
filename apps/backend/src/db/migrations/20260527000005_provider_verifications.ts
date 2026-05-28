import { type Kysely, sql } from 'kysely';

/**
 * Provider verification facts — one row per Provider. Drives the pure-TS
 * Verification workflow state machine (`@our-haven/domain` →
 * `computeVerificationState`). Each column is a result timestamp; nullable =
 * step not satisfied. The state machine reads these and never mutates them.
 *
 * Per OH-105 (state machine) + OH-106 (Checkr) + OH-107 (license boards):
 *   - email/phone confirmations come from Supabase Auth (mirrored here)
 *   - id_doc_object_path is set when client confirms a Supabase Storage upload
 *   - screening_*_at columns updated by the Checkr webhook handler (OH-106)
 *   - license_verified_at set by admin after license-board lookup (OH-107)
 *   - rejected_at is terminal (admin or Checkr-fail driven)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('provider_verifications')
    .addColumn('provider_id', 'uuid', (c) =>
      c.primaryKey().references('providers.id').onDelete('cascade'),
    )
    .addColumn('email_confirmed_at', 'timestamptz')
    .addColumn('phone_confirmed_at', 'timestamptz')
    .addColumn('id_doc_object_path', 'text')
    .addColumn('id_doc_uploaded_at', 'timestamptz')
    .addColumn('screening_initiated_at', 'timestamptz')
    .addColumn('screening_passed_at', 'timestamptz')
    .addColumn('license_verified_at', 'timestamptz')
    .addColumn('rejected_at', 'timestamptz')
    .addColumn('rejection_reason', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`ALTER TABLE public.provider_verifications ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('provider_verifications').execute();
}
