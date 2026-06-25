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

  it('sets the caregiver role + categories on a role-less token and writes app_metadata', async () => {
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const app = buildApp(makeDeps({ updateUserById }));
    const token = await mintAccessToken({ sub: 'uid-1', email: 'cg@example.com' });
    const res = await app.request(
      '/v1/auth/role-claim',
      postJson(token, { role: 'caregiver', categories: ['babysitter', 'nanny'] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      role: 'caregiver',
      categories: ['babysitter', 'nanny'],
      specialty: null,
    });
    expect(updateUserById).toHaveBeenCalledWith(
      'uid-1',
      expect.objectContaining({
        app_metadata: expect.objectContaining({ role: 'caregiver', categories: ['babysitter', 'nanny'] }),
      }),
    );
  });

  it('sets the provider role + specialty', async () => {
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const app = buildApp(makeDeps({ updateUserById }));
    const token = await mintAccessToken({ sub: 'uid-2', email: 'pv@example.com' });
    const res = await app.request('/v1/auth/role-claim', postJson(token, { role: 'provider', specialty: 'slp' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'provider', categories: null, specialty: 'slp' });
    expect(updateUserById).toHaveBeenCalledWith(
      'uid-2',
      expect.objectContaining({ app_metadata: expect.objectContaining({ role: 'provider', specialty: 'slp' }) }),
    );
  });

  it('is idempotent (200, no write) when the existing claim matches', async () => {
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const app = buildApp(makeDeps({ updateUserById }));
    const token = await mintAccessToken({
      sub: 'uid-3',
      appMetadata: { role: 'caregiver', categories: ['babysitter'] },
    });
    const res = await app.request('/v1/auth/role-claim', postJson(token, { role: 'caregiver', categories: ['babysitter'] }));
    expect(res.status).toBe(200);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('409 role_already_claimed when changing an existing role (permanence)', async () => {
    const updateUserById = vi.fn(async () => ({ data: null, error: null }));
    const app = buildApp(makeDeps({ updateUserById }));
    const token = await mintAccessToken({ sub: 'uid-4', appMetadata: { role: 'parent' } });
    const res = await app.request('/v1/auth/role-claim', postJson(token, { role: 'caregiver', categories: ['babysitter'] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'role_already_claimed' });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('400 when role=caregiver omits categories', async () => {
    const app = buildApp(makeDeps());
    const token = await mintAccessToken({ sub: 'uid-5' });
    const res = await app.request('/v1/auth/role-claim', postJson(token, { role: 'caregiver' }));
    expect(res.status).toBe(400);
  });

  it('400 when role=provider omits specialty', async () => {
    const app = buildApp(makeDeps());
    const token = await mintAccessToken({ sub: 'uid-6' });
    const res = await app.request('/v1/auth/role-claim', postJson(token, { role: 'provider' }));
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

describe('GET /v1/caregiver/payout-settings (sample step-up gate)', () => {
  it('403 forbidden_role for a non-caregiver role', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ stepUpGrant: { granted_at: new Date() } }) }));
    const token = await mintAccessToken({ sub: 'uid-1', appMetadata: { role: 'provider', specialty: 'slp' } });
    const res = await app.request('/v1/caregiver/payout-settings', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden_role' });
  });

  it('403 step_up_required for a caregiver without a fresh grant', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ stepUpGrant: null }) }));
    const token = await mintAccessToken({ sub: 'uid-1', appMetadata: { role: 'caregiver', categories: ['babysitter'] } });
    const res = await app.request('/v1/caregiver/payout-settings', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'step_up_required' });
  });

  it('200 for a caregiver with a fresh step-up grant', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ stepUpGrant: { granted_at: new Date() } }) }));
    const token = await mintAccessToken({ sub: 'uid-1', appMetadata: { role: 'caregiver', categories: ['babysitter'] } });
    const res = await app.request('/v1/caregiver/payout-settings', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ uid: 'uid-1', stepUp: 'satisfied' });
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
