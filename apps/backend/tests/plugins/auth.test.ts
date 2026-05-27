import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDeps } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';
import { authPlugin, type RequireAuthOptions } from '@/plugins/auth.js';

function makeDeps(overrides?: {
  verifyIdToken?: (token: string, checkRevoked?: boolean) => Promise<DecodedIdToken>;
}): AppDeps {
  resetEnvForTests();
  process.env.NODE_ENV = 'test';
  process.env.GCP_PROJECT_ID = 'our-haven-test';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/our_haven_test';
  process.env.GCS_UPLOAD_BUCKET = 'our-haven-test-bucket';
  process.env.LOG_LEVEL = 'fatal';
  const env = loadEnv();

  const passThrough = new Proxy({} as never, { get: () => passThrough });

  const verifyIdToken =
    overrides?.verifyIdToken ??
    vi.fn(async () => {
      throw new Error('verifyIdToken not stubbed for this test');
    });

  return {
    env,
    db: passThrough,
    firebase: {
      auth: { verifyIdToken, setCustomUserClaims: vi.fn() } as never,
      firestore: passThrough,
    },
    storage: passThrough,
    tasks: passThrough,
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
  }));

  return app;
}

const validDecoded = (extra?: Partial<DecodedIdToken & Record<string, unknown>>): DecodedIdToken =>
  ({
    uid: 'firebase-uid-123',
    sub: 'firebase-uid-123',
    aud: 'our-haven-test',
    iss: 'https://securetoken.google.com/our-haven-test',
    iat: Math.floor(Date.now() / 1000) - 5,
    exp: Math.floor(Date.now() / 1000) + 3600,
    auth_time: Math.floor(Date.now() / 1000) - 60,
    email: 'parent@example.com',
    phone_number: null,
    firebase: { identities: {}, sign_in_provider: 'password' },
    ...extra,
  }) as unknown as DecodedIdToken;

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

  it('returns 401 when verifyIdToken throws', async () => {
    const app = await buildTestApp(
      makeDeps({
        verifyIdToken: vi.fn(async () => {
          throw new Error('expired');
        }),
      }),
    );
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: 'Bearer bogus' },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'invalid_token' });
    } finally {
      await app.close();
    }
  });

  it('populates principal on a valid token', async () => {
    const app = await buildTestApp(
      makeDeps({
        verifyIdToken: vi.fn(async () => validDecoded({ role: 'parent' })),
      }),
    );
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: 'Bearer good' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ uid: 'firebase-uid-123', role: 'parent', kind: null });
    } finally {
      await app.close();
    }
  });

  it('returns 403 when token has no role claim but route requires one', async () => {
    const deps = makeDeps({
      verifyIdToken: vi.fn(async () => validDecoded()),
    });
    const app = await buildTestApp(deps, { roles: ['parent'] });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: 'Bearer good' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden_role' });
    } finally {
      await app.close();
    }
  });

  it('returns 403 when role mismatches', async () => {
    const deps = makeDeps({
      verifyIdToken: vi.fn(async () => validDecoded({ role: 'parent' })),
    });
    const app = await buildTestApp(deps, { roles: ['admin'] });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: 'Bearer good' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('honors provider kind from custom claims', async () => {
    const app = await buildTestApp(
      makeDeps({
        verifyIdToken: vi.fn(async () => validDecoded({ role: 'provider', kind: 'specialist' })),
      }),
      { roles: ['provider'] },
    );
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: 'Bearer good' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ role: 'provider', kind: 'specialist' });
    } finally {
      await app.close();
    }
  });

  it('strips kind for non-provider roles', async () => {
    const app = await buildTestApp(
      makeDeps({
        verifyIdToken: vi.fn(async () => validDecoded({ role: 'parent', kind: 'specialist' })),
      }),
    );
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/probe',
        headers: { authorization: 'Bearer good' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ role: 'parent', kind: null });
    } finally {
      await app.close();
    }
  });
});
