import { OpenAPIHono } from '@hono/zod-openapi';

import type { AppEnv } from './context.ts';
import type { AppDeps } from './deps.ts';
import { registerHealthRoutes } from './routes/health.ts';

export const OPENAPI_DOC_PATH = '/openapi.json';

/**
 * OpenAPI document metadata. Exported so the Node-side emit/drift scripts
 * (openapi:*:edge) produce a byte-identical spec to what the running app
 * serves at {@link OPENAPI_DOC_PATH}.
 */
export const openApiInfo = {
  openapi: '3.1.0',
  info: {
    title: 'Our Haven API',
    version: '0.0.0',
    description:
      'Our Haven v1 API — single Hono fat Edge Function (ADR-0019). Source of truth per ADR-0004 (§§ 1–3, 8). US-region only.',
    license: { name: 'Proprietary' },
  },
  // The function is served under the Supabase Edge function base (the `/api`
  // slug is part of the URL, not the paths); paths below stay clean `/v1/*`.
  servers: [
    {
      url: 'https://<project-ref>.supabase.co/functions/v1/api',
      description: 'Supabase Edge Function (production) — replace <project-ref>.',
    },
    { url: 'http://localhost:54321/functions/v1/api', description: 'Local (supabase functions serve)' },
  ],
  tags: [{ name: 'health', description: 'Liveness and readiness probes' }],
};

/**
 * Build the Hono app that the `api` Edge Function serves (ADR-0019 § Decision
 * 1 — one fat function: one middleware chain, one error handler, all routes
 * under /v1, OpenAPI via @hono/zod-openapi). Collaborators are injected so the
 * whole app runs under vitest on Node exactly as it runs on Deno.
 */
export function buildApp(deps: AppDeps): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();

  // Inject collaborators into every request context (runs before all routes,
  // including mounted sub-apps).
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });

  // Uniform error envelope — never leak internals (mirrors the Fastify posture).
  app.onError((err, c) => {
    console.error('[api] unhandled error', err);
    return c.json({ error: 'internal_error' }, 500);
  });

  // Versioned surface. Each route module registers onto the /v1 sub-app; the
  // parent merges their OpenAPI definitions under the /v1 prefix.
  const v1 = new OpenAPIHono<AppEnv>();
  registerHealthRoutes(v1);
  app.route('/v1', v1);

  // OpenAPI is the load-bearing contract (ADR-0004 § 2).
  app.doc(OPENAPI_DOC_PATH, openApiInfo);

  return app;
}
