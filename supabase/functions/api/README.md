# `api` — Our Haven fat Edge Function (ADR-0019)

The single [Hono](https://hono.dev) app that serves the whole `/v1` surface on
Supabase Edge Functions (Deno), replacing the Fly.io + Fastify host of ADR-0010.
One auth/error middleware chain, all routes under `/v1`, OpenAPI via
`@hono/zod-openapi`, deployed `--no-verify-jwt` (self-verifies per route).

## Layout

| Path | Role |
|---|---|
| `index.ts` | Deno entrypoint (`Deno.serve`) — the **only** Deno-coupled module; excluded from the Node typecheck. |
| `app.ts` | `buildApp(deps)` — the Hono app (middleware + routes + OpenAPI). Runs on Node too, so vitest tests it unchanged. |
| `config/env.ts` | Runtime-agnostic env (`loadEnv(source)`); `index.ts` passes `Deno.env.toObject()`. |
| `db/kysely.ts` | Kysely over postgres.js on the Supavisor transaction pooler (`prepare:false`, `max:1`). |
| `auth/` | `requireAuth` JWT middleware + Principal/roles (ported from `plugins/auth.ts`). |
| `routes/health.ts` | `/v1/healthz` liveness, `/v1/readyz` readiness. |
| `deno.json` | Import map pinning the npm deps for Deno. |
| `_test/` | Node test helpers — underscore dir, never deployed. |

## Run / deploy

```bash
# local (needs supabase CLI + .env from .env.example)
supabase functions serve api --no-verify-jwt --env-file supabase/functions/api/.env
curl -i http://localhost:54321/functions/v1/api/v1/healthz

# deploy
supabase functions deploy api --no-verify-jwt
```

## Node-side tooling (from repo root — supabase/ is not an npm workspace)

```bash
npm run typecheck:edge        # tsc over the Edge tree
npm run test:edge             # vitest (Hono app + Node-side scripts)
npm run openapi:emit:edge     # regenerate openapi/openapi.yaml
npm run openapi:check:edge    # spec-drift gate
npm run check:no-plpgsql      # the plpgsql canary (ADR-0019)
```
