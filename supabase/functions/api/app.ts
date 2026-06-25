import { OpenAPIHono } from '@hono/zod-openapi';

import type { AppEnv } from './context.ts';
import type { AppDeps } from './deps.ts';
import { registerAdminStripeTaxRoutes } from './routes/admin/stripe-tax.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerCaregiverConnectRoutes } from './routes/caregiver-connect.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerStripeConnectWebhookRoutes } from './routes/webhooks/stripe-connect.ts';

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
  tags: [
    { name: 'health', description: 'Liveness and readiness probes' },
    { name: 'auth', description: 'Authentication — role-claim, email-OTP, step-up MFA' },
    { name: 'caregiver', description: 'Caregiver Stripe Connect Express — onboarding, summary, dashboard (OH-190)' },
    { name: 'webhooks', description: 'Vendor webhooks — Stripe Connect account.updated (OH-190)' },
    { name: 'admin', description: 'Admin-only surfaces (Stripe Tax registrations + calculation audit, etc.)' },
    {
      name: 'tax',
      description:
        'Stripe Tax (OH-192) — per-state taxability on Subscription + Commission; Bookings deliberately not taxed.',
    },
  ],
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
  registerAuthRoutes(v1);
  registerCaregiverConnectRoutes(v1);
  registerStripeConnectWebhookRoutes(v1);
  registerAdminStripeTaxRoutes(v1);
  app.route('/v1', v1);

  // Bearer security scheme for the Supabase access token (ADR-0010 § 62).
  app.openAPIRegistry.registerComponent('securitySchemes', 'supabaseAccessToken', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description:
      'Supabase Auth access token (HS256). Verified locally with the project JWT secret on every request.',
  });

  // OpenAPI is the load-bearing contract (ADR-0004 § 2).
  app.doc(OPENAPI_DOC_PATH, openApiInfo);

  return app;
}
