import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Fake Kysely surface for the provider-credentials route (OH-186). Mirrors
 * routes/verification.test.ts: `specialist_credentials` and
 * `provider_verifications` are stateful so the load-or-create + admin mirror
 * writes are observable. `captures` records every insert/update for assertions.
 */
interface DbOpts {
  provider?: Record<string, unknown> | null;
  /** Initial specialist_credentials row; null → does not exist yet (insert on first touch). */
  credentials?: Record<string, unknown> | null;
  /** Whether a provider_verifications row already exists (drives the on-demand create). */
  verificationExists?: boolean;
}

function crow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider_id: PROV2_ID,
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
    created_at: new Date('2026-06-01T00:00:00.000Z'),
    updated_at: new Date('2026-06-01T00:00:00.000Z'),
    ...over,
  };
}

function makeDb(opts: DbOpts = {}) {
  const captures = {
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  };
  let credentials: Record<string, unknown> | null = opts.credentials ?? null;
  let verificationExists = opts.verificationExists ?? false;

  const selectChain = (result: unknown) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      selectAll: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => b,
      executeTakeFirst: async () => result ?? undefined,
    });
    return b;
  };

  const insertChain = (table: string) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      values: (values: Record<string, unknown>) => {
        captures.inserts.push({ table, values });
        if (table === 'specialist_credentials') credentials = crow({ provider_id: values.provider_id });
        if (table === 'provider_verifications') verificationExists = true;
        return b;
      },
      returning: () => b,
      returningAll: () => b,
      execute: async () => [],
      executeTakeFirstOrThrow: async () => credentials,
    });
    return b;
  };

  const updateChain = (table: string) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      set: (set: Record<string, unknown>) => {
        captures.updates.push({ table, set });
        if (table === 'specialist_credentials' && credentials) credentials = { ...credentials, ...set };
        return b;
      },
      where: () => b,
      returning: () => b,
      returningAll: () => b,
      execute: async () => [],
      executeTakeFirstOrThrow: async () => credentials,
    });
    return b;
  };

  const db = {
    selectFrom: (table: string) => {
      if (table === 'providers') return selectChain(opts.provider);
      if (table === 'specialist_credentials') return selectChain(credentials ?? undefined);
      if (table === 'provider_verifications') return selectChain(verificationExists ? { provider_id: PROV2_ID } : undefined);
      return selectChain(undefined);
    },
    insertInto: (table: string) => insertChain(table),
    updateTable: (table: string) => updateChain(table),
  } as unknown as AppDeps['db'];

  return { db, captures };
}

function makeDeps(opts: { db?: AppDeps['db'] } = {}): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return {
    env: buildTestEnv(),
    db: (opts.db ?? stub) as AppDeps['db'],
    supabase: stub,
    stripe: stub,
    backgroundCheck: stub,
  };
}

// Provider ids are uuids in prod (Generated<string>); the admin route param is
// uuid-validated, so the fixtures use real uuids.
const PROV2_ID = '22222222-2222-4222-8222-222222222222';
const PROV3_ID = '33333333-3333-4333-8333-333333333333';
const PROVIDER_CLINICAL = { id: PROV2_ID, uid: 'uid-2', role: 'provider', specialty: 'slp', state: 'CA' };
const PROVIDER_OUT_OF_SLATE = { id: PROV3_ID, uid: 'uid-3', role: 'provider', specialty: 'ot', state: 'VT' };

function providerToken(uid = 'uid-2') {
  return mintAccessToken({ sub: uid, email: 'pr@example.com', appMetadata: { role: 'provider', specialty: 'slp' } });
}
function caregiverToken() {
  return mintAccessToken({ sub: 'uid-1', email: 'cg@example.com', appMetadata: { role: 'caregiver', categories: ['babysitter'] } });
}
function adminToken() {
  return mintAccessToken({
    sub: 'admin-1',
    email: 'admin@ourhaven.com',
    appMetadata: { role: 'admin' },
    aal: 'aal2',
    amr: [{ method: 'totp' }],
  });
}

