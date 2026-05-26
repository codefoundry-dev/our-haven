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
  process.env.GCP_PROJECT_ID ??= 'our-haven-local';
  process.env.DATABASE_URL ??= 'postgres://localhost/our_haven_unused';
  process.env.GCS_UPLOAD_BUCKET ??= 'our-haven-uploads-unused';
  const env = loadEnv();
  const stub = new Proxy({} as never, { get: () => stub });
  const app = await buildApp({ env, db: stub, firebase: stub, storage: stub, tasks: stub });
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
