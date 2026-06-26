# worker-tick

The serverless background-work substrate for Our Haven (ADR-0019 § Decision 4;
OH-237). One mental model: **due work is rows; a tick processes them.**

Every minute, `pg_cron` + `pg_net` POST to this function, which:

1. **Drains the `notification_outbox`** — claims due rows with
   `FOR UPDATE SKIP LOCKED`, dispatches each, and marks `sent_at` (success) or
   bumps `attempts` + backs off `next_attempt_at` (failure), giving up at
   `max_attempts`. Overlapping ticks skip locked rows, so nothing is sent twice.
   The dispatch chain is **screening.invite → notifications → logging**: the
   OH-185 screening dispatcher handles its event, the OH-194 notifications
   dispatcher fans every known notification event out to Expo Push / VAPID web
   push / Resend email / Twilio SMS (channel matrix in `@our-haven/domain`
   `notifications/`), and anything unrecognised falls through to the logging no-op.
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
| `dispatchers/screening.ts` | OH-185 `screening.invite` → deferred Checkr call. |
| `dispatchers/notifications.ts` | OH-194 channel fan-out + recipient resolver. |
| `sweeps.ts` | `Sweep` registry; the screening-disposal sweep. |
| `auth.ts` | Constant-time shared-secret check. |
| `db/kysely.ts` | postgres.js + Supavisor (shares `apps/backend` schema). |
| `config/env.ts` | DB + `WORKER_TICK_SECRET` + Checkr + notification vendor secrets. |

The notifications dispatcher (OH-194) is the real channel matrix behind the
dispatcher seam (Expo Push / VAPID / Resend / Twilio). Its vendor secrets are
**all optional** — the function still boots with only DB + secret + Checkr set;
an unconfigured channel is skipped (best-effort), except a missing Twilio makes
the four SMS-mandatory event kinds fail loudly rather than silently drop. The
recipient's email + phone come from `auth.users`; push destinations come from the
`notification_push_tokens` / `notification_web_push_subscriptions` tables (the
app-side registration write path lands with the apps/mobile push-setup ticket).

## Deploy & wire the tick (one-time per environment)

Requires the `notification_outbox` migration and `enable_pg_cron` (pg_cron +
pg_net) migration applied — `npm run migrate:up --workspace=@our-haven/backend`.

```bash
# 1. Deploy the function. --no-verify-jwt: the caller is pg_cron, not a user;
#    the function gates itself on WORKER_TICK_SECRET.
supabase functions deploy worker-tick --no-verify-jwt

# 2. Set the function secret (also need DATABASE_URL if not already a project secret).
supabase secrets set WORKER_TICK_SECRET="<long-random-secret>"

# 3. Store the function URL + shared secret in Supabase Vault. The cron command
#    reads them from vault.decrypted_secrets; the enable_pg_cron migration already
#    scheduled the `worker_tick` job as a no-op until these exist, so this "arms"
#    it. Vault — not `ALTER DATABASE SET` — because the managed `postgres` role is
#    not a superuser and cannot set a custom GUC (permission denied).
```

```sql
-- Run once against the project DB (Supabase SQL editor or psql):
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/worker-tick', 'worker_tick_url',    'worker-tick function URL for the pg_cron tick');
select vault.create_secret('<the same WORKER_TICK_SECRET>',                                'worker_tick_secret', 'shared bearer secret for the worker-tick tick');
-- pg_cron reads these on its next run. Rotate with vault.update_secret(id, ...).
```

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