const get = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });
const post = (token: string, body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('GET /v1/providers/me/credentials', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps());
    const res = await app.request('/v1/providers/me/credentials');
    expect(res.status).toBe(401);
  });

  it('403 forbidden_role for a caregiver token (license is provider-only)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: PROVIDER_CLINICAL }).db }));
    const res = await app.request('/v1/providers/me/credentials', get(await caregiverToken()));
    expect(res.status).toBe(403);
  });

  it('404 when the supply row is missing', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: null }).db }));
    const res = await app.request('/v1/providers/me/credentials', get(await providerToken()));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'provider_not_found' });
  });

  it('creates the row on first read and surfaces the resolved state board', async () => {
    const { db, captures } = makeDb({ provider: PROVIDER_CLINICAL, credentials: null });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request('/v1/providers/me/credentials', get(await providerToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      licenseBoardSupported: boolean;
      defaultBoard: { state: string; specialty: string; registerUrl: string } | null;
      altBoardsInState: unknown[];
      decision: string | null;
    };
    expect(body.licenseBoardSupported).toBe(true);
    expect(body.defaultBoard).toMatchObject({ state: 'CA', specialty: 'slp' });
    expect(body.defaultBoard!.registerUrl).toMatch(/^https:\/\//);
    expect(body.altBoardsInState).toHaveLength(5); // one per specialty
    expect(body.decision).toBeNull();
    expect(captures.inserts).toEqual([
      expect.objectContaining({ table: 'specialist_credentials', values: { provider_id: PROV2_ID } }),
    ]);
  });

  it('reports licenseBoardSupported=false for an out-of-slate Provider', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: PROVIDER_OUT_OF_SLATE, credentials: crow({ provider_id: PROV3_ID }) }).db }));
    const res = await app.request('/v1/providers/me/credentials', get(await providerToken('uid-3')));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { licenseBoardSupported: boolean; defaultBoard: unknown; altBoardsInState: unknown[] };
    expect(body.licenseBoardSupported).toBe(false);
    expect(body.defaultBoard).toBeNull();
    expect(body.altBoardsInState).toHaveLength(0);
  });
});

describe('POST /v1/providers/me/credentials/license', () => {
  it('400 invalid_object_path when the path is not in the caller license-doc namespace', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: PROVIDER_CLINICAL, credentials: crow() }).db }));
    const res = await app.request(
      '/v1/providers/me/credentials/license',
      post(await providerToken(), { objectPath: 'license-doc/uid-999/forged.pdf' }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_object_path' });
  });

  it('records the license upload + optional metadata', async () => {
    const { db, captures } = makeDb({ provider: PROVIDER_CLINICAL, credentials: crow() });
    const app = buildApp(makeDeps({ db }));
    const objectPath = 'license-doc/uid-2/lic-1.pdf';
    const res = await app.request(
      '/v1/providers/me/credentials/license',
      post(await providerToken(), { objectPath, licenseNumber: 'SLP-12345', licenseBoardState: 'CA' }),
    );
    expect(res.status).toBe(200);
    expect(captures.updates).toContainEqual(
      expect.objectContaining({
        table: 'specialist_credentials',
        set: expect.objectContaining({
          license_doc_object_path: objectPath,
          license_uploaded_at: expect.any(Date),
          license_number: 'SLP-12345',
          license_board_state: 'CA',
        }),
      }),
    );
  });
});

describe('POST /v1/providers/me/credentials/insurance', () => {
  it('400 invalid_object_path when the path is not in the caller insurance-doc namespace', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: PROVIDER_CLINICAL, credentials: crow() }).db }));
    const res = await app.request(
      '/v1/providers/me/credentials/insurance',
      post(await providerToken(), { objectPath: 'license-doc/uid-2/wrong-kind.pdf' }),
    );
    expect(res.status).toBe(400);
  });

  it('records the insurance COI upload', async () => {
    const { db, captures } = makeDb({ provider: PROVIDER_CLINICAL, credentials: crow() });
    const app = buildApp(makeDeps({ db }));
    const objectPath = 'insurance-doc/uid-2/coi-1.pdf';
    const res = await app.request('/v1/providers/me/credentials/insurance', post(await providerToken(), { objectPath }));
    expect(res.status).toBe(200);
    expect(captures.updates).toContainEqual(
      expect.objectContaining({
        table: 'specialist_credentials',
        set: expect.objectContaining({ insurance_doc_object_path: objectPath, insurance_uploaded_at: expect.any(Date) }),
      }),
    );
  });
});

