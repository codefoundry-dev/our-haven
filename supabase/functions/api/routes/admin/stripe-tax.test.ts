import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../app.ts';
import { buildTestEnv, mintAccessToken } from '../../_test/jwt.ts';
import type { AppDeps } from '../../deps.ts';

/**
 * Fake Kysely surface for the admin Stripe Tax routes. `selectFrom(table)`
 * resolves a per-table configured row set (used by the calculations list + the
 * step-up grant lookup in the auth middleware); `insertInto` captures the
 * persisted audit payload. Mirrors the stub style in caregiver-connect.test.ts.
 */
function makeDb(
  opts: {
    calculations?: unknown[];
    insertedId?: string;
    stepUpGrant?: { granted_at: Date } | null;
  } = {},
) {
  const captures = { inserts: [] as Array<{ table: string; values: Record<string, unknown> }> };

  const selectChain = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      selectAll: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => b,
      execute: async () => rows,
      executeTakeFirst: async () => rows[0] ?? undefined,
    });
    return b;
  };

  const insertChain = (table: string) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      values: (values: Record<string, unknown>) => {
        captures.inserts.push({ table, values });
        return b;
      },
      returning: () => b,
      returningAll: () => b,
      execute: async () => [],
      executeTakeFirstOrThrow: async () => ({ id: opts.insertedId ?? 'calc-row-1' }),
    });
    return b;
  };

  const db = {
    selectFrom: (table: string) => {
      if (table === 'stripe_tax_calculations') return selectChain(opts.calculations ?? []);
      if (table === 'auth_step_up_grants') {
        return selectChain(opts.stepUpGrant ? [opts.stepUpGrant] : []);
      }
      return selectChain([]);
    },
    insertInto: (table: string) => insertChain(table),
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
    backgroundCheck: stub as AppDeps['backgroundCheck'],
  };
}

async function adminToken(uid = 'admin-1') {
  const now = Math.floor(Date.now() / 1000);
  return mintAccessToken({
    sub: uid,
    email: 'admin@ourhaven.example',
    appMetadata: { role: 'admin' },
    aal: 'aal2',
    amr: [{ method: 'mfa/totp', timestamp: now }],
  });
}

function authGet(token: string): RequestInit {
  return { headers: { authorization: `Bearer ${token}` } };
}

function authJson(token: string, body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const TAX_CALC = {
  id: 'taxcalc_1',
  amount_total: 10_800,
  tax_amount_exclusive: 800,
  tax_amount_inclusive: 0,
  currency: 'usd',
  expires_at: 1_900_000_000,
  customer_details: { address: { country: 'US', state: 'CA' } },
  tax_breakdown: [
    {
      amount: 800,
      inclusive: false,
      tax_rate_details: { state: 'CA', tax_type: 'sales_tax', percentage_decimal: '8.0' },
      taxability_reason: 'standard_rated',
      taxable_amount: 10_000,
    },
  ],
  line_items: {
    data: [{ amount: 10_000, amount_tax: 800, reference: 'sub-1', tax_behavior: 'exclusive', tax_code: 'txcd_10103001' }],
  },
};

const PREVIEW_BODY = { purpose: 'subscription', amountCents: 10_000, state: 'CA', reference: 'sub-1' };

describe('POST /v1/admin/stripe-tax/preview-calculation', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps());
    const res = await app.request('/v1/admin/stripe-tax/preview-calculation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(PREVIEW_BODY),
    });
    expect(res.status).toBe(401);
  });

  it('403 forbidden_role for a non-admin token', async () => {
    const token = await mintAccessToken({ sub: 'p-1', appMetadata: { role: 'caregiver', categories: ['babysitter'] } });
    const app = buildApp(makeDeps());
    const res = await app.request('/v1/admin/stripe-tax/preview-calculation', authJson(token, PREVIEW_BODY));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden_role' });
  });

  it('403 admin_totp_required for an admin token that is not aal2+TOTP', async () => {
    const token = await mintAccessToken({ sub: 'admin-1', appMetadata: { role: 'admin' } });
    const app = buildApp(makeDeps());
    const res = await app.request('/v1/admin/stripe-tax/preview-calculation', authJson(token, PREVIEW_BODY));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'admin_totp_required' });
  });

  it('400 rejects purpose=booking — Bookings are never taxed (the structural guard)', async () => {
    const { db } = makeDb();
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      '/v1/admin/stripe-tax/preview-calculation',
      authJson(await adminToken(), { ...PREVIEW_BODY, purpose: 'booking' }),
    );
    expect(res.status).toBe(400);
  });

  it('200 computes per-state tax, persists the audit row, and projects the result', async () => {
    const { db, captures } = makeDb({ insertedId: 'calc-row-9' });
    const createTaxCalculation = vi.fn(async () => TAX_CALC);
    const app = buildApp(makeDeps({ db, stripe: { createTaxCalculation } }));

    const res = await app.request(
      '/v1/admin/stripe-tax/preview-calculation',
      authJson(await adminToken(), PREVIEW_BODY),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      calculationId: 'calc-row-9',
      stripeCalculationId: 'taxcalc_1',
      purpose: 'subscription',
      customerState: 'CA',
      amountCents: 10_000,
      taxAmountCents: 800,
      amountTotalCents: 10_800,
      taxBehavior: 'exclusive',
      taxCode: 'txcd_10103001',
      taxBreakdown: [
        { amount: 800, inclusive: false, state: 'CA', taxType: 'sales_tax', percentageDecimal: '8.0' },
      ],
    });

    expect(createTaxCalculation).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'subscription', amountCents: 10_000, customerAddress: expect.objectContaining({ state: 'CA' }) }),
    );
    expect(captures.inserts).toEqual([
      expect.objectContaining({
        table: 'stripe_tax_calculations',
        values: expect.objectContaining({
          stripe_calculation_id: 'taxcalc_1',
          purpose: 'subscription',
          customer_state: 'CA',
          tax_amount_cents: 800,
          amount_total_cents: 10_800,
        }),
      }),
    ]);
  });

  it('records tax_amount_cents=0 as a valid (auditable) outcome for a non-taxing state', async () => {
    const { db, captures } = makeDb();
    const createTaxCalculation = vi.fn(async () => ({
      ...TAX_CALC,
      id: 'taxcalc_or',
      amount_total: 10_000,
      tax_amount_exclusive: 0,
      tax_breakdown: [],
    }));
    const app = buildApp(makeDeps({ db, stripe: { createTaxCalculation } }));
    const res = await app.request(
      '/v1/admin/stripe-tax/preview-calculation',
      authJson(await adminToken(), { ...PREVIEW_BODY, state: 'OR', reference: 'sub-or' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ taxAmountCents: 0, amountTotalCents: 10_000, taxBreakdown: [] });
    expect(captures.inserts).toHaveLength(1);
    expect(captures.inserts[0]!.values).toMatchObject({ tax_amount_cents: 0, customer_state: 'OR' });
  });

  it('502 when the Stripe Tax call fails', async () => {
    const createTaxCalculation = vi.fn(async () => {
      throw new Error('stripe down');
    });
    const app = buildApp(makeDeps({ db: makeDb().db, stripe: { createTaxCalculation } }));
    const res = await app.request(
      '/v1/admin/stripe-tax/preview-calculation',
      authJson(await adminToken(), PREVIEW_BODY),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'stripe_tax_calculation_failed' });
  });
});

