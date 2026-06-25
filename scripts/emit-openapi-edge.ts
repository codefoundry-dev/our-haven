/**
 * Boot the Hono `api` app, capture the OpenAPI document it serves, and write it
 * to supabase/functions/api/openapi/openapi.yaml — the static artifact CI
 * compares against (ADR-0004 § "OpenAPI spec is a load-bearing artifact",
 * carried forward to the Edge host by ADR-0019).
 *
 * Run: npm run openapi:emit:edge
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stringify } from 'yaml';

import { edgeOpenApiDocument } from './_edge-app.ts';

const here = dirname(fileURLToPath(import.meta.url));
const OUTPUT = resolve(here, '..', 'supabase', 'functions', 'api', 'openapi', 'openapi.yaml');

async function main(): Promise<void> {
  const doc = await edgeOpenApiDocument();
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, stringify(doc), 'utf8');
  console.log(`Wrote ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
