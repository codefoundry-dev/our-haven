import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDeps } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';
import { authPlugin } from '@/plugins/auth.js';
import { providerRoutes } from '@/routes/providers.js';

import { applyTestEnv, mintAccessToken } from '../helpers/test-jwt.js';

function envForTest() {
  resetEnvForTests();
  applyTestEnv();
  return loadEnv();
}

interface ProviderRow {
  id: string;
  uid: string;
  role: 'caregiver' | 'provider';
  categories: string[] | null;
  specialty: string | null;
  state: string;
  created_at: Date;
}

interface DbStubOpts {
  existing?: ProviderRow | null;
  insertReturns?: ProviderRow;
}

function makeDbStub(opts: DbStubOpts) {
  const insertSpy = vi.fn();
  const selectSpy = vi.fn();

  const selectChain = {
    select: () => selectChain,
    where: () => selectChain,
    executeTakeFirst: vi.fn(async () => {
      selectSpy();
      return opts.existing ?? undefined;
    }),
  };

  const insertChain = {
    values: () => insertChain,
    returning: () => insertChain,
    executeTakeFirstOrThrow: vi.fn(async () => {
      insertSpy();
      if (!opts.insertReturns) throw new Error('insert stub had no insertReturns');
      return opts.insertReturns;
    }),
  };

  const db = {
    selectFrom: () => selectChain,
    insertInto: () => insertChain,
  };

  return { db, insertSpy, selectSpy };
}

