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
    categories: req.principal!.categories,
    specialty: req.principal!.specialty,
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
      expect(res.json()).toMatchObject({
        uid: 'supabase-uid-123',
        role: 'parent',
        categories: null,
        specialty: null,
      });
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
    const app = await buildTestApp(makeDeps(), { roles: ['caregiver'] });
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

  it('honors provider specialty from app_metadata', async () => {
    const app = await buildTestApp(makeDeps(), { roles: ['provider'] });
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'provider', specialty: 'slp' },
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ role: 'provider', specialty: 'slp', categories: null });
    } finally {
      await app.close();
    }
  });

  it('honors caregiver categories from app_metadata', async () => {
    const app = await buildTestApp(makeDeps(), { roles: ['caregiver'] });
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'caregiver', categories: ['babysitter', 'nanny'] },
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        role: 'caregiver',
        categories: ['babysitter', 'nanny'],
        specialty: null,
      });
    } finally {
      await app.close();
    }
  });

  it('strips categories/specialty for roles that do not carry them', async () => {
    const app = await buildTestApp(makeDeps());
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'parent', categories: ['babysitter'], specialty: 'slp' },
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ role: 'parent', categories: null, specialty: null });
    } finally {
      await app.close();
    }
  });

  it('derives secondFactor=totp from aal2 + amr={mfa/totp}', async () => {
    const app = await buildTestApp(makeDeps());
    const token = await mintAccessToken({
      sub: 'supabase-uid-123',
      appMetadata: { role: 'caregiver', categories: ['babysitter'] },
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
      appMetadata: { role: 'caregiver', categories: ['babysitter'] },
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

  // Admin TOTP is mandatory server-side on every request (OH-175 — CONTEXT § MFA posture).
  describe('admin TOTP enforcement', () => {
    it('403 admin_totp_required when an admin token is aal1 (no TOTP)', async () => {
      const app = await buildTestApp(makeDeps());
      const token = await mintAccessToken({ sub: 'admin-1', appMetadata: { role: 'admin' } });
      try {
        const res = await app.inject({
          method: 'GET',
          url: '/probe',
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'admin_totp_required' });
      } finally {
        await app.close();
      }
    });

    it('passes an admin token with aal2 + TOTP', async () => {
      const app = await buildTestApp(makeDeps(), { roles: ['admin'] });
      const now = Math.floor(Date.now() / 1000);
      const token = await mintAccessToken({
        sub: 'admin-1',
        appMetadata: { role: 'admin' },
        aal: 'aal2',
        amr: [{ method: 'mfa/totp', timestamp: now }],
      });
      try {
        const res = await app.inject({
          method: 'GET',
          url: '/probe',
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ role: 'admin', secondFactor: 'totp' });
      } finally {
        await app.close();
      }
    });
  });
});
