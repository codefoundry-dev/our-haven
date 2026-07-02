import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';
import type { StripeAdapter } from '../vendors/stripe.ts';

/**
 * Table-routed Kysely fake for the tip route (OH-215). Selects resolve to a
 * table's canned rows (the `where` is ignored — fixtures are pre-scoped);
 * updates are captured for assertion.
 */
function makeDb(tables: Record<string, Record<string, unknown>[]> = {}) {
  const captures = {
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  };
  const selectChain = (rows: Record<string, unknown>[]) => {
    const c: Record<string, unknown> = {
      select: () => c,
      where: () => c,
      executeTakeFirst: async () => rows[0] ?? undefined,
      execute: async () => rows,
    };
    return c;
  };
  const db = {
    selectFrom: (t: string) => selectChain(tables[t] ?? []),
    updateTable: (t: string) => {
      const c: Record<string, unknown> = {
        set: (set: Record<string, unknown>) => {
          captures.updates.push({ table: t, set });
          return c;
        },
        where: () => c,
        execute: async () => [],
      };
      return c;
    },
  } as unknown as AppDeps['db'];
  return { db, captures };
}

/** A Stripe stub covering the tip money moves; everything else throws. */
function makeStripe(over: Partial<StripeAdapter> = {}): StripeAdapter {
  const base = {
    createBookingPaymentIntent: vi.fn(async () => ({
      id: 'pi_tip_new',
      client_secret: 'pi_tip_secret',
      status: 'requires_capture',
    })),
    cancelPaymentIntent: vi.fn(async () => ({ id: 'pi_tip_old', status: 'canceled', amount: 0 })),
    retrieveCustomerDefaultPaymentMethod: vi.fn(async () => 'pm_saved'),
  } as unknown as StripeAdapter;
  return { ...base, ...over } as StripeAdapter;
}

function makeDeps(db: AppDeps['db'], stripe: StripeAdapter): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return { env: buildTestEnv(), db, supabase: stub, stripe, backgroundCheck: stub, daily: stub };
}

const parentToken = (uid = 'uid-par') =>
  mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'parent' } });
const caregiverToken = () =>
  mintAccessToken({ sub: 'uid-cg', appMetadata: { role: 'caregiver', categories: ['babysitter'] } });

const BID = '33333333-3333-4333-8333-333333333333';
const PID = '55555555-5555-4555-8555-555555555555';
const path = `/v1/bookings/${BID}/tip`;

