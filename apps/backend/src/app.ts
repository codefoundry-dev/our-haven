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

import type { BackgroundCheckAdapter } from '@our-haven/domain';

import type { Env } from '@/config/env.js';
import type { Db } from '@/db/kysely.js';
import type { QueueHandles } from '@/jobs/queue.js';
import { authPlugin } from '@/plugins/auth.js';
import { authRoutes } from '@/routes/auth.js';
import { healthRoutes } from '@/routes/health.js';
import { providerProfileRoutes } from '@/routes/provider-profile.js';
import { providerRoutes } from '@/routes/providers.js';
import { screeningRoutes } from '@/routes/screening.js';
import { homeChildcareRegistrationRoutes } from '@/routes/home-childcare-registration.js';
import { specialistCredentialsRoutes } from '@/routes/specialist-credentials.js';
import { stripeConnectRoutes } from '@/routes/stripe-connect.js';
import { adminStripeTaxRoutes } from '@/routes/admin/stripe-tax.js';
import { uploadRoutes } from '@/routes/uploads.js';
import { verificationRoutes } from '@/routes/verification.js';
import { checkrWebhookRoutes } from '@/routes/webhooks/checkr.js';
import { stripeWebhookRoutes } from '@/routes/webhooks/stripe.js';
import { stripeConnectWebhookRoutes } from '@/routes/webhooks/stripe-connect.js';
import type { SupabaseHandles } from '@/supabase/admin.js';
import type { StorageHandles } from '@/supabase/storage.js';
import type { StripeAdapter } from '@/vendors/stripe.js';

export interface AppDeps {
  env: Env;
  db: Db;
  supabase: SupabaseHandles;
  storage: StorageHandles;
  queue: QueueHandles;
  stripe: StripeAdapter;
  backgroundCheck: BackgroundCheckAdapter;
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
          'Our Haven v1 API — Parent + Provider mobile, Provider web portal, admin dashboard. Source of truth per ADR-0004 (§§ 1–3, 8) and ADR-0010 (Supabase + Fly.io + Vercel platform). US-region only.',
        license: { name: 'Proprietary' },
      },
      servers: [
        { url: 'https://api.ourhaven.example', description: 'Production (Fly.io iad)' },
        { url: 'http://localhost:8080', description: 'Local development' },
      ],
      tags: [
        { name: 'health', description: 'Liveness and readiness probes' },
        { name: 'uploads', description: 'Signed-URL helper for client-side Supabase Storage uploads' },
        { name: 'auth', description: 'Role claims, email-OTP fallback, step-up MFA grants' },
        { name: 'providers', description: 'Provider sign-up + profile (web portal + mobile companion)' },
        {
          name: 'screening',
          description:
            'Provider background-screening (OH-106) — $35 Stripe charge + Checkr standard package via vendor-agnostic adapter',
        },
        { name: 'webhooks', description: 'Inbound vendor webhooks (Stripe, Checkr)' },
        { name: 'admin', description: 'Admin-only surfaces (dashboards, tax registrations, etc.)' },
        {
          name: 'tax',
          description:
            'Stripe Tax (OH-111) — per-state taxability on Subscription + Commission; bookings deliberately not taxed.',
        },
      ],
      components: {
        securitySchemes: {
          supabaseAccessToken: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Supabase Auth access token (HS256). Verified locally with the project JWT secret on every request.',
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
  await app.register(providerRoutes, { prefix: '/v1' });
  await app.register(providerProfileRoutes, { prefix: '/v1' });
  await app.register(verificationRoutes, { prefix: '/v1' });
  await app.register(specialistCredentialsRoutes, { prefix: '/v1' });
  await app.register(homeChildcareRegistrationRoutes, { prefix: '/v1' });
  await app.register(screeningRoutes, { prefix: '/v1' });
  await app.register(stripeConnectRoutes, { prefix: '/v1' });
  await app.register(adminStripeTaxRoutes, { prefix: '/v1' });
  await app.register(stripeWebhookRoutes, { prefix: '/v1' });
  await app.register(stripeConnectWebhookRoutes, { prefix: '/v1' });
  await app.register(checkrWebhookRoutes, { prefix: '/v1' });

  return app;
}
