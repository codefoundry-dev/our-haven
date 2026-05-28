import { type Kysely, sql } from 'kysely';

/**
 * Provider home-childcare state-registration credential (OH-108).
 *
 * One row per Provider. Optional credential path for **Babysitter / Nanny**
 * Caregivers who operate as a state-licensed home-based childcare program
 * (e.g., FL DCF FCCH, CA DSS Family Child Care Home, TX HHSC Registered
 * Child-Care Home, NY OCFS Family Day Care). On admin approval the Provider
 * gets a "State-registered home childcare" badge on their public profile.
 *
 * Unlike `specialist_credentials` (OH-107) which is wired into
 * `provider_verifications.license_verified_at` and gates activation, this
 * table is **decoupled** from the Verification state machine — the badge is
 * cosmetic / informational and never blocks the Provider's activation.
 *
 * Columns:
 *   - `state_at_upload` — the Provider's resident state captured at upload
 *     time so the badge keeps naming the correct agency even if the Provider
 *     later moves.
 *   - `certificate_doc_object_path` — Supabase Storage key for the uploaded
 *     state registration certificate (signed-URL upload, kind=`state-childcare-registration`).
 *   - `decision` — `verified | rejected | null`. Null while pending or before
 *     upload. Set by Trust & Safety admin after cross-checking the cert
 *     against the surfaced state register URL.
 *
 * Specialists (kind=specialist) and Tutor Caregivers never get a row — the
 * API layer returns HTTP 409 for those provider kinds.
 *
 * Admin manual verification flow is gated to admin role at the API layer.
 * RLS is enabled here for the standard owner-read / admin-write policy split.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('provider_home_childcare_registrations')
    .addColumn('provider_id', 'uuid', (c) =>
      c.primaryKey().references('providers.id').onDelete('cascade'),
    )
    .addColumn('state_at_upload', 'text')
    .addColumn('certificate_doc_object_path', 'text')
    .addColumn('certificate_uploaded_at', 'timestamptz')
    .addColumn('decision', 'text')
    .addColumn('decision_at', 'timestamptz')
    .addColumn('decision_by_admin_uid', 'text')
    .addColumn('decision_notes', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'provider_home_childcare_registrations_decision_chk',
      sql`decision IS NULL OR decision IN ('verified','rejected')`,
    )
    .addCheckConstraint(
      'provider_home_childcare_registrations_notes_len',
      sql`decision_notes IS NULL OR char_length(decision_notes) <= 2000`,
    )
    .execute();

  await sql`ALTER TABLE public.provider_home_childcare_registrations ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('provider_home_childcare_registrations').execute();
}
