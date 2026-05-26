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
    firestore: z.enum(['ok', 'fail']),
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
          'Checks Postgres + Firestore reachability. Returns 503 with status=degraded if any dependency is unreachable.',
        response: { 200: ReadinessResponse, 503: ReadinessResponse },
      },
    },
    async (_req, reply) => {
      const { db, firebase } = app.deps;

      const [postgresOk, firestoreOk] = await Promise.all([
        sql`select 1`.execute(db).then(
          () => true,
          () => false,
        ),
        firebase.firestore
          .collection('__health')
          .limit(1)
          .get()
          .then(
            () => true,
            () => false,
          ),
      ]);

      const body = {
        status: postgresOk && firestoreOk ? ('ready' as const) : ('degraded' as const),
        checks: {
          postgres: postgresOk ? ('ok' as const) : ('fail' as const),
          firestore: firestoreOk ? ('ok' as const) : ('fail' as const),
        },
      };
      reply.code(body.status === 'ready' ? 200 : 503);
      return body;
    },
  );
};
