import { type Kysely, sql } from 'kysely';

/**
 * Specialist license + insurance credentials (OH-107).
 *
 * One row per Specialist Provider. Captures:
 *   - License doc upload (object path in Supabase Storage) + license number +
 *     issuing state board (`license_board_state`) + uploaded_at timestamp
 *   - Insurance COI upload (optional, but encouraged)
 *   - Admin manual verification decision: 'verified' | 'rejected' + actor +
 *     timestamp + free-text notes (decisioned by Trust & Safety admin)
 *
 * Caregivers (kind=caregiver) never get a row here — Checkr is sufficient.
 *
 * The admin manual verification flow is gated to admin role at the API layer.
 * Per CONTEXT.md § Verification: Specialists in launch-unsupported states
 * route to `holding-state-not-supported` and may still upload — admin records
 * the decision once the per-state adapter ships for that state.
 *
 * Linked to `provider_verifications.license_verified_at` — the verification
 * state machine reads that timestamp; this table is the audit + raw-doc trail.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('specialist_credentials')
    .addColumn('provider_id', 'uuid', (c) =>
      c.primaryKey().references('providers.id').onDelete('cascade'),
    )
    .addColumn('license_board_state', 'text')
    .addColumn('license_number', 'text')
    .addColumn('license_doc_object_path', 'text')
    .addColumn('license_uploaded_at', 'timestamptz')
    .addColumn('insurance_doc_object_path', 'text')
    .addColumn('insurance_uploaded_at', 'timestamptz')
    .addColumn('decision', 'text')
    .addColumn('decision_at', 'timestamptz')
    .addColumn('decision_by_admin_uid', 'text')
    .addColumn('decision_notes', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'specialist_credentials_decision_chk',
      sql`decision IS NULL OR decision IN ('verified','rejected')`,
    )
    .addCheckConstraint(
      'specialist_credentials_license_no_len',
      sql`license_number IS NULL OR char_length(license_number) <= 64`,
    )
    .addCheckConstraint(
      'specialist_credentials_decision_notes_len',
      sql`decision_notes IS NULL OR char_length(decision_notes) <= 2000`,
    )
    .execute();

  await sql`ALTER TABLE public.specialist_credentials ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('specialist_credentials').execute();
}
