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
    ...overrides,
  });
}

/** Deps with a Proxy db that throws if a route actually touches Postgres —
 *  health (liveness) + auth (no step-up) must not. */
export function stubDeps(): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return { env: buildTestEnv(), db: stub };
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
