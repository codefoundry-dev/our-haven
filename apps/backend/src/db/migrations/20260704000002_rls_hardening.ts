import { type Kysely, sql } from 'kysely';

/**
 * RLS hardening — enable Row Level Security on the four public tables the
 * Supabase linter flagged as exposed to the anon/authenticated PostgREST roles
 * with RLS OFF (lint 0013_rls_disabled_in_public, ERROR / "fully exposed to the
 * anon key").
 *
 * All four are written/read ONLY by privileged paths that BYPASS RLS, so there
 * is no live application path to lock out:
 *   - messages               — Supabase Realtime skeleton (OH-174). No client
 *                              subscriber is wired yet; the participant-scoped
 *                              SELECT policy lands with the real DM data model
 *                              (OH-2.13). Until then, service-role only.
 *   - notification_outbox     — enqueued in-transaction by the Edge function and
 *                              drained by the worker-tick (service role); never
 *                              client-facing.
 *   - kysely_migration        — the migration ledger; written by the migrator,
 *   - kysely_migration_lock     which connects as the table owner (postgres) and
 *                              bypasses RLS.
 *
 * Enabling RLS with NO policy is the correct secure default: the service role +
 * table owner keep full access while anon/authenticated lose the default
 * PostgREST read/write. This matches the other service-only tables already in
 * this state (providers, provider_*, parent_subscriptions, …) — the ERROR
 * becomes a benign INFO (rls_enabled_no_policy), consistent with its siblings.
 *
 * RLS enable/policy DDL is an explicit plpgsql-canary carve-out (ADR-0019) — no
 * trip, no exception needed.
 */
const TABLES = ['messages', 'notification_outbox', 'kysely_migration', 'kysely_migration_lock'] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of TABLES) {
    await sql`ALTER TABLE ${sql.id('public', table)} ENABLE ROW LEVEL SECURITY`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of TABLES) {
    await sql`ALTER TABLE ${sql.id('public', table)} DISABLE ROW LEVEL SECURITY`.execute(db);
  }
}
