import { SignJWT } from 'jose';

export const TEST_JWT_SECRET = 'test-supabase-jwt-secret-32-bytes-long-enough';

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

export function applyTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/our_haven_test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
  process.env.SUPABASE_STORAGE_BUCKET = 'our-haven-test-uploads';
  process.env.LOG_LEVEL = 'fatal';
  // OH-106 / OH-107 / OH-110 — Stripe + Checkr required by env.ts. Stub values
  // are enough to pass schema validation; tests stub the actual SDK calls.
  process.env.STRIPE_SECRET_KEY = 'sk_test_unused';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_unused';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_connect_test_unused';
  process.env.STRIPE_CONNECT_RETURN_URL = 'http://localhost:3000/portal/verification?stripe=return';
  process.env.STRIPE_CONNECT_REFRESH_URL = 'http://localhost:3000/portal/verification?stripe=refresh';
  // OH-111 — Stripe Tax env defaults are populated by env.ts (txcd_… codes);
  // tests don't need to override unless asserting on a specific code.
  process.env.CHECKR_API_KEY = 'checkr_test_unused';
  process.env.CHECKR_WEBHOOK_SECRET = 'checkr_whsec_test_unused';
}
