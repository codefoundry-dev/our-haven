import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Fake Kysely surface routed by table name. Each `selectFrom(table)` resolves a
 * per-table configured row; insert/update terminals capture their payloads so
 * tests can assert the persisted Connect state. Mirrors the stub style in
 * routes/auth.test.ts.
 */
interface DbOpts {
  caregiver?: Record<string, unknown> | null;
  connectAccount?: Record<string, unknown> | null;
  verification?: Record<string, unknown> | null;
  stepUpGrant?: { granted_at: Date } | null;
  insertedConnect?: Record<string, unknown>;
}

function makeDb(opts: DbOpts = {}) {
  const captures = { inserts: [] as Array<{ table: string; values: unknown }>, updates: [] as Array<{ table: string; set: unknown }> };

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
      values: (values: unknown) => {
        captures.inserts.push({ table, values });
        return b;
      },
      returning: () => b,
      returningAll: () => b,
      onConflict: () => b,
      execute: async () => [],
      executeTakeFirstOrThrow: async () =>
        opts.insertedConnect ?? {
          provider_id: 'cg-1',
          stripe_account_id: null,
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
          disabled_reason: null,
          requirements: {},
          account_ready_at: null,
          last_webhook_at: null,
        },
    });
    return b;
  };

  const updateChain = (table: string) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      set: (set: unknown) => {
        captures.updates.push({ table, set });
        return b;
      },
      where: () => b,
      execute: async () => [],
    });
    return b;
  };

  const db = {
    selectFrom: (table: string) => {
      if (table === 'providers') return selectChain(opts.caregiver);
      if (table === 'provider_connect_accounts') return selectChain(opts.connectAccount);
      if (table === 'provider_verifications') return selectChain(opts.verification);
      if (table === 'auth_step_up_grants') return selectChain(opts.stepUpGrant);
      return selectChain(undefined);
    },
    insertInto: (table: string) => insertChain(table),
    updateTable: (table: string) => updateChain(table),
  } as unknown as AppDeps['db'];

  return { db, captures };
}

function makeDeps(opts: { db?: AppDeps['db']; stripe?: Partial<AppDeps['stripe']> } = {}): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return {
    env: buildTestEnv(),
    db: (opts.db ?? stub) as AppDeps['db'],
    supabase: stub,
    stripe: (opts.stripe ?? stub) as AppDeps['stripe'],
  };
}

const CAREGIVER = { id: 'cg-1', uid: 'uid-1', role: 'caregiver', state: 'CA' };

async function caregiverToken(uid = 'uid-1') {
  return mintAccessToken({ sub: uid, email: 'cg@example.com', appMetadata: { role: 'caregiver', categories: ['babysitter'] } });
}

async function caregiverStepUpToken(uid = 'uid-1') {
  const now = Math.floor(Date.now() / 1000);
  return mintAccessToken({
    sub: uid,
    email: 'cg@example.com',
    appMetadata: { role: 'caregiver', categories: ['babysitter'] },
    aal: 'aal2',
    amr: [{ method: 'mfa/totp', timestamp: now }],
  });
}

function authGet(token: string): RequestInit {
  return { headers: { authorization: `Bearer ${token}` } };
}

function authPost(token: string): RequestInit {
  return { method: 'POST', headers: { authorization: `Bearer ${token}` } };
}

describe('GET /v1/caregiver/connect/summary', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps());
    const res = await app.request('/v1/caregiver/connect/summary');
    expect(res.status).toBe(401);
  });

  it('403 forbidden_role for a provider token (Providers have no Connect)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ caregiver: CAREGIVER }).db }));
    const token = await mintAccessToken({ sub: 'uid-9', appMetadata: { role: 'provider', specialty: 'slp' } });
    const res = await app.request('/v1/caregiver/connect/summary', authGet(token));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden_role' });
  });

  it('404 when the caregiver row is missing', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ caregiver: null }).db }));
    const res = await app.request('/v1/caregiver/connect/summary', authGet(await caregiverToken()));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'caregiver_not_found' });
  });

  it('returns the empty summary when no Connect account row exists', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ caregiver: CAREGIVER, connectAccount: null }).db }));
    const res = await app.request('/v1/caregiver/connect/summary', authGet(await caregiverToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      hasAccount: false,
      stripeAccountId: null,
      accountReady: false,
      requirementsCurrentlyDue: [],
    });
  });

  it('projects a ready account row, surfacing requirement lists', async () => {
    const readyAt = new Date('2026-06-01T00:00:00.000Z');
    const db = makeDb({
      caregiver: CAREGIVER,
      connectAccount: {
        provider_id: 'cg-1',
        stripe_account_id: 'acct_1',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        disabled_reason: null,
        requirements: { currently_due: ['x'], past_due: [], pending_verification: ['y'] },
        account_ready_at: readyAt,
        last_webhook_at: readyAt,
      },
    }).db;
    const app = buildApp(makeDeps({ db }));
    const res = await app.request('/v1/caregiver/connect/summary', authGet(await caregiverToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      hasAccount: true,
      stripeAccountId: 'acct_1',
      chargesEnabled: true,
      payoutsEnabled: true,
      accountReady: true,
      accountReadyAt: readyAt.toISOString(),
      requirementsCurrentlyDue: ['x'],
      requirementsPendingVerification: ['y'],
    });
  });
});

