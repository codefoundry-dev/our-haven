import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDeps } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';
import { authPlugin } from '@/plugins/auth.js';
import { verificationRoutes } from '@/routes/verification.js';

import { applyTestEnv, mintAccessToken } from '../helpers/test-jwt.js';

function envForTest(overrides: Record<string, string> = {}) {
  resetEnvForTests();
  applyTestEnv();
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
  return loadEnv();
}

interface ProviderRow {
  id: string;
  uid: string;
  role: 'caregiver' | 'provider';
  state: string;
}

interface VerificationRow {
  provider_id: string;
  email_confirmed_at: Date | null;
  phone_confirmed_at: Date | null;
  id_doc_object_path: string | null;
  id_doc_uploaded_at: Date | null;
  screening_initiated_at: Date | null;
  screening_passed_at: Date | null;
  license_verified_at: Date | null;
  rejected_at: Date | null;
  rejection_reason: string | null;
}

interface DbStubOpts {
  provider?: ProviderRow | null;
  verification?: VerificationRow | null;
}

function makeDbStub(opts: DbStubOpts) {
  let verification: VerificationRow | null = opts.verification ?? null;

  const db = {
    selectFrom(table: string) {
      if (table === 'providers') {
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: vi.fn(async () => opts.provider ?? undefined),
            }),
          }),
        };
      }
      if (table === 'provider_verifications') {
        return {
          selectAll: () => ({
            where: () => ({
              executeTakeFirst: vi.fn(async () => verification ?? undefined),
            }),
          }),
        };
      }
      if (table === 'provider_connect_accounts') {
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: vi.fn(async () => undefined),
            }),
          }),
        };
      }
      throw new Error(`unstubbed selectFrom(${table})`);
    },
    insertInto(table: string) {
      if (table === 'provider_verifications') {
        return {
          values: (vals: Partial<VerificationRow>) => ({
            returningAll: () => ({
              executeTakeFirstOrThrow: vi.fn(async () => {
                const fresh: VerificationRow = {
                  provider_id: vals.provider_id ?? '',
                  email_confirmed_at: null,
                  phone_confirmed_at: null,
                  id_doc_object_path: null,
                  id_doc_uploaded_at: null,
                  screening_initiated_at: null,
                  screening_passed_at: null,
                  license_verified_at: null,
                  rejected_at: null,
                  rejection_reason: null,
                  ...vals,
                };
                verification = fresh;
                return fresh;
              }),
            }),
          }),
        };
      }
      throw new Error(`unstubbed insertInto(${table})`);
    },
    updateTable(table: string) {
      if (table === 'provider_verifications') {
        let patch: Partial<VerificationRow> = {};
        const chain = {
          set: (next: Partial<VerificationRow>) => {
            patch = { ...patch, ...next };
            return chain;
          },
          where: () => chain,
          returningAll: () => chain,
          executeTakeFirstOrThrow: vi.fn(async () => {
            verification = { ...(verification ?? ({} as VerificationRow)), ...patch };
            return verification!;
          }),
        };
        return chain;
      }
      throw new Error(`unstubbed updateTable(${table})`);
    },
  };

  return { db, getVerification: () => verification };
}

