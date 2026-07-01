import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';
import type { SupabaseHandles } from '../supabase/admin.ts';

/**
 * Fake Kysely surface routed by table name (mirrors routes/caregiver-connect.test.ts
 * + routes/auth.test.ts). `provider_verifications` is stateful so the
 * load-or-create + mirror writes the GET/POST handlers perform are observable:
 * an insert seeds the row, an update merges its `set` payload, and a later select
 * reflects it.
 */
interface DbOpts {
  provider?: Record<string, unknown> | null;
  /** Initial provider_verifications row; null/undefined → the row does not exist yet. */
  verification?: Record<string, unknown> | null;
  connect?: Record<string, unknown> | null;
}

function vrow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider_id: 'prov-1',
    email_confirmed_at: null,
    phone_confirmed_at: null,
    id_doc_object_path: null,
    id_doc_uploaded_at: null,
    screening_initiated_at: null,
    screening_passed_at: null,
    license_verified_at: null,
    insurance_verified_at: null,
    rejected_at: null,
    rejection_reason: null,
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
  let verification: Record<string, unknown> | null = opts.verification ?? null;

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
        if (table === 'provider_verifications') {
          verification = vrow({ provider_id: values.provider_id });
        }
        return b;
      },
      returning: () => b,
      returningAll: () => b,
      onConflict: () => b,
      execute: async () => [],
      executeTakeFirstOrThrow: async () => verification,
    });
    return b;
  };

  const updateChain = (table: string) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      set: (set: Record<string, unknown>) => {
        captures.updates.push({ table, set });
        if (table === 'provider_verifications' && verification) {
          verification = { ...verification, ...set };
        }
        return b;
      },
      where: () => b,
      returning: () => b,
      returningAll: () => b,
      execute: async () => [],
      executeTakeFirstOrThrow: async () => verification,
    });
    return b;
  };

  const db = {
    selectFrom: (table: string) => {
      if (table === 'providers') return selectChain(opts.provider);
      if (table === 'provider_verifications') return selectChain(verification ?? undefined);
      if (table === 'provider_connect_accounts') return selectChain(opts.connect);
      return selectChain(undefined);
    },
    insertInto: (table: string) => insertChain(table),
    updateTable: (table: string) => updateChain(table),
  } as unknown as AppDeps['db'];

  return { db, captures };
}

/** Supabase admin stub exposing only `auth.admin.getUserById` (verification mirror). */
function supabaseWithUser(
  user: { email_confirmed_at?: string | null; phone_confirmed_at?: string | null } | null,
): SupabaseHandles {
  return {
    admin: {
      auth: { admin: { getUserById: async () => ({ data: { user }, error: null }) } },
    },
  } as unknown as SupabaseHandles;
}

function makeDeps(opts: { db?: AppDeps['db']; supabase?: SupabaseHandles } = {}): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return {
    env: buildTestEnv(),
    db: (opts.db ?? stub) as AppDeps['db'],
    supabase: (opts.supabase ?? stub) as AppDeps['supabase'],
    stripe: stub,
    backgroundCheck: stub,
    daily: stub,
  };
}

const PROVIDER_CG = { id: 'prov-1', uid: 'uid-1', role: 'caregiver', state: 'CA' };
const PROVIDER_CLINICAL = { id: 'prov-2', uid: 'uid-2', role: 'provider', state: 'CA' };
const PROVIDER_OUT_OF_SLATE = { id: 'prov-3', uid: 'uid-3', role: 'provider', state: 'VT' };

const EMAIL_AT = '2026-06-02T10:00:00.000Z';
const PHONE_AT = '2026-06-03T10:00:00.000Z';

function caregiverToken(uid = 'uid-1') {
  return mintAccessToken({ sub: uid, email: 'cg@example.com', appMetadata: { role: 'caregiver', categories: ['babysitter'] } });
}
function providerToken(uid = 'uid-2') {
  return mintAccessToken({ sub: uid, email: 'pr@example.com', appMetadata: { role: 'provider', specialty: 'slp' } });
}
function parentToken() {
  return mintAccessToken({ sub: 'uid-p', email: 'p@example.com', appMetadata: { role: 'parent' } });
}