function makeDeps(opts: {
  updateUserById?: ReturnType<typeof vi.fn>;
  db?: unknown;
}): AppDeps {
  const passThrough = new Proxy({} as never, { get: () => passThrough });
  const updateUserById = opts.updateUserById ?? vi.fn(async () => ({ data: null, error: null }));

  return {
    env: envForTest(),
    db: (opts.db ?? passThrough) as never,
    supabase: {
      admin: {
        auth: { admin: { updateUserById } },
      } as never,
    },
    storage: passThrough,
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
  await app.register(providerRoutes, { prefix: '/v1' });
  return app;
}

describe('POST /v1/providers', () => {
  beforeEach(() => resetEnvForTests());

  it('401s without a bearer token', async () => {
    const { db } = makeDbStub({ existing: null });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers',
        payload: { role: 'caregiver', categories: ['babysitter'], state: 'NY' },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('400s on unknown state', async () => {
    const { db } = makeDbStub({ existing: null });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    const token = await mintAccessToken({ sub: 'supabase-uid-prov-1', email: 'provider@example.com' });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers',
        headers: { authorization: `Bearer ${token}` },
        payload: { role: 'caregiver', categories: ['babysitter'], state: 'ZZ' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('400s when caregiver tab includes specialty (strict schema)', async () => {
    const { db } = makeDbStub({ existing: null });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    const token = await mintAccessToken({ sub: 'supabase-uid-prov-1', email: 'provider@example.com' });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers',
        headers: { authorization: `Bearer ${token}` },
        payload: { role: 'caregiver', categories: ['babysitter'], specialty: 'slp', state: 'NY' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('creates a caregiver Provider, persists row + sets claims, returns 201', async () => {
    const insertReturns: ProviderRow = {
      id: '0193a4b1-0001-7a01-9abc-000000000001',
      uid: 'supabase-uid-prov-1',
      role: 'caregiver',
      categories: ['babysitter'],
      specialty: null,
      state: 'NY',
      created_at: new Date('2026-05-27T12:00:00Z'),
    };
    const { db, insertSpy } = makeDbStub({ existing: null, insertReturns });
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const app = await buildAppWithRoutes(makeDeps({ db, updateUserById }));
    const token = await mintAccessToken({ sub: 'supabase-uid-prov-1', email: 'provider@example.com' });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers',
        headers: { authorization: `Bearer ${token}` },
        payload: { role: 'caregiver', categories: ['babysitter'], state: 'NY' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({
        id: insertReturns.id,
        uid: insertReturns.uid,
        role: 'caregiver',
        categories: ['babysitter'],
        specialty: null,
        state: 'NY',
        createdAt: '2026-05-27T12:00:00.000Z',
      });
      expect(insertSpy).toHaveBeenCalledOnce();
      expect(updateUserById).toHaveBeenCalledWith(
        'supabase-uid-prov-1',
        expect.objectContaining({
          app_metadata: expect.objectContaining({
            role: 'caregiver',
            categories: ['babysitter'],
            state: 'NY',
          }),
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('creates a Provider (clinical) with specialty + state', async () => {
    const insertReturns: ProviderRow = {
      id: '0193a4b1-0002-7a02-9abc-000000000002',
      uid: 'supabase-uid-prov-1',
      role: 'provider',
      categories: null,
      specialty: 'slp',
      state: 'CA',
      created_at: new Date('2026-05-27T12:30:00Z'),
    };
    const { db } = makeDbStub({ existing: null, insertReturns });
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const app = await buildAppWithRoutes(makeDeps({ db, updateUserById }));
    const token = await mintAccessToken({ sub: 'supabase-uid-prov-1', email: 'provider@example.com' });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers',
        headers: { authorization: `Bearer ${token}` },
        payload: { role: 'provider', specialty: 'slp', state: 'CA' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.specialty).toBe('slp');
      expect(body.categories).toBeNull();
      expect(body.state).toBe('CA');
      expect(updateUserById).toHaveBeenCalledWith(
        'supabase-uid-prov-1',
        expect.objectContaining({
          app_metadata: expect.objectContaining({
            role: 'provider',
            specialty: 'slp',
            state: 'CA',
          }),
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('is idempotent when the existing Provider row matches the request', async () => {
    const existing: ProviderRow = {
      id: '0193a4b1-0003-7a03-9abc-000000000003',
      uid: 'supabase-uid-prov-1',
      role: 'caregiver',
      categories: ['nanny'],
      specialty: null,
      state: 'TX',
      created_at: new Date('2026-05-20T08:00:00Z'),
    };
    const { db, insertSpy } = makeDbStub({ existing });
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const app = await buildAppWithRoutes(makeDeps({ db, updateUserById }));
    const token = await mintAccessToken({ sub: 'supabase-uid-prov-1', email: 'provider@example.com' });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers',
        headers: { authorization: `Bearer ${token}` },
        payload: { role: 'caregiver', categories: ['nanny'], state: 'TX' },
      });
      expect(res.statusCode).toBe(200);
      expect(insertSpy).not.toHaveBeenCalled();
      expect(updateUserById).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('409s when existing Provider differs on role/categories/state', async () => {
    const existing: ProviderRow = {
      id: '0193a4b1-0004-7a04-9abc-000000000004',
      uid: 'supabase-uid-prov-1',
      role: 'caregiver',
      categories: ['babysitter'],
      specialty: null,
      state: 'NY',
      created_at: new Date('2026-05-20T08:00:00Z'),
    };
    const { db } = makeDbStub({ existing });
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const app = await buildAppWithRoutes(makeDeps({ db, updateUserById }));
    const token = await mintAccessToken({ sub: 'supabase-uid-prov-1', email: 'provider@example.com' });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers',
        headers: { authorization: `Bearer ${token}` },
        payload: { role: 'caregiver', categories: ['tutor'], state: 'NY' },
      });
      expect(res.statusCode).toBe(409);
      expect(updateUserById).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('409s when account is already bound as parent', async () => {
    const { db } = makeDbStub({ existing: null });
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const app = await buildAppWithRoutes(makeDeps({ db, updateUserById }));
    const token = await mintAccessToken({
      sub: 'supabase-uid-prov-1',
      email: 'provider@example.com',
      appMetadata: { role: 'parent' },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers',
        headers: { authorization: `Bearer ${token}` },
        payload: { role: 'caregiver', categories: ['babysitter'], state: 'NY' },
      });
      expect(res.statusCode).toBe(409);
      expect(updateUserById).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
