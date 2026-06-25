import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDeps } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';
import { stripeConnectWebhookRoutes } from '@/routes/webhooks/stripe-connect.js';

import { applyTestEnv } from '../helpers/test-jwt.js';

function envForTest() {
  resetEnvForTests();
  applyTestEnv();
  return loadEnv();
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

function makeDbStub(initial: ConnectRow | null) {
  let row: ConnectRow | null = initial;
  const db = {
    selectFrom(table: string) {
      if (table === 'provider_connect_accounts') {
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: vi.fn(async () => row ?? undefined),
            }),
          }),
        };
      }
      throw new Error(`unstubbed selectFrom(${table})`);
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
            if (row) row = { ...row, ...patch };
            return undefined;
          }),
        };
        return chain;
      }
      throw new Error(`unstubbed updateTable(${table})`);
    },
  };
  return { db, getRow: () => row };
}

function makeStripeStub(opts: {
  verifySpy?: ReturnType<typeof vi.fn>;
  parseSpy?: ReturnType<typeof vi.fn>;
}) {
  return {
    createScreeningPaymentIntent: vi.fn(),
    verifyWebhookSignature: vi.fn(() => true),
    parseWebhookEvent: vi.fn(),
    createConnectAccount: vi.fn(),
    createAccountLink: vi.fn(),
    createLoginLink: vi.fn(),
    retrieveConnectAccount: vi.fn(),
    verifyConnectWebhookSignature: opts.verifySpy ?? vi.fn(() => true),
    parseConnectWebhookEvent: opts.parseSpy ?? vi.fn(),
  };
}

function makeDeps(opts: { db: unknown; stripe: unknown }): AppDeps {
  const passThrough = new Proxy({} as never, { get: () => passThrough });
  return {
    env: envForTest(),
    db: opts.db as never,
    supabase: { admin: passThrough },
    storage: passThrough,
    stripe: opts.stripe as never,
    backgroundCheck: passThrough,
  };
}

