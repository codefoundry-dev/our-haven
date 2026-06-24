/**
 * pg_cron periodic-job catalog (OH-174 skeleton; ADR-0010).
 *
 * Periodic work runs in the database via pg_cron — NOT in-process timers,
 * because Fly.io may stop/restart/relocate instances at will. pg_cron is
 * SQL-only and cannot call application code, so each job enqueues a pgmq
 * message that the Node worker drains (see src/jobs/queue.ts + the
 * retention-planner module). The enable_pg_cron migration installs the
 * extension and schedules every job in this catalog, keeping a single tested
 * source of truth for the schedule + command.
 *
 * This module is intentionally pure (no DB import) so it can be unit-tested and
 * imported by the migration without dragging in a connection.
 */

export interface CronJob {
  /** pg_cron job name — stable + unique. pg_cron keys jobs by name, so
   *  re-scheduling the same name replaces the prior definition (idempotent). */
  name: string;
  /** Standard 5-field cron expression, evaluated in UTC. */
  schedule: string;
  /** SQL the scheduler runs in-database. For Our Haven this enqueues a pgmq
   *  message the Node worker drains. */
  command: string;
}

/** Default pgmq queue for retention/erasure work — matches QUEUE_RETENTION
 *  (config/env.ts) and the queue created in the enable_pgmq migration. */
export const RETENTION_QUEUE = 'retention_planner';

/**
 * Daily retention/erasure sweep. Enqueues a `daily_sweep` message that the
 * retention worker drains to run the soft-delete / pseudonymization / FCRA
 * disposal sweeps (OH-2.14). 08:17 UTC — off the top of the hour to avoid the
 * cron thundering herd.
 */
export function retentionSweepJob(queue: string = RETENTION_QUEUE): CronJob {
  return {
    name: 'retention_planner_daily_sweep',
    schedule: '17 8 * * *',
    command: `select pgmq.send('${queue}', '{"kind":"daily_sweep"}'::jsonb)`,
  };
}

/** Every periodic job the platform installs. The enable_pg_cron migration
 *  schedules each of these. */
export const CRON_JOBS: readonly CronJob[] = [retentionSweepJob()];