describe('POST /v1/caregiver/connect/onboarding-link', () => {
  it('400 screening_not_cleared before Checkr clears', async () => {
    const db = makeDb({ caregiver: CAREGIVER, verification: { screening_passed_at: null, rejected_at: null } }).db;
    const app = buildApp(makeDeps({ db }));
    const res = await app.request('/v1/caregiver/connect/onboarding-link', authPost(await caregiverToken()));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'screening_not_cleared' });
  });

  it('409 verification_terminated when rejected', async () => {
    const db = makeDb({
      caregiver: CAREGIVER,
      verification: { screening_passed_at: new Date(), rejected_at: new Date() },
    }).db;
    const app = buildApp(makeDeps({ db }));
    const res = await app.request('/v1/caregiver/connect/onboarding-link', authPost(await caregiverToken()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'verification_terminated' });
  });

  it('creates the Stripe account on first onboarding, stamps it, and returns the hosted link', async () => {
    const { db, captures } = makeDb({
      caregiver: CAREGIVER,
      verification: { screening_passed_at: new Date(), rejected_at: null },
      connectAccount: null,
    });
    const createConnectAccount = vi.fn(async () => ({
      id: 'acct_new',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    }));
    const createAccountLink = vi.fn(async () => ({ url: 'https://connect.stripe/onboard', expires_at: 1_900_000_000 }));
    const app = buildApp(makeDeps({ db, stripe: { createConnectAccount, createAccountLink } }));

    const res = await app.request('/v1/caregiver/connect/onboarding-link', authPost(await caregiverToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stripeAccountId: string; url: string };
    expect(body.stripeAccountId).toBe('acct_new');
    expect(body.url).toBe('https://connect.stripe/onboard');

    expect(createConnectAccount).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'cg@example.com', providerId: 'cg-1', metadata: expect.objectContaining({ uid: 'uid-1', state: 'CA' }) }),
    );
    // The new account id is persisted back onto the connect row.
    expect(captures.updates).toEqual([
      expect.objectContaining({ table: 'provider_connect_accounts', set: expect.objectContaining({ stripe_account_id: 'acct_new' }) }),
    ]);
  });

  it('reuses an existing Stripe account (no create) and just mints a fresh link', async () => {
    const { db } = makeDb({
      caregiver: CAREGIVER,
      verification: { screening_passed_at: new Date(), rejected_at: null },
      connectAccount: { provider_id: 'cg-1', stripe_account_id: 'acct_existing', requirements: {} },
    });
    const createConnectAccount = vi.fn();
    const createAccountLink = vi.fn(async () => ({ url: 'https://connect.stripe/onboard2', expires_at: 1_900_000_000 }));
    const app = buildApp(makeDeps({ db, stripe: { createConnectAccount, createAccountLink } }));

    const res = await app.request('/v1/caregiver/connect/onboarding-link', authPost(await caregiverToken()));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { stripeAccountId: string }).stripeAccountId).toBe('acct_existing');
    expect(createConnectAccount).not.toHaveBeenCalled();
    expect(createAccountLink).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acct_existing', type: 'account_onboarding' }));
  });
});

describe('POST /v1/caregiver/connect/dashboard-link (step-up MFA gated)', () => {
  it('403 step_up_required for a caregiver without a fresh grant', async () => {
    const db = makeDb({ caregiver: CAREGIVER, stepUpGrant: null }).db;
    const app = buildApp(makeDeps({ db }));
    const res = await app.request('/v1/caregiver/connect/dashboard-link', authPost(await caregiverStepUpToken()));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'step_up_required' });
  });

  it('403 forbidden_role for a provider token', async () => {
    const db = makeDb({ stepUpGrant: { granted_at: new Date() } }).db;
    const app = buildApp(makeDeps({ db }));
    const token = await mintAccessToken({ sub: 'uid-9', appMetadata: { role: 'provider', specialty: 'slp' }, aal: 'aal2', amr: [{ method: 'mfa/totp' }] });
    const res = await app.request('/v1/caregiver/connect/dashboard-link', authPost(token));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden_role' });
  });

  it('400 connect_account_missing when onboarding has not produced an account', async () => {
    const db = makeDb({ caregiver: CAREGIVER, connectAccount: { provider_id: 'cg-1', stripe_account_id: null }, stepUpGrant: { granted_at: new Date() } }).db;
    const app = buildApp(makeDeps({ db }));
    const res = await app.request('/v1/caregiver/connect/dashboard-link', authPost(await caregiverStepUpToken()));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'connect_account_missing' });
  });

  it('200 returns a one-time Express dashboard login link with a fresh grant', async () => {
    const db = makeDb({
      caregiver: CAREGIVER,
      connectAccount: { provider_id: 'cg-1', stripe_account_id: 'acct_1' },
      stepUpGrant: { granted_at: new Date() },
    }).db;
    const createLoginLink = vi.fn(async () => ({ url: 'https://connect.stripe/dash', created: 1_900_000_000 }));
    const app = buildApp(makeDeps({ db, stripe: { createLoginLink } }));
    const res = await app.request('/v1/caregiver/connect/dashboard-link', authPost(await caregiverStepUpToken()));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toBe('https://connect.stripe/dash');
    expect(createLoginLink).toHaveBeenCalledWith('acct_1');
  });
});
