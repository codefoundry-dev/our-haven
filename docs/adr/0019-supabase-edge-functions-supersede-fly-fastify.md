# Supabase Edge Functions (Hono fat-function) supersede the Fly.io + Fastify backend of ADR-0010

**Status:** accepted (2026-06-24) — **supersedes ADR-0010 § 5 (background jobs: `pgmq` + `pg_cron`) and § 6 (backend hosting: Fly.io + Fastify)**, **amends ADR-0010 § 8 (webhook posture)**, and **overturns the "Supabase Edge Functions instead of a Fastify backend — Considered and rejected" alternative** recorded in ADR-0010 § Considered alternatives. **ADR-0010 §§ 1–4 and 7 carry forward unchanged** (Supabase Auth, Supabase Postgres, Supabase Realtime, Supabase Storage, Vercel for the web surfaces). **ADR-0004 §§ 2, 3, 8 carry forward**; ADR-0004 § 1's "Fastify" reference is now "Hono" (Node + TypeScript is unchanged; the runtime gains Deno).

## Context

ADR-0010 (2026-05-27) landed the v1 backend as a long-lived **Fastify** process on **Fly.io `iad`**, with `pgmq` + `pg_cron` for background work and a separately-hosted Node worker to drain the queue. In its *Considered alternatives* it explicitly weighed — and rejected — Supabase Edge Functions, for three reasons: (a) the deep modules want a long-lived TS host for expressiveness/testability; (b) step-up MFA is cleaner as one Fastify plugin than duplicated across many functions; (c) the mobile cold-start tax, webhook fan-in centrality, and the OpenAPI-first contract.

We are revisiting that rejection deliberately, with one new driver and three corrections:

- **New driver — operational-surface reduction.** Running Fastify on Fly.io means owning a Dockerfile, a Fly machine (deploy/scale/healthcheck config), *and* a second always-on worker process to drain `pgmq`. Moving the backend onto **Supabase Edge Functions** collapses "the backend" into the same Supabase vendor surface already used for Auth + Postgres + Realtime + Storage. The PIA / Privacy-Policy vendor data-flow inventory loses one vendor (Fly.io).
- **Correction to (c) — cold start.** ADR-0010 argued against a slower serverless model than the one on offer. Supabase Edge Functions are **Deno isolates** (sub-100ms boot), not Lambda-style containers. The real per-invocation cost is establishing the Postgres connection, which the Supavisor pooler absorbs (§ Decision 3).
- **Correction to (a) — testability.** The downgrade ADR-0010 feared applies to *scattered raw `Deno.serve` functions*, not to a single **Hono** app: Hono runs on Node, so `vitest` keeps testing the whole app, and the domain modules stay pure-TS tested exactly as today (§ Decision 1, § Why).
- **Correction to (b) — MFA duplication.** Avoided by the same choice: one fat function = one middleware chain = one step-up-MFA implementation (§ Decision 1).

The discipline that makes this reversible is fixed up front, while the decision is unemotional: **all domain logic stays in `packages/domain` (pure TS); each Edge Function is a thin caller, never a home for rules; the first time correctness forces business logic into `plpgsql` is the pre-agreed switch-trigger** (§ The plpgsql canary). Because the domain is pure TS and the persistence layer is Kysely-over-Postgres in *both* the Edge and the fallback hosting, the escape hatch is **swap the host, keep the DB + domain** — a host redeploy, not a rewrite.

## Decision