describe('GET /v1/admin/stripe-tax/calculations', () => {
  it('403 forbidden_role for a non-admin token', async () => {
    const token = await mintAccessToken({ sub: 'p-1', appMetadata: { role: 'parent' } });
    const app = buildApp(makeDeps({ db: makeDb().db }));
    const res = await app.request('/v1/admin/stripe-tax/calculations', authGet(token));
    expect(res.status).toBe(403);
  });

  it('200 projects audit rows newest-first', async () => {
    const db = makeDb({
      calculations: [
        {
          id: 'row-1',
          stripe_calculation_id: 'taxcalc_1',
          purpose: 'commission',
          customer_state: 'TX',
          customer_postal_code: null,
          amount_cents: 1_500,
          tax_amount_cents: 0,
          amount_total_cents: 1_500,
          tax_behavior: 'exclusive',
          tax_code: 'txcd_20030000',
          tax_breakdown: [],
          stripe_expires_at: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
    }).db;
    const app = buildApp(makeDeps({ db }));
    const res = await app.request('/v1/admin/stripe-tax/calculations?purpose=commission', authGet(await adminToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      calculations: [
        {
          calculationId: 'row-1',
          purpose: 'commission',
          customerState: 'TX',
          taxAmountCents: 0,
          taxCode: 'txcd_20030000',
          expiresAt: '2026-06-01T00:00:00.000Z',
        },
      ],
    });
  });
});

describe('GET /v1/admin/stripe-tax/registrations (nexus dashboard)', () => {
  it('200 maps the Stripe registrations list to the nexus view', async () => {
    const listTaxRegistrations = vi.fn(async () => ({
      data: [
        {
          id: 'taxreg_1',
          active_from: 1_800_000_000,
          country: 'US',
          country_options: { us: { state: 'CA', type: 'state_sales_tax' } },
          expires_at: null,
          status: 'active' as const,
        },
      ],
      has_more: false,
    }));
    const app = buildApp(makeDeps({ stripe: { listTaxRegistrations } }));
    const res = await app.request('/v1/admin/stripe-tax/registrations', authGet(await adminToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      registrations: [{ id: 'taxreg_1', state: 'CA', registrationType: 'state_sales_tax', status: 'active', expiresAt: null }],
      hasMore: false,
    });
    expect(listTaxRegistrations).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('502 when the Stripe list call fails', async () => {
    const listTaxRegistrations = vi.fn(async () => {
      throw new Error('stripe down');
    });
    const app = buildApp(makeDeps({ stripe: { listTaxRegistrations } }));
    const res = await app.request('/v1/admin/stripe-tax/registrations', authGet(await adminToken()));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'stripe_list_failed' });
  });
});

describe('POST /v1/admin/stripe-tax/registrations (step-up MFA gated)', () => {
  it('403 step_up_required for an admin without a fresh step-up grant', async () => {
    const db = makeDb({ stepUpGrant: null }).db;
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      '/v1/admin/stripe-tax/registrations',
      authJson(await adminToken(), { state: 'NY' }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'step_up_required' });
  });

  it('200 creates a registration with a fresh step-up grant', async () => {
    const db = makeDb({ stepUpGrant: { granted_at: new Date() } }).db;
    const createUsStateRegistration = vi.fn(async () => ({
      id: 'taxreg_new',
      active_from: 1_800_000_000,
      country: 'US',
      country_options: { us: { state: 'NY', type: 'state_sales_tax' } },
      expires_at: null,
      status: 'active' as const,
    }));
    const app = buildApp(makeDeps({ db, stripe: { createUsStateRegistration } }));
    const res = await app.request(
      '/v1/admin/stripe-tax/registrations',
      authJson(await adminToken(), { state: 'NY' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'taxreg_new', state: 'NY', registrationType: 'state_sales_tax', status: 'active' });
    expect(createUsStateRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'NY', registrationType: 'state_sales_tax' }),
    );
  });
});
