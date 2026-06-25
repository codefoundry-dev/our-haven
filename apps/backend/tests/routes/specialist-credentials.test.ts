import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDeps } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';
import { authPlugin } from '@/plugins/auth.js';
import { specialistCredentialsRoutes } from '@/routes/specialist-credentials.js';

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
}

interface CredentialsRow {
  provider_id: string;
  license_board_state: string | null;
  license_number: string | null;
  license_doc_object_path: string | null;
  license_uploaded_at: Date | null;
  insurance_doc_object_path: string | null;
  insurance_uploaded_at: Date | null;
  decision: 'verified' | 'rejected' | null;
  decision_at: Date | null;
  decision_by_admin_uid: string | null;
  decision_notes: string | null;
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

function emptyCredentials(providerId: string): CredentialsRow {
  return {
    provider_id: providerId,
    license_board_state: null,
    license_number: null,
    license_doc_object_path: null,
    license_uploaded_at: null,
    insurance_doc_object_path: null,
    insurance_uploaded_at: null,
    decision: null,
    decision_at: null,
    decision_by_admin_uid: null,
    decision_notes: null,
  };
}

interface DbStubOpts {
  providerByUid?: ProviderRow | null;
  providerById?: ProviderRow | null;
  credentials?: CredentialsRow | null;
  verification?: VerificationRow | null;
}

function makeDbStub(opts: DbStubOpts) {
  let credentials: CredentialsRow | null = opts.credentials ?? null;
  let verification: VerificationRow | null = opts.verification ?? null;
  const verifInsertSpy = vi.fn();
  const verifUpdateSpy = vi.fn();
  const credUpdateSpy = vi.fn();

  const db = {
    selectFrom(table: string) {
      if (table === 'providers') {
        return {
          select: () => ({
            where: (_col: string, _op: string, val: string) => ({
              executeTakeFirst: vi.fn(async () => {
                if (opts.providerByUid && opts.providerByUid.uid === val) return opts.providerByUid;
                if (opts.providerById && opts.providerById.id === val) return opts.providerById;
                return undefined;
              }),
            }),
          }),
        };
      }
      if (table === 'specialist_credentials') {
        return {
          selectAll: () => ({
            where: () => ({
              executeTakeFirst: vi.fn(async () => credentials ?? undefined),
            }),
          }),
        };
      }
      if (table === 'provider_verifications') {
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: vi.fn(async () => verification ?? undefined),
            }),
          }),
        };
      }
      throw new Error(`unstubbed selectFrom(${table})`);
    },
    insertInto(table: string) {
      if (table === 'specialist_credentials') {
        return {
          values: (vals: Partial<CredentialsRow>) => ({
            returningAll: () => ({
              executeTakeFirstOrThrow: vi.fn(async () => {
                const fresh = { ...emptyCredentials(vals.provider_id ?? ''), ...vals };
                credentials = fresh;
                return fresh;
              }),
            }),
          }),
        };
      }
      if (table === 'provider_verifications') {
        return {
          values: (vals: Partial<VerificationRow>) => ({
            execute: vi.fn(async () => {
              verification = {
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
              verifInsertSpy(verification);
            }),
          }),
        };
      }
      throw new Error(`unstubbed insertInto(${table})`);
    },
    updateTable(table: string) {
      if (table === 'specialist_credentials') {
        let patch: Partial<CredentialsRow> = {};
        const chain = {
          set: (p: Partial<CredentialsRow>) => {
            patch = p;
            credUpdateSpy(p);
            return chain;
          },
          where: () => chain,
          returningAll: () => chain,
          executeTakeFirstOrThrow: vi.fn(async () => {
            if (!credentials) throw new Error('credentials row missing');
            credentials = { ...credentials, ...patch };
            return credentials;
          }),
        };
        return chain;
      }
      if (table === 'provider_verifications') {
        let patch: Partial<VerificationRow> = {};
        const chain = {
          set: (p: Partial<VerificationRow>) => {
            patch = p;
            verifUpdateSpy(p);
            return chain;
          },
          where: () => chain,
          execute: vi.fn(async () => {
            if (verification) verification = { ...verification, ...patch };
          }),
        };
        return chain;
      }
      throw new Error(`unstubbed updateTable(${table})`);
    },
  };

  return {
    db,
    getCredentials: () => credentials,
    getVerification: () => verification,
    credUpdateSpy,
    verifUpdateSpy,
    verifInsertSpy,
  };
}

