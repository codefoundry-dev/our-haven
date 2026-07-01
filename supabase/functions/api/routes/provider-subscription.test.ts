import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Table-routed Kysely fake for the provider-subscription route (OH-191). Each
 * selectFrom(table) resolves a per-table configured row; insert/update terminals
 * capture their payloads. Mirrors the stub style in caregiver-connect.test.ts.
 */
interface DbOpts {
  provider?: Record<string, unknown> | null;
  subscription?: Record<string, unknown> | null;
  insertedSubscription?: Record<string, unknown>;
}

function makeDb(opts: DbOpts = {}) {
  const captures = {
    inserts: [] as Array<{ table: string; values: unknown }>,
    updates: [] as Array<{ table: string; set: unknown }>,
  };

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
        opts.insertedSubscription ?? {
          provider_id: 'prov-1',
          stripe_customer_id: null,
          stripe_subscription_id: null,
          status: null,
          price_id: null,
          current_period_end: null,
          cancel_at_period_end: false,
          listed_at: null,
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
      if (table === 'providers') return selectChain(opts.provider);
      if (table === 'provider_subscriptions') return selectChain(opts.subscription);
      return selectChain(undefined);
    },
    insertInto: (table: string) => insertChain(table),
    updateTable: (table: string) => updateChain(table),
  } as unknown as AppDeps['db'];

  return { db, captures };
}

function makeStripe(over: Partial<AppDeps['stripe']> = {}): AppDeps['stripe'] {
  return {
    createBillingCustomer: vi.fn(async () => ({ id: 'cus_test' })),
    createSubscriptionCheckoutSession: vi.fn(async () => ({
      id: 'cs_test',
      url: 'https://checkout.stripe.com/c/pay/cs_test',
    })),
    createBillingPortalSession: vi.fn(async () => ({
      id: 'bps_test',
      url: 'https://billing.stripe.com/p/session/bps_test',
    })),
    ...over,
  } as unknown as AppDeps['stripe'];
}

function makeDeps(opts: { db?: AppDeps['db']; stripe?: AppDeps['stripe'] } = {}): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return {
    env: buildTestEnv(),
    db: (opts.db ?? stub) as AppDeps['db'],
    supabase: stub,
    stripe: (opts.stripe ?? stub) as AppDeps['stripe'],
    backgroundCheck: stub as AppDeps['backgroundCheck'],
    daily: stub,
  };
}

const PROVIDER = { id: 'prov-1', uid: 'uid-prov', role: 'provider', state: 'FL' };

const providerToken = (uid = 'uid-prov') =>
  mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'provider', specialty: 'ot' } });
const caregiverToken = (uid = 'uid-cg') =>
  mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'caregiver', categories: ['babysitter'] } });

const get = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });
const post = (token: string): RequestInit => ({ method: 'POST', headers: { authorization: `Bearer ${token}` } });

const SUMMARY = '/v1/providers/me/subscription';
const CHECKOUT = '/v1/providers/me/subscription/checkout-link';
const PORTAL = '/v1/providers/me/subscription/portal-link';

describe('GET /v1/providers/me/subscription', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps());
    expect((await app.request(SUMMARY)).status).toBe(401);
  });

  it('403 for a Caregiver (provider-only)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: PROVIDER }).db }));
    expect((await app.request(SUMMARY, get(await caregiverToken()))).status).toBe(403);
  });

  it('404 when the supply row is missing', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: null }).db }));
    expect((await app.request(SUMMARY, get(await providerToken('orphan')))).status).toBe(404);
  });

  it('reports not-listed for a Provider with no subscription', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: PROVIDER, subscription: null }).db }));
    const res = await app.request(SUMMARY, get(await providerToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: null,
      listed: false,
      listingReason: 'none',
      hasCustomer: false,
      hasSubscription: false,
    });
  });

  it('reports listed for an active subscription', async () => {
    const app = buildApp(
      makeDeps({
        db: makeDb({
          provider: PROVIDER,
          subscription: {
            provider_id: 'prov-1',
            stripe_customer_id: 'cus_1',
            stripe_subscription_id: 'sub_1',
            status: 'active',
            price_id: 'price_1',
            current_period_end: new Date('2026-08-01T00:00:00.000Z'),
            cancel_at_period_end: false,
            listed_at: new Date('2026-07-01T00:00:00.000Z'),
          },
        }).db,
      }),
    );
    const res = await app.request(SUMMARY, get(await providerToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'active',
      listed: true,
      listingReason: 'active',
      hasCustomer: true,
      hasSubscription: true,
      priceId: 'price_1',
    });
  });
});

