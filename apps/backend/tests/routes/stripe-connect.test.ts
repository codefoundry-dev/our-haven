import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDeps } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';
import { authPlugin } from '@/plugins/auth.js';
import { stripeConnectRoutes } from '@/routes/stripe-connect.js';

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
  state: string;
}

interface ConnectRow {
  provider_id: string;
  stripe_account_id: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  disabled_reason: string | null;
  requirements: Record<string, unknown>;
  account_ready_at: Date | null;
  last_webhook_at: Date | null;
}

interface VerificationGate {
  screening_passed_at: Date | null;
  rejected_at: Date | null;
}

interface DbStubOpts {
  provider?: ProviderRow | null;
  connect?: ConnectRow | null;
  gate?: VerificationGate | null;
  stepUpGrant?: { granted_at: Date } | null;
}

function makeDbStub(opts: DbStubOpts) {
  let connect: ConnectRow | null = opts.connect ?? null;

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
      if (table === 'provider_connect_accounts') {
        return {
          selectAll: () => ({
            where: () => ({
              executeTakeFirst: vi.fn(async () => connect ?? undefined),
            }),
          }),
        };
      }
      if (table === 'provider_verifications') {
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: vi.fn(async () => opts.gate ?? undefined),
            }),
          }),
        };
      }
      if (table === 'auth_step_up_grants') {
        return {
          select: () => ({
            where: () => ({
              where: () => ({
                where: () => ({
                  orderBy: () => ({
                    limit: () => ({
                      executeTakeFirst: vi.fn(async () => opts.stepUpGrant ?? undefined),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unstubbed selectFrom(${table})`);
    },
    insertInto(table: string) {
      if (table === 'provider_connect_accounts') {
        return {
          values: (vals: Partial<ConnectRow>) => ({
            returningAll: () => ({
              executeTakeFirstOrThrow: vi.fn(async () => {
                connect = {
                  provider_id: vals.provider_id ?? '',
                  stripe_account_id: null,
                  charges_enabled: false,
                  payouts_enabled: false,
                  details_submitted: false,
                  disabled_reason: null,
                  requirements: {},
                  account_ready_at: null,
                  last_webhook_at: null,
                };
                return connect;
              }),
            }),
          }),
        };
      }
      throw new Error(`unstubbed insertInto(${table})`);
    },
    updateTable(table: string) {
      if (table === 'provider_connect_accounts') {
        let patch: Partial<ConnectRow> = {};
        const chain = {
          set: (next: Partial<ConnectRow>) => {
            patch = { ...patch, ...next };
            return chain;
          },
          where: () => chain,
          execute: vi.fn(async () => {
            if (connect) connect = { ...connect, ...patch };
            return undefined;
          }),
        };
        return chain;
      }
      throw new Error(`unstubbed updateTable(${table})`);
    },
  };

  return { db, getConnect: () => connect };
}

interface StripeStubOpts {
  createSpy?: ReturnType<typeof vi.fn>;
  linkSpy?: ReturnType<typeof vi.fn>;
  loginSpy?: ReturnType<typeof vi.fn>;
}
function makeStripeStub(opts: StripeStubOpts = {}) {
  return {
    createScreeningPaymentIntent: vi.fn(),
    verifyWebhookSignature: vi.fn(() => true),
    parseWebhookEvent: vi.fn(),
    createConnectAccount:
      opts.createSpy ??
      vi.fn(async () => ({
        id: 'acct_test_1',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
      })),
    createAccountLink:
      opts.linkSpy ??
      vi.fn(async () => ({
        url: 'https://connect.stripe.com/setup/e/acct_test_1/abc',
        expires_at: Math.floor(Date.now() / 1000) + 600,
      })),
    createLoginLink:
      opts.loginSpy ??
      vi.fn(async () => ({
        url: 'https://connect.stripe.com/express/acct_test_1/dashboard',
        created: Math.floor(Date.now() / 1000),
      })),
    retrieveConnectAccount: vi.fn(),
    verifyConnectWebhookSignature: vi.fn(() => true),
    parseConnectWebhookEvent: vi.fn(),
  };
}

function makeDeps(opts: { db: unknown; stripe?: unknown; getUserById?: ReturnType<typeof vi.fn> }): AppDeps {
  const passThrough = new Proxy({} as never, { get: () => passThrough });
  const getUserById =
    opts.getUserById ?? vi.fn(async () => ({ data: { user: { email: 'p@example.com' } }, error: null }));
  return {
    env: envForTest(),
    db: opts.db as never,
    supabase: {
      admin: {
        auth: { admin: { getUserById, updateUserById: vi.fn(async () => ({ data: null, error: null })) } },
      } as never,
    },
    storage: passThrough,
    queue: passThrough,
    stripe: (opts.stripe ?? makeStripeStub()) as never,
    backgroundCheck: passThrough,
  };
}

async function buildAppWithRoutes(deps: AppDeps) {
  const app = Fastify({ logger: { level: 'fatal' }, disableRequestLogging: true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);
  await app.register(authPlugin);
  await app.register(stripeConnectRoutes, { prefix: '/v1' });
  return app;
}

describe('GET /v1/providers/me/stripe-connect/summary', () => {
  beforeEach(() => resetEnvForTests());

  it('returns hasAccount=false when no row exists', async () => {
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      connect: null,
    });
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db }));
    const token = await mintAccessToken({ sub: 'u-1', appMetadata: { role: 'caregiver' } });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/stripe-connect/summary',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().hasAccount).toBe(false);
      expect(res.json().accountReady).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('returns hasAccount + capability flags when account exists', async () => {
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      connect: {
        provider_id: 'p-1',
        stripe_account_id: 'acct_live_1',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        disabled_reason: null,
        requirements: { currently_due: [] },
        account_ready_at: new Date('2026-05-28T12:00:00Z'),
        last_webhook_at: new Date('2026-05-28T12:00:01Z'),
      },
    });
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db }));
    const token = await mintAccessToken({ sub: 'u-1', appMetadata: { role: 'caregiver' } });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/stripe-connect/summary',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.hasAccount).toBe(true);
      expect(body.stripeAccountId).toBe('acct_live_1');
      expect(body.chargesEnabled).toBe(true);
      expect(body.payoutsEnabled).toBe(true);
      expect(body.accountReady).toBe(true);
      expect(body.accountReadyAt).toBe('2026-05-28T12:00:00.000Z');
    } finally {
      await app.close();
    }
  });

  it('403s for a non-provider role', async () => {
    const stub = makeDbStub({ provider: null });
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db }));
    const token = await mintAccessToken({ sub: 'u-1', appMetadata: { role: 'parent' } });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/stripe-connect/summary',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/providers/me/stripe-connect/onboarding-link', () => {
  beforeEach(() => resetEnvForTests());

  it('400s when Checkr screening has not cleared', async () => {
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      gate: { screening_passed_at: null, rejected_at: null },
    });
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db }));
    const token = await mintAccessToken({ sub: 'u-1', appMetadata: { role: 'caregiver' } });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/stripe-connect/onboarding-link',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('screening_not_cleared');
    } finally {
      await app.close();
    }
  });

  it('creates a Stripe account when none exists and returns a hosted onboarding URL', async () => {
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      gate: { screening_passed_at: new Date('2026-05-25T00:00:00Z'), rejected_at: null },
      connect: null,
    });
    const stripeStub = makeStripeStub();
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db, stripe: stripeStub }));
    const token = await mintAccessToken({ sub: 'u-1', appMetadata: { role: 'caregiver' } });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/stripe-connect/onboarding-link',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.stripeAccountId).toBe('acct_test_1');
      expect(body.url).toMatch(/^https:\/\/connect\.stripe\.com/);
      expect(stripeStub.createConnectAccount).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'p@example.com', providerId: 'p-1' }),
      );
      expect(stripeStub.createAccountLink).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'acct_test_1', type: 'account_onboarding' }),
      );
      // Row was persisted with the new account id.
      expect(stub.getConnect()?.stripe_account_id).toBe('acct_test_1');
    } finally {
      await app.close();
    }
  });

  it('reuses an existing Stripe account id', async () => {
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      gate: { screening_passed_at: new Date('2026-05-25T00:00:00Z'), rejected_at: null },
      connect: {
        provider_id: 'p-1',
        stripe_account_id: 'acct_existing',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        disabled_reason: null,
        requirements: {},
        account_ready_at: null,
        last_webhook_at: null,
      },
    });
    const stripeStub = makeStripeStub();
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db, stripe: stripeStub }));
    const token = await mintAccessToken({ sub: 'u-1', appMetadata: { role: 'caregiver' } });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/stripe-connect/onboarding-link',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().stripeAccountId).toBe('acct_existing');
      expect(stripeStub.createConnectAccount).not.toHaveBeenCalled();
      expect(stripeStub.createAccountLink).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'acct_existing' }),
      );
    } finally {
      await app.close();
    }
  });

  it('409s when the Provider has been rejected', async () => {
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      gate: { screening_passed_at: new Date('2026-05-25T00:00:00Z'), rejected_at: new Date('2026-05-27T00:00:00Z') },
    });
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db }));
    const token = await mintAccessToken({ sub: 'u-1', appMetadata: { role: 'caregiver' } });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/stripe-connect/onboarding-link',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('verification_terminated');
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/providers/me/stripe-connect/dashboard-link', () => {
  beforeEach(() => resetEnvForTests());

  it('403s without a step-up MFA grant (OH-110 AC #3 + #4)', async () => {
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      stepUpGrant: null,
      connect: {
        provider_id: 'p-1',
        stripe_account_id: 'acct_live',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        disabled_reason: null,
        requirements: {},
        account_ready_at: new Date(),
        last_webhook_at: new Date(),
      },
    });
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db }));
    const token = await mintAccessToken({ sub: 'u-1', appMetadata: { role: 'caregiver' } });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/stripe-connect/dashboard-link',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('step_up_required');
    } finally {
      await app.close();
    }
  });

  it('400s when no Stripe account exists yet', async () => {
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      stepUpGrant: { granted_at: new Date() },
      connect: null,
    });
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db }));
    const token = await mintAccessToken({ sub: 'u-1', appMetadata: { role: 'caregiver' } });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/stripe-connect/dashboard-link',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('connect_account_missing');
    } finally {
      await app.close();
    }
  });

  it('returns a Stripe Express login link with a fresh step-up grant', async () => {
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      stepUpGrant: { granted_at: new Date() },
      connect: {
        provider_id: 'p-1',
        stripe_account_id: 'acct_live',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        disabled_reason: null,
        requirements: {},
        account_ready_at: new Date('2026-05-28T12:00:00Z'),
        last_webhook_at: new Date(),
      },
    });
    const stripeStub = makeStripeStub();
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db, stripe: stripeStub }));
    const token = await mintAccessToken({ sub: 'u-1', appMetadata: { role: 'caregiver' } });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/stripe-connect/dashboard-link',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().url).toMatch(/^https:\/\/connect\.stripe\.com\/express\//);
      expect(stripeStub.createLoginLink).toHaveBeenCalledWith('acct_live');
    } finally {
      await app.close();
    }
  });
});
