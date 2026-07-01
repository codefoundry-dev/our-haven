import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Table-routed Kysely fake for the Parent booking routes (OH-211): selects resolve
 * to a table's canned rows, inserts/updates are captured, and the transaction runs
 * the callback against the same handle. Modelled on applications.test's fake.
 */
function makeDb(tables: Record<string, Record<string, unknown>[]> = {}) {
  const captures = {
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  };
  const selectChain = (rows: Record<string, unknown>[]) => {
    const c: Record<string, unknown> = {
      select: () => c,
      where: () => c,
      orderBy: () => c,
      limit: () => c,
      execute: async () => rows,
      executeTakeFirst: async () => rows[0] ?? undefined,
    };
    return c;
  };
  const handle: Record<string, unknown> = {
    selectFrom: (t: string) => selectChain(tables[t] ?? []),
    updateTable: (t: string) => {
      const c: Record<string, unknown> = {
        set: (s: Record<string, unknown>) => {
          captures.updates.push({ table: t, set: s });
          return c;
        },
        where: () => c,
        execute: async () => [],
      };
      return c;
    },
    insertInto: (t: string) => {
      const c: Record<string, unknown> = {
        values: (v: Record<string, unknown>) => {
          captures.inserts.push({ table: t, values: v });
          return c;
        },
        onConflict: () => c,
        execute: async () => [],
      };
      return c;
    },
  };
  const db = {
    ...handle,
    transaction: () => ({ execute: async (cb: (trx: typeof handle) => Promise<unknown>) => cb(handle) }),
  } as unknown as AppDeps['db'];
  return { db, captures };
}

function makeStripe(over: Record<string, unknown> = {}): AppDeps['stripe'] {
  return {
    capturePaymentIntent: vi.fn(async () => ({ id: 'pi_1', status: 'succeeded', amount: 0 })),
    cancelPaymentIntent: vi.fn(async () => ({ id: 'pi_1', status: 'canceled', amount: 0 })),
    ...over,
  } as unknown as AppDeps['stripe'];
}

function makeDeps(db: AppDeps['db'], stripe?: AppDeps['stripe']): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return { env: buildTestEnv(), db, supabase: stub, stripe: stripe ?? makeStripe(), backgroundCheck: stub };
}

const parentToken = (uid = 'uid-par') =>
  mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'parent' } });
const caregiverToken = () =>
  mintAccessToken({ sub: 'uid-cg', appMetadata: { role: 'caregiver', categories: ['babysitter'] } });

const BID = '33333333-3333-4333-8333-333333333333';
const PID = '55555555-5555-4555-8555-555555555555';

/** Build a scheduled_date + start_min whose UTC instant is `at`. */
function slotFromInstant(at: Date): { scheduled_date: string; start_min: number } {
  return { scheduled_date: at.toISOString().slice(0, 10), start_min: at.getUTCHours() * 60 + at.getUTCMinutes() };
}
const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000);

const caregiverBooking = (over: Record<string, unknown> = {}) => ({
  id: BID,
  kind: 'caregiver',
  state: 'accepted',
  parent_uid: 'uid-par',
  provider_id: PID,
  origin: 'posted-job',
  category: 'babysitter',
  ...slotFromInstant(hoursFromNow(48)),
  end_min: 1260,
  child_count: 1,
  child_ages: [4],
  service_address_line1: '12 Oak St',
  service_address_line2: null,
  service_city: 'Austin',
  service_state: 'TX',
  service_postal_code: '78701',
  agreed_rate_cents: 5000,
  computed_total_cents: 15000,
  authorized_amount_cents: 15000,
  captured_amount_cents: null,
  proposed_amount_cents: null,
  commission_bp: 1500,
  commission_cents: 2250,
  payment_intent_id: 'pi_1',
  payment_status: 'authorized',
  confirm_deadline_at: null,
  request_expires_at: null,
  cancellation_tier: null,
  dispute_reason: null,
  ...over,
});

const fixtures = (booking: Record<string, unknown>) => ({
  bookings: [booking],
  provider_profiles: [{ provider_id: PID, display_name: 'Casey' }],
});

