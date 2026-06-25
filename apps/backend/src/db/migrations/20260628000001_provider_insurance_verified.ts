import { type Kysely, sql } from 'kysely';

/**
 * Provider liability-insurance verification fact (OH-186).
 *
 * Adds the `insurance_verified_at` timestamp to `provider_verifications`, the
 * last Provider-only column the Verification state machine reads. OH-181's
 * `VerificationFacts.insuranceVerifiedAt` and the `insurance-pending` gate
 * already exist in the domain; OH-184 stubbed this fact as `null` (see
 * supabase/functions/api/routes/verification.ts) and flagged it would "land with
 * OH-186". This migration lands the physical column so the admin manual-verify
 * flow (provider-credentials route) can stamp it, advancing a Provider out of
 * `insurance-pending`.
 *
 * Nullable timestamptz, same shape as the sibling `license_verified_at` column.
 * No default — null means "insurance not yet verified by admin".
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('provider_verifications')
    .addColumn('insurance_verified_at', 'timestamptz')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('provider_verifications')
    .dropColumn('insurance_verified_at')
    .execute();
}