const put = (token: string, body?: unknown): RequestInit => ({
  method: 'PUT',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** A completed Caregiver Booking with no tip yet. */
const completed = (over: Record<string, unknown> = {}) => ({
  id: BID,
  kind: 'caregiver',
  state: 'completed',
  parent_uid: 'uid-par',
  provider_id: PID,
  tip_cents: null,
  tip_payment_intent_id: null,
  tip_status: null,
  ...over,
});

const fixtures = (booking: Record<string, unknown>) => ({
  bookings: [booking],
  provider_connect_accounts: [
    { stripe_account_id: 'acct_cg', charges_enabled: true, payouts_enabled: true },
  ],
  parent_subscriptions: [{ stripe_customer_id: 'cus_parent' }],
});

describe('PUT /v1/bookings/{bookingId}/tip', () => {
  it('sets a first tip: zero-fee destination hold + authorized patch', async () => {
    const { db, captures } = makeDb(fixtures(completed()));
    const stripe = makeStripe();
    const res = await buildApp(makeDeps(db, stripe)).request(path, put(await parentToken(), { amountCents: 1000 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: BID,
      tip: { amountCents: 1000, status: 'authorized', settled: false },
      canTip: true, // still editable until the settle sweep captures it
      clientSecret: 'pi_tip_secret',
    });
    // 100% pass-through: the destination charge carries a ZERO application fee.
    expect(stripe.createBookingPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 1000,
        applicationFeeCents: 0,
        destinationAccountId: 'acct_cg',
        customerId: 'cus_parent',
        paymentMethodId: 'pm_saved',
        confirm: true,
        offSession: false,
        metadata: { purpose: 'tip', booking_id: BID },
      }),
    );
    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
    const update = captures.updates.find((u) => u.table === 'bookings');
    expect(update?.set).toMatchObject({
      tip_cents: 1000,
      tip_payment_intent_id: 'pi_tip_new',
      tip_status: 'authorized',
    });
    expect(update?.set.tip_settle_at).toBeInstanceOf(Date);
  });

  it('edits an existing tip: releases the old hold, places a new one', async () => {
    const { db } = makeDb(
      fixtures(completed({ tip_cents: 500, tip_payment_intent_id: 'pi_tip_old', tip_status: 'authorized' })),
    );
    const stripe = makeStripe();
    const res = await buildApp(makeDeps(db, stripe)).request(path, put(await parentToken(), { amountCents: 2000 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tip: { amountCents: 2000, status: 'authorized' } });
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_tip_old', 'tip:release:pi_tip_old');
    expect(stripe.createBookingPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 2000, applicationFeeCents: 0 }),
    );
  });

  it('clears the tip with amountCents 0: releases the hold, nulls the columns', async () => {
    const { db, captures } = makeDb(
      fixtures(completed({ tip_cents: 500, tip_payment_intent_id: 'pi_tip_old', tip_status: 'authorized' })),
    );
    const stripe = makeStripe();
    const res = await buildApp(makeDeps(db, stripe)).request(path, put(await parentToken(), { amountCents: 0 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tip: null, canTip: true, clientSecret: null });
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_tip_old', 'tip:release:pi_tip_old');
    expect(stripe.createBookingPaymentIntent).not.toHaveBeenCalled();
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({
      tip_cents: null,
      tip_payment_intent_id: null,
      tip_status: null,
      tip_settle_at: null,
    });
  });

  it('clearing when no tip exists is a no-op success (no Stripe calls)', async () => {
    const { db } = makeDb(fixtures(completed()));
    const stripe = makeStripe();
    const res = await buildApp(makeDeps(db, stripe)).request(path, put(await parentToken(), { amountCents: 0 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tip: null, canTip: true });
    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
    expect(stripe.createBookingPaymentIntent).not.toHaveBeenCalled();
  });

  it('surfaces a 3DS challenge: requires_action status + clientSecret', async () => {
    const { db } = makeDb(fixtures(completed()));
    const stripe = makeStripe({
      createBookingPaymentIntent: vi.fn(async () => ({
        id: 'pi_tip_3ds',
        client_secret: 'pi_tip_3ds_secret',
        status: 'requires_action',
      })),
    });
    const res = await buildApp(makeDeps(db, stripe)).request(path, put(await parentToken(), { amountCents: 1500 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      tip: { amountCents: 1500, status: 'requires_action', settled: false },
      clientSecret: 'pi_tip_3ds_secret',
    });
  });

  it('409 not_tippable on a Provider consultation (no on-platform money)', async () => {
    const { db } = makeDb(fixtures(completed({ kind: 'provider' })));
    const res = await buildApp(makeDeps(db, makeStripe())).request(path, put(await parentToken(), { amountCents: 1000 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_tippable' });
  });

  it('409 not_tippable before the Booking completes', async () => {
    const { db } = makeDb(fixtures(completed({ state: 'awaiting-confirmation' })));
    const res = await buildApp(makeDeps(db, makeStripe())).request(path, put(await parentToken(), { amountCents: 1000 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_tippable' });
  });

  it('409 tip_settled once the tip has captured — immutable (ADR-0018 §3)', async () => {
    const { db } = makeDb(
      fixtures(completed({ tip_cents: 500, tip_payment_intent_id: 'pi_tip_old', tip_status: 'captured' })),
    );
    const stripe = makeStripe();
    const res = await buildApp(makeDeps(db, stripe)).request(path, put(await parentToken(), { amountCents: 2000 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'tip_settled' });
    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
  });

  it('409 caregiver_payout_unavailable when the Connect account is not ready', async () => {
    const { db } = makeDb({ ...fixtures(completed()), provider_connect_accounts: [] });
    const res = await buildApp(makeDeps(db, makeStripe())).request(path, put(await parentToken(), { amountCents: 1000 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'caregiver_payout_unavailable' });
  });

  it('409 payment_method_required when the Parent has no saved card', async () => {
    const { db } = makeDb(fixtures(completed()));
    const stripe = makeStripe({ retrieveCustomerDefaultPaymentMethod: vi.fn(async () => null) });
    const res = await buildApp(makeDeps(db, stripe)).request(path, put(await parentToken(), { amountCents: 1000 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'payment_method_required' });
  });

  it('402 payment_failed on a decline; a prior tip is parked failed (sweep-inert)', async () => {
    const { db, captures } = makeDb(
      fixtures(completed({ tip_cents: 500, tip_payment_intent_id: 'pi_tip_old', tip_status: 'authorized' })),
    );
    const stripe = makeStripe({
      createBookingPaymentIntent: vi.fn(async () => {
        throw new Error('Your card was declined.');
      }),
    });
    const res = await buildApp(makeDeps(db, stripe)).request(path, put(await parentToken(), { amountCents: 2000 }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'payment_failed' });
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({
      tip_status: 'failed',
      tip_settle_at: null,
    });
  });

  it("404 when the Booking is not the caller's", async () => {
    const { db } = makeDb(fixtures(completed()));
    const res = await buildApp(makeDeps(db, makeStripe())).request(
      path,
      put(await parentToken('uid-other'), { amountCents: 1000 }),
    );
    expect(res.status).toBe(404);
  });

  it('403 for a non-parent caller', async () => {
    const { db } = makeDb(fixtures(completed()));
    const res = await buildApp(makeDeps(db, makeStripe())).request(path, put(await caregiverToken(), { amountCents: 1000 }));
    expect(res.status).toBe(403);
  });

  it('400 on a sub-minimum (< 50¢) or out-of-range amount', async () => {
    const { db } = makeDb(fixtures(completed()));
    const app = buildApp(makeDeps(db, makeStripe()));
    expect((await app.request(path, put(await parentToken(), { amountCents: 25 }))).status).toBe(400);
    expect((await app.request(path, put(await parentToken(), { amountCents: -100 }))).status).toBe(400);
    expect((await app.request(path, put(await parentToken(), { amountCents: 60_000 }))).status).toBe(400);
  });
});
