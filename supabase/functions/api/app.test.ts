import { describe, expect, it } from 'vitest';

import { stubDeps } from './_test/jwt.ts';
import { buildApp, OPENAPI_DOC_PATH } from './app.ts';

describe('OpenAPI document (@hono/zod-openapi)', () => {
  it('serves the doc with the /v1 health routes merged under their prefix', async () => {
    const res = await buildApp(stubDeps()).request(OPENAPI_DOC_PATH);
    expect(res.status).toBe(200);

    const doc = (await res.json()) as { openapi?: string; paths?: Record<string, unknown> };
    expect(String(doc.openapi)).toMatch(/^3\./);
    expect(doc.paths?.['/v1/healthz']).toBeDefined();
    expect(doc.paths?.['/v1/readyz']).toBeDefined();
  });
});
