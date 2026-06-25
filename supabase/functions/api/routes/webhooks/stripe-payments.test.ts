import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../app.ts';
import { buildTestEnv } from '../../_test/jwt.ts';
import type { AppDeps } from '../../deps.ts';
import { createStripeAdapter } from '../../vendors/stripe.ts';

// Matches buildTestEnv()'s STRIPE_PAYMENTS_WEBHOOK_SECRET so the real adapter
// verifies signatures we mint here end-to-end through the route.
const PAYMENTS_SECRET = 'whsec_test_payments';

function sign(rawBody: string, ts = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', PAYMENTS_SECRET).update(`${ts}.${rawBody}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

function makeDb(opts: { screening?: Record<string, unknown> | null; provider?: Record<string, unknown> | null }) {
  const captures = {
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
    outbox: [] as Array<{ table: string; values: Record<string, unknown> }>,
  };
  const selectFrom = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      where: () => chain,
      executeTakeFirst: async () => {
        if (table === 'provider_screenings') return opts.screening ?? undefined;
        if (table === 'providers') return opts.provider ?? undefined;
        return undefined;
      },
    };
    return chain;
  };
  const trx = {
    updateTable: (table: string) => {
      const chain: Record<string, unknown> = {
        set: (set: Record<string, unknown>) => {
          captures.updates.push({ table, set });
          return chain;
        },
        where: () => chain,
        execute: async () => [],
      };
      return chain;
    },
    insertInto: (table: string) => {
      const chain: Record<string, unknown> = {
        values: (values: Record<string, unknown>) => {
          captures.outbox.push({ table, values });
          return chain;
        },
        onConflict: () => chain,
        execute: async () => [],
      };
      return chain;
    },
  };
  const db = {
    selectFrom,
    transaction: () => ({ execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx) }),
  } as unknown as AppDeps['db'];
  return { db, captures };
}

function makeDeps(
  db: AppDeps['db'],
  getUserById = vi.fn(async () => ({
    data: { user: { email: 'cg@example.com', user_metadata: { first_name: 'Casey', last_name: 'Giver' } } },
    error: null,
  })),
): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  const neverFetch = (async () => {
    throw new Error('payments webhook must not call Stripe');
  }) as unknown as typeof fetch;
  return {
    env: buildTestEnv(),
    db,
    supabase: { admin: { auth: { admin: { getUserById } } } } as unknown as AppDeps['supabase'],
    stripe: createStripeAdapter({
      secretKey: 'sk_test',
      connectWebhookSecret: 'whsec_test_connect',
      paymentsWebhookSecret: PAYMENTS_SECRET,
      fetchImpl: neverFetch,
    }),
    backgroundCheck: stub,
  };
}

const PATH = '/v1/webhooks/stripe-payments';

function paymentSucceeded(metadata: Record<string, string>) {
  return JSON.stringify({
    id: 'evt_1',
    type: 'payment_intent.succeeded',
    created: 1,
    data: { object: { id: 'pi_1', status: 'succeeded', amount: 3500, currency: 'usd', metadata } },
  });
}

function postWebhook(body: string, signature: string | null): RequestInit {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature) headers['stripe-signature'] = signature;
  return { method: 'POST', headers, body };
}

const SCREENING_META = { purpose: 'screening', screening_id: 'screening-1', provider_id: 'prov-1' };

describe('POST /v1/webhooks/stripe-payments', () => {
  it('400 invalid_signature without a signature header', async () => {
    const app = buildApp(makeDeps(makeDb({}).db));
    const res = await app.request(PATH, postWebhook('{}', null));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_signature' });
  });

  it('acks 200 and does nothing for non payment_intent.succeeded events', async () => {
    const { db, captures } = makeDb({});
    const app = buildApp(makeDeps(db));
    const raw = JSON.stringify({ id: 'evt', type: 'payment_intent.created', created: 1, data: { object: { id: 'pi_1' } } });
    const res = await app.request(PATH, postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(captures.outbox).toHaveLength(0);
    expect(captures.updates).toHaveLength(0);
  });

  it('acks 200 and ignores intents that are not screening charges', async () => {
    const { db, captures } = makeDb({});
    const app = buildApp(makeDeps(db));
    const raw = paymentSucceeded({ purpose: 'booking' });
    const res = await app.request(PATH, postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(captures.outbox).toHaveLength(0);
  });

  it('acks 200 without writes when no screening row matches the intent', async () => {
    const { db, captures } = makeDb({ screening: null });
    const app = buildApp(makeDeps(db));
    const raw = paymentSucceeded(SCREENING_META);
    const res = await app.request(PATH, postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(captures.updates).toHaveLength(0);
    expect(captures.outbox).toHaveLength(0);
  });

  it('is idempotent: acks 200 without writes when the row is past payment_pending', async () => {
    const { db, captures } = makeDb({
      screening: { id: 'screening-1', provider_id: 'prov-1', status: 'payment_succeeded' },
      provider: { id: 'prov-1', uid: 'uid-cg', state: 'CA' },
    });
    const app = buildApp(makeDeps(db));
    const raw = paymentSucceeded(SCREENING_META);
    const res = await app.request(PATH, postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(captures.updates).toHaveLength(0);
    expect(captures.outbox).toHaveLength(0);
  });

  it('flips the row to payment_succeeded and enqueues the screening.invite with resolved identity', async () => {
    const { db, captures } = makeDb({
      screening: { id: 'screening-1', provider_id: 'prov-1', status: 'payment_pending' },
      provider: { id: 'prov-1', uid: 'uid-cg', state: 'CA' },
    });
    const app = buildApp(makeDeps(db));
    const raw = paymentSucceeded(SCREENING_META);
    const res = await app.request(PATH, postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    expect(captures.updates).toHaveLength(1);
    expect(captures.updates[0]).toMatchObject({
      table: 'provider_screenings',
      set: { status: 'payment_succeeded' },
    });
    expect(captures.updates[0]!.set.paid_at).toBeInstanceOf(Date);

    expect(captures.outbox).toHaveLength(1);
    const row = captures.outbox[0]!;
    expect(row.table).toBe('notification_outbox');
    expect(row.values).toMatchObject({
      recipient_uid: 'uid-cg',
      event_type: 'screening.invite',
      dedupe_key: 'screening.invite:screening-1',
    });
    expect(row.values.payload).toMatchObject({
      screeningId: 'screening-1',
      providerId: 'prov-1',
      email: 'cg@example.com',
      firstName: 'Casey',
      lastName: 'Giver',
      state: 'CA',
    });
  });
});