const get = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });
const post = (token: string, body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('GET /v1/providers/me/verification', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps());
    const res = await app.request('/v1/providers/me/verification');
    expect(res.status).toBe(401);
  });

  it('403 forbidden_role for a parent token', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: PROVIDER_CG }).db }));
    const res = await app.request('/v1/providers/me/verification', get(await parentToken()));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden_role' });
  });

  it('404 when the supply row is missing', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: null }).db, supabase: supabaseWithUser(null) }));
    const res = await app.request('/v1/providers/me/verification', get(await caregiverToken()));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'provider_not_found' });
  });

  it('creates the verification row on first read and mirrors email → email-verified', async () => {
    const { db, captures } = makeDb({ provider: PROVIDER_CG, verification: null });
    const app = buildApp(makeDeps({ db, supabase: supabaseWithUser({ email_confirmed_at: EMAIL_AT }) }));
    const res = await app.request('/v1/providers/me/verification', get(await caregiverToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; role: string; residentState: string; licenseBoardSupported: boolean; facts: Record<string, unknown> };
    expect(body).toMatchObject({ state: 'email-verified', role: 'caregiver', residentState: 'CA', licenseBoardSupported: true });
    expect(body.facts.emailConfirmedAt).toBe(EMAIL_AT);
    // The missing row was inserted, then the mirrored email was written back.
    expect(captures.inserts).toEqual([expect.objectContaining({ table: 'provider_verifications', values: { provider_id: 'prov-1' } })]);
    expect(captures.updates).toEqual([expect.objectContaining({ table: 'provider_verifications', set: expect.objectContaining({ email_confirmed_at: expect.any(Date) }) })]);
  });

  it('does not re-mirror when the row already carries the confirmation (no-op update)', async () => {
    const { db, captures } = makeDb({
      provider: PROVIDER_CG,
      verification: vrow({ email_confirmed_at: new Date(EMAIL_AT) }),
    });
    const app = buildApp(makeDeps({ db, supabase: supabaseWithUser({ email_confirmed_at: EMAIL_AT }) }));
    const res = await app.request('/v1/providers/me/verification', get(await caregiverToken()));
    expect(res.status).toBe(200);
    expect(captures.updates).toEqual([]);
  });

  it('projects a Provider in a supported state to license-pending', async () => {
    const db = makeDb({
      provider: PROVIDER_CLINICAL,
      verification: vrow({
        provider_id: 'prov-2',
        email_confirmed_at: new Date(EMAIL_AT),
        id_doc_uploaded_at: new Date(),
        screening_initiated_at: new Date(),
        screening_passed_at: new Date(),
      }),
    }).db;
    const app = buildApp(makeDeps({ db, supabase: supabaseWithUser({ email_confirmed_at: EMAIL_AT }) }));
    const res = await app.request('/v1/providers/me/verification', get(await providerToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'license-pending', role: 'provider', licenseBoardSupported: true });
  });

  it('rests a Provider with a verified license but no insurance at insurance-pending', async () => {
    const db = makeDb({
      provider: PROVIDER_CLINICAL,
      verification: vrow({
        provider_id: 'prov-2',
        email_confirmed_at: new Date(EMAIL_AT),
        id_doc_uploaded_at: new Date(),
        screening_initiated_at: new Date(),
        screening_passed_at: new Date(),
        license_verified_at: new Date(),
      }),
    }).db;
    const app = buildApp(makeDeps({ db, supabase: supabaseWithUser({ email_confirmed_at: EMAIL_AT }) }));
    const res = await app.request('/v1/providers/me/verification', get(await providerToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; facts: Record<string, unknown> };
    expect(body.state).toBe('insurance-pending');
    expect(body.facts.insuranceVerifiedAt).toBeNull();
  });

  it('advances a Provider with license + insurance verified past both clinical gates', async () => {
    const db = makeDb({
      provider: PROVIDER_CLINICAL,
      verification: vrow({
        provider_id: 'prov-2',
        email_confirmed_at: new Date(EMAIL_AT),
        id_doc_uploaded_at: new Date(),
        screening_initiated_at: new Date(),
        screening_passed_at: new Date(),
        license_verified_at: new Date(),
        insurance_verified_at: new Date(),
      }),
    }).db;
    const app = buildApp(makeDeps({ db, supabase: supabaseWithUser({ email_confirmed_at: EMAIL_AT }) }));
    const res = await app.request('/v1/providers/me/verification', get(await providerToken()));
    expect(res.status).toBe(200);
    // Both clinical gates cleared; only phone remains.
    expect(await res.json()).toMatchObject({ state: 'awaiting-phone-verification' });
  });

  it('routes a Provider in an out-of-slate state to holding-state-not-supported', async () => {
    const db = makeDb({
      provider: PROVIDER_OUT_OF_SLATE,
      verification: vrow({
        provider_id: 'prov-3',
        email_confirmed_at: new Date(EMAIL_AT),
        id_doc_uploaded_at: new Date(),
        screening_initiated_at: new Date(),
        screening_passed_at: new Date(),
      }),
    }).db;
    const app = buildApp(makeDeps({ db, supabase: supabaseWithUser({ email_confirmed_at: EMAIL_AT }) }));
    const res = await app.request('/v1/providers/me/verification', get(await providerToken('uid-3')));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'holding-state-not-supported', licenseBoardSupported: false });
  });

  it('reports a fully-cleared Caregiver (connect + phone) as activated', async () => {
    const db = makeDb({
      provider: PROVIDER_CG,
      verification: vrow({
        email_confirmed_at: new Date(EMAIL_AT),
        phone_confirmed_at: new Date(PHONE_AT),
        id_doc_uploaded_at: new Date(),
        screening_initiated_at: new Date(),
        screening_passed_at: new Date(),
      }),
      connect: { account_ready_at: new Date('2026-06-04T00:00:00.000Z') },
    }).db;
    const app = buildApp(makeDeps({ db, supabase: supabaseWithUser({ email_confirmed_at: EMAIL_AT, phone_confirmed_at: PHONE_AT }) }));
    const res = await app.request('/v1/providers/me/verification', get(await caregiverToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'activated' });
  });
});

