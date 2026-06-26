import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildApp } from '../../app.ts';
import { buildTestEnv } from '../../_test/jwt.ts';
import type { AppDeps } from '../../deps.ts';
import { createStripeAdapter } from '../../vendors/stripe.ts';

// Matches buildTestEnv()'s STRIPE_BILLING_WEBHOOK_SECRET so the real adapter
// verifies signatures we mint here end-to-end through the route.
const BILLING_SECRET = 'whsec_test_billing';

function sign(rawBody: string, ts = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', BILLING_SECRET).update(`${ts}.${rawBody}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

function makeDb(opts: { subRow?: Record<string, unknown> | null } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const selectChain = {
    select: () => selectChain,
    where: () => selectChain,
    executeTakeFirst: async () => opts.subRow ?? undefined,
  };
  const updateChain = {
    set: (set: Record<string, unknown>) => {
      updates.push(set);
      return updateChain;
    },
    where: () => updateChain,
    execute: async () => [],
  };
  const db = {
    selectFrom: () => selectChain,
    updateTable: () => updateChain,
  } as unknown as AppDeps['db'];
  return { db, updates };
}

function makeDeps(db: AppDeps['db']): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  const neverFetch = (async () => {
    throw new Error('webhook handler must not call Stripe');
  }) as unknown as typeof fetch;
  return {
    env: buildTestEnv(),
    db,
    supabase: stub,
    stripe: createStripeAdapter({
      secretKey: 'sk_test',
      connectWebhookSecret: 'whsec_unused',
      billingWebhookSecret: BILLING_SECRET,
      fetchImpl: neverFetch,
    }),
    backgroundCheck: stub,
  };
}

function post(body: string, signature: string | null): RequestInit {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature) headers['stripe-signature'] = signature;
  return { method: 'POST', headers, body };
}

const URL = '/v1/webhooks/stripe-billing';

function subscriptionEvent(type: string, over: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'evt_1',
    type,
    created: 1,
    data: {
      object: {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        current_period_end: 1790000000,
        cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_1' } }] },
        metadata: { provider_id: 'prov-1' },
        ...over,
      },
    },
  });
}

const ROW = { provider_id: 'prov-1', stripe_customer_id: 'cus_1', price_id: null, listed_at: null };