const getReq = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });
const post = (token: string, body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// ── GET /v1/bookings/{bookingId} ───────────────────────────────────────────────
describe('GET /v1/bookings/{bookingId}', () => {
  const path = `/v1/bookings/${BID}`;

  it('200 returns the detail with payment fields; address revealed at accepted', async () => {
    const app = buildApp(makeDeps(makeDb(fixtures(caregiverBooking())).db));
    const res = await app.request(path, getReq(await parentToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body).toMatchObject({
      id: BID,
      state: 'accepted',
      counterpartyName: 'Casey',
      paymentStatus: 'authorized',
      paymentIntentId: 'pi_1',
      authorizedAmountCents: 15000,
      commissionCents: 2250,
    });
    expect(body.serviceAddress).toMatchObject({ line1: '12 Oak St', city: 'Austin' });
  });

  it('hides the service address before acceptance (requested)', async () => {
    const app = buildApp(makeDeps(makeDb(fixtures(caregiverBooking({ state: 'requested' }))).db));
    const res = await app.request(path, getReq(await parentToken()));
    const body = (await res.json()) as Record<string, any>;
    expect(body.serviceAddress).toBeNull();
  });

  it("404 when the Booking is not the caller's", async () => {
    const app = buildApp(makeDeps(makeDb(fixtures(caregiverBooking())).db));
    expect((await app.request(path, getReq(await parentToken('uid-other')))).status).toBe(404);
  });

  it('403 for a caregiver', async () => {
    const app = buildApp(makeDeps(makeDb(fixtures(caregiverBooking())).db));
    expect((await app.request(path, getReq(await caregiverToken()))).status).toBe(403);
  });
});

// ── GET /v1/bookings/{bookingId}/cancel-preview ────────────────────────────────
describe('GET /v1/bookings/{bookingId}/cancel-preview', () => {
  const path = `/v1/bookings/${BID}/cancel-preview`;

  it('free tier ≥24h before start', async () => {
    const app = buildApp(makeDeps(makeDb(fixtures(caregiverBooking(slotFromInstant(hoursFromNow(48))))).db));
    const res = await app.request(path, getReq(await parentToken()));
    expect(await res.json()).toMatchObject({ tier: 'free', chargeCents: 0, refundCents: 15000 });
  });

  it('half tier inside 24h', async () => {
    const app = buildApp(makeDeps(makeDb(fixtures(caregiverBooking(slotFromInstant(hoursFromNow(3))))).db));
    const res = await app.request(path, getReq(await parentToken()));
    expect(await res.json()).toMatchObject({ tier: 'half', chargeCents: 7500, refundCents: 7500 });
  });

  it('full tier inside 2h', async () => {
    const app = buildApp(makeDeps(makeDb(fixtures(caregiverBooking(slotFromInstant(hoursFromNow(1))))).db));
    const res = await app.request(path, getReq(await parentToken()));
    expect(await res.json()).toMatchObject({ tier: 'full', chargeCents: 15000, refundCents: 0 });
  });
});

// ── POST /v1/bookings/{bookingId}/cancel (caregiver — via consultation-bookings) ─
describe('POST /v1/bookings/{bookingId}/cancel (caregiver)', () => {
  const path = `/v1/bookings/${BID}/cancel`;

  it('free tier ≥24h: releases the hold, no capture', async () => {
    const cancel = vi.fn(async () => ({ id: 'pi_1', status: 'canceled', amount: 0 }));
    const capture = vi.fn(async () => ({ id: 'pi_1', status: 'succeeded', amount: 0 }));
    const { db, captures } = makeDb(fixtures(caregiverBooking(slotFromInstant(hoursFromNow(48)))));
    const app = buildApp(makeDeps(db, makeStripe({ cancelPaymentIntent: cancel, capturePaymentIntent: capture })));
    const res = await app.request(path, post(await parentToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'cancelled', tier: 'free', chargeCents: 0 });
    expect(cancel).toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({
      state: 'cancelled',
      payment_status: 'canceled',
    });
  });

  it('half tier inside 24h: partial-captures the charge', async () => {
    const capture = vi.fn(async () => ({ id: 'pi_1', status: 'succeeded', amount: 0 }));
    const { db } = makeDb(fixtures(caregiverBooking(slotFromInstant(hoursFromNow(3)))));
    const app = buildApp(makeDeps(db, makeStripe({ capturePaymentIntent: capture })));
    const res = await app.request(path, post(await parentToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'cancelled', tier: 'half', chargeCents: 7500 });
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ amountToCaptureCents: 7500, applicationFeeCents: 1125 }),
    );
  });
});

// ── POST /v1/bookings/{bookingId}/confirm-hours ────────────────────────────────
describe('POST /v1/bookings/{bookingId}/confirm-hours', () => {
  const path = `/v1/bookings/${BID}/confirm-hours`;

  it('captures + completes from the review window', async () => {
    const capture = vi.fn(async () => ({ id: 'pi_1', status: 'succeeded', amount: 0 }));
    const { db, captures } = makeDb(fixtures(caregiverBooking({ state: 'awaiting-confirmation' })));
    const app = buildApp(makeDeps(db, makeStripe({ capturePaymentIntent: capture })));
    const res = await app.request(path, post(await parentToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'completed', capturedAmountCents: 15000 });
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ amountToCaptureCents: 15000, applicationFeeCents: 2250 }),
    );
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({
      state: 'completed',
      payment_status: 'captured',
    });
  });

  it('409 when not in the review window (accepted)', async () => {
    const { db } = makeDb(fixtures(caregiverBooking({ state: 'accepted' })));
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_confirmable' });
  });
});

// ── POST /v1/bookings/{bookingId}/dispute ──────────────────────────────────────
describe('POST /v1/bookings/{bookingId}/dispute', () => {
  const path = `/v1/bookings/${BID}/dispute`;

  it('in-window dispute → disputed + holds payout + flags admin', async () => {
    const { db, captures } = makeDb(fixtures(caregiverBooking({ state: 'awaiting-confirmation' })));
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken(), { reason: 'overcharged' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'disputed', escalation: false });
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({
      state: 'disputed',
      dispute_reason: 'overcharged',
    });
    expect(captures.inserts.find((i) => i.table === 'notification_outbox')?.values).toMatchObject({
      event_type: 'booking_disputed',
    });
  });

  it('out-of-window dispute on a completed Booking → admin escalation, no state change', async () => {
    const { db, captures } = makeDb(fixtures(caregiverBooking({ state: 'completed' })));
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken(), { reason: 'quality', details: 'x' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'completed', escalation: true });
    const set = captures.updates.find((u) => u.table === 'bookings')?.set;
    expect(set).toMatchObject({ dispute_reason: 'quality' });
    expect(set).not.toHaveProperty('state');
  });

  it('409 when the Booking cannot be disputed (requested)', async () => {
    const { db } = makeDb(fixtures(caregiverBooking({ state: 'requested' })));
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken(), { reason: 'other' }));
    expect(res.status).toBe(409);
  });
});
