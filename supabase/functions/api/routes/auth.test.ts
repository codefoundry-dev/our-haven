import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/** Db stub: supports the step-up grant insert (POST /auth/step-up/refresh) and
 *  the step-up grant lookup (the sample gated route). Configure the lookup
 *  result via `stepUpGrant`. */
function makeDb(opts: { stepUpGrant?: { granted_at: Date } | null } = {}): AppDeps['db'] {
  const now = new Date();
  const insertChain = {
    values: () => insertChain,
    returning: () => insertChain,
    executeTakeFirstOrThrow: async () => ({
      granted_at: now,
      expires_at: new Date(now.getTime() + 900_000),
    }),
  };
  const selectChain = {
    select: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: () => selectChain,
    executeTakeFirst: async () => opts.stepUpGrant ?? undefined,
  };
  return {
    insertInto: () => insertChain,
    selectFrom: () => selectChain,
  } as unknown as AppDeps['db'];
}

/** Db stub for the role-claim providers insert. Captures each `.values(...)` so
 *  tests can assert the persisted supply identity. The handler calls
 *  `insertInto('providers').values(row).onConflict(...).execute()`. */
function makeProvidersDb(): { db: AppDeps['db']; inserts: Array<Record<string, unknown>> } {
  const inserts: Array<Record<string, unknown>> = [];
  const insertChain = {
    values: (row: Record<string, unknown>) => {
      inserts.push(row);
      return insertChain;
    },
    onConflict: () => insertChain,
    execute: async () => [],
  };
  return { db: { insertInto: () => insertChain } as unknown as AppDeps['db'], inserts };
}

function makeDeps(opts: {
  db?: AppDeps['db'];
  updateUserById?: ReturnType<typeof vi.fn>;
} = {}): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  const updateUserById = opts.updateUserById ?? vi.fn(async () => ({ data: null, error: null }));
  return {
    env: buildTestEnv(),
    db: (opts.db ?? stub) as AppDeps['db'],
    supabase: { admin: { auth: { admin: { updateUserById } } } } as unknown as AppDeps['supabase'],
    stripe: stub as AppDeps['stripe'],
    backgroundCheck: stub as AppDeps['backgroundCheck'],
  };
}

