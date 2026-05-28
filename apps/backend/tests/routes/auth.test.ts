import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDeps } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';
import { authPlugin } from '@/plugins/auth.js';
import { authRoutes } from '@/routes/auth.js';

import { applyTestEnv, mintAccessToken } from '../helpers/test-jwt.js';

function envForTest() {
  resetEnvForTests();
  applyTestEnv();
  return loadEnv();
}

function makeDeps(opts: {
  updateUserById?: ReturnType<typeof vi.fn>;
}): AppDeps {
  const passThrough = new Proxy({} as never, { get: () => passThrough });
  const updateUserById = opts.updateUserById ?? vi.fn(async () => ({ data: null, error: null }));

  return {
    env: envForTest(),
    db: passThrough,
    supabase: {
      admin: {
        auth: { admin: { updateUserById } },
      } as never,
    },
    storage: passThrough,
    queue: passThrough,
    stripe: passThrough,
    backgroundCheck: passThrough,
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
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const deps = makeDeps({ updateUserById });
    const app = await buildAppWithRoutes(deps);
    const token = await mintAccessToken({ sub: 'supabase-uid-123', email: 'parent@example.com' });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/role-claim',
        headers: { authorization: `Bearer ${token}` },
        payload: { role: 'parent' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ role: 'parent', kind: null });
      expect(updateUserById).toHaveBeenCalledWith(
        'supabase-uid-123',
        expect.objectContaining({
          app_metadata: expect.objectContaining({ role: 'parent' }),
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('returns 409 when an existing role differs', async () => {
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const deps = makeDeps({ updateUserById });
    const app = await buildAppWithRoutes(deps);
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'parent' },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/role-claim',
        headers: { authorization: `Bearer ${token}` },
        payload: { role: 'provider', kind: 'caregiver' },
      });
      expect(res.statusCode).toBe(409);
      expect(updateUserById).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('is idempotent when role+kind match', async () => {
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const deps = makeDeps({ updateUserById });
    const app = await buildAppWithRoutes(deps);
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'provider', kind: 'specialist' },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/role-claim',
        headers: { authorization: `Bearer ${token}` },
        payload: { role: 'provider', kind: 'specialist' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ role: 'provider', kind: 'specialist' });
      expect(updateUserById).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('400s when provider role is requested without a kind', async () => {
    const app = await buildAppWithRoutes(makeDeps({}));
    const token = await mintAccessToken({ sub: 'supabase-uid-123' });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/role-claim',
        headers: { authorization: `Bearer ${token}` },
        payload: { role: 'provider' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('400s when caregiverCategory accompanies kind=specialist', async () => {
    const app = await buildAppWithRoutes(makeDeps({}));
    const token = await mintAccessToken({ sub: 'supabase-uid-123' });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/role-claim',
        headers: { authorization: `Bearer ${token}` },
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
    const app = await buildAppWithRoutes(makeDeps({}));
    const token = await mintAccessToken({ sub: 'supabase-uid-123', email: null });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/email-otp/issue',
        headers: { authorization: `Bearer ${token}` },
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
    const token = await mintAccessToken({ sub: 'supabase-uid-123', email: 'p@example.com' });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/email-otp/verify',
        headers: { authorization: `Bearer ${token}` },
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

  it('400s when token is aal1 (no second factor)', async () => {
    const app = await buildAppWithRoutes(makeDeps({}));
    const token = await mintAccessToken({ sub: 'supabase-uid-123' });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/step-up/refresh',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'no_second_factor' });
    } finally {
      await app.close();
    }
  });
});