describe('admin license-verification', () => {
  it('403 for a provider (non-admin) token', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: PROVIDER_CLINICAL, credentials: crow() }).db }));
    const res = await app.request(`/v1/admin/providers/${PROV2_ID}/license-verification`, get(await providerToken()));
    expect(res.status).toBe(403);
  });

  it('admin_totp_required for an admin token without aal2+TOTP', async () => {
    const token = await mintAccessToken({ sub: 'admin-1', appMetadata: { role: 'admin' } }); // aal1
    const app = buildApp(makeDeps({ db: makeDb({ provider: PROVIDER_CLINICAL, credentials: crow() }).db }));
    const res = await app.request(`/v1/admin/providers/${PROV2_ID}/license-verification`, get(token));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'admin_totp_required' });
  });

  it('GET surfaces the board context + uploaded docs for review', async () => {
    const app = buildApp(
      makeDeps({
        db: makeDb({
          provider: PROVIDER_CLINICAL,
          credentials: crow({ license_doc_object_path: 'license-doc/uid-2/lic.pdf', license_number: 'SLP-1' }),
        }).db,
      }),
    );
    const res = await app.request(`/v1/admin/providers/${PROV2_ID}/license-verification`, get(await adminToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { defaultBoard: { registerUrl: string } | null; licenseNumber: string | null };
    expect(body.defaultBoard!.registerUrl).toMatch(/^https:\/\//);
    expect(body.licenseNumber).toBe('SLP-1');
  });

  it('404 when the provider does not exist', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: null }).db }));
    const res = await app.request(
      '/v1/admin/providers/00000000-0000-0000-0000-000000000000/license-verification',
      post(await adminToken(), { decision: 'verified' }),
    );
    expect(res.status).toBe(404);
  });

  it('verified → stamps BOTH license_verified_at and insurance_verified_at, records the decision', async () => {
    const { db, captures } = makeDb({
      provider: PROVIDER_CLINICAL,
      credentials: crow({ license_doc_object_path: 'license-doc/uid-2/lic.pdf', insurance_doc_object_path: 'insurance-doc/uid-2/coi.pdf' }),
      verificationExists: true,
    });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      `/v1/admin/providers/${PROV2_ID}/license-verification`,
      post(await adminToken(), { decision: 'verified', notes: 'license + COI confirmed on CA DCA' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ decision: 'verified', decisionByAdminUid: 'admin-1' });

    // The audit decision is recorded on specialist_credentials...
    expect(captures.updates).toContainEqual(
      expect.objectContaining({
        table: 'specialist_credentials',
        set: expect.objectContaining({ decision: 'verified', decision_by_admin_uid: 'admin-1', decision_notes: 'license + COI confirmed on CA DCA' }),
      }),
    );
    // ...and BOTH clinical gates are mirrored into provider_verifications.
    expect(captures.updates).toContainEqual(
      expect.objectContaining({
        table: 'provider_verifications',
        set: expect.objectContaining({ license_verified_at: expect.any(Date), insurance_verified_at: expect.any(Date) }),
      }),
    );
  });

  it('rejected → stamps rejected_at + rejection_reason from notes', async () => {
    const { db, captures } = makeDb({ provider: PROVIDER_CLINICAL, credentials: crow(), verificationExists: true });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      `/v1/admin/providers/${PROV2_ID}/license-verification`,
      post(await adminToken(), { decision: 'rejected', notes: 'license number not found on register' }),
    );
    expect(res.status).toBe(200);
    expect(captures.updates).toContainEqual(
      expect.objectContaining({
        table: 'provider_verifications',
        set: expect.objectContaining({ rejected_at: expect.any(Date), rejection_reason: 'license number not found on register' }),
      }),
    );
  });

  it('creates the provider_verifications row on demand when the Provider never hit the verification GET', async () => {
    const { db, captures } = makeDb({ provider: PROVIDER_CLINICAL, credentials: crow(), verificationExists: false });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      `/v1/admin/providers/${PROV2_ID}/license-verification`,
      post(await adminToken(), { decision: 'verified' }),
    );
    expect(res.status).toBe(200);
    expect(captures.inserts).toContainEqual(
      expect.objectContaining({ table: 'provider_verifications', values: { provider_id: PROV2_ID } }),
    );
  });
});
