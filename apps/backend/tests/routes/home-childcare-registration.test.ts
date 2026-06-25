import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDeps } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';
import { homeChildcareRegistrationRoutes } from '@/routes/home-childcare-registration.js';
import { authPlugin } from '@/plugins/auth.js';

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

interface RegistrationRow {
  provider_id: string;
  state_at_upload: string | null;
  certificate_doc_object_path: string | null;
  certificate_uploaded_at: Date | null;
  decision: 'verified' | 'rejected' | null;
  decision_at: Date | null;
  decision_by_admin_uid: string | null;
  decision_notes: string | null;
}

function emptyRegistration(providerId: string): RegistrationRow {
  return {
    provider_id: providerId,
    state_at_upload: null,
    certificate_doc_object_path: null,
    certificate_uploaded_at: null,
    decision: null,
    decision_at: null,
    decision_by_admin_uid: null,
    decision_notes: null,
  };
}

interface DbStubOpts {
  providerByUid?: ProviderRow | null;
  providerById?: ProviderRow | null;
  registration?: RegistrationRow | null;
}

function makeDbStub(opts: DbStubOpts) {
  let registration: RegistrationRow | null = opts.registration ?? null;
  const updateSpy = vi.fn();

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
      if (table === 'provider_home_childcare_registrations') {
        return {
          selectAll: () => ({
            where: () => ({
              executeTakeFirst: vi.fn(async () => registration ?? undefined),
            }),
          }),
        };
      }
      throw new Error(`unstubbed selectFrom(${table})`);
    },
    insertInto(table: string) {
      if (table === 'provider_home_childcare_registrations') {
        return {
          values: (vals: Partial<RegistrationRow>) => ({
            returningAll: () => ({
              executeTakeFirstOrThrow: vi.fn(async () => {
                const fresh = { ...emptyRegistration(vals.provider_id ?? ''), ...vals };
                registration = fresh;
                return fresh;
              }),
            }),
          }),
        };
      }
      throw new Error(`unstubbed insertInto(${table})`);
    },
    updateTable(table: string) {
      if (table === 'provider_home_childcare_registrations') {
        let patch: Partial<RegistrationRow> = {};
        const chain = {
          set: (p: Partial<RegistrationRow>) => {
            patch = p;
            updateSpy(p);
            return chain;
          },
          where: () => chain,
          returningAll: () => chain,
          executeTakeFirstOrThrow: vi.fn(async () => {
            if (!registration) throw new Error('registration row missing');
            registration = { ...registration, ...patch };
            return registration;
          }),
        };
        return chain;
      }
      throw new Error(`unstubbed updateTable(${table})`);
    },
  };

  return {
    db,
    getRegistration: () => registration,
    updateSpy,
  };
}