describe('POST /v1/providers/me/subscription/checkout-link', () => {
  it('creates a Stripe Customer (first time) and returns a hosted checkout URL', async () => {
    const stripe = makeStripe();
    const { db, captures } = makeDb({ provider: PROVIDER, subscription: null });
    const app = buildApp(makeDeps({ db, stripe }));
    const res = await app.request(CHECKOUT, post(await providerToken()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ url: 'https://checkout.stripe.com/c/pay/cs_test', sessionId: 'cs_test', stripeCustomerId: 'cus_test' });
    // Customer was created once and stamped onto the row.
    expect(stripe.createBillingCustomer).toHaveBeenCalledTimes(1);
    expect(captures.updates.some((u) => u.table === 'provider_subscriptions' && (u.set as Record<string, unknown>).stripe_customer_id === 'cus_test')).toBe(true);
    // The checkout session was created with provider id as the client reference.
    expect(stripe.createSubscriptionCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_test', clientReferenceId: 'prov-1' }),
    );
  });

  it('503 not_configured when STRIPE_PROVIDER_SUBSCRIPTION_PRICE_ID is unset', async () => {
    const stripe = makeStripe();
    const { db } = makeDb({
      provider: PROVIDER,
      subscription: { provider_id: 'prov-1', stripe_customer_id: 'cus_existing', status: null },
    });
    // Boot the app with the price id absent — the rest of the API is unaffected.
    const deps: AppDeps = { ...makeDeps({ db, stripe }), env: buildTestEnv({ STRIPE_PROVIDER_SUBSCRIPTION_PRICE_ID: undefined }) };
    const app = buildApp(deps);
    const res = await app.request(CHECKOUT, post(await providerToken()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'not_configured' });
    // The guard short-circuits before Stripe is ever called.
    expect(stripe.createSubscriptionCheckoutSession).not.toHaveBeenCalled();
  });

  it('reuses an existing Stripe Customer (no second create)', async () => {
    const stripe = makeStripe();
    const { db } = makeDb({
      provider: PROVIDER,
      subscription: { provider_id: 'prov-1', stripe_customer_id: 'cus_existing', status: null },
    });
    const app = buildApp(makeDeps({ db, stripe }));
    const res = await app.request(CHECKOUT, post(await providerToken()));
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ stripeCustomerId: 'cus_existing' });
    expect(stripe.createBillingCustomer).not.toHaveBeenCalled();
    expect(stripe.createSubscriptionCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_existing' }),
    );
  });

  it('404 when the supply row is missing', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: null }).db, stripe: makeStripe() }));
    expect((await app.request(CHECKOUT, post(await providerToken('orphan')))).status).toBe(404);
  });
});

describe('POST /v1/providers/me/subscription/portal-link', () => {
  it('400 when the Provider has no Stripe Customer yet', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: PROVIDER, subscription: null }).db, stripe: makeStripe() }));
    const res = await app.request(PORTAL, post(await providerToken()));
    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: 'no_customer' });
  });

  it('returns a Billing Portal URL when a Customer exists', async () => {
    const stripe = makeStripe();
    const { db } = makeDb({
      provider: PROVIDER,
      subscription: { provider_id: 'prov-1', stripe_customer_id: 'cus_1', status: 'active' },
    });
    const app = buildApp(makeDeps({ db, stripe }));
    const res = await app.request(PORTAL, post(await providerToken()));
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ url: 'https://billing.stripe.com/p/session/bps_test' });
    expect(stripe.createBillingPortalSession).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_1' }));
  });
});
