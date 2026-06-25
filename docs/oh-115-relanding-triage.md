# Re-landing `feat/oh-115` onto the ADR-0019 / 3-role `main` lineage

**Status:** triage (2026-06-25). The salvage map for the pre-pivot branch, to be
consumed before **OH-194 / OH-195 / OH-196 / OH-197 / OH-180 / OH-182 / OH-179**
resume.

## Background

`feat/oh-115-retention-planner-and-state-privacy` (commits `b5cf0c6`, `00d6883`,
`e03788e`) diverged from `main` at `b171d8b` (OH-113 Job/Application/Offer state
machines) — **before** the ADR-0019 Edge/Kysely pivot *and* the ADR-0011 3-role
flatten. On the old architecture (pgmq + plpgsql `pg_cron` + Fastify) it built
retention/erasure, notifications, the admin console, and trust-&-safety. It was
migrated to the live DB but never merged; OH-237 has since reconciled the live DB
to `main`, removing those objects (4 pgmq queues, 7 `oh_*` plpgsql functions, 5
divergent tables).

**It is not mergeable or rebaseable.** It would conflict massively and
reintroduce the pgmq/plpgsql layer ADR-0019 deleted. Re-land it **ticket by
ticket**: lift the pure domain + adapters, reconcile with the 3-role model, and
route side-effects through `notification_outbox` + the worker-tick `SWEEPS`
registry (both shipped in OH-237).

## Disposition legend

- **LIFT** — pure `packages/domain` (architecture-agnostic). Port nearly as-is;
  reconcile with the 3-role model; emit side-effects via the outbox, not pgmq.
- **PORT** — needs real rework: Fastify→Hono (routes), pgmq/plpgsql→Kysely +
  outbox/sweeps (migrations/services/jobs), or a Next.js surface to wire to the
  ported API.
- **DROP** — dead under ADR-0019 (pgmq enqueue, plpgsql `pg_cron`). Do not
  re-land.

## Per-ticket mapping

### OH-194 — Notifications dispatcher
Largest overlap; `main` has none of this today.

| Source on `feat/oh-115` | Disposition |
|---|---|
| `packages/domain/src/notifications/*` — channel-matrix, consent, deep-links, dispatcher, events, templates (+ index/tests) | **LIFT** (net-new on main) |
| `apps/backend/src/vendors/{expo-push,sendgrid,twilio,web-push}.ts` (+ tests) | **PORT** — SDK-free `fetch`, Deno-clean; relocate into the edge function tree |
| `apps/backend/src/services/notifications.ts` | **PORT** → the worker-tick **dispatcher seam** (OH-237 left `loggingDispatcher` in `supabase/functions/worker-tick/outbox.ts` as the stub) |
| `apps/backend/src/routes/notifications.ts`, `routes/webhooks/twilio.ts` | **PORT** Fastify→Hono (`supabase/functions/api`) |
| `20260528000005_notifications.ts` (`notification_devices`, `notification_consent`, `notification_dispatches`) | **PORT** — keep the table DDL as a new Kysely migration; `notification_outbox` already exists |
| `apps/backend/src/jobs/notifications-worker.ts` | **DROP** — pgmq drain → the worker-tick outbox drain |
| `docs/notifications-deep-link-format.md` | reference |

### OH-182 — Retention/erasure planner + state-privacy
OH-237 already shipped the substrate (deadline columns + `SWEEPS`).

| Source | Disposition |
|---|---|
| `packages/domain/src/state-privacy/index.ts` (+ test) | **LIFT** (net-new on main) |
| `packages/domain/src/retention-planner/index.ts` (+440 expansion, + test) | **LIFT** the expansion onto main's skeleton |
| `20260528000009_pg_cron_retention_jobs.ts` + the 7 `oh_retention_*` plpgsql fns | **DROP** → register a retention `Sweep` in `supabase/functions/worker-tick/sweeps.ts`, scanning deadline/`purge_at` columns |

### OH-180 — Disintermediation + search ranking + rating reveal
`main` already has the three module skeletons; the branch adds coverage + the table.

| Source | Disposition |
|---|---|
| `packages/domain/src/disintermediation/index.test.ts`, `search-ranking/index.test.ts`, `rating-reveal/index.test.ts` | **LIFT** tests onto main's existing skeletons (reconcile any drift) |
| `disintermediation_flags` table (in `20260528000010_trust_safety.ts`) | **PORT** to a Kysely migration |

### OH-195 — Admin dashboard (supply review queue)
`main` has no admin pages today (`apps/admin/app` is empty).

| Source | Disposition |
|---|---|
| `apps/admin/app/review/*`, `apps/admin/lib/*` (AdminShell, api, supabase, design tokens) | **PORT** — Next.js, reusable; reconcile with the current `apps/admin` scaffold + shared design tokens |
| `apps/backend/src/routes/admin/verification.ts` | **PORT** Fastify→Hono |
| `20260528000006_admin_verification_decisions.ts` | **PORT** table DDL to Kysely |

### OH-196 — Admin metrics
| Source | Disposition |
|---|---|
| `apps/admin/app/metrics/page.tsx` (+ `routes/admin/metrics.ts`, `tests/routes/admin-metrics.test.ts`) | **PORT** — page + Fastify→Hono route |

### OH-197 — Trust & Safety
| Source | Disposition |
|---|---|
| `apps/admin/app/trust-safety/*` (queue, investigate, audit) | **PORT** Next.js |
| `apps/backend/src/routes/admin/trust-safety.ts` (+ test) | **PORT** Fastify→Hono |
| `ts_thread_access_log` table (in `20260528000010_trust_safety.ts`) | **PORT** table DDL to Kysely |

### OH-179 — Job + Application + Offer + atomic DM materialisation
| Source | Disposition |
|---|---|
| `20260528000008_offer_lifecycle_queue.ts` (pgmq) | **DROP** → Offer 72h expiry becomes an `offers.valid_until` deadline column + a worker-tick `Sweep`. Domain state machines are already on `main` (merge-base OH-113). |

### OH-181 / OH-184 — Verification workflow
| Source | Disposition |
|---|---|
| `packages/domain/src/verification-workflow/index.ts` (+ test) changes | **LIFT** the diff onto main's existing module |

## Cross-cutting reconciliation (applies to every LIFT/PORT)

1. **3-role flatten (ADR-0011):** the branch predates `kind → {role, categories}` / `specialty`. Update provider-shape assumptions and any `kind`-based branching.
2. **Side-effects via the outbox:** replace pgmq enqueue with `enqueueNotification(trx, …)` (`apps/backend/src/jobs/outbox.ts`) written inside the domain transaction — no dual-write.
3. **Sweeps, not plpgsql cron:** lifecycle/retention timers become deadline columns + a `Sweep` in `supabase/functions/worker-tick/sweeps.ts` (the registry OH-237 left extensible).
4. **Routes Fastify→Hono:** target `supabase/functions/api` with `@hono/zod-openapi`; the OpenAPI drift + plpgsql canary gates apply.

## Quick win (independent of the re-landing)

`feat/oh-115` commit `e03788e` already fixes the **Windows migrator**
(`FileMigrationProvider` needs `file://` URLs), a **dev SSL toggle**, and pg_cron
jobname literals — the exact issues worked around during the OH-237 live deploy.
Worth cherry-picking onto `main` so `npm run migrate:up` runs cleanly on Windows
without the throwaway runner.