1. **Topology — one "fat" Hono Edge Function.** A single Edge Function (`api`) runs a [Hono](https://hono.dev) app that mirrors today's `apps/backend/src/app.ts`: one auth middleware (the `requireAuth` from `plugins/auth.ts`, ported), one error handler, all routes under `/v1`, OpenAPI via `@hono/zod-openapi`. Deployed `--no-verify-jwt` so the app self-verifies per route exactly as Fastify does now (public health/webhooks; JWT-gated everything else). **Not** many small per-resource functions — that is the shape ADR-0010 reason (b) rightly condemned.
2. **Host — Supabase Edge Functions replace Fly.io.** The Fastify process, `Dockerfile`, and `fly.toml` are retired. The function is region-pinned to the Supabase project's region (`us-east-1`); data residency is unchanged. Vercel continues to host the admin web surface (ADR-0010 § 7).
3. **Data plane — Kysely over Supavisor transaction-mode; `supabase-js` quarantined.** All reads/writes go through **Kysely** on a **Supavisor transaction-mode** connection (`postgres.js` driver, `prepare: false`, `DATABASE_URL` repointed to the `:6543` pooler, `pg.Pool`-equivalent `max: 1–2` at module scope for warm-isolate reuse). Atomicity is a **TS-orchestrated `db.transaction()`** — never `plpgsql`. `supabase-js` is the **management-plane** SDK only (Auth admin, Storage signed URLs, Realtime); it is **banned from the data plane**, because PostgREST is single-statement and would force atomic operations into stored procedures.
4. **Background work — drop `pgmq`; deadline-columns + transactional outbox + one tick.** Lifecycle timers (Booking 24h expiry, Session 24h auto-confirm, Dispute-window expiry, Offer 72h expiry, retention disposal, scheduled notifications) become **deadline columns** scanned by `WHERE deadline <= now()`. Event-driven side-effects (notifications) become a **`notification_outbox`** table written **in the same transaction** as the domain change. A single **`worker-tick`** Edge Function, scheduled every minute by **`pg_cron` + `pg_net`**, runs all due sweeps and drains the outbox, claiming rows with `FOR UPDATE SKIP LOCKED`. `pgmq` is removed.
5. **Webhooks — terminate on the fat function.** The three handlers (Stripe screening charge, Stripe Connect `account.updated`, Checkr results) become Hono routes; raw body via `c.req.text()` (the Fastify `addContentTypeParser` hack is dropped); they stay public under `--no-verify-jwt`. Signature verification ports unchanged (the vendor adapters are SDK-free: `fetch` + `URLSearchParams` + `node:crypto` + `Buffer`, all Deno-compatible). The **screening webhook defers its external Checkr call to the outbox/tick** (verify → mark paid + enqueue outbox row in one tx → ack `200`), because Edge isolates are ephemeral and post-response work is not durable. Endpoint URLs are re-registered in the Stripe/Checkr dashboards.
6. **Runtime — Deno.** The Fastify stack (`fastify`, `fastify-plugin`, `fastify-type-provider-zod`, 5× `@fastify/*`, `pino-pretty`) is dropped. `@supabase/supabase-js`, `jose`, `zod`, `kysely`, the domain/shared packages, and the vendor adapters carry over Deno-clean. `pg` is swapped for `postgres.js` (runs on Deno *and* Node, preserving the reverse-migration). The dev/CI toolchain (`vitest`, `tsx` migrations, OpenAPI emit/drift) stays Node-side and is untouched. Module resolution (`@/` aliases + `.js` specifiers) is handled by a `deno.json` import map or an esbuild pre-bundle.
7. **The plpgsql canary governs reversibility** (own section below).

## Why

- **It answers ADR-0010's own objections rather than ignoring them.** Reason (a) testability and reason (b) MFA are both neutralised by the single-fat-Hono-function topology; reason (c) cold-start was argued against the wrong serverless model. The rejection was correct *for the architecture ADR-0010 imagined* (scattered Deno functions); it does not bind the Hono-fat-function architecture.
- **Operational surface shrinks.** No Dockerfile, no Fly machine, no separately-hosted worker. One vendor surface; one deploy (`supabase functions deploy`); one fewer entry in the PIA vendor inventory.
- **The reverse-migration is a host swap, not a rewrite — by construction.** Hono ⇄ Fastify are near-isomorphic, `postgres.js` runs on Node, the domain is pure TS, and the persistence is Kysely on both sides. If the canary trips, `fly deploy` the same Hono app on Node as a long-lived process and keep everything else.
- **The background-work model gets simpler *and* more correct.** Dropping `pgmq` removes an infrastructure layer; the transactional outbox eliminates the dual-write window the planned "enqueue after the write" had.

## The plpgsql canary (switch-trigger)

The pivot is only safe while logic does not leak into the database. The trigger is defined precisely so it neither false-positives (and gets ignored) nor false-negatives (and lets logic accrete one "small" trigger at a time).

**Trips the canary** — correctness/atomicity *forces* write-path domain logic into the database: a `plpgsql` `FUNCTION`, a `TRIGGER` or `RULE` that mutates other tables or enforces a workflow invariant, or a PostgREST **RPC wrapping such a proc** as the only way to get atomicity. In one line: *a TS-orchestrated Kysely transaction can no longer express the operation.*

**Does NOT trip it** (carve-outs, so the canary stays credible):
- Multi-statement `BEGIN/COMMIT` transactions issued by Kysely — the green state, permanently.
- `FOR UPDATE SKIP LOCKED` row-claiming in the tick (concurrency primitive).
- Schema-level integrity in migrations: `CHECK`, `UNIQUE`, FKs, `NOT NULL`, partial indexes, generated columns.
- `pg_cron` + `pg_net` (schedule + transport).
- **RLS as a defense-in-depth backstop** — the API connects as a privileged role and enforces authz in Hono middleware; RLS must never become the *primary* home for domain rules.
- Read-only views for query shaping (no write-path branching).

**Enforcement — `scripts/check-no-plpgsql.ts`** (sibling to `check-openapi-drift.ts`): CI fails if a migration introduces `language plpgsql` / `create function` / `create trigger` / `create rule` without an opt-out comment referencing a registered exception. The canary enforces itself.

**Action on a trip — stop, do not auto-abort.** The first forced case halts the merge and becomes a mandatory ADR checkpoint with an either/or: **(i)** if it is a *mechanical, business-logic-free* atomic op, record it as a single bounded exception in a stored-proc registry and proceed; **(ii)** if it carries business branching, **or** it is the *second* exception, the switch-trigger is met — plan the move back to a long-lived host (**Hono-on-Node**, a host swap per § Why).

## The spike gate

The pivot is **not** committed — and the 14 route modules are **not** ported — until a spike is green: a hello-world Edge Function that (a) opens a Supavisor transaction-mode connection via `postgres.js` + Kysely, (b) runs a two-write `db.transaction()`, and (c) imports one real domain module (`booking-lifecycle`) and executes it. A green spike proves the technical core (transactions + domain import on Deno); a fighting spike is the earliest, cheapest no-go signal.

## Considered alternatives

- **Keep Fastify-on-Fly per ADR-0010.** The status quo; lowest immediate churn. Rejected for the operational-surface and single-vendor reasons above — but retained as the **named fallback** the canary switches *to*.
- **Many small per-resource Edge Functions.** Rejected: duplicates `requireAuth`/step-up-MFA/error-handling/OpenAPI across functions (ADR-0010 reason (b)) and multiplies cold-starts. The fat function is also Supabase's own recommended pattern.
- **Keep `pgmq`; replace the worker with a scheduled drain function.** Viable (smaller delta), but preserves the `pgmq` extension *and* adds `pg_net` indirection. Rejected in favour of deleting the layer (deadline-columns + outbox), which is simpler and transactionally cleaner.
- **`supabase-js` / PostgREST as the data plane.** Rejected hard: PostgREST is single-statement, so the first atomic operation (Direct-Message accept materialising Job + Application + Booking + thread-rebind) would force a `plpgsql` proc — tripping the canary on day one and voiding the bounded-migration promise.

## Consequences

- **Code churn (pre-launch, mostly pre-build):**
  - **New:** `supabase/functions/api/` (Hono app), `supabase/functions/worker-tick/`, `deno.json` import map (or esbuild bundle config), `scripts/check-no-plpgsql.ts`, a `notification_outbox` migration, deadline-column migrations.
  - **Rewritten:** `app.ts` → Hono bootstrap; `plugins/auth.ts` → Hono middleware; the 14 route modules → Hono handlers + `@hono/zod-openapi`; `db/kysely.ts` → `postgres.js` + Supavisor config; `jobs/cron.ts` → the `pg_net` tick schedule (its "the Node worker drains" header is now false); `server.ts` → a thin Deno `serve` entrypoint.
  - **Retired:** `Dockerfile`, `fly.toml`, the Fastify/`pino` deps, the three migrations `enable_pgmq` / `offer_lifecycle_queue` / `pg_cron_retention_jobs` (superseded by deadline-columns + outbox + the `worker-tick` cron), `pg` (→ `postgres.js`).
  - **Unchanged:** `packages/domain/*` (the whole point), `packages/shared/*`, the vendor adapters (`vendors/stripe.ts`, `vendors/checkr.ts`), `scripts/migrate.ts` + migration tooling, `vitest` suites.
- **OpenAPI-first is preserved** via `@hono/zod-openapi`; `check-openapi-drift.ts` carries forward. ADR-0004 § 2 holds.
- **Webhook endpoints re-registered** in the Stripe and Checkr dashboards against the new function URL; screening initiation now lags up to ~1 min behind the charge (durable, acceptable against a minutes-to-days background check).
- **Latency floor:** `pg_cron` is 1-minute granularity; all scheduled jobs tolerate ±1 min. A future need for sub-minute dispatch is a *separate* signal from the plpgsql canary.
- **PIA / Privacy-Policy vendor inventory:** Fly.io is removed; Edge Functions are the same Supabase vendor/DPA already inventoried. `pg_net`'s outbound HTTP (to the platform's own function URL) is noted as an internal call.
- **Docs:** ADR-0010 is stamped superseded-in-part; CONTEXT.md § Data residency and the platform note drop the Fly.io line. `apps/backend/package.json`'s description ("…Fastify…Fly.io") is updated when the port lands.
- **Reverse-migration off Supabase Edge Functions** is bounded by design: Hono-on-Node on any long-lived host (Fly.io, Render, a container) reuses the same routes, domain, persistence, and tests. Only the `serve` entrypoint and the deploy artifacts change back.
