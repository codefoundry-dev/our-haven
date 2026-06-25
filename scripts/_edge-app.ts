// Shared builder for the Node-side OpenAPI scripts (emit + drift). Constructs
// the real `api` Hono app with throwaway collaborators and returns the exact
// document it serves, so the checked-in spec is byte-faithful to runtime.
import { buildApp, OPENAPI_DOC_PATH } from '../supabase/functions/api/app.ts';
import { loadEnv } from '../supabase/functions/api/config/env.ts';
import type { AppDeps } from '../supabase/functions/api/deps.ts';

function fakeDeps(): AppDeps {
  // The OpenAPI document is built from route *definitions*, never by invoking
  // handlers, so a Proxy db that throws on use is the correct stub.
  const stub = new Proxy({} as never, { get: () => stub });
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://localhost/our_haven_unused',
    DATABASE_SSL: 'false',
    JWT_SECRET: 'unused-edge-openapi-jwt-secret',
    SUPABASE_URL: 'https://unused.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'unused-service-role-key',
    STRIPE_SECRET_KEY: 'sk_test_unused',
    STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_unused',
  });
  return { env, db: stub, supabase: stub, stripe: stub };
}

export async function edgeOpenApiDocument(): Promise<unknown> {
  const app = buildApp(fakeDeps());
  const res = await app.request(OPENAPI_DOC_PATH);
  if (!res.ok) throw new Error(`OpenAPI doc route ${OPENAPI_DOC_PATH} returned ${res.status}`);
  return res.json();
}
