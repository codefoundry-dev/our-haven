import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';

import type { AppEnv } from './context.ts';
import type { AppDeps } from './deps.ts';
import { NotConfiguredError } from './errors.ts';
import { registerAdminStripeTaxRoutes } from './routes/admin/stripe-tax.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerCaregiverBadgeRoutes } from './routes/caregiver-badges.ts';
import { registerCaregiverConnectRoutes } from './routes/caregiver-connect.ts';
import { registerCaregiverProfileRoutes } from './routes/caregiver-profile.ts';
import { registerContactUsRoutes } from './routes/contact-us.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerParentProfileRoutes } from './routes/parent-profile.ts';
import { registerParentSubscriptionRoutes } from './routes/parent-subscription.ts';
import { registerProviderCredentialsRoutes } from './routes/provider-credentials.ts';
import { registerProviderProfileRoutes } from './routes/provider-profile.ts';
import { registerProviderSubscriptionRoutes } from './routes/provider-subscription.ts';
import { registerScreeningRoutes } from './routes/screening.ts';
import { registerUploadRoutes } from './routes/uploads.ts';
import { registerVerificationRoutes } from './routes/verification.ts';
import { registerCheckrWebhookRoutes } from './routes/webhooks/checkr.ts';
import { registerStripeBillingWebhookRoutes } from './routes/webhooks/stripe-billing.ts';
import { registerStripeConnectWebhookRoutes } from './routes/webhooks/stripe-connect.ts';
import { registerStripePaymentsWebhookRoutes } from './routes/webhooks/stripe-payments.ts';

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
    {
      name: 'badges',
      description:
        'Optional Caregiver badges (OH-187) — W-10 "Tax-credit-friendly" self-attest + per-state home-childcare (FCCH) registration; neither gates activation.',
    },
    {
      name: 'profile',
      description:
        'Supply profile builders — Caregiver (OH-188): per-category Rate + surcharge, availability, negotiable toggle, ages-served + behaviour-comfort, and the Credentials umbrella (admin-reviewed). Provider (OH-189): specialty + per-session display Rate, consultation-slot publishing, and the read-only license/insurance/screening credential-status badge.',
    },
    {
      name: 'subscription',
      description:
        'Subscriptions (Stripe Billing, both web-sold to dodge IAP). Provider Subscription (OH-191) — checkout + portal (Provider as Customer, not Connect); listing gated on an active subscription; plus the public corporate "Contact Us" intake (sales-led custom contract; v1 intake only). Parent Subscription (OH-193) — checkout (with Stripe Promotion Codes) + portal; an active subscription unlocks the demand-side marketplace (the M3 paywall reads the access state).',
    },
    { name: 'verification', description: 'Supply verification — state + email/phone/ID-doc facts (OH-184)' },
    {
      name: 'screening',
      description: 'Background screening — $35 Stripe charge + Checkr standard package (OH-185)',
    },
    { name: 'uploads', description: 'Signed URLs for client-direct private Storage uploads (OH-184)' },
    {
      name: 'webhooks',
      description:
        'Vendor webhooks — Stripe Connect account.updated (OH-190), Stripe payments payment_intent.succeeded + Checkr report.* (OH-185), Stripe Billing checkout.session.completed + customer.subscription.* for both Provider (OH-191) and Parent (OH-193) subscriptions',
    },
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

  // CORS — the RN/Expo *web* bundle calls this API from a different origin than
  // the Edge Functions host, so the browser sends a preflight (OPTIONS) and
  // requires Access-Control-* on every response. Native has no CORS. Auth is a
  // bearer token (no cookies), so reflecting the request origin is safe; lock
  // this to an allow-list of known web origins if that ever changes. First in
  // the chain so even error responses carry the headers and the preflight is
  // answered before any route logic.
  app.use(
    '*',
    cors({
      origin: (origin) => origin ?? '*',
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      maxAge: 86400,
    }),
  );

  // Inject collaborators into every request context (runs before all routes,
  // including mounted sub-apps).
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });

  // Uniform error envelope — never leak internals (mirrors the Fastify posture).
  app.onError((err, c) => {
    // A route reached for an unconfigured vendor feature (e.g. Stripe not set up
    // yet) is a 503 not_configured, not a 500 — the rest of the API is healthy.
    if (err instanceof NotConfiguredError) {
      return c.json({ error: 'not_configured', detail: err.message }, 503);
    }
    console.error('[api] unhandled error', err);
    return c.json({ error: 'internal_error' }, 500);
  });

  // Versioned surface. Each route module registers onto the /v1 sub-app; the
  // parent merges their OpenAPI definitions under the /v1 prefix.
  const v1 = new OpenAPIHono<AppEnv>();
  registerHealthRoutes(v1);
  registerAuthRoutes(v1);
  registerCaregiverConnectRoutes(v1);
  registerVerificationRoutes(v1);
  registerProviderCredentialsRoutes(v1);
  registerCaregiverBadgeRoutes(v1);
  registerCaregiverProfileRoutes(v1);
  registerProviderProfileRoutes(v1);
  registerProviderSubscriptionRoutes(v1);
  registerParentSubscriptionRoutes(v1);
  registerParentProfileRoutes(v1);
  registerContactUsRoutes(v1);
  registerScreeningRoutes(v1);
  registerUploadRoutes(v1);
  registerStripeConnectWebhookRoutes(v1);
  registerStripePaymentsWebhookRoutes(v1);
  registerStripeBillingWebhookRoutes(v1);
  registerCheckrWebhookRoutes(v1);
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
