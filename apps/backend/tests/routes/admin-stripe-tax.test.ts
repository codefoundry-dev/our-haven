/**
 * Route tests for OH-111 — admin Stripe Tax surfaces.
 *
 * Coverage map vs. acceptance criteria:
 *   AC #1 (Subscription tax per subscriber state)  → preview-calculation
 *                                                    suite + 5-state matrix.
 *   AC #2 (Commission tax per Provider state)      → preview-calculation
 *                                                    suite + multi-state.
 *   AC #3 (Booking flows do NOT add platform tax)  → schema test (Zod
 *                                                    purpose enum rejects
 *                                                    'booking').
 *   AC #4 (Stripe Tax dashboard nexus monitoring)  → registrations suite.
 */

import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDeps } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';
import { authPlugin } from '@/plugins/auth.js';
import { adminStripeTaxRoutes } from '@/routes/admin/stripe-tax.js';
import type { StripeAdapter } from '@/vendors/stripe.js';

import { applyTestEnv, mintAccessToken } from '../helpers/test-jwt.js';

function envForTest() {
  resetEnvForTests();
  applyTestEnv();
  return loadEnv();
}

interface StoredRow {
  id: string;
  stripe_calculation_id: string;
  purpose: 'subscription' | 'commission';
  reference: string;
  subject_uid: string | null;
  customer_state: string;
  customer_postal_code: string | null;
  amount_cents: number;
  tax_amount_cents: number;
  amount_total_cents: number;
  tax_behavior: 'inclusive' | 'exclusive';
  tax_code: string;
  tax_breakdown: unknown[];
  raw_payload: Record<string, unknown>;
  stripe_expires_at: Date;
  created_at: Date;
}

interface DbStubOpts {
  stored?: StoredRow[];
  stepUpGrant?: { granted_at: Date } | null;
}