function makeDeps(opts: {
  db: unknown;
  getUserById?: ReturnType<typeof vi.fn>;
  envOverrides?: Record<string, string>;
}): AppDeps {
  const passThrough = new Proxy({} as never, { get: () => passThrough });
  const getUserById =
    opts.getUserById ??
    vi.fn(async () => ({ data: { user: { email_confirmed_at: null, phone_confirmed_at: null } }, error: null }));

  return {
    env: envForTest(opts.envOverrides),
    db: opts.db as never,
    supabase: {
      admin: {
        auth: { admin: { getUserById, updateUserById: vi.fn(async () => ({ data: null, error: null })) } },
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
  await app.register(verificationRoutes, { prefix: '/v1' });
  return app;
}

describe('GET /v1/providers/me/verification', () => {
  beforeEach(() => resetEnvForTests());

  it('401s without a bearer token', async () => {
    const { db } = makeDbStub({});
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const res = await app.inject({ method: 'GET', url: '/v1/providers/me/verification' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('403s when the bearer token is not a provider role', async () => {
    const { db } = makeDbStub({});
    const app = await buildAppWithRoutes(makeDeps({ db }));
    const token = await mintAccessToken({
      sub: 'u-1',
      email: 'p@example.com',
      appMetadata: { role: 'parent' },
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/verification',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('404s when no Provider row exists yet', async () => {
    const { db } = makeDbStub({ provider: null });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    const token = await mintAccessToken({
      sub: 'u-1',
      appMetadata: { role: 'caregiver' },
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/verification',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('provider_not_found');
    } finally {
      await app.close();
    }
  });

  it('returns unverified state for a fresh Provider with no facts', async () => {
    const { db } = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
    });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    const token = await mintAccessToken({
      sub: 'u-1',
      appMetadata: { role: 'caregiver' },
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/verification',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.state).toBe('unverified');
      expect(body.role).toBe('caregiver');
      expect(body.residentState).toBe('NY');
      expect(body.facts.emailConfirmedAt).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('mirrors Supabase email_confirmed_at into facts on read', async () => {
    const { db, getVerification } = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
    });
    const getUserById = vi.fn(async () => ({
      data: { user: { email_confirmed_at: '2026-05-20T12:00:00Z', phone_confirmed_at: null } },
      error: null,
    }));
    const app = await buildAppWithRoutes(makeDeps({ db, getUserById }));
    const token = await mintAccessToken({
      sub: 'u-1',
      appMetadata: { role: 'caregiver' },
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/verification',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.state).toBe('email-verified');
      expect(body.facts.emailConfirmedAt).toBe('2026-05-20T12:00:00.000Z');
      expect(getVerification()?.email_confirmed_at).toBeInstanceOf(Date);
    } finally {
      await app.close();
    }
  });

  it('flags licenseBoardSupported=false for a provider outside the supported-state slate', async () => {
    const { db } = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'provider', state: 'WY' },
    });
    const app = await buildAppWithRoutes(
      makeDeps({ db, envOverrides: { LICENSE_BOARD_SUPPORTED_STATES: 'FL,NY' } }),
    );
    const token = await mintAccessToken({
      sub: 'u-1',
      appMetadata: { role: 'provider' },
    });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/verification',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().licenseBoardSupported).toBe(false);
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/providers/me/verification/id-doc', () => {
  beforeEach(() => resetEnvForTests());

  it('400s when objectPath is not scoped to the calling user', async () => {
    const { db } = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
    });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    const token = await mintAccessToken({
      sub: 'u-1',
      appMetadata: { role: 'caregiver' },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/verification/id-doc',
        headers: { authorization: `Bearer ${token}` },
        payload: { objectPath: 'id-doc/someone-else/abcd.png' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_object_path');
    } finally {
      await app.close();
    }
  });

  it('records the upload and advances to id-uploaded once email+phone are confirmed', async () => {
    const { db, getVerification } = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      verification: {
        provider_id: 'p-1',
        email_confirmed_at: new Date('2026-05-20T12:00:00Z'),
        phone_confirmed_at: new Date('2026-05-20T12:05:00Z'),
        id_doc_object_path: null,
        id_doc_uploaded_at: null,
        screening_initiated_at: null,
        screening_passed_at: null,
        license_verified_at: null,
        rejected_at: null,
        rejection_reason: null,
      },
    });
    const getUserById = vi.fn(async () => ({
      data: { user: { email_confirmed_at: '2026-05-20T12:00:00Z', phone_confirmed_at: '2026-05-20T12:05:00Z' } },
      error: null,
    }));
    const app = await buildAppWithRoutes(makeDeps({ db, getUserById }));
    const token = await mintAccessToken({
      sub: 'u-1',
      appMetadata: { role: 'caregiver' },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/verification/id-doc',
        headers: { authorization: `Bearer ${token}` },
        payload: { objectPath: 'id-doc/u-1/abcd.png' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.state).toBe('id-uploaded');
      expect(body.facts.idDocObjectPath).toBe('id-doc/u-1/abcd.png');
      expect(getVerification()?.id_doc_object_path).toBe('id-doc/u-1/abcd.png');
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/providers/me/verification/phone-confirm', () => {
  beforeEach(() => resetEnvForTests());

  it('400s when supabase user has no phone_confirmed_at', async () => {
    const { db } = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
    });
    const getUserById = vi.fn(async () => ({
      data: { user: { email_confirmed_at: '2026-05-20T12:00:00Z', phone_confirmed_at: null } },
      error: null,
    }));
    const app = await buildAppWithRoutes(makeDeps({ db, getUserById }));
    const token = await mintAccessToken({
      sub: 'u-1',
      appMetadata: { role: 'caregiver' },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/verification/phone-confirm',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('phone_not_confirmed');
    } finally {
      await app.close();
    }
  });

  it('records phone_confirmed_at; phone is off-spine so state stays email-verified until ID upload (OH-181)', async () => {
    const { db, getVerification } = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      verification: {
        provider_id: 'p-1',
        email_confirmed_at: new Date('2026-05-20T12:00:00Z'),
        phone_confirmed_at: null,
        id_doc_object_path: null,
        id_doc_uploaded_at: null,
        screening_initiated_at: null,
        screening_passed_at: null,
        license_verified_at: null,
        rejected_at: null,
        rejection_reason: null,
      },
    });
    const getUserById = vi.fn(async () => ({
      data: { user: { email_confirmed_at: '2026-05-20T12:00:00Z', phone_confirmed_at: '2026-05-20T13:00:00Z' } },
      error: null,
    }));
    const app = await buildAppWithRoutes(makeDeps({ db, getUserById }));
    const token = await mintAccessToken({
      sub: 'u-1',
      appMetadata: { role: 'caregiver' },
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/verification/phone-confirm',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Phone is a hard ACTIVATION gate (ADR-0015), not a linear step — with
      // email confirmed but no ID yet, the spine rests at email-verified while
      // the phone fact is recorded for the final activation gate.
      expect(body.state).toBe('email-verified');
      expect(body.facts.phoneConfirmedAt).toBe('2026-05-20T13:00:00.000Z');
      expect(getVerification()?.phone_confirmed_at).toBeInstanceOf(Date);
    } finally {
      await app.close();
    }
  });
});
