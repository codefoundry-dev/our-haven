import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { sql } from 'kysely';

import type { AppEnv } from '../context.ts';

// No npm_package_version on Deno; the spec/version story is owned by the
// OpenAPI document. Bump in lockstep with releases (placeholder pre-launch).
const SERVICE_VERSION = '0.0.0';

const LivenessResponse = z
  .object({
    status: z.literal('ok'),
    service: z.string(),
    version: z.string(),
  })
  .openapi('LivenessResponse');

const ReadinessResponse = z
  .object({
    status: z.enum(['ready', 'degraded']),
    checks: z.object({ postgres: z.enum(['ok', 'fail']) }),
  })
  .openapi('ReadinessResponse');

const livenessRoute = createRoute({
  method: 'get',
  path: '/healthz',
  tags: ['health'],
  summary: 'Liveness probe',
  description: 'Returns 200 as long as the isolate is up.',
  responses: {
    200: {
      description: 'Service is live',
      content: { 'application/json': { schema: LivenessResponse } },
    },
  },
});

const readinessRoute = createRoute({
  method: 'get',
  path: '/readyz',
  tags: ['health'],
  summary: 'Readiness probe',
  description:
    'Checks Postgres reachability over the Supavisor pooler. 503 + status=degraded when unreachable. (Supabase Auth + Storage + Realtime share this Postgres, so one check covers the data plane — ADR-0010.)',
  responses: {
    200: {
      description: 'Ready',
      content: { 'application/json': { schema: ReadinessResponse } },
    },
    503: {
      description: 'Degraded — Postgres unreachable',
      content: { 'application/json': { schema: ReadinessResponse } },
    },
  },
});

export function registerHealthRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(livenessRoute, (c) =>
    c.json({ status: 'ok', service: 'our-haven-backend', version: SERVICE_VERSION }, 200),
  );

  app.openapi(readinessRoute, async (c) => {
    const { db } = c.var.deps;
    const postgresOk = await sql`select 1`.execute(db).then(
      () => true,
      () => false,
    );
    return c.json(
      {
        status: postgresOk ? 'ready' : 'degraded',
        checks: { postgres: postgresOk ? 'ok' : 'fail' },
      },
      postgresOk ? 200 : 503,
    );
  });
}
