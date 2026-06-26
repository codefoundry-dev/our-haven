// Deno entrypoint for the `api` fat Edge Function (ADR-0019 § Decision 1).
//
// Thin by design: read env, build the data-plane connection once at MODULE
// scope (a warm isolate reuses it — ADR-0019 § Decision 3), construct the Hono
// app, and serve. All behaviour lives in `app.ts` and below, which run
// unchanged under vitest on Node — this file is the only Deno-coupled module
// and is intentionally excluded from the Node typecheck (it references the
// `Deno` global). Validated by `supabase functions serve` / deploy.
import { createCheckrAdapter } from '../_shared/checkr.ts';
import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';
import { createDb } from './db/kysely.ts';
import { mountUnderSlug } from './edge.ts';
import { initSupabase } from './supabase/admin.ts';
import { createStripeAdapter } from './vendors/stripe.ts';

// Build the handler once at module scope (warm-isolate reuse). Supabase keeps
// the function slug (`api`) in the request path, so mount the app under `/api`
// here in the host glue — the app itself stays slug-agnostic.
function boot(): (req: Request) => Response | Promise<Response> {
  const env = loadEnv(Deno.env.toObject());
  const db = createDb(env);
  const supabase = initSupabase(env);
  const stripe = createStripeAdapter({
    secretKey: env.STRIPE_SECRET_KEY,
    connectWebhookSecret: env.STRIPE_CONNECT_WEBHOOK_SECRET,
    paymentsWebhookSecret: env.STRIPE_PAYMENTS_WEBHOOK_SECRET,
    billingWebhookSecret: env.STRIPE_BILLING_WEBHOOK_SECRET,
    apiBase: env.STRIPE_API_BASE,
    tax: {
      subscriptionTaxCode: env.STRIPE_TAX_SUBSCRIPTION_TAX_CODE,
      commissionTaxCode: env.STRIPE_TAX_COMMISSION_TAX_CODE,
      originState: env.STRIPE_TAX_ORIGIN_STATE,
    },
  });
  // The api host only verifies the Checkr webhook — the slow REST calls
  // (candidates + invitations) run on the worker-tick, so no CHECKR_API_KEY here.
  const backgroundCheck = createCheckrAdapter({
    webhookSecret: env.CHECKR_WEBHOOK_SECRET,
    packageSlug: env.CHECKR_PACKAGE,
  });
  return mountUnderSlug(buildApp({ env, db, supabase, stripe, backgroundCheck }), 'api').fetch;
}

// A boot failure is almost always a missing/invalid secret (DATABASE_URL,
// JWT_SECRET). Surface it as a readable 503 instead of an opaque WORKER_ERROR
// so misconfiguration is self-diagnosing without digging through logs. The
// detail is config-validation text only (zod messages, never secret values).
//
// CRITICAL: the fallback emits CORS headers (and answers the preflight) too —
// otherwise a browser hitting a boot-failed function sees an opaque "CORS error"
// that masks the real 503 detail (exactly the symptom that hid this very bug).
let handler: (req: Request) => Response | Promise<Response>;
try {
  handler = boot();
} catch (err) {
  const detail = err instanceof Error ? err.message : String(err);
  console.error('[api] boot failed:', detail);
  handler = (req) => {
    const cors: Record<string, string> = {
      'access-control-allow-origin': req.headers.get('origin') ?? '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    return new Response(JSON.stringify({ error: 'boot_failed', detail }), {
      status: 503,
      headers: { ...cors, 'content-type': 'application/json' },
    });
  };
}

Deno.serve(handler);
