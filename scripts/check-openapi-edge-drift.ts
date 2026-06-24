/**
 * CI guard (sibling to apps/backend's check-openapi-drift.ts, for the Edge
 * host): compares the checked-in supabase/functions/api/openapi/openapi.yaml
 * against what the Hono `api` app emits right now. Non-zero exit on any drift.
 *
 * The Fastify openapi:check stays the canonical contract until the route
 * modules finish porting (OH-175…); this gate keeps the growing Edge spec
 * honest in the meantime.
 *
 * Run: npm run openapi:check:edge
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, stringify } from 'yaml';

import { edgeOpenApiDocument } from './_edge-app.ts';

const here = dirname(fileURLToPath(import.meta.url));
const SPEC = resolve(here, '..', 'supabase', 'functions', 'api', 'openapi', 'openapi.yaml');

async function main(): Promise<void> {
  const fresh = stringify(await edgeOpenApiDocument());

  let checked: string;
  try {
    checked = await readFile(SPEC, 'utf8');
  } catch {
    console.error(`Missing ${SPEC}. Run: npm run openapi:emit:edge`);
    process.exit(2);
    return;
  }

  if (stringify(parse(checked)) !== stringify(parse(fresh))) {
    console.error(
      'Edge OpenAPI drift: the api app spec differs from the checked-in openapi.yaml.\n' +
        'Run: npm run openapi:emit:edge',
    );
    process.exit(1);
  }

  console.log('Edge OpenAPI spec is in sync.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
