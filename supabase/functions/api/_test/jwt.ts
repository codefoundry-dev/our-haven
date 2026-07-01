// Test-only helpers for the Edge app, co-located under an underscore dir so
// Supabase never deploys it as a function and it is never part of index.ts's
// bundle graph. Mirrors apps/backend/tests/helpers/test-jwt.ts.
import { SignJWT } from 'jose';

import { loadEnv, type Env } from '../config/env.ts';
import type { AppDeps } from '../deps.ts';

export const TEST_JWT_SECRET = 'test-supabase-jwt-secret-32-bytes-long-enough';

export function buildTestEnv(overrides: Record<string, string | undefined> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test:test@localhost:5432/our_haven_test',
    DATABASE_SSL: 'false',
    JWT_SECRET: TEST_JWT_SECRET,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    STRIPE_SECRET_KEY: 'sk_test_unused',
    STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_test_connect',
    STRIPE_PAYMENTS_WEBHOOK_SECRET: 'whsec_test_payments',
    STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_test_billing',
    STRIPE_PROVIDER_SUBSCRIPTION_PRICE_ID: 'price_test_provider_sub',
    STRIPE_PARENT_SUBSCRIPTION_PRICE_ID: 'price_test_parent_sub',
    CHECKR_WEBHOOK_SECRET: 'checkr_whsec_test',
    ...overrides,
  });
}

/** Deps with a Proxy db + supabase + stripe that throw if a route actually
 *  touches them — health (liveness) + auth (no step-up / no claim write) must
 *  not. Tests that exercise Postgres / the admin client / Stripe pass their own
 *  stubs. */
export function stubDeps(): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return { env: buildTestEnv(), db: stub, supabase: stub, stripe: stub, backgroundCheck: stub, daily: stub };
}

export interface TestTokenInput {
  sub: string;
  email?: string | null;
  phone?: string | null;
  appMetadata?: Record<string, unknown>;
  aal?: 'aal1' | 'aal2';
  amr?: Array<{ method: string; timestamp?: number }>;
  expiresInSec?: number;
}

export async function mintAccessToken(input: TestTokenInput): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  const now = Math.floor(Date.now() / 1000);
  const expiresInSec = input.expiresInSec ?? 3600;

  const payload: Record<string, unknown> = {
    sub: input.sub,
    aud: 'authenticated',
    role: 'authenticated',
    email: input.email ?? null,
    phone: input.phone ?? null,
    app_metadata: input.appMetadata ?? {},
    user_metadata: {},
    aal: input.aal ?? 'aal1',
    amr: input.amr ?? [{ method: 'password', timestamp: now }],
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSec)
    .sign(secret);
}
