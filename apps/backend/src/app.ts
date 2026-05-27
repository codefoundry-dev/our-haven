import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import type { Env } from '@/config/env.js';
import type { Db } from '@/db/kysely.js';
import type { FirebaseHandles } from '@/gcp/firebase.js';
import type { StorageHandles } from '@/gcp/storage.js';
import type { TasksHandles } from '@/gcp/tasks.js';
import { authPlugin } from '@/plugins/auth.js';
import { authRoutes } from '@/routes/auth.js';
import { healthRoutes } from '@/routes/health.js';
import { uploadRoutes } from '@/routes/uploads.js';

export interface AppDeps {
  env: Env;
  db: Db;
  firebase: FirebaseHandles;
  storage: StorageHandles;
  tasks: TasksHandles;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.env.LOG_LEVEL,
      transport:
        deps.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l', singleLine: true } }
          : undefined,
    },
    disableRequestLogging: deps.env.NODE_ENV === 'test',
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: deps.env.NODE_ENV === 'production' ? false : true });
  await app.register(sensible);

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Our Haven API',
        version: '0.0.0',
        description:
          'Our Haven v1 API — Parent + Provider mobile, Provider web portal, admin dashboard. Source of truth per ADR-0004. US-region only.',
        license: { name: 'Proprietary' },
      },
      servers: [
        { url: 'https://api.ourhaven.example', description: 'Production (us-east1)' },
        { url: 'http://localhost:8080', description: 'Local development' },
      ],
      tags: [
        { name: 'health', description: 'Liveness and readiness probes' },
        { name: 'uploads', description: 'Signed-URL helper for client-side GCS uploads' },
        { name: 'auth', description: 'Role claims, email-OTP fallback, step-up MFA grants' },
      ],
      components: {
        securitySchemes: {
          firebaseIdToken: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Firebase Auth ID token. Verified by firebase-admin on every request.',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list' },
  });

  await app.register(authPlugin);

  await app.register(healthRoutes, { prefix: '/v1' });
  await app.register(authRoutes, { prefix: '/v1' });
  await app.register(uploadRoutes, { prefix: '/v1' });

  return app;
}
