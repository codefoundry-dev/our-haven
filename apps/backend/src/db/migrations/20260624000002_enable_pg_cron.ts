import { type Kysely, sql } from 'kysely';

import { CRON_JOBS } from '../../jobs/cron.js';

/**
 * Enable pg_cron + pg_net and schedule the periodic-job catalog (OH-237;
 * ADR-0019 § Decision 4).
 *
 * Periodic work runs in-database via pg_cron — never in-process timers, since
 * Edge isolates are ephemeral and post-response work is not durable. pg_cron
 * cannot call application code, so each catalog job's `command` is a `pg_net`
 * HTTP POST to the `worker-tick` Edge Function, which drains the
 * notification_outbox and runs the due-row sweeps. pg_cron + pg_net are
 * schedule + transport (the plpgsql-canary carve-out) — no domain logic here.
 *
 * On Supabase both extensions are available from the catalog (pg_cron is
 * preloaded via shared_preload_libraries). Locally they must be present on the
 * Postgres image, or run against `supabase start`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_cron CASCADE`.execute(db);
  await sql`CREATE EXTENSION IF NOT EXISTS pg_net CASCADE`.execute(db);

  for (const job of CRON_JOBS) {
    // cron.schedule(name, schedule, command) upserts by name — idempotent.
    await sql`SELECT cron.schedule(${job.name}, ${job.schedule}, ${job.command})`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const job of CRON_JOBS) {
    // Unschedule by id for any rows matching the name — no-op if absent.
    await sql`SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ${job.name}`.execute(db);
  }
  // Keep the extensions installed — other jobs in the cluster may depend on them.
}
