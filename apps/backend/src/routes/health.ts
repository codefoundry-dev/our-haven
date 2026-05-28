import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';

const LivenessResponse = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
});

const ReadinessResponse = z.object({
  status: z.enum(['ready', 'degraded']),
  checks: z.object({
    postgres: z.enum(['ok', 'fail']),
  }),
});

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/healthz',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness probe',
        description: 'Returns 200 as long as the process is up.',
        response: { 200: LivenessResponse },
      },
    },
    async () => ({
      status: 'ok' as const,
      service: 'our-haven-backend',
      version: process.env.npm_package_version ?? '0.0.0',
    }),
  );

  app.get(
    '/readyz',
    {
      schema: {
        tags: ['health'],
        summary: 'Readiness probe',
        description:
          'Checks Postgres reachability. Returns 503 with status=degraded if Postgres is unreachable. (Supabase Auth + Storage + Realtime share the same Postgres backend, so this single check covers the data plane per ADR-0010.)',
        response: { 200: ReadinessResponse, 503: ReadinessResponse },
      },
    },
    async (_req, reply) => {
      const { db } = app.deps;

      const postgresOk = await sql`select 1`.execute(db).then(
        () => true,
        () => false,
      );

      const body = {
        status: postgresOk ? ('ready' as const) : ('degraded' as const),
        checks: {
          postgres: postgresOk ? ('ok' as const) : ('fail' as const),
        },
      };
      reply.code(body.status === 'ready' ? 200 : 503);
      return body;
    },
  );
};
