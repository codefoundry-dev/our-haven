import { type Kysely, sql } from 'kysely';

/**
 * Private Supabase Storage bucket for government-ID uploads (OH-184).
 *
 * Supply members upload a government ID during verification. The bytes are
 * sensitive PII, so the bucket is PRIVATE (`public = false`): objects are only
 * reachable through a signed URL. Uploads are client-direct via a one-time
 * signed upload URL minted server-side by the service-role admin client
 * (POST /v1/uploads/signed-url, supabase/functions/api/routes/uploads.ts);
 * the admin/Trust-&-Safety review queue (OH-195) reads them with a signed
 * download URL. Objects are namespaced `id-doc/<uid>/<uuid>`.
 *
 * No `storage.objects` RLS policies are added: every read/write goes through the
 * service-role admin client (which bypasses RLS) or a scoped signed URL, and no
 * anon/authenticated client is ever given direct bucket access. `id-docs` must
 * match `env.ID_DOC_BUCKET` (config/env.ts).
 *
 * `storage.buckets` is owned by `supabase_storage_admin`; the migration role on a
 * Supabase project (the same role that runs `CREATE EXTENSION` in the pg_cron
 * migration) has insert privileges. If a future environment lacks them, create
 * the bucket out-of-band (Dashboard → Storage, or the Storage admin API) — the
 * `on conflict do nothing` keeps this migration idempotent either way.
 */
const BUCKET_ID = 'id-docs';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    insert into storage.buckets (id, name, public)
    values (${BUCKET_ID}, ${BUCKET_ID}, false)
    on conflict (id) do nothing
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Only removes the bucket row; on a real environment any uploaded objects must
  // be purged first (Storage forbids dropping a non-empty bucket). Safe here
  // because down is a dev/test affordance.
  await sql`delete from storage.buckets where id = ${BUCKET_ID}`.execute(db);
}