function makeDbStub(opts: DbStubOpts = {}) {
  const stored: StoredRow[] = opts.stored ? [...opts.stored] : [];

  const db = {
    selectFrom(table: string) {
      if (table === 'stripe_tax_calculations') {
        let purpose: string | undefined;
        let state: string | undefined;
        let subjectUid: string | undefined;
        let limit = 100;
        const chain = {
          select: () => chain,
          orderBy: () => chain,
          limit: (n: number) => {
            limit = n;
            return chain;
          },
          where: (col: string, _op: string, val: unknown) => {
            if (col === 'purpose') purpose = val as string;
            if (col === 'customer_state') state = val as string;
            if (col === 'subject_uid') subjectUid = val as string;
            return chain;
          },
          execute: vi.fn(async () => {
            return stored
              .filter((r) => !purpose || r.purpose === purpose)
              .filter((r) => !state || r.customer_state === state)
              .filter((r) => !subjectUid || r.subject_uid === subjectUid)
              .slice(0, limit);
          }),
        };
        return chain;
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
      if (table === 'stripe_tax_calculations') {
        return {
          values: (vals: Omit<StoredRow, 'id' | 'created_at'>) => ({
            returning: () => ({
              executeTakeFirstOrThrow: vi.fn(async () => {
                const row: StoredRow = {
                  ...vals,
                  id: `calc-${stored.length + 1}`,
                  stripe_expires_at: vals.stripe_expires_at as Date,
                  created_at: new Date(),
                };
                stored.push(row);
                return { id: row.id };
              }),
            }),
          }),
        };
      }
      throw new Error(`unstubbed insertInto(${table})`);
    },
  };

  return { db, stored };
}

function makeStripeStub(over: Partial<StripeAdapter> = {}): StripeAdapter {
  const calcFn = vi.fn(async () => ({
    id: 'taxcalc_test',
    amount_total: 1999,
    tax_amount_exclusive: 0,
    tax_amount_inclusive: 0,
    currency: 'usd',
    expires_at: Math.floor(Date.now() / 1000) + 86_400,
    customer_details: {},
    tax_breakdown: [],
    line_items: {
      data: [
        { amount: 1999, amount_tax: 0, reference: 'r', tax_behavior: 'exclusive', tax_code: 'txcd_x' },
      ],
    },
  }));
  const listFn = vi.fn(async () => ({ data: [], has_more: false }));
  const createRegFn = vi.fn(async () => ({
    id: 'taxreg_1',
    active_from: 1_716_700_000,
    country: 'US',
    country_options: { us: { state: 'CA', type: 'state_sales_tax' } },
    expires_at: null,
    status: 'active' as const,
  }));
  return {
    createScreeningPaymentIntent: vi.fn(),
    verifyWebhookSignature: vi.fn(() => true),
    parseWebhookEvent: vi.fn(),
    createConnectAccount: vi.fn(),
    createAccountLink: vi.fn(),
    createLoginLink: vi.fn(),
    retrieveConnectAccount: vi.fn(),
    verifyConnectWebhookSignature: vi.fn(() => true),
    parseConnectWebhookEvent: vi.fn(),
    createTaxCalculation: calcFn,
    listTaxRegistrations: listFn,
    createUsStateRegistration: createRegFn,
    ...over,
  } as StripeAdapter;
}

function makeDeps(opts: { db: unknown; stripe?: StripeAdapter }): AppDeps {
  const passThrough = new Proxy({} as never, { get: () => passThrough });
  return {
    env: envForTest(),
    db: opts.db as never,
    supabase: passThrough,
    storage: passThrough,
    queue: passThrough,
    stripe: opts.stripe ?? makeStripeStub(),
    backgroundCheck: passThrough,
  };
}

async function buildAppWithRoutes(deps: AppDeps) {
  const app = Fastify({ logger: { level: 'fatal' }, disableRequestLogging: true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);
  await app.register(authPlugin);
  await app.register(adminStripeTaxRoutes, { prefix: '/v1' });
  return app;
}

async function adminToken(): Promise<string> {
  return mintAccessToken({ sub: 'admin-1', appMetadata: { role: 'admin' } });
}

describe('POST /v1/admin/stripe-tax/preview-calculation', () => {
  beforeEach(() => resetEnvForTests());

  it('403s for a non-admin role', async () => {
    const stub = makeDbStub();
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db }));
    const token = await mintAccessToken({ sub: 'u', appMetadata: { role: 'parent' } });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/stripe-tax/preview-calculation',
        headers: { authorization: `Bearer ${token}` },
        payload: { purpose: 'subscription', amountCents: 1999, state: 'CA', reference: 'r1' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('rejects unknown purposes — Booking is structurally not a tax purpose (AC #3)', async () => {
    const stub = makeDbStub();
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db }));
    const token = await adminToken();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/stripe-tax/preview-calculation',
        headers: { authorization: `Bearer ${token}` },
        payload: { purpose: 'booking', amountCents: 1999, state: 'CA', reference: 'r1' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it.each(['CA', 'TX', 'NY', 'FL', 'WA'])(
    'computes Subscription tax for %s and persists an audit row (AC #1)',
    async (state) => {
      const stub = makeDbStub();
      const stripeStub = makeStripeStub();
      const app = await buildAppWithRoutes(makeDeps({ db: stub.db, stripe: stripeStub }));
      const token = await adminToken();
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/admin/stripe-tax/preview-calculation',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            purpose: 'subscription',
            amountCents: 1999,
            state,
            reference: `sub_preview_${state}`,
          },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.purpose).toBe('subscription');
        expect(body.customerState).toBe(state);
        expect(body.amountCents).toBe(1999);
        expect(typeof body.taxAmountCents).toBe('number');
        expect(stripeStub.createTaxCalculation).toHaveBeenCalledWith(
          expect.objectContaining({ purpose: 'subscription', amountCents: 1999, customerAddress: expect.objectContaining({ state }) }),
        );
        expect(stub.stored).toHaveLength(1);
        expect(stub.stored[0]!.customer_state).toBe(state);
      } finally {
        await app.close();
      }
    },
  );

  it('computes Commission tax for a Provider in TX (AC #2)', async () => {
    const stub = makeDbStub();
    const stripeStub = makeStripeStub();
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db, stripe: stripeStub }));
    const token = await adminToken();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/stripe-tax/preview-calculation',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          purpose: 'commission',
          amountCents: 800,
          state: 'TX',
          reference: 'commission_b-1',
          subjectUid: '11111111-1111-4111-8111-111111111111',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.purpose).toBe('commission');
      expect(body.customerState).toBe('TX');
      expect(stripeStub.createTaxCalculation).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'commission', customerAddress: expect.objectContaining({ state: 'TX' }) }),
      );
      expect(stub.stored[0]!.subject_uid).toBe('11111111-1111-4111-8111-111111111111');
    } finally {
      await app.close();
    }
  });

  it('502s with Stripe failure detail when the API rejects', async () => {
    const stub = makeDbStub();
    const stripeStub = makeStripeStub({
      createTaxCalculation: vi.fn(async () => {
        throw new Error('stripe POST /tax/calculations failed: 400');
      }),
    });
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db, stripe: stripeStub }));
    const token = await adminToken();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/stripe-tax/preview-calculation',
        headers: { authorization: `Bearer ${token}` },
        payload: { purpose: 'subscription', amountCents: 1999, state: 'CA', reference: 'r' },
      });
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe('stripe_tax_calculation_failed');
    } finally {
      await app.close();
    }
  });
});

