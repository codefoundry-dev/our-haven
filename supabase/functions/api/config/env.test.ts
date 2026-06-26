import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.ts';

/**
 * Boot resilience (the role-claim outage fix): the fat function must come up
 * with ONLY the core data-plane + auth secrets. Vendor secrets (Stripe / Checkr)
 * are optional — a missing one is a per-route 503 not_configured, never a
 * whole-function boot failure.
 */
const CORE = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_SECRET: 'test-jwt-secret-32-bytes-long-enough!!',
  SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc-role-key',
};

describe('loadEnv', () => {
  it('boots with ONLY the core secrets — no Stripe/Checkr configured', () => {
    const env = loadEnv(CORE);
    expect(env.DATABASE_URL).toContain('postgres://');
    // Vendor secrets are absent, not a boot error.
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.STRIPE_PROVIDER_SUBSCRIPTION_PRICE_ID).toBeUndefined();
    expect(env.STRIPE_PARENT_SUBSCRIPTION_PRICE_ID).toBeUndefined();
    expect(env.CHECKR_WEBHOOK_SECRET).toBeUndefined();
  });

  it('still fails fast when a CORE secret is missing', () => {
    const { JWT_SECRET: _omit, ...withoutJwt } = CORE;
    expect(() => loadEnv(withoutJwt)).toThrow(/JWT_SECRET/);
  });
});