function makeDeps(opts: { db?: unknown }): AppDeps {
  const passThrough = new Proxy({} as never, { get: () => passThrough });
  return {
    env: envForTest(),
    db: (opts.db ?? passThrough) as never,
    supabase: passThrough,
    storage: passThrough,
    queue: passThrough,
    stripe: passThrough,
    backgroundCheck: passThrough,
  };
}

async function buildAppWithRoutes(deps: AppDeps) {
  const app = Fastify({ logger: { level: 'fatal' }, disableRequestLogging: true })
    .withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);
  await app.register(authPlugin);
  await app.register(specialistCredentialsRoutes, { prefix: '/v1' });
  return app;
}

async function providerToken(uid: string): Promise<string> {
  return mintAccessToken({
    sub: uid,
    email: `${uid}@example.com`,
    appMetadata: { role: 'provider', specialty: 'slp' },
  });
}

async function caregiverToken(uid: string): Promise<string> {
  return mintAccessToken({
    sub: uid,
    email: `${uid}@example.com`,
    appMetadata: { role: 'caregiver', categories: ['babysitter'] },
  });
}

async function adminToken(uid: string): Promise<string> {
  // Admin acts at aal2 with TOTP — the auth plugin rejects any admin token that
  // is not step-up-verified (403 admin_totp_required) on every request.
  return mintAccessToken({
    sub: uid,
    email: `${uid}@ourhaven.com`,
    appMetadata: { role: 'admin' },
    aal: 'aal2',
    amr: [{ method: 'totp' }],
  });
}

const PROVIDER_FL: ProviderRow = {
  id: '0193a4b1-1001-7a01-9abc-000000000001',
  uid: 'sup-uid-provider-fl',
  role: 'provider',
  categories: null,
  specialty: 'ot',
  state: 'FL',
};

const PROVIDER_AK: ProviderRow = {
  id: '0193a4b1-1002-7a02-9abc-000000000002',
  uid: 'sup-uid-provider-ak',
  role: 'provider',
  categories: null,
  specialty: 'slp',
  state: 'AK',
};

const CAREGIVER: ProviderRow = {
  id: '0193a4b1-1003-7a03-9abc-000000000003',
  uid: 'sup-uid-caregiver',
  role: 'caregiver',
  categories: ['babysitter'],
  specialty: null,
  state: 'NY',
};

