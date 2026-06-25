/**
 * CI guard: compares the checked-in apps/backend/openapi/openapi.yaml against
 * what @fastify/swagger emits right now. Fails (non-zero exit) on any drift.
 *
 * Run: npm run openapi:check --workspace=@our-haven/backend
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, stringify } from 'yaml';

import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC = resolve(__dirname, '..', 'openapi', 'openapi.yaml');

async function main(): Promise<void> {
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
  const env = loadEnv();
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
  const fresh = stringify(app.swagger());
  await app.close();

  let checked: string;
  try {
    checked = await readFile(SPEC, 'utf8');
  } catch {
    console.error(`Missing ${SPEC}. Run: npm run openapi:emit --workspace=@our-haven/backend`);
    process.exit(2);
  }

  const a = stringify(parse(checked));
  const b = stringify(parse(fresh));
  if (a !== b) {
    console.error(
      'OpenAPI drift detected. The runtime spec differs from the checked-in openapi.yaml.\n' +
        'Run: npm run openapi:emit --workspace=@our-haven/backend',
    );
    process.exit(1);
  }
  console.log('OpenAPI spec is in sync.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