describe('GET /v1/admin/stripe-tax/calculations', () => {
  beforeEach(() => resetEnvForTests());

  function seed(): StoredRow[] {
    const base: Omit<StoredRow, 'id' | 'created_at'> = {
      stripe_calculation_id: 'taxcalc_seed',
      purpose: 'subscription',
      reference: 'r',
      subject_uid: null,
      customer_state: 'CA',
      customer_postal_code: null,
      amount_cents: 1999,
      tax_amount_cents: 0,
      amount_total_cents: 1999,
      tax_behavior: 'exclusive',
      tax_code: 'txcd_10103001',
      tax_breakdown: [],
      raw_payload: {},
      stripe_expires_at: new Date('2026-06-01T00:00:00Z'),
    };
    return [
      { ...base, id: 'c1', created_at: new Date(), purpose: 'subscription', customer_state: 'CA' },
      { ...base, id: 'c2', created_at: new Date(), purpose: 'commission', customer_state: 'TX' },
      { ...base, id: 'c3', created_at: new Date(), purpose: 'subscription', customer_state: 'NY' },
    ];
  }

  it('filters by purpose', async () => {
    const stub = makeDbStub({ stored: seed() });
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db }));
    const token = await adminToken();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/stripe-tax/calculations?purpose=commission',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.calculations).toHaveLength(1);
      expect(body.calculations[0].purpose).toBe('commission');
    } finally {
      await app.close();
    }
  });

  it('filters by state', async () => {
    const stub = makeDbStub({ stored: seed() });
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db }));
    const token = await adminToken();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/stripe-tax/calculations?state=NY',
        headers: { authorization: `Bearer ${token}` },
      });
      const body = res.json();
      expect(body.calculations).toHaveLength(1);
      expect(body.calculations[0].customerState).toBe('NY');
    } finally {
      await app.close();
    }
  });
});

describe('GET /v1/admin/stripe-tax/registrations', () => {
  beforeEach(() => resetEnvForTests());

  it('lists active registrations and surfaces the US-state shape (AC #4)', async () => {
    const stub = makeDbStub();
    const stripeStub = makeStripeStub({
      listTaxRegistrations: vi.fn(async () => ({
        data: [
          {
            id: 'taxreg_1',
            active_from: 1_716_700_000,
            country: 'US',
            country_options: { us: { state: 'CA', type: 'state_sales_tax' } },
            expires_at: null,
            status: 'active' as const,
          },
          {
            id: 'taxreg_2',
            active_from: 1_716_700_000,
            country: 'US',
            country_options: { us: { state: 'TX', type: 'state_sales_tax' } },
            expires_at: null,
            status: 'active' as const,
          },
        ],
        has_more: false,
      })),
    });
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db, stripe: stripeStub }));
    const token = await adminToken();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/admin/stripe-tax/registrations',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.registrations).toHaveLength(2);
      expect(body.registrations.map((r: { state: string }) => r.state)).toEqual(['CA', 'TX']);
      expect(stripeStub.listTaxRegistrations).toHaveBeenCalledWith({ status: 'active', limit: 100 });
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/admin/stripe-tax/registrations', () => {
  beforeEach(() => resetEnvForTests());

  it('403s without a step-up MFA grant', async () => {
    const stub = makeDbStub({ stepUpGrant: null });
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db }));
    const token = await adminToken();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/stripe-tax/registrations',
        headers: { authorization: `Bearer ${token}` },
        payload: { state: 'CA' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('step_up_required');
    } finally {
      await app.close();
    }
  });

  it('creates a US state registration with a fresh step-up grant', async () => {
    const stub = makeDbStub({ stepUpGrant: { granted_at: new Date() } });
    const stripeStub = makeStripeStub();
    const app = await buildAppWithRoutes(makeDeps({ db: stub.db, stripe: stripeStub }));
    const token = await adminToken();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/admin/stripe-tax/registrations',
        headers: { authorization: `Bearer ${token}` },
        payload: { state: 'CA', registrationType: 'state_sales_tax' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe('taxreg_1');
      expect(body.state).toBe('CA');
      expect(stripeStub.createUsStateRegistration).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'CA', registrationType: 'state_sales_tax' }),
      );
    } finally {
      await app.close();
    }
  });
});
