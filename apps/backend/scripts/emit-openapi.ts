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
  process.env.GCP_PROJECT_ID ??= 'our-haven-local';
  process.env.DATABASE_URL ??= 'postgres://localhost/our_haven_unused';
  process.env.GCS_UPLOAD_BUCKET ??= 'our-haven-uploads-unused';
  return loadEnv();
}

async function main(): Promise<void> {
  const env = fakeEnv();
  // Stubs — emit-openapi only inspects route schemas, doesn't talk to GCP/DB.
  const stub = new Proxy({} as never, { get: () => stub });
  const app = await buildApp({
    env,
    db: stub,
    firebase: stub,
    storage: stub,
    tasks: stub,
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
