import { describe, expect, it } from 'vitest';

import { stubDeps } from './_test/jwt.ts';
import { buildApp } from './app.ts';
import { mountUnderSlug } from './edge.ts';

const edge = () => mountUnderSlug(buildApp(stubDeps()), 'api');

describe('mountUnderSlug — Supabase keeps the /api slug in the path', () => {
  it('serves the app under the slug so /api/v1/healthz reaches /v1/healthz', async () => {
    const res = await edge().request('/api/v1/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'our-haven-backend' });
  });

  it('exposes the OpenAPI doc at /api/openapi.json (paths stay /v1/*)', async () => {
    const res = await edge().request('/api/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths?: Record<string, unknown> };
    expect(doc.paths?.['/v1/healthz']).toBeDefined();
  });

  it('does not serve the app without the slug (prod always includes it)', async () => {
    const res = await edge().request('/v1/healthz');
    expect(res.status).toBe(404);
  });
});
