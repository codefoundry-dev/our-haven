import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildApp } from '../../app.ts';
import { buildTestEnv } from '../../_test/jwt.ts';
import type { AppDeps } from '../../deps.ts';
import { createStripeAdapter } from '../../vendors/stripe.ts';

// Matches buildTestEnv()'s STRIPE_CONNECT_WEBHOOK_SECRET so the real adapter
// verifies signatures we mint here end-to-end through the route.
const CONNECT_SECRET = 'whsec_test_connect';

function sign(rawBody: string, ts = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', CONNECT_SECRET).update(`${ts}.${rawBody}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

function makeDb(opts: { connectRow?: Record<string, unknown> | null } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const selectChain = {
    select: () => selectChain,
    where: () => selectChain,
    executeTakeFirst: async () => opts.connectRow ?? undefined,
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
    stripe: createStripeAdapter({ secretKey: 'sk_test', connectWebhookSecret: CONNECT_SECRET, fetchImpl: neverFetch }),
    backgroundCheck: stub,
    daily: stub,
  };
}

function postWebhook(body: string, signature: string | null): RequestInit {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature) headers['stripe-signature'] = signature;
  return { method: 'POST', headers, body };
}

const READY_ACCOUNT = (id: string) =>
  JSON.stringify({
    id: 'evt_1',
    type: 'account.updated',
    created: 1,
    data: {
      object: {
        id,
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements: { disabled_reason: null, currently_due: [] },
      },
    },
  });

describe('POST /v1/webhooks/stripe-connect', () => {
  it('400 invalid_signature without a signature header', async () => {
    const { db } = makeDb();
    const app = buildApp(makeDeps(db));
    const res = await app.request('/v1/webhooks/stripe-connect', postWebhook('{}', null));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_signature' });
  });

  it('400 invalid_payload when the body is signed but unparseable', async () => {
    const { db } = makeDb();
    const app = buildApp(makeDeps(db));
    const raw = 'not json';
    const res = await app.request('/v1/webhooks/stripe-connect', postWebhook(raw, sign(raw)));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_payload' });
  });

  it('mirrors account.updated and stamps account_ready_at on first ready transition', async () => {
    const { db, updates } = makeDb({
      connectRow: {
        provider_id: 'cg-1',
        stripe_account_id: 'acct_1',
        charges_enabled: false,
        payouts_enabled: false,
        account_ready_at: null,
      },
    });
    const app = buildApp(makeDeps(db));
    const raw = READY_ACCOUNT('acct_1');
    const res = await app.request('/v1/webhooks/stripe-connect', postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    expect(updates).toHaveLength(1);
    const set = updates[0]!;
    expect(set).toMatchObject({ charges_enabled: true, payouts_enabled: true, details_submitted: true });
    expect(set.account_ready_at).toBeInstanceOf(Date);
  });

  it('does NOT re-stamp account_ready_at when the account was already ready', async () => {
    const { db, updates } = makeDb({
      connectRow: {
        provider_id: 'cg-1',
        stripe_account_id: 'acct_1',
        charges_enabled: true,
        payouts_enabled: true,
        account_ready_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const app = buildApp(makeDeps(db));
    const raw = READY_ACCOUNT('acct_1');
    const res = await app.request('/v1/webhooks/stripe-connect', postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.account_ready_at).toBeUndefined();
  });

  it('acks 200 without an update when no row matches the account id', async () => {
    const { db, updates } = makeDb({ connectRow: null });
    const app = buildApp(makeDeps(db));
    const raw = READY_ACCOUNT('acct_unknown');
    const res = await app.request('/v1/webhooks/stripe-connect', postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(updates).toHaveLength(0);
  });

  it('acks 200 and ignores non-account.updated events', async () => {
    const { db, updates } = makeDb({ connectRow: { provider_id: 'cg-1', stripe_account_id: 'acct_1' } });
    const app = buildApp(makeDeps(db));
    const raw = JSON.stringify({ id: 'evt_2', type: 'payout.paid', created: 1, data: { object: { id: 'acct_1' } } });
    const res = await app.request('/v1/webhooks/stripe-connect', postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(updates).toHaveLength(0);
  });
});
