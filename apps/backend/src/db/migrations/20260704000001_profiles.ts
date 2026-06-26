import { type Kysely, sql } from 'kysely';

/**
 * public.profiles — the queryable user directory (uid → role) the app and admin
 * tools read (the gap reported in the sign-up review). ADR-0011 keeps
 * `app_metadata.role` authoritative for the JWT/RLS; this table is its queryable
 * projection, since auth.users / app_metadata live in the protected `auth`
 * schema and cannot be joined from the public API. Unlike supply roles there is
 * no `parents` table, so before this every Parent was un-listable — profiles
 * gives every account exactly one row, role and all.
 *
 * Every auth user gets a row created synchronously by an AFTER INSERT trigger on
 * auth.users (handle_new_user). Sign-up is a direct `supabase.auth.signUp()`
 * against GoTrue with NO application-server hop, so a TS-orchestrated Kysely
 * write cannot observe the insert — a DB trigger is the only way to mirror it
 * atomically. That is the plpgsql-canary's sanctioned, bounded carve-out
 * (ADR-0019): the trigger is a pure mechanical copy of sign-up metadata with
 * zero business logic, registered as `profiles-mirror`.
 *
 *   intended_role — the sign-up choice (provisional), from user_metadata.
 *   role          — the permanent claimed role; null until POST /auth/role-claim
 *                   sets it (alongside app_metadata.role + the providers row).
 *                   Read coalesce(role, intended_role) for "what flow to show".
 *   state         — resident state (supply roles); set at role-claim, null parent.
 */
// plpgsql-canary-exception: profiles-mirror
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('profiles')
    // The Supabase auth user uuid (auth.users.id). No FK — auth.users lives in
    // the protected auth schema (matches providers.uid / parent_subscriptions.uid).
    .addColumn('id', 'uuid', (c) => c.primaryKey())
    .addColumn('email', 'text')
    .addColumn('first_name', 'text')
    .addColumn('last_name', 'text')
    .addColumn('intended_role', 'text')
    .addColumn('role', 'text')
    .addColumn('state', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'profiles_intended_role_chk',
      sql`intended_role IS NULL OR intended_role IN ('parent','caregiver','provider')`,
    )
    .addCheckConstraint(
      'profiles_role_chk',
      sql`role IS NULL OR role IN ('parent','caregiver','provider','admin')`,
    )
    .execute();

  // Cheap directory scans ("all caregivers", "all parents") filter on role.
  await db.schema.createIndex('profiles_role_idx').on('profiles').column('role').execute();

  // RLS: a signed-in user reads only their own row. Every write is server-side —
  // the SECURITY DEFINER trigger (sign-up) and the service-role Edge role-claim
  // handler — both of which bypass RLS, so no write policy is granted to users.
  await sql`ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`
    CREATE POLICY profiles_select_own ON public.profiles
      FOR SELECT TO authenticated USING (id = auth.uid())
  `.execute(db);

  // handle_new_user — mechanical mirror of a new auth user into public.profiles.
  // SECURITY DEFINER + empty search_path is the Supabase hardening pattern (all
  // names fully-qualified). ON CONFLICT DO NOTHING so a backfilled/duplicate id
  // can never abort the auth.users insert this trigger runs inside.
  await sql`
    CREATE OR REPLACE FUNCTION public.handle_new_user()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
    BEGIN
      INSERT INTO public.profiles (id, email, first_name, last_name, intended_role)
      VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data ->> 'first_name',
        NEW.raw_user_meta_data ->> 'last_name',
        NEW.raw_user_meta_data ->> 'intended_role'
      )
      ON CONFLICT (id) DO NOTHING;
      RETURN NEW;
    END;
    $$
  `.execute(db);

  // The function lives in `public`, so PostgREST would otherwise expose it as an
  // RPC callable by anon/authenticated. It's only ever a trigger; revoke the
  // default PUBLIC grant and hand EXECUTE to just the auth admin role that owns
  // the auth.users insert (closes the SECURITY DEFINER-executable advisory).
  await sql`REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public`.execute(db);
  await sql`REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon`.execute(db);
  await sql`REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated`.execute(db);
  await sql`GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin`.execute(db);

  await sql`
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()
  `.execute(db);

  // Backfill existing auth users (idempotent). app_metadata.role is the permanent
  // role; user_metadata carries the sign-up fields.
  await sql`
    INSERT INTO public.profiles (id, email, first_name, last_name, intended_role, role)
    SELECT
      u.id,
      u.email,
      u.raw_user_meta_data ->> 'first_name',
      u.raw_user_meta_data ->> 'last_name',
      u.raw_user_meta_data ->> 'intended_role',
      u.raw_app_meta_data ->> 'role'
    FROM auth.users u
    ON CONFLICT (id) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users`.execute(db);
  await sql`DROP FUNCTION IF EXISTS public.handle_new_user()`.execute(db);
  await db.schema.dropTable('profiles').ifExists().execute();
}