describe('POST /v1/providers/me/verification/phone-confirm', () => {
  it('400 phone_not_confirmed when Supabase has no phone_confirmed_at yet', async () => {
    const db = makeDb({ provider: PROVIDER_CG, verification: vrow({ email_confirmed_at: new Date(EMAIL_AT) }) }).db;
    const app = buildApp(makeDeps({ db, supabase: supabaseWithUser({ phone_confirmed_at: null }) }));
    const res = await app.request('/v1/providers/me/verification/phone-confirm', post(await caregiverToken()));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'phone_not_confirmed' });
  });

  it('404 when the supply row is missing', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: null }).db, supabase: supabaseWithUser({ phone_confirmed_at: PHONE_AT }) }));
    const res = await app.request('/v1/providers/me/verification/phone-confirm', post(await caregiverToken()));
    expect(res.status).toBe(404);
  });

  it('mirrors the confirmed phone and advances the state', async () => {
    // Everything cleared except phone → awaiting-phone-verification; confirming phone activates.
    const { db, captures } = makeDb({
      provider: PROVIDER_CG,
      verification: vrow({
        email_confirmed_at: new Date(EMAIL_AT),
        id_doc_uploaded_at: new Date(),
        screening_initiated_at: new Date(),
        screening_passed_at: new Date(),
      }),
      connect: { account_ready_at: new Date('2026-06-04T00:00:00.000Z') },
    });
    const app = buildApp(makeDeps({ db, supabase: supabaseWithUser({ email_confirmed_at: EMAIL_AT, phone_confirmed_at: PHONE_AT }) }));
    const res = await app.request('/v1/providers/me/verification/phone-confirm', post(await caregiverToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; facts: Record<string, unknown> };
    expect(body.state).toBe('activated');
    expect(body.facts.phoneConfirmedAt).toBe(PHONE_AT);
    expect(captures.updates).toContainEqual(
      expect.objectContaining({ table: 'provider_verifications', set: expect.objectContaining({ phone_confirmed_at: expect.any(Date) }) }),
    );
  });
});

describe('POST /v1/providers/me/verification/id-doc', () => {
  it('400 invalid_object_path when the path is not in the caller id-doc namespace', async () => {
    const db = makeDb({ provider: PROVIDER_CG, verification: vrow({ email_confirmed_at: new Date(EMAIL_AT) }) }).db;
    const app = buildApp(makeDeps({ db, supabase: supabaseWithUser({ email_confirmed_at: EMAIL_AT }) }));
    const res = await app.request(
      '/v1/providers/me/verification/id-doc',
      post(await caregiverToken(), { objectPath: 'id-doc/uid-999/forged.jpg' }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_object_path' });
  });

  it('403 forbidden_role for a parent token', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: PROVIDER_CG }).db }));
    const res = await app.request(
      '/v1/providers/me/verification/id-doc',
      post(await parentToken(), { objectPath: 'id-doc/uid-p/x.jpg' }),
    );
    expect(res.status).toBe(403);
  });

  it('records the upload, stamps the path, and advances to id-uploaded', async () => {
    const { db, captures } = makeDb({
      provider: PROVIDER_CG,
      verification: vrow({ email_confirmed_at: new Date(EMAIL_AT) }),
    });
    const app = buildApp(makeDeps({ db, supabase: supabaseWithUser({ email_confirmed_at: EMAIL_AT }) }));
    const objectPath = 'id-doc/uid-1/abc-123.jpg';
    const res = await app.request('/v1/providers/me/verification/id-doc', post(await caregiverToken(), { objectPath }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; facts: Record<string, unknown> };
    expect(body.state).toBe('id-uploaded');
    expect(body.facts.idDocObjectPath).toBe(objectPath);
    expect(captures.updates).toContainEqual(
      expect.objectContaining({
        table: 'provider_verifications',
        set: expect.objectContaining({ id_doc_object_path: objectPath, id_doc_uploaded_at: expect.any(Date) }),
      }),
    );
  });
});
