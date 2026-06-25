/**
 * Boot the Fastify app, ask @fastify/swagger to emit the OpenAPI document,
 * and write it to apps/backend/openapi/openapi.yaml. The static yaml is the
 * artifact `packages/openapi-types` reads from and CI compares against, per
 * ADR-0004 § Consequences ("OpenAPI spec is a load-bearing artifact").
 *
 * Run: npm run openapi:emit --workspace=@our-haven/backend
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stringify } from 'yaml';

import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(__dirname, '..', 'openapi', 'openapi.yaml');

function fakeEnv(): ReturnType<typeof loadEnv> {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL ??= 'postgres://localhost/our_haven_unused';
  process.env.SUPABASE_URL ??= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'unused-service-role-key';
  process.env.SUPABASE_JWT_SECRET ??= 'unused-jwt-secret';
  process.env.SUPABASE_STORAGE_BUCKET ??= 'uploads';
  process.env.STRIPE_SECRET_KEY ??= 'sk_test_unused';
  process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_unused';
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET ??= 'whsec_connect_unused';
  process.env.CHECKR_API_KEY ??= 'unused-checkr-key';
  process.env.CHECKR_WEBHOOK_SECRET ??= 'unused-checkr-secret';
  return loadEnv();
}

async function main(): Promise<void> {
  const env = fakeEnv();
  // Stubs — emit-openapi only inspects route schemas, doesn't talk to Supabase/DB.
  const stub = new Proxy({} as never, { get: () => stub });
  const app = await buildApp({
    env,
    db: stub,
    supabase: { admin: stub },
    storage: stub,
    stripe: stub,
    backgroundCheck: stub,
  });
  await app.ready();
  const spec = app.swagger();
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, stringify(spec), 'utf8');
  await app.close();
  console.log(`Wrote ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
