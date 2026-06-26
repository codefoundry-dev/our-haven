import { type Kysely, sql } from 'kysely';

/**
 * Caregiver profile builder — additional public-profile fields (OH-188 follow-up).
 *
 * The web onboarding wizard (cp-web `cp-onboarding` step 2 · Profile basics)
 * surfaces five public-facing profile fields. Three already existed on the OH-109
 * `provider_profiles` row (`languages[]`, `specialty_tags[]`, `photo_object_path`)
 * and just weren't exposed by the OH-188 caregiver-profile API. The remaining two
 * are added here:
 *
 *   - `zip`              — the Caregiver's 5-digit ZIP (search proximity + display).
 *                          Resident *state* already lives on `providers.state`; ZIP
 *                          is finer-grained and profile-level, so it sits here.
 *   - `years_experience` — whole years of childcare/tutoring experience (0–75).
 *
 * Both are API-layer-validated too (zod: `zip` ~ /^\d{5}$/, `years_experience`
 * 0..75) — the DB checks are the backstop, matching the surcharge/rate convention
 * on `provider_profiles`.
 *
 * Also provisions the PUBLIC `avatars` Storage bucket the profile photo lives in.
 * Unlike `id-docs` (private — signed-URL only, sensitive PII), an avatar is shown
 * to Parents in search, so the bucket is PUBLIC: the object is reachable at a
 * stable `/storage/v1/object/public/avatars/<path>` URL with no signing. Uploads
 * are still client-direct via a one-time signed UPLOAD url (the write path needs
 * the service role); the kind prefix is `avatar/<uid>/<uuid>`. Bucket id must
 * match `env.AVATAR_BUCKET`.
 *
 * Pure DDL — no plpgsql (the canary stays green).
 */
const AVATAR_BUCKET = 'avatars';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('provider_profiles')
    .addColumn('zip', 'text')
    .addColumn('years_experience', 'smallint')
    .execute();

  await db.schema
    .alterTable('provider_profiles')
    .addCheckConstraint('provider_profiles_zip_fmt', sql`zip IS NULL OR zip ~ '^[0-9]{5}$'`)
    .execute();

  await db.schema
    .alterTable('provider_profiles')
    .addCheckConstraint(
      'provider_profiles_years_experience_range',
      sql`years_experience IS NULL OR (years_experience >= 0 AND years_experience <= 75)`,
    )
    .execute();

  // Public bucket for profile photos (avatars are shown to Parents in search).
  await sql`
    insert into storage.buckets (id, name, public)
    values (${AVATAR_BUCKET}, ${AVATAR_BUCKET}, true)
    on conflict (id) do nothing
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from storage.buckets where id = ${AVATAR_BUCKET}`.execute(db);
  await db.schema
    .alterTable('provider_profiles')
    .dropConstraint('provider_profiles_years_experience_range')
    .execute();
  await db.schema
    .alterTable('provider_profiles')
    .dropConstraint('provider_profiles_zip_fmt')
    .execute();
  await db.schema
    .alterTable('provider_profiles')
    .dropColumn('years_experience')
    .dropColumn('zip')
    .execute();
}
