import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDeps } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';
import { authPlugin } from '@/plugins/auth.js';
import { authRoutes } from '@/routes/auth.js';

function envForTest() {
  resetEnvForTests();
  process.env.NODE_ENV = 'test';
  process.env.GCP_PROJECT_ID = 'our-haven-test';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/our_haven_test';
  process.env.GCS_UPLOAD_BUCKET = 'our-haven-test-bucket';
  process.env.LOG_LEVEL = 'fatal';
  return loadEnv();
}

function makeDeps(opts: {
  decoded?: Partial<DecodedIdToken & Record<string, unknown>>;
  verifyThrows?: boolean;
  setCustomUserClaims?: ReturnType<typeof vi.fn>;
}): AppDeps {
  const passThrough = new Proxy({} as never, { get: () => passThrough });
  const decoded = {
    uid: 'firebase-uid-123',
    sub: 'firebase-uid-123',
    aud: 'our-haven-test',
    iss: 'https://securetoken.google.com/our-haven-test',
    iat: Math.floor(Date.now() / 1000) - 5,
    exp: Math.floor(Date.now() / 1000) + 3600,
    auth_time: Math.floor(Date.now() / 1000) - 60,
    email: 'parent@example.com',
    firebase: { identities: {}, sign_in_provider: 'password' },
    ...opts.decoded,
  } as unknown as DecodedIdToken;

  const verifyIdToken = vi.fn(async () => {
    if (opts.verifyThrows) throw new Error('invalid');
    return decoded;
  });
  const setCustomUserClaims = opts.setCustomUserClaims ?? vi.fn(async () => {});

  return {
    env: envForTest(),
    db: passThrough,
    firebase: {
      auth: { verifyIdToken, setCustomUserClaims } as never,
      firestore: passThrough,
    },
    storage: passThrough,
    tasks: passThrough,
  };
}

async function buildAppWithRoutes(deps: AppDeps) {
  const app = Fastify({ logger: { level: 'fatal' }, disableRequestLogging: true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);
  await app.register(authPlugin);
  await app.register(authRoutes, { prefix: '/v1' });
  return app;
}

describe('POST /v1/auth/role-claim', () => {
  beforeEach(() => resetEnvForTests());

  it('401s without a bearer token', async () => {
    const app = await buildAppWithRoutes(makeDeps({}));
    try {
      const res = await app.inject({ method: 'POST', url: '/v1/auth/role-claim', payload: { role: 'parent' } });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('sets parent role on a fresh user', async () => {
    const setCustomUserClaims = vi.fn(async () => {});
    const deps = makeDeps({ setCustomUserClaims });
    const app = await buildAppWithRoutes(deps);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/role-claim',
        headers: { authorization: 'Bearer good' },
        payload: { role: 'parent' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ role: 'parent', kind: null });
      expect(setCustomUserClaims).toHaveBeenCalledWith(
        'firebase-uid-123',
        expect.objectContaining({ role: 'parent' }),
      );
    } finally {
      await app.close();
    }
  });

  it('returns 409 when an existing role differs', async () => {
    const setCustomUserClaims = vi.fn(async () => {});
    const deps = makeDeps({ decoded: { role: 'parent' }, setCustomUserClaims });
    const app = await buildAppWithRoutes(deps);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/role-claim',
        headers: { authorization: 'Bearer good' },
        payload: { role: 'provider', kind: 'caregiver' },
      });
      expect(res.statusCode).toBe(409);
      expect(setCustomUserClaims).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('is idempotent when role+kind match', async () => {
    const setCustomUserClaims = vi.fn(async () => {});
    const deps = makeDeps({ decoded: { role: 'provider', kind: 'specialist' }, setCustomUserClaims });
    const app = await buildAppWithRoutes(deps);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/role-claim',
        headers: { authorization: 'Bearer good' },
        payload: { role: 'provider', kind: 'specialist' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ role: 'provider', kind: 'specialist' });
      expect(setCustomUserClaims).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('400s when provider role is requested without a kind', async () => {
    const app = await buildAppWithRoutes(makeDeps({}));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/role-claim',
        headers: { authorization: 'Bearer good' },
        payload: { role: 'provider' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('400s when caregiverCategory accompanies kind=specialist', async () => {
    const app = await buildAppWithRoutes(makeDeps({}));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/role-claim',
        headers: { authorization: 'Bearer good' },
        payload: { role: 'provider', kind: 'specialist', caregiverCategory: 'babysitter' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/auth/email-otp/issue', () => {
  beforeEach(() => resetEnvForTests());

  it('400s when token has no email', async () => {
    const app = await buildAppWithRoutes(makeDeps({ decoded: { email: undefined } }));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/email-otp/issue',
        headers: { authorization: 'Bearer good' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'no_email_on_account' });
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/auth/email-otp/verify', () => {
  beforeEach(() => resetEnvForTests());

  it('400s on non-6-digit code', async () => {
    const app = await buildAppWithRoutes(makeDeps({}));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/email-otp/verify',
        headers: { authorization: 'Bearer good' },
        payload: { code: 'abc123' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/auth/step-up/refresh', () => {
  beforeEach(() => resetEnvForTests());

  it('400s when token has no sign_in_second_factor', async () => {
    const app = await buildAppWithRoutes(makeDeps({}));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/step-up/refresh',
        headers: { authorization: 'Bearer good' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'no_second_factor' });
    } finally {
      await app.close();
    }
  });
});
