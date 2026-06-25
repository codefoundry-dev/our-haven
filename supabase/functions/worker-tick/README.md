# worker-tick

The serverless background-work substrate for Our Haven (ADR-0019 § Decision 4;
OH-237). One mental model: **due work is rows; a tick processes them.**

Every minute, `pg_cron` + `pg_net` POST to this function, which:

1. **Drains the `notification_outbox`** — claims due rows with
   `FOR UPDATE SKIP LOCKED`, dispatches each, and marks `sent_at` (success) or
   bumps `attempts` + backs off `next_attempt_at` (failure), giving up at
   `max_attempts`. Overlapping ticks skip locked rows, so nothing is sent twice.
2. **Runs every due-row sweep** (`sweeps.ts`) — FCRA screening disposal today;
   Booking 24h-expiry, Session auto-confirm, Offer 72h-expiry and retention land
   here as OH-177 / OH-179 / OH-182 add the `bookings` / `offers` tables and
   their deadline columns.

This replaces `pgmq` + the always-on drain worker. No in-process timers.

## Layout

| File | Role |
|------|------|
| `index.ts` | Deno entrypoint — auth + one `runTick`. The only Deno-coupled file (excluded from the Node typecheck). |
| `tick.ts` | `runTick`: drain then sweeps, each isolated. |
| `outbox.ts` | Drain orchestrator + Kysely `SKIP LOCKED` store + dispatcher seam. |
| `sweeps.ts` | `Sweep` registry; the screening-disposal sweep. |
| `auth.ts` | Constant-time shared-secret check. |
| `db/kysely.ts` | postgres.js + Supavisor (shares `apps/backend` schema). |
| `config/env.ts` | `DATABASE_URL`, `DATABASE_SSL`, `WORKER_TICK_SECRET`. |

The dispatcher in `outbox.ts` is a no-op logger for now — **OH-194** wires the
real channel matrix (Expo Push / VAPID / Resend / Twilio) against that seam.

## Deploy & wire the tick (one-time per environment)

Requires the `notification_outbox` migration and `enable_pg_cron` (pg_cron +
pg_net) migration applied — `npm run migrate:up --workspace=@our-haven/backend`.

```bash
# 1. Deploy the function. --no-verify-jwt: the caller is pg_cron, not a user;
#    the function gates itself on WORKER_TICK_SECRET.
supabase functions deploy worker-tick --no-verify-jwt

# 2. Set the function secret (also need DATABASE_URL if not already a project secret).
supabase secrets set WORKER_TICK_SECRET="<long-random-secret>"

# 3. Tell the cron command where to POST and how to authenticate, via DB GUCs.
#    The enable_pg_cron migration already scheduled the `worker_tick` job; it is
#    a no-op until app.worker_tick_url is set, so this step "arms" it.
```

```sql
-- Run once against the project DB (psql or Supabase SQL editor):
alter database postgres set app.worker_tick_url    = 'https://<project-ref>.supabase.co/functions/v1/worker-tick';
alter database postgres set app.worker_tick_secret = '<the same WORKER_TICK_SECRET>';
-- New settings apply to new sessions; pg_cron picks them up on its next run.
```

> Hardening option: move `app.worker_tick_secret` into Supabase Vault and read
> it via `vault.decrypted_secrets` in the cron command instead of a GUC.

### Verify it is firing

```sql
-- The scheduled job exists and is active:
select jobname, schedule, active from cron.job where jobname = 'worker_tick';

-- Recent runs (every minute):
select status, return_message, start_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'worker_tick')
order by start_time desc limit 5;

-- pg_net responses from the function (expect HTTP 200 with a TickSummary body):
select id, status_code, content from net._http_response order by created desc limit 5;
```

A manual smoke test (mirrors what pg_cron sends):

```bash
curl -sS -X POST 'https://<project-ref>.supabase.co/functions/v1/worker-tick' \
  -H "Authorization: Bearer $WORKER_TICK_SECRET" -H 'Content-Type: application/json' -d '{}'
# → {"ranAt":"…","drain":{"claimed":0,…},"sweeps":[{"name":"screening_disposal","processed":0}]}
```

## Tests

```bash
npm run test:edge        # unit: drain retry/backoff/give-up, SKIP-LOCKED SQL shape, auth, runTick
npm run typecheck:edge
```

The SKIP-LOCKED concurrency guarantee has an integration test
(`outbox.integration.test.ts`) gated on a real Postgres — set
`OUTBOX_IT_DATABASE_URL` to a migrated DB to run it; it is skipped otherwise.
