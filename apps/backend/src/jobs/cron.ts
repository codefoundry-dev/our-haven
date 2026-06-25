/**
 * pg_cron periodic-job catalog (OH-237; ADR-0019 § Decision 4).
 *
 * The model is "due work is rows; a tick processes them". A single `worker-tick`
 * Edge Function runs every minute, drains the `notification_outbox`, and runs
 * every due-row sweep — FCRA screening disposal today, plus Booking 24h-expiry,
 * Session auto-confirm, Offer 72h-expiry and retention as their owning tickets
 * (OH-177 / OH-179 / OH-182) add the deadline columns those sweeps scan.
 *
 * pg_cron cannot call application code, so each job's `command` is a `pg_net`
 * HTTP POST to the function. pg_cron + pg_net are schedule + transport — an
 * explicit plpgsql-canary carve-out (ADR-0019), never a home for domain logic.
 *
 * The function URL + shared secret are environment-specific and read at run
 * time from custom GUCs set per-environment at deploy (see
 * `supabase/functions/worker-tick/README.md`), so this catalog stays free of
 * project refs and the job is a safe no-op until they are configured.
 *
 * Intentionally pure (no DB import) so the `enable_pg_cron` migration can import
 * it and it stays unit-testable.
 */

export interface CronJob {
  /** pg_cron job name — stable + unique. pg_cron keys jobs by name, so
   *  re-scheduling the same name replaces the prior definition (idempotent). */
  name: string;
  /** Standard 5-field cron expression, evaluated in UTC. */
  schedule: string;
  /** SQL the scheduler runs in-database. For Our Haven this is a pg_net POST to
   *  the worker-tick function. */
  command: string;
}

/** Every-minute tick. pg_cron is 1-minute granularity and all scheduled work
 *  tolerates ±1 min (ADR-0019 § Consequences). */
export const WORKER_TICK_SCHEDULE = '* * * * *';

/** Custom GUCs holding the deploy-time function URL + shared secret. Namespaced
 *  (class `app`) so they are settable via `ALTER DATABASE … SET` without prior
 *  definition; `current_setting(_, true)` returns NULL when unset, which the
 *  command's WHERE guard turns into a no-op. */
export const WORKER_TICK_URL_SETTING = 'app.worker_tick_url';
export const WORKER_TICK_SECRET_SETTING = 'app.worker_tick_secret';

/**
 * The minute tick. The WHERE guard means the job is a harmless no-op until
 * `app.worker_tick_url` is set at deploy, so the migration applies cleanly in
 * every environment (local, CI, staging) without a configured function URL.
 */
export function workerTickJob(): CronJob {
  return {
    name: 'worker_tick',
    schedule: WORKER_TICK_SCHEDULE,
    command: `select net.http_post(
  url := current_setting('${WORKER_TICK_URL_SETTING}', true),
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || coalesce(current_setting('${WORKER_TICK_SECRET_SETTING}', true), '')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 5000
)
where current_setting('${WORKER_TICK_URL_SETTING}', true) is not null
  and current_setting('${WORKER_TICK_URL_SETTING}', true) <> ''`,
  };
}

/** Every periodic job the platform installs. The enable_pg_cron migration
 *  schedules each of these. */
export const CRON_JOBS: readonly CronJob[] = [workerTickJob()];
