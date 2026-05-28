import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AppDeps } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';
import { authPlugin, type RequireAuthOptions } from '@/plugins/auth.js';

import { applyTestEnv, mintAccessToken } from '../helpers/test-jwt.js';

function makeDeps(): AppDeps {
  resetEnvForTests();
  applyTestEnv();
  const env = loadEnv();

  const passThrough = new Proxy({} as never, { get: () => passThrough });

  return {
    env,
    db: passThrough,
    supabase: { admin: passThrough },
    storage: passThrough,
    queue: passThrough,
    stripe: passThrough,
    backgroundCheck: passThrough,
  };
}

async function buildTestApp(deps: AppDeps, opts?: RequireAuthOptions) {
  const app = Fastify({ logger: { level: 'fatal' }, disableRequestLogging: true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);
  await app.register(authPlugin);

  app.get('/probe', { preHandler: app.requireAuth(opts) }, async (req) => ({
    uid: req.principal!.uid,
    role: req.principal!.role,
    kind: req.principal!.kind,
    secondFactor: req.principal!.secondFactor,
  }));

  return app;
}

describe('auth plugin — requireAuth()', () => {
  beforeEach(() => {
    resetEnvForTests();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const app = await buildTestApp(makeDeps());
    try {
      const res = await app.inject({ method: 'GET', url: '/probe' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'missing_bearer_token' });
    } finally {
      await app.close();
    }
  });

  it('returns 401 when bearer prefix is missing', async () => {
    const app = await buildTestApp(makeDeps());
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: 'token-without-bearer' },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 401 when token signature is invalid', async () => {
    const app = await buildTestApp(makeDeps());
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: 'Bearer not.a.real.jwt' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'invalid_token' });
    } finally {
      await app.close();
    }
  });

  it('populates principal on a valid token (parent)', async () => {
    const app = await buildTestApp(makeDeps());
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      email: 'parent@example.com',
      appMetadata: { role: 'parent' },
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ uid: 'supabase-uid-123', role: 'parent', kind: null });
    } finally {
      await app.close();
    }
  });

  it('returns 403 when token has no role claim but route requires one', async () => {
    const app = await buildTestApp(makeDeps(), { roles: ['parent'] });
    const token = await mintAccessToken({ sub: 'supabase-uid-123' });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden_role' });
    } finally {
      await app.close();
    }
  });

  it('returns 403 when role mismatches', async () => {
    const app = await buildTestApp(makeDeps(), { roles: ['admin'] });
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'parent' },
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('honors provider kind from app_metadata', async () => {
    const app = await buildTestApp(makeDeps(), { roles: ['provider'] });
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'provider', kind: 'specialist' },
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ role: 'provider', kind: 'specialist' });
    } finally {
      await app.close();
    }
  });

  it('strips kind for non-provider roles', async () => {
    const app = await buildTestApp(makeDeps());
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'parent', kind: 'specialist' },
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ role: 'parent', kind: null });
    } finally {
      await app.close();
    }
  });

  it('derives secondFactor=totp from aal2 + amr={mfa/totp}', async () => {
    const app = await buildTestApp(makeDeps());
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'provider', kind: 'caregiver' },
      aal: 'aal2',
      amr: [
        { method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 },
        { method: 'mfa/totp', timestamp: Math.floor(Date.now() / 1000) - 5 },
      ],
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ secondFactor: 'totp' });
    } finally {
      await app.close();
    }
  });

  it('leaves secondFactor null on aal1 tokens', async () => {
    const app = await buildTestApp(makeDeps());
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'provider', kind: 'caregiver' },
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ secondFactor: null });
    } finally {
      await app.close();
    }
  });
});
