import { type Kysely, sql } from 'kysely';

/**
 * Lock down PostgREST exposure for tables the backend owns.
 *
 * The anon key is shipped to apps/provider-web, so anything in `public` is
 * reachable at https://<ref>.supabase.co/rest/v1/<table> without RLS. These
 * tables are server-only — the Fastify backend talks to them with the
 * service-role key (which bypasses RLS). Enabling RLS with no policies makes
 * them invisible to anon and authenticated roles.
 *
 * If `providers` later needs direct anon/authenticated access (e.g. browsing
 * provider profiles via PostgREST), add policies in a follow-up migration.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE public.auth_email_otps ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.auth_step_up_grants ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE public.providers DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.auth_step_up_grants DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE public.auth_email_otps DISABLE ROW LEVEL SECURITY`.execute(db);
}
