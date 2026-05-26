import { describe, expect, it } from 'vitest';

import { buildApp } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';

const envForTest = () => {
  resetEnvForTests();
  process.env.NODE_ENV = 'test';
  process.env.GCP_PROJECT_ID = 'our-haven-test';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/our_haven_test';
  process.env.GCS_UPLOAD_BUCKET = 'our-haven-test-bucket';
  process.env.LOG_LEVEL = 'fatal';
  return loadEnv();
};

const stubCollaborators = () => {
  const stub = new Proxy({} as never, { get: () => stub });
  return { db: stub, firebase: stub, storage: stub, tasks: stub };
};

describe('GET /v1/healthz', () => {
  it('returns 200 + status=ok without touching db/firestore', async () => {
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
