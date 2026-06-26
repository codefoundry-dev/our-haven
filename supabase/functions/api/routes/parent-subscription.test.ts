import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Table-routed Kysely fake for the parent-subscription route (OH-193). Mirrors
 * the provider-subscription stub; the parent row is keyed by `uid` (there is no
 * `parents` table — a Parent is just the auth user).
 */
interface DbOpts {
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
          uid: 'uid-par',
          stripe_customer_id: null,
          stripe_subscription_id: null,
          status: null,
          price_id: null,
          current_period_end: null,
          cancel_at_period_end: false,
          entitled_at: null,
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
    selectFrom: (table: string) =>
      table === 'parent_subscriptions' ? selectChain(opts.subscription) : selectChain(undefined),
    insertInto: (table: string) => insertChain(table),
    updateTable: (table: string) => updateChain(table),
  } as unknown as AppDeps['db'];

  return { db, captures };
}

function makeStripe(over: Partial<AppDeps['stripe']> = {}): AppDeps['stripe'] {
  return {
    createParentBillingCustomer: vi.fn(async () => ({ id: 'cus_test' })),
    createParentSubscriptionCheckoutSession: vi.fn(async () => ({
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
  };
}

const parentToken = (uid = 'uid-par') =>
  mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'parent' } });
const providerToken = (uid = 'uid-prov') =>
  mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'provider', specialty: 'ot' } });

const get = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });
const post = (token: string, body?: unknown): RequestInit => ({
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
  },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

const SUMMARY = '/v1/parents/me/subscription';
const CHECKOUT = '/v1/parents/me/subscription/checkout-link';
const PORTAL = '/v1/parents/me/subscription/portal-link';

describe('GET /v1/parents/me/subscription', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps());
    expect((await app.request(SUMMARY)).status).toBe(401);
  });

  it('403 for a Provider (parent-only)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ subscription: null }).db }));
    expect((await app.request(SUMMARY, get(await providerToken()))).status).toBe(403);
  });

  it('reports not-entitled for a Parent with no subscription (free browse account)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ subscription: null }).db }));
    const res = await app.request(SUMMARY, get(await parentToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: null,
      entitled: false,
      accessReason: 'none',
      hasCustomer: false,
      hasSubscription: false,
    });
  });

  it('reports entitled for an active subscription', async () => {
    const app = buildApp(
      makeDeps({
        db: makeDb({
          subscription: {
            uid: 'uid-par',
            stripe_customer_id: 'cus_1',
            stripe_subscription_id: 'sub_1',
            status: 'active',
            price_id: 'price_1',
            current_period_end: new Date('2026-08-01T00:00:00.000Z'),
            cancel_at_period_end: false,
            entitled_at: new Date('2026-07-01T00:00:00.000Z'),
          },
        }).db,
      }),
    );
    const res = await app.request(SUMMARY, get(await parentToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'active',
      entitled: true,
      accessReason: 'active',
      hasCustomer: true,
      hasSubscription: true,
      priceId: 'price_1',
    });
  });

  it('reports not-entitled (inactive) for a past_due subscription — no dunning grace', async () => {
    const app = buildApp(
      makeDeps({ db: makeDb({ subscription: { uid: 'uid-par', stripe_customer_id: 'cus_1', status: 'past_due' } }).db }),
    );
    const res = await app.request(SUMMARY, get(await parentToken()));
    expect(await res.json()).toMatchObject({ status: 'past_due', entitled: false, accessReason: 'inactive' });
  });
});

describe('POST /v1/parents/me/subscription/checkout-link', () => {
  it('creates a Stripe Customer (first time) and returns a hosted checkout URL', async () => {
    const stripe = makeStripe();
    const { db, captures } = makeDb({ subscription: null });
    const app = buildApp(makeDeps({ db, stripe }));
    const res = await app.request(CHECKOUT, post(await parentToken()));
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      url: 'https://checkout.stripe.com/c/pay/cs_test',
      sessionId: 'cs_test',
      stripeCustomerId: 'cus_test',
    });
    // Customer created once and stamped onto the row keyed by uid.
    expect(stripe.createParentBillingCustomer).toHaveBeenCalledTimes(1);
    expect(stripe.createParentBillingCustomer).toHaveBeenCalledWith(expect.objectContaining({ uid: 'uid-par' }));
    expect(
      captures.updates.some(
        (u) => u.table === 'parent_subscriptions' && (u.set as Record<string, unknown>).stripe_customer_id === 'cus_test',
      ),
    ).toBe(true);
    // Checkout created with the auth uid as the client reference; no pre-applied promo.
    expect(stripe.createParentSubscriptionCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_test', clientReferenceId: 'uid-par', promotionCode: undefined }),
    );
  });

  it('reuses an existing Stripe Customer (no second create)', async () => {
    const stripe = makeStripe();
    const { db } = makeDb({ subscription: { uid: 'uid-par', stripe_customer_id: 'cus_existing', status: null } });
    const app = buildApp(makeDeps({ db, stripe }));
    const res = await app.request(CHECKOUT, post(await parentToken()));
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ stripeCustomerId: 'cus_existing' });
    expect(stripe.createParentBillingCustomer).not.toHaveBeenCalled();
    expect(stripe.createParentSubscriptionCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_existing' }),
    );
  });

  it('passes a discount code through to the checkout session (Stripe Promotion Codes)', async () => {
    const stripe = makeStripe();
    const { db } = makeDb({ subscription: { uid: 'uid-par', stripe_customer_id: 'cus_1', status: null } });
    const app = buildApp(makeDeps({ db, stripe }));
    const res = await app.request(CHECKOUT, post(await parentToken(), { promotionCode: 'promo_launch' }));
    expect(res.status).toBe(200);
    expect(stripe.createParentSubscriptionCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ promotionCode: 'promo_launch' }),
    );
  });

  it('400 on a malformed promo body', async () => {
    const stripe = makeStripe();
    const { db } = makeDb({ subscription: { uid: 'uid-par', stripe_customer_id: 'cus_1', status: null } });
    const app = buildApp(makeDeps({ db, stripe }));
    const res = await app.request(CHECKOUT, post(await parentToken(), { promotionCode: 123 }));
    expect(res.status).toBe(400);
    expect(stripe.createParentSubscriptionCheckoutSession).not.toHaveBeenCalled();
  });

  it('403 for a Provider (parent-only)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ subscription: null }).db, stripe: makeStripe() }));
    expect((await app.request(CHECKOUT, post(await providerToken()))).status).toBe(403);
  });
});

describe('POST /v1/parents/me/subscription/portal-link', () => {
  it('400 when the Parent has no Stripe Customer yet', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ subscription: null }).db, stripe: makeStripe() }));
    const res = await app.request(PORTAL, post(await parentToken()));
    expect(res.status).toBe(400);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: 'no_customer' });
  });

  it('returns a Billing Portal URL when a Customer exists', async () => {
    const stripe = makeStripe();
    const { db } = makeDb({ subscription: { uid: 'uid-par', stripe_customer_id: 'cus_1', status: 'active' } });
    const app = buildApp(makeDeps({ db, stripe }));
    const res = await app.request(PORTAL, post(await parentToken()));
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({
      url: 'https://billing.stripe.com/p/session/bps_test',
    });
    expect(stripe.createBillingPortalSession).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_1' }));
  });
});
