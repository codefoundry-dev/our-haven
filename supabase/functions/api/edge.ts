import { Hono } from 'hono';

/**
 * Supabase routes `/functions/v1/<slug>/*` to this function and KEEPS the
 * `<slug>` segment in the path the handler receives — "paths should always be
 * prefixed with the function name" (Supabase routing guide). So a request to
 * `…/functions/v1/api/v1/healthz` reaches the handler as `/api/v1/healthz`.
 *
 * Mount the portable Hono app under `/<slug>` so it still sees clean `/v1/*`
 * paths. This keeps the app host-agnostic (the reverse-migration target — Hono
 * on a long-lived Node host — has no such prefix; only this entrypoint does)
 * and keeps the OpenAPI contract free of the deployment slug. Mirrors how
 * `buildApp` mounts its own `/v1` sub-app.
 */
export function mountUnderSlug(app: Hono<any>, slug: string): Hono {
  return new Hono().route(`/${slug}`, app);
}