describe('GET /v1/providers/me/credentials', () => {
  beforeEach(() => resetEnvForTests());

  it('returns FL board context for an OT Provider in FL', async () => {
    const { db } = makeDbStub({ providerByUid: PROVIDER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await providerToken(PROVIDER_FL.uid);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/credentials',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.role).toBe('provider');
      expect(body.residentState).toBe('FL');
      expect(body.licenseBoardSupported).toBe(true);
      expect(body.defaultBoard).not.toBeNull();
      expect(body.defaultBoard.state).toBe('FL');
      expect(body.defaultBoard.specialty).toBe('ot');
      expect(body.defaultBoard.registerUrl).toMatch(/^https:\/\//);
      expect(body.altBoardsInState).toHaveLength(5); // SLP+OT+ABA+Psych+Other
    } finally {
      await app.close();
    }
  });

  it('marks licenseBoardSupported=false for a Provider in a non-slate state', async () => {
    const { db } = makeDbStub({ providerByUid: PROVIDER_AK });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await providerToken(PROVIDER_AK.uid);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/credentials',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.licenseBoardSupported).toBe(false);
      expect(body.defaultBoard).toBeNull();
      expect(body.altBoardsInState).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('403s for a Caregiver (provider-only role guard)', async () => {
    const { db } = makeDbStub({ providerByUid: CAREGIVER });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await caregiverToken(CAREGIVER.uid);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/credentials',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('forbidden_role');
    } finally {
      await app.close();
    }
  });

  it('401s without a token', async () => {
    const { db } = makeDbStub({});
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const res = await app.inject({ method: 'GET', url: '/v1/providers/me/credentials' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('404s when no Provider row exists', async () => {
    const { db } = makeDbStub({ providerByUid: null });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await providerToken('orphan-uid');
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/credentials',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/providers/me/credentials/license', () => {
  beforeEach(() => resetEnvForTests());

  it('records a license upload + licenseNumber + licenseBoardState', async () => {
    const { db, getCredentials } = makeDbStub({ providerByUid: PROVIDER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await providerToken(PROVIDER_FL.uid);
      const objectPath = `license-doc/${PROVIDER_FL.uid}/abc-def-license.pdf`;
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/credentials/license',
        headers: { authorization: `Bearer ${token}` },
        payload: { objectPath, licenseNumber: 'OT12345', licenseBoardState: 'FL' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.licenseDocObjectPath).toBe(objectPath);
      expect(body.licenseNumber).toBe('OT12345');
      expect(body.licenseBoardState).toBe('FL');
      expect(body.licenseUploadedAt).not.toBeNull();
      expect(getCredentials()?.license_doc_object_path).toBe(objectPath);
    } finally {
      await app.close();
    }
  });

  it('400s when objectPath is not scoped to the caller', async () => {
    const { db } = makeDbStub({ providerByUid: PROVIDER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await providerToken(PROVIDER_FL.uid);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/credentials/license',
        headers: { authorization: `Bearer ${token}` },
        payload: { objectPath: 'license-doc/some-other-uid/file.pdf' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_object_path');
    } finally {
      await app.close();
    }
  });

  it('400s on too-long licenseNumber', async () => {
    const { db } = makeDbStub({ providerByUid: PROVIDER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await providerToken(PROVIDER_FL.uid);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/credentials/license',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          objectPath: `license-doc/${PROVIDER_FL.uid}/lic.pdf`,
          licenseNumber: 'X'.repeat(65),
        },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('403s for a Caregiver (provider-only role guard)', async () => {
    const { db } = makeDbStub({ providerByUid: CAREGIVER });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await caregiverToken(CAREGIVER.uid);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/credentials/license',
        headers: { authorization: `Bearer ${token}` },
        payload: { objectPath: `license-doc/${CAREGIVER.uid}/x.pdf` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('forbidden_role');
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/providers/me/credentials/insurance', () => {
  beforeEach(() => resetEnvForTests());

  it('records an insurance COI upload', async () => {
    const { db, getCredentials } = makeDbStub({ providerByUid: PROVIDER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await providerToken(PROVIDER_FL.uid);
      const objectPath = `insurance-doc/${PROVIDER_FL.uid}/coi.pdf`;
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/credentials/insurance',
        headers: { authorization: `Bearer ${token}` },
        payload: { objectPath },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.insuranceDocObjectPath).toBe(objectPath);
      expect(body.insuranceUploadedAt).not.toBeNull();
      expect(getCredentials()?.insurance_doc_object_path).toBe(objectPath);
    } finally {
      await app.close();
    }
  });

  it('400s when objectPath is not scoped to the caller', async () => {
    const { db } = makeDbStub({ providerByUid: PROVIDER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await providerToken(PROVIDER_FL.uid);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/credentials/insurance',
        headers: { authorization: `Bearer ${token}` },
        payload: { objectPath: 'insurance-doc/some-other-uid/file.pdf' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('Admin license verification', () => {
  beforeEach(() => resetEnvForTests());

  it('403s when the caller is a Provider, not an admin', async () => {
    const { db } = makeDbStub({ providerById: PROVIDER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await providerToken(PROVIDER_FL.uid);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/admin/providers/${PROVIDER_FL.id}/license-verification`,
        headers: { authorization: `Bearer ${token}` },
        payload: { decision: 'verified' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('admin GET returns board context + uploaded docs for a Provider', async () => {
    const cred = {
      ...emptyCredentials(PROVIDER_FL.id),
      license_doc_object_path: `license-doc/${PROVIDER_FL.uid}/lic.pdf`,
      license_number: 'OT12345',
      license_uploaded_at: new Date('2026-05-28T08:00:00Z'),
    };
    const { db } = makeDbStub({ providerById: PROVIDER_FL, credentials: cred });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await adminToken('admin-1');
      const res = await app.inject({
        method: 'GET',
        url: `/v1/admin/providers/${PROVIDER_FL.id}/license-verification`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.providerId).toBe(PROVIDER_FL.id);
      expect(body.defaultBoard.registerUrl).toMatch(/^https:\/\//);
      expect(body.licenseNumber).toBe('OT12345');
    } finally {
      await app.close();
    }
  });

  it('admin POST verified records decision + sets provider_verifications.license_verified_at', async () => {
    const { db, getCredentials, getVerification, verifUpdateSpy } = makeDbStub({
      providerById: PROVIDER_FL,
    });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await adminToken('admin-1');
      const res = await app.inject({
        method: 'POST',
        url: `/v1/admin/providers/${PROVIDER_FL.id}/license-verification`,
        headers: { authorization: `Bearer ${token}` },
        payload: { decision: 'verified', notes: 'License # checked on FL MQA portal — active.' },
      });
      expect(res.statusCode).toBe(200);
      expect(getCredentials()?.decision).toBe('verified');
      expect(getCredentials()?.decision_by_admin_uid).toBe('admin-1');
      expect(getCredentials()?.decision_notes).toMatch(/MQA portal/);
      // verification row was created on demand and license_verified_at set.
      expect(getVerification()).not.toBeNull();
      const lastPatch = verifUpdateSpy.mock.calls.at(-1)?.[0] as {
        license_verified_at?: Date;
      };
      expect(lastPatch?.license_verified_at).toBeInstanceOf(Date);
    } finally {
      await app.close();
    }
  });

  it('admin POST rejected sets provider_verifications.rejected_at + rejection_reason from notes', async () => {
    const { db, getCredentials, verifUpdateSpy } = makeDbStub({ providerById: PROVIDER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await adminToken('admin-1');
      const res = await app.inject({
        method: 'POST',
        url: `/v1/admin/providers/${PROVIDER_FL.id}/license-verification`,
        headers: { authorization: `Bearer ${token}` },
        payload: { decision: 'rejected', notes: 'License lapsed in 2024' },
      });
      expect(res.statusCode).toBe(200);
      expect(getCredentials()?.decision).toBe('rejected');
      const lastPatch = verifUpdateSpy.mock.calls.at(-1)?.[0] as {
        rejected_at?: Date;
        rejection_reason?: string;
      };
      expect(lastPatch?.rejected_at).toBeInstanceOf(Date);
      expect(lastPatch?.rejection_reason).toBe('License lapsed in 2024');
    } finally {
      await app.close();
    }
  });

  it('admin POST 409s when the target Provider is a Caregiver', async () => {
    const { db } = makeDbStub({ providerById: CAREGIVER });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await adminToken('admin-1');
      const res = await app.inject({
        method: 'POST',
        url: `/v1/admin/providers/${CAREGIVER.id}/license-verification`,
        headers: { authorization: `Bearer ${token}` },
        payload: { decision: 'verified' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('license_not_applicable');
    } finally {
      await app.close();
    }
  });

  it('admin POST 400s on unknown decision value', async () => {
    const { db } = makeDbStub({ providerById: PROVIDER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await adminToken('admin-1');
      const res = await app.inject({
        method: 'POST',
        url: `/v1/admin/providers/${PROVIDER_FL.id}/license-verification`,
        headers: { authorization: `Bearer ${token}` },
        payload: { decision: 'maybe' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