describe('POST /v1/webhooks/stripe-billing', () => {
  it('400 invalid_signature without a signature header', async () => {
    const { db } = makeDb();
    const res = await buildApp(makeDeps(db)).request(URL, post('{}', null));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_signature' });
  });

  it('400 invalid_payload when signed but unparseable', async () => {
    const { db } = makeDb();
    const raw = 'not json';
    const res = await buildApp(makeDeps(db)).request(URL, post(raw, sign(raw)));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_payload' });
  });

  it('mirrors customer.subscription.created and stamps listed_at on first active', async () => {
    const { db, updates } = makeDb({ subRow: { ...ROW } });
    const raw = subscriptionEvent('customer.subscription.created');
    const res = await buildApp(makeDeps(db)).request(URL, post(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    expect(updates).toHaveLength(1);
    const set = updates[0]!;
    expect(set).toMatchObject({ status: 'active', stripe_subscription_id: 'sub_1', price_id: 'price_1', cancel_at_period_end: false });
    expect(set.current_period_end).toBeInstanceOf(Date);
    expect(set.listed_at).toBeInstanceOf(Date);
  });

  it('does NOT re-stamp listed_at when already listed', async () => {
    const { db, updates } = makeDb({ subRow: { ...ROW, listed_at: new Date('2026-01-01T00:00:00.000Z') } });
    const raw = subscriptionEvent('customer.subscription.updated');
    await buildApp(makeDeps(db)).request(URL, post(raw, sign(raw)));
    expect(updates[0]!.listed_at).toBeUndefined();
  });

  it('mirrors a cancellation (deleted → canceled) and does not stamp listed_at', async () => {
    const { db, updates } = makeDb({ subRow: { ...ROW } });
    const raw = subscriptionEvent('customer.subscription.deleted', { status: 'canceled' });
    await buildApp(makeDeps(db)).request(URL, post(raw, sign(raw)));
    expect(updates[0]!).toMatchObject({ status: 'canceled' });
    expect(updates[0]!.listed_at).toBeUndefined();
  });

  it('acks an unknown subscription status without writing', async () => {
    const { db, updates } = makeDb({ subRow: { ...ROW } });
    const raw = subscriptionEvent('customer.subscription.updated', { status: 'frozen' });
    const res = await buildApp(makeDeps(db)).request(URL, post(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });

  it('links the subscription id on checkout.session.completed', async () => {
    const { db, updates } = makeDb({ subRow: { ...ROW } });
    const raw = JSON.stringify({
      id: 'evt_2',
      type: 'checkout.session.completed',
      created: 1,
      data: { object: { id: 'cs_1', mode: 'subscription', customer: 'cus_1', subscription: 'sub_1', client_reference_id: 'prov-1' } },
    });
    const res = await buildApp(makeDeps(db)).request(URL, post(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(updates[0]!).toMatchObject({ stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1' });
  });

  it('acks 200 without an update when no row matches', async () => {
    const { db, updates } = makeDb({ subRow: null });
    const raw = subscriptionEvent('customer.subscription.updated');
    const res = await buildApp(makeDeps(db)).request(URL, post(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });

  it('acks 200 and ignores unrelated billing events', async () => {
    const { db, updates } = makeDb({ subRow: { ...ROW } });
    const raw = JSON.stringify({ id: 'evt_3', type: 'invoice.paid', created: 1, data: { object: { id: 'in_1' } } });
    const res = await buildApp(makeDeps(db)).request(URL, post(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });
});

/**
 * Parent subscriptions (OH-193) share this billing endpoint with the provider
 * flow. A table-routed db fake lets us assert the handler writes the RIGHT table
 * (parent_subscriptions) and stamps entitled_at — and that it routes by metadata
 * + the customer-id probe fallback.
 */
function makeRoutedDb(opts: { provider?: Record<string, unknown> | null; parent?: Record<string, unknown> | null }) {
  const updates: Array<{ table: string; set: Record<string, unknown> }> = [];
  const sel = (result: unknown) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, { select: () => b, where: () => b, executeTakeFirst: async () => result ?? undefined });
    return b;
  };
  const upd = (table: string) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      set: (s: Record<string, unknown>) => {
        updates.push({ table, set: s });
        return b;
      },
      where: () => b,
      execute: async () => [],
    });
    return b;
  };
  const db = {
    selectFrom: (t: string) =>
      sel(t === 'provider_subscriptions' ? opts.provider : t === 'parent_subscriptions' ? opts.parent : undefined),
    updateTable: (t: string) => upd(t),
  } as unknown as AppDeps['db'];
  return { db, updates };
}

function parentSubscriptionEvent(type: string, over: Record<string, unknown> = {}, meta: Record<string, string> | undefined = { uid: 'uid-par', purpose: 'parent_subscription' }) {
  return JSON.stringify({
    id: 'evt_p1',
    type,
    created: 1,
    data: {
      object: {
        id: 'sub_par',
        customer: 'cus_par',
        status: 'active',
        current_period_end: 1790000000,
        cancel_at_period_end: false,
        items: { data: [{ price: { id: 'price_par' } }] },
        metadata: meta,
        ...over,
      },
    },
  });
}

const PARENT_ROW = { uid: 'uid-par', stripe_customer_id: 'cus_par', price_id: null, entitled_at: null };

describe('POST /v1/webhooks/stripe-billing — Parent subscriptions (OH-193)', () => {
  it('mirrors a parent customer.subscription.created onto parent_subscriptions and stamps entitled_at', async () => {
    const { db, updates } = makeRoutedDb({ parent: { ...PARENT_ROW } });
    const raw = parentSubscriptionEvent('customer.subscription.created');
    const res = await buildApp(makeDeps(db)).request(URL, post(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe('parent_subscriptions');
    expect(updates[0]!.set).toMatchObject({ status: 'active', stripe_subscription_id: 'sub_par', price_id: 'price_par' });
    expect(updates[0]!.set.entitled_at).toBeInstanceOf(Date);
  });

  it('does NOT re-stamp entitled_at when already entitled', async () => {
    const { db, updates } = makeRoutedDb({ parent: { ...PARENT_ROW, entitled_at: new Date('2026-01-01T00:00:00.000Z') } });
    const raw = parentSubscriptionEvent('customer.subscription.updated');
    await buildApp(makeDeps(db)).request(URL, post(raw, sign(raw)));
    expect(updates[0]!.table).toBe('parent_subscriptions');
    expect(updates[0]!.set.entitled_at).toBeUndefined();
  });

  it('mirrors a parent cancellation and does not stamp entitled_at', async () => {
    const { db, updates } = makeRoutedDb({ parent: { ...PARENT_ROW } });
    const raw = parentSubscriptionEvent('customer.subscription.deleted', { status: 'canceled' });
    await buildApp(makeDeps(db)).request(URL, post(raw, sign(raw)));
    expect(updates[0]!).toMatchObject({ table: 'parent_subscriptions' });
    expect(updates[0]!.set).toMatchObject({ status: 'canceled' });
    expect(updates[0]!.set.entitled_at).toBeUndefined();
  });

  it('links the subscription id on a parent checkout.session.completed', async () => {
    const { db, updates } = makeRoutedDb({ parent: { ...PARENT_ROW } });
    const raw = JSON.stringify({
      id: 'evt_p2',
      type: 'checkout.session.completed',
      created: 1,
      data: {
        object: {
          id: 'cs_par',
          mode: 'subscription',
          customer: 'cus_par',
          subscription: 'sub_par',
          client_reference_id: 'uid-par',
          metadata: { uid: 'uid-par', purpose: 'parent_subscription' },
        },
      },
    });
    const res = await buildApp(makeDeps(db)).request(URL, post(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(updates[0]!.table).toBe('parent_subscriptions');
    expect(updates[0]!.set).toMatchObject({ stripe_subscription_id: 'sub_par', stripe_customer_id: 'cus_par' });
  });

  it('routes by the customer-id probe when metadata is absent (resolves the parent table)', async () => {
    const { db, updates } = makeRoutedDb({ provider: null, parent: { ...PARENT_ROW } });
    const raw = parentSubscriptionEvent('customer.subscription.updated', {}, undefined);
    const res = await buildApp(makeDeps(db)).request(URL, post(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe('parent_subscriptions');
  });
});
