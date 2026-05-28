import { describe, expect, it } from 'vitest';

import { buildApp } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';

import { applyTestEnv } from '../helpers/test-jwt.js';

const envForTest = () => {
  resetEnvForTests();
  applyTestEnv();
  return loadEnv();
};

const stubCollaborators = () => {
  const stub = new Proxy({} as never, { get: () => stub });
  return {
    db: stub,
    supabase: { admin: stub },
    storage: stub,
    queue: stub,
    stripe: stub,
    backgroundCheck: stub,
  };
};

describe('GET /v1/healthz', () => {
  it('returns 200 + status=ok without touching db/supabase', async () => {
    const env = envForTest();
    const app = await buildApp({ env, ...stubCollaborators() });
    try {
      const res = await app.inject({ method: 'GET', url: '/v1/healthz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'ok', service: 'our-haven-backend' });
    } finally {
      await app.close();
    }
  });
});
