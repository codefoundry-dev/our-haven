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
 * The function URL + shared secret are environment-specific and read at run time
 * from **Supabase Vault** (`vault.decrypted_secrets`), set per-environment at
 * deploy (see `supabase/functions/worker-tick/README.md`). Vault — not a custom
 * GUC — because Supabase's managed `postgres` role is not a superuser and cannot
 * `ALTER DATABASE … SET` a custom parameter (permission denied). Keeping the
 * values in Vault also keeps this catalog free of project refs, and the WHERE
 * guard makes the job a safe no-op until the secrets are created.
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

/** Supabase Vault secret names holding the deploy-time function URL + shared
 *  secret. `vault.create_secret(value, name, …)` sets them; the cron command
 *  reads them via `vault.decrypted_secrets`. */
export const WORKER_TICK_URL_SECRET_NAME = 'worker_tick_url';
export const WORKER_TICK_SECRET_SECRET_NAME = 'worker_tick_secret';

/**
 * The minute tick. The WHERE guard means the job is a harmless no-op until both
 * Vault secrets exist, so the migration applies cleanly in every environment
 * (local, CI, staging) without a configured function URL.
 */
export function workerTickJob(): CronJob {
  return {
    name: 'worker_tick',
    schedule: WORKER_TICK_SCHEDULE,
    command: `select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = '${WORKER_TICK_URL_SECRET_NAME}'),
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${WORKER_TICK_SECRET_SECRET_NAME}')
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 5000
)
where exists (select 1 from vault.decrypted_secrets where name = '${WORKER_TICK_URL_SECRET_NAME}')
  and exists (select 1 from vault.decrypted_secrets where name = '${WORKER_TICK_SECRET_SECRET_NAME}')`,
  };
}

/** Every periodic job the platform installs. The enable_pg_cron migration
 *  schedules each of these. */
export const CRON_JOBS: readonly CronJob[] = [workerTickJob()];