async function buildAppWithWebhook(deps: AppDeps) {
  const app = Fastify({ logger: { level: 'fatal' }, disableRequestLogging: true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);
  await app.register(stripeConnectWebhookRoutes, { prefix: '/v1' });
  return app;
}

describe('POST /v1/webhooks/stripe-connect', () => {
  beforeEach(() => resetEnvForTests());

  it('400s on invalid signature', async () => {
    const stub = makeDbStub(null);
    const stripeStub = makeStripeStub({ verifySpy: vi.fn(() => false) });
    const app = await buildAppWithWebhook(makeDeps({ db: stub.db, stripe: stripeStub }));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe-connect',
        headers: { 'content-type': 'application/json', 'stripe-signature': 'bad' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_signature');
    } finally {
      await app.close();
    }
  });

  it('acks unknown event types without touching the DB', async () => {
    const stub = makeDbStub({
      provider_id: 'p-1',
      stripe_account_id: 'acct_1',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      disabled_reason: null,
      requirements: {},
      account_ready_at: null,
      last_webhook_at: null,
    });
    const stripeStub = makeStripeStub({
      parseSpy: vi.fn(() => ({
        id: 'evt_1',
        type: 'invoice.created',
        created: 0,
        data: { object: { id: 'in_1' } },
      })),
    });
    const app = await buildAppWithWebhook(makeDeps({ db: stub.db, stripe: stripeStub }));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe-connect',
        headers: { 'content-type': 'application/json', 'stripe-signature': 'good' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });
      // Row should be untouched.
      expect(stub.getRow()?.charges_enabled).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('on account.updated stamps account_ready_at the first time both capabilities are enabled', async () => {
    const stub = makeDbStub({
      provider_id: 'p-1',
      stripe_account_id: 'acct_1',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      disabled_reason: null,
      requirements: {},
      account_ready_at: null,
      last_webhook_at: null,
    });
    const stripeStub = makeStripeStub({
      parseSpy: vi.fn(() => ({
        id: 'evt_1',
        type: 'account.updated',
        created: 0,
        data: {
          object: {
            id: 'acct_1',
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
            requirements: { currently_due: [], disabled_reason: null },
          },
        },
      })),
    });
    const app = await buildAppWithWebhook(makeDeps({ db: stub.db, stripe: stripeStub }));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe-connect',
        headers: { 'content-type': 'application/json', 'stripe-signature': 'good' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(200);
      const row = stub.getRow();
      expect(row?.charges_enabled).toBe(true);
      expect(row?.payouts_enabled).toBe(true);
      expect(row?.details_submitted).toBe(true);
      expect(row?.account_ready_at).toBeInstanceOf(Date);
    } finally {
      await app.close();
    }
  });

  it('does not re-stamp account_ready_at on subsequent account.updated deliveries', async () => {
    const stampedAt = new Date('2026-05-28T10:00:00Z');
    const stub = makeDbStub({
      provider_id: 'p-1',
      stripe_account_id: 'acct_1',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      disabled_reason: null,
      requirements: {},
      account_ready_at: stampedAt,
      last_webhook_at: stampedAt,
    });
    const stripeStub = makeStripeStub({
      parseSpy: vi.fn(() => ({
        id: 'evt_2',
        type: 'account.updated',
        created: 0,
        data: {
          object: {
            id: 'acct_1',
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
            requirements: { currently_due: [] },
          },
        },
      })),
    });
    const app = await buildAppWithWebhook(makeDeps({ db: stub.db, stripe: stripeStub }));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe-connect',
        headers: { 'content-type': 'application/json', 'stripe-signature': 'good' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(200);
      expect(stub.getRow()?.account_ready_at).toEqual(stampedAt);
    } finally {
      await app.close();
    }
  });

  it('mirrors disabled_reason + requirements when Stripe flags the account', async () => {
    const stub = makeDbStub({
      provider_id: 'p-1',
      stripe_account_id: 'acct_1',
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      disabled_reason: null,
      requirements: {},
      account_ready_at: new Date('2026-05-28T10:00:00Z'),
      last_webhook_at: new Date('2026-05-28T10:00:00Z'),
    });
    const stripeStub = makeStripeStub({
      parseSpy: vi.fn(() => ({
        id: 'evt_3',
        type: 'account.updated',
        created: 0,
        data: {
          object: {
            id: 'acct_1',
            charges_enabled: false,
            payouts_enabled: false,
            details_submitted: true,
            requirements: {
              currently_due: ['individual.id_number'],
              past_due: ['individual.id_number'],
              disabled_reason: 'requirements.past_due',
            },
          },
        },
      })),
    });
    const app = await buildAppWithWebhook(makeDeps({ db: stub.db, stripe: stripeStub }));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe-connect',
        headers: { 'content-type': 'application/json', 'stripe-signature': 'good' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(200);
      const row = stub.getRow();
      expect(row?.charges_enabled).toBe(false);
      expect(row?.payouts_enabled).toBe(false);
      expect(row?.disabled_reason).toBe('requirements.past_due');
      expect(row?.requirements).toMatchObject({ past_due: ['individual.id_number'] });
    } finally {
      await app.close();
    }
  });

  it('acks 200 when no matching row exists (logs + moves on)', async () => {
    const stub = makeDbStub(null);
    const stripeStub = makeStripeStub({
      parseSpy: vi.fn(() => ({
        id: 'evt_4',
        type: 'account.updated',
        created: 0,
        data: { object: { id: 'acct_unknown', charges_enabled: false, payouts_enabled: false, details_submitted: false } },
      })),
    });
    const app = await buildAppWithWebhook(makeDeps({ db: stub.db, stripe: stripeStub }));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe-connect',
        headers: { 'content-type': 'application/json', 'stripe-signature': 'good' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });
    } finally {
      await app.close();
    }
  });
});
