import { type Kysely, sql } from 'kysely';

import { CRON_JOBS } from '../../jobs/cron.js';

/**
 * Enable pg_cron and schedule the periodic-job catalog (OH-174; ADR-0010).
 *
 * Periodic work runs in-database via pg_cron — never in-process timers, since
 * Fly.io may stop/restart/relocate instances. Each catalog job's `command`
 * enqueues a pgmq message the Node worker drains, so this depends on the
 * enable_pgmq migration (queues created) having run first.
 *
 * On Supabase, pg_cron is available from the extensions catalog and preloaded
 * via shared_preload_libraries. Locally the extension must be present on the
 * Postgres image (or run against `supabase start`) — same caveat as pgmq.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pg_cron CASCADE`.execute(db);

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
  // Keep the extension installed — other jobs in the cluster may depend on it.
}
