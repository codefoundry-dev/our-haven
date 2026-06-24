import { describe, expect, it } from 'vitest';

import { stubDeps } from '../_test/jwt.ts';
import { buildApp } from '../app.ts';

describe('GET /v1/healthz', () => {
  it('returns 200 + status=ok without touching the db', async () => {
    const res = await buildApp(stubDeps()).request('/v1/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'our-haven-backend' });
  });
});