function postJson(token: string, body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('POST /v1/auth/role-claim', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps());
    const res = await app.request('/v1/auth/role-claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'parent' }),
    });
    expect(res.status).toBe(401);
  });

  it('sets the caregiver role + categories + state, writes app_metadata, and persists a providers row', async () => {
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const { db, inserts } = makeProvidersDb();
    const app = buildApp(makeDeps({ db, updateUserById }));
    const token = await mintAccessToken({ sub: 'uid-1', email: 'cg@example.com' });
    const res = await app.request(
      '/v1/auth/role-claim',
      postJson(token, { role: 'caregiver', categories: ['babysitter', 'nanny'], state: 'CA' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      role: 'caregiver',
      categories: ['babysitter', 'nanny'],
      specialty: null,
      state: 'CA',
    });
    expect(updateUserById).toHaveBeenCalledWith(
      'uid-1',
      expect.objectContaining({
        app_metadata: expect.objectContaining({ role: 'caregiver', categories: ['babysitter', 'nanny'], state: 'CA' }),
      }),
    );
    expect(inserts).toEqual([
      { uid: 'uid-1', role: 'caregiver', categories: ['babysitter', 'nanny'], specialty: null, state: 'CA' },
    ]);
  });

  it('sets the provider role + specialty + state and persists a providers row', async () => {
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const { db, inserts } = makeProvidersDb();
    const app = buildApp(makeDeps({ db, updateUserById }));
    const token = await mintAccessToken({ sub: 'uid-2', email: 'pv@example.com' });
    const res = await app.request(
      '/v1/auth/role-claim',
      postJson(token, { role: 'provider', specialty: 'slp', state: 'TX' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'provider', categories: null, specialty: 'slp', state: 'TX' });
    expect(updateUserById).toHaveBeenCalledWith(
      'uid-2',
      expect.objectContaining({ app_metadata: expect.objectContaining({ role: 'provider', specialty: 'slp', state: 'TX' }) }),
    );
    expect(inserts).toEqual([
      { uid: 'uid-2', role: 'provider', categories: null, specialty: 'slp', state: 'TX' },
    ]);
  });

  it('is idempotent (200, no write) when the existing claim matches, including state', async () => {
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const { db, inserts } = makeProvidersDb();
    const app = buildApp(makeDeps({ db, updateUserById }));
    const token = await mintAccessToken({
      sub: 'uid-3',
      appMetadata: { role: 'caregiver', categories: ['babysitter'], state: 'NY' },
    });
    const res = await app.request(
      '/v1/auth/role-claim',
      postJson(token, { role: 'caregiver', categories: ['babysitter'], state: 'NY' }),
    );
    expect(res.status).toBe(200);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it('409 role_already_claimed when changing an existing role (permanence)', async () => {
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const { db, inserts } = makeProvidersDb();
    const app = buildApp(makeDeps({ db, updateUserById }));
    const token = await mintAccessToken({ sub: 'uid-4', appMetadata: { role: 'parent' } });
    const res = await app.request(
      '/v1/auth/role-claim',
      postJson(token, { role: 'caregiver', categories: ['babysitter'], state: 'CA' }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'role_already_claimed' });
    expect(updateUserById).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it('400 when role=caregiver omits categories', async () => {
    const app = buildApp(makeDeps());
    const token = await mintAccessToken({ sub: 'uid-5' });
    const res = await app.request('/v1/auth/role-claim', postJson(token, { role: 'caregiver', state: 'CA' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'categories_required' });
  });

  it('400 when role=provider omits specialty', async () => {
    const app = buildApp(makeDeps());
    const token = await mintAccessToken({ sub: 'uid-6' });
    const res = await app.request('/v1/auth/role-claim', postJson(token, { role: 'provider', state: 'TX' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'specialty_required' });
  });

  it('400 state_required when a caregiver omits state', async () => {
    const app = buildApp(makeDeps());
    const token = await mintAccessToken({ sub: 'uid-5b' });
    const res = await app.request('/v1/auth/role-claim', postJson(token, { role: 'caregiver', categories: ['tutor'] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'state_required' });
  });

  it('400 state_required when a provider omits state', async () => {
    const app = buildApp(makeDeps());
    const token = await mintAccessToken({ sub: 'uid-6b' });
    const res = await app.request('/v1/auth/role-claim', postJson(token, { role: 'provider', specialty: 'ot' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'state_required' });
  });

  it('400 state_not_allowed when state is sent for a parent', async () => {
    const app = buildApp(makeDeps());
    const token = await mintAccessToken({ sub: 'uid-7b' });
    const res = await app.request('/v1/auth/role-claim', postJson(token, { role: 'parent', state: 'CA' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'state_not_allowed' });
  });

  it('400 (schema) when state is not a valid US state', async () => {
    const app = buildApp(makeDeps());
    const token = await mintAccessToken({ sub: 'uid-7c' });
    const res = await app.request(
      '/v1/auth/role-claim',
      postJson(token, { role: 'caregiver', categories: ['babysitter'], state: 'ZZ' }),
    );
    expect(res.status).toBe(400);
  });

  it('400 when categories are sent for a non-caregiver role', async () => {
    const app = buildApp(makeDeps());
    const token = await mintAccessToken({ sub: 'uid-7' });
    const res = await app.request('/v1/auth/role-claim', postJson(token, { role: 'parent', categories: ['babysitter'] }));
    expect(res.status).toBe(400);
  });

  it('400 (schema) when role is admin (not a sign-up role)', async () => {
    const app = buildApp(makeDeps());
    const token = await mintAccessToken({ sub: 'uid-8' });
    const res = await app.request('/v1/auth/role-claim', postJson(token, { role: 'admin' }));
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/auth/step-up/refresh', () => {
  it('400 no_second_factor when the token is aal1', async () => {
    const app = buildApp(makeDeps({ db: makeDb() }));
    const token = await mintAccessToken({ sub: 'uid-1', appMetadata: { role: 'caregiver', categories: ['babysitter'] } });
    const res = await app.request('/v1/auth/step-up/refresh', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'no_second_factor' });
  });

  it('200 + opens a step-up window for an aal2 TOTP token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const app = buildApp(makeDeps({ db: makeDb() }));
    const token = await mintAccessToken({
      sub: 'uid-1',
      appMetadata: { role: 'caregiver', categories: ['babysitter'] },
      aal: 'aal2',
      amr: [{ method: 'mfa/totp', timestamp: now }],
    });
    const res = await app.request('/v1/auth/step-up/refresh', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { secondFactor: string; grantedAt: string; expiresAt: string };
    expect(body.secondFactor).toBe('totp');
    expect(typeof body.grantedAt).toBe('string');
    expect(typeof body.expiresAt).toBe('string');
  });
});

describe('POST /v1/auth/email-otp/issue', () => {
  it('400 no_email_on_account when the token has no email', async () => {
    const app = buildApp(makeDeps());
    const token = await mintAccessToken({ sub: 'uid-1', email: null, appMetadata: { role: 'parent' } });
    const res = await app.request('/v1/auth/email-otp/issue', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'no_email_on_account' });
  });
});