function makeDeps(opts: { db?: unknown }): AppDeps {
  const passThrough = new Proxy({} as never, { get: () => passThrough });
  return {
    env: envForTest(),
    db: (opts.db ?? passThrough) as never,
    supabase: passThrough,
    storage: passThrough,
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
  await app.register(homeChildcareRegistrationRoutes, { prefix: '/v1' });
  return app;
}

async function caregiverToken(uid: string, categories: string[]): Promise<string> {
  return mintAccessToken({
    sub: uid,
    email: `${uid}@example.com`,
    appMetadata: { role: 'caregiver', categories },
  });
}

async function providerToken(uid: string): Promise<string> {
  return mintAccessToken({
    sub: uid,
    email: `${uid}@example.com`,
    appMetadata: { role: 'provider', specialty: 'ot' },
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

const BABYSITTER_FL: ProviderRow = {
  id: '0193a4b1-2001-7a01-9abc-000000000001',
  uid: 'uid-babysitter-fl',
  role: 'caregiver',
  categories: ['babysitter'],
  specialty: null,
  state: 'FL',
};

const NANNY_AK: ProviderRow = {
  id: '0193a4b1-2002-7a02-9abc-000000000002',
  uid: 'uid-nanny-ak',
  role: 'caregiver',
  categories: ['nanny'],
  specialty: null,
  state: 'AK',
};

const TUTOR: ProviderRow = {
  id: '0193a4b1-2003-7a03-9abc-000000000003',
  uid: 'uid-tutor',
  role: 'caregiver',
  categories: ['tutor'],
  specialty: null,
  state: 'FL',
};

const PROVIDER: ProviderRow = {
  id: '0193a4b1-2004-7a04-9abc-000000000004',
  uid: 'uid-provider',
  role: 'provider',
  categories: null,
  specialty: 'ot',
  state: 'FL',
};

describe('GET /v1/providers/me/home-childcare-registration', () => {
  beforeEach(() => resetEnvForTests());

  it('returns FL agency context for a Babysitter in FL', async () => {
    const { db } = makeDbStub({ providerByUid: BABYSITTER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await caregiverToken(BABYSITTER_FL.uid, ['babysitter']);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/home-childcare-registration',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.role).toBe('caregiver');
      expect(body.categories).toEqual(['babysitter']);
      expect(body.residentState).toBe('FL');
      expect(body.homeChildcareBoardSupported).toBe(true);
      expect(body.board).not.toBeNull();
      expect(body.board.state).toBe('FL');
      expect(body.board.agencyName).toMatch(/Florida/);
      expect(body.board.registerUrl).toMatch(/^https:\/\//);
      expect(body.decision).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('marks homeChildcareBoardSupported=false for a Nanny in a non-slate state', async () => {
    const { db } = makeDbStub({ providerByUid: NANNY_AK });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await caregiverToken(NANNY_AK.uid, ['nanny']);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/home-childcare-registration',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.homeChildcareBoardSupported).toBe(false);
      expect(body.board).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('409s for a Tutor Caregiver', async () => {
    const { db } = makeDbStub({ providerByUid: TUTOR });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await caregiverToken(TUTOR.uid, ['tutor']);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/home-childcare-registration',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('home_childcare_registration_not_applicable');
    } finally {
      await app.close();
    }
  });

  it('403s for a clinical Provider (caregiver-only role guard)', async () => {
    const { db } = makeDbStub({ providerByUid: PROVIDER });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await providerToken(PROVIDER.uid);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/home-childcare-registration',
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
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/home-childcare-registration',
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('404s when no Provider row exists', async () => {
    const { db } = makeDbStub({ providerByUid: null });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await caregiverToken('orphan-uid', ['babysitter']);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/home-childcare-registration',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/providers/me/home-childcare-registration', () => {
  beforeEach(() => resetEnvForTests());

  it('records a certificate upload and captures resident state at upload time', async () => {
    const { db, getRegistration } = makeDbStub({ providerByUid: BABYSITTER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await caregiverToken(BABYSITTER_FL.uid, ['babysitter']);
      const objectPath = `state-childcare-registration/${BABYSITTER_FL.uid}/dcf-cert.pdf`;
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/home-childcare-registration',
        headers: { authorization: `Bearer ${token}` },
        payload: { objectPath },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.certificateDocObjectPath).toBe(objectPath);
      expect(body.certificateUploadedAt).not.toBeNull();
      expect(body.stateAtUpload).toBe('FL');
      expect(getRegistration()?.certificate_doc_object_path).toBe(objectPath);
      expect(getRegistration()?.state_at_upload).toBe('FL');
    } finally {
      await app.close();
    }
  });

  it('clears a prior decision when a fresh certificate is uploaded', async () => {
    const priorDecision: RegistrationRow = {
      provider_id: BABYSITTER_FL.id,
      state_at_upload: 'FL',
      certificate_doc_object_path: `state-childcare-registration/${BABYSITTER_FL.uid}/old.pdf`,
      certificate_uploaded_at: new Date('2026-01-01'),
      decision: 'verified',
      decision_at: new Date('2026-01-02'),
      decision_by_admin_uid: 'admin-1',
      decision_notes: 'cleared on first review',
    };
    const { db, getRegistration } = makeDbStub({
      providerByUid: BABYSITTER_FL,
      registration: priorDecision,
    });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await caregiverToken(BABYSITTER_FL.uid, ['babysitter']);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/home-childcare-registration',
        headers: { authorization: `Bearer ${token}` },
        payload: { objectPath: `state-childcare-registration/${BABYSITTER_FL.uid}/new.pdf` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.decision).toBeNull();
      expect(body.decisionByAdminUid).toBeNull();
      expect(getRegistration()?.decision).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('400s when objectPath is not scoped to the caller', async () => {
    const { db } = makeDbStub({ providerByUid: BABYSITTER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await caregiverToken(BABYSITTER_FL.uid, ['babysitter']);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/home-childcare-registration',
        headers: { authorization: `Bearer ${token}` },
        payload: { objectPath: 'state-childcare-registration/some-other-uid/file.pdf' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_object_path');
    } finally {
      await app.close();
    }
  });

  it('409s for a Tutor', async () => {
    const { db } = makeDbStub({ providerByUid: TUTOR });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await caregiverToken(TUTOR.uid, ['tutor']);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/home-childcare-registration',
        headers: { authorization: `Bearer ${token}` },
        payload: { objectPath: `state-childcare-registration/${TUTOR.uid}/x.pdf` },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('home_childcare_registration_not_applicable');
    } finally {
      await app.close();
    }
  });

  it('rejects unknown body fields', async () => {
    const { db } = makeDbStub({ providerByUid: BABYSITTER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await caregiverToken(BABYSITTER_FL.uid, ['babysitter']);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/home-childcare-registration',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          objectPath: `state-childcare-registration/${BABYSITTER_FL.uid}/cert.pdf`,
          decision: 'verified',
        },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('GET /v1/admin/providers/:providerId/home-childcare-registration', () => {
  beforeEach(() => resetEnvForTests());

  it('returns context + uploaded cert for the admin', async () => {
    const registration: RegistrationRow = {
      provider_id: BABYSITTER_FL.id,
      state_at_upload: 'FL',
      certificate_doc_object_path: `state-childcare-registration/${BABYSITTER_FL.uid}/cert.pdf`,
      certificate_uploaded_at: new Date('2026-05-20'),
      decision: null,
      decision_at: null,
      decision_by_admin_uid: null,
      decision_notes: null,
    };
    const { db } = makeDbStub({ providerById: BABYSITTER_FL, registration });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await adminToken('admin-1');
      const res = await app.inject({
        method: 'GET',
        url: `/v1/admin/providers/${BABYSITTER_FL.id}/home-childcare-registration`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.board.registerUrl).toMatch(/^https:\/\//);
      expect(body.certificateDocObjectPath).toBe(registration.certificate_doc_object_path);
    } finally {
      await app.close();
    }
  });

  it('403s for a non-admin caller', async () => {
    const { db } = makeDbStub({ providerById: BABYSITTER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await providerToken(BABYSITTER_FL.uid);
      const res = await app.inject({
        method: 'GET',
        url: `/v1/admin/providers/${BABYSITTER_FL.id}/home-childcare-registration`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('409s when the target Provider is a clinical Provider', async () => {
    const { db } = makeDbStub({ providerById: PROVIDER });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await adminToken('admin-1');
      const res = await app.inject({
        method: 'GET',
        url: `/v1/admin/providers/${PROVIDER.id}/home-childcare-registration`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('home_childcare_registration_not_applicable');
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/admin/providers/:providerId/home-childcare-registration', () => {
  beforeEach(() => resetEnvForTests());

  it('records a `verified` decision with the admin uid + notes', async () => {
    const { db, getRegistration } = makeDbStub({ providerById: BABYSITTER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const adminUid = 'admin-camille';
      const token = await adminToken(adminUid);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/admin/providers/${BABYSITTER_FL.id}/home-childcare-registration`,
        headers: { authorization: `Bearer ${token}` },
        payload: { decision: 'verified', notes: 'DCF portal confirms FCCH active.' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.decision).toBe('verified');
      expect(body.decisionByAdminUid).toBe(adminUid);
      expect(body.decisionNotes).toBe('DCF portal confirms FCCH active.');
      expect(getRegistration()?.decision).toBe('verified');
    } finally {
      await app.close();
    }
  });

  it('records a `rejected` decision', async () => {
    const { db } = makeDbStub({ providerById: BABYSITTER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await adminToken('admin-1');
      const res = await app.inject({
        method: 'POST',
        url: `/v1/admin/providers/${BABYSITTER_FL.id}/home-childcare-registration`,
        headers: { authorization: `Bearer ${token}` },
        payload: { decision: 'rejected', notes: 'Certificate illegible.' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().decision).toBe('rejected');
    } finally {
      await app.close();
    }
  });

  it('403s for a non-admin caller', async () => {
    const { db } = makeDbStub({ providerById: BABYSITTER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await providerToken(BABYSITTER_FL.uid);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/admin/providers/${BABYSITTER_FL.id}/home-childcare-registration`,
        headers: { authorization: `Bearer ${token}` },
        payload: { decision: 'verified' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('400s on an unknown decision value', async () => {
    const { db } = makeDbStub({ providerById: BABYSITTER_FL });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await adminToken('admin-1');
      const res = await app.inject({
        method: 'POST',
        url: `/v1/admin/providers/${BABYSITTER_FL.id}/home-childcare-registration`,
        headers: { authorization: `Bearer ${token}` },
        payload: { decision: 'maybe' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('409s when the target Provider is a Tutor', async () => {
    const { db } = makeDbStub({ providerById: TUTOR });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await adminToken('admin-1');
      const res = await app.inject({
        method: 'POST',
        url: `/v1/admin/providers/${TUTOR.id}/home-childcare-registration`,
        headers: { authorization: `Bearer ${token}` },
        payload: { decision: 'verified' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('home_childcare_registration_not_applicable');
    } finally {
      await app.close();
    }
  });
});
