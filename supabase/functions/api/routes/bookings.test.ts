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
        // A guarded claim (`WHERE state='accepted'`) reads the affected-row count;
        // the fake treats every claim as won (1 row) — race-loss is not modelled.
        executeTakeFirst: async () => ({ numUpdatedRows: 1n }),
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
  return { env: buildTestEnv(), db, supabase: stub, stripe: stripe ?? makeStripe(), backgroundCheck: stub, daily: stub };
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
const del = (token: string): RequestInit => ({
  method: 'DELETE',
  headers: { authorization: `Bearer ${token}` },
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

// ── POST /v1/bookings/{bookingId}/report-no-show ───────────────────────────────
describe('POST /v1/bookings/{bookingId}/report-no-show', () => {
  const path = `/v1/bookings/${BID}/report-no-show`;

  // A no-show is reportable once the start has passed → use a slot 1h in the past.
  const started = (over: Record<string, unknown> = {}) => ({
    bookings: [caregiverBooking({ ...slotFromInstant(hoursFromNow(-1)), ...over })],
    provider_profiles: [{ provider_id: PID, display_name: 'Casey' }],
    providers: [{ id: PID, uid: 'uid-cg' }],
    supply_flags: [{ c: '1' }], // 1 active no-show flag after this one → standing 'ok'
  });

  it('caregiver no-show → cancelled + full refund (release hold) + supply flag + dispute row', async () => {
    const cancel = vi.fn(async () => ({ id: 'pi_1', status: 'canceled', amount: 0 }));
    const { db, captures } = makeDb(started());
    const app = buildApp(makeDeps(db, makeStripe({ cancelPaymentIntent: cancel })));
    const res = await app.request(path, post(await parentToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'cancelled', refunded: true, supplyStanding: 'ok' });
    expect(cancel).toHaveBeenCalled();
    // The claim flips state → cancelled + stamps no_show_at.
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({ state: 'cancelled' });
    expect(captures.inserts.find((i) => i.table === 'supply_flags')?.values).toMatchObject({
      provider_id: PID,
      kind: 'caregiver',
      reason: 'no-show',
    });
    expect(captures.inserts.find((i) => i.table === 'disputes')?.values).toMatchObject({
      subject_type: 'booking',
      reason: 'no-show',
    });
    expect(captures.inserts.find((i) => i.table === 'notification_outbox')?.values).toMatchObject({
      recipient_uid: 'uid-cg',
      event_type: 'booking_no_show',
    });
  });

  it('third active no-show flag → provider suspended (suspended_at set)', async () => {
    const { db, captures } = makeDb({ ...started(), supply_flags: [{ c: '3' }] });
    const app = buildApp(makeDeps(db));
    const res = await app.request(path, post(await parentToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ supplyStanding: 'suspended' });
    expect(captures.updates.find((u) => u.table === 'providers')?.set).toHaveProperty('suspended_at');
  });

  it('provider consultation no-show → flag only, no money', async () => {
    const cancel = vi.fn(async () => ({ id: 'pi_1', status: 'canceled', amount: 0 }));
    const { db, captures } = makeDb({ ...started({ kind: 'provider' }), supply_flags: [{ c: '1' }] });
    const app = buildApp(makeDeps(db, makeStripe({ cancelPaymentIntent: cancel })));
    const res = await app.request(path, post(await parentToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'cancelled', refunded: false });
    expect(cancel).not.toHaveBeenCalled();
    expect(captures.inserts.find((i) => i.table === 'supply_flags')?.values).toMatchObject({ kind: 'provider' });
  });

  it('409 before the scheduled start', async () => {
    const { db } = makeDb(fixtures(caregiverBooking(slotFromInstant(hoursFromNow(4)))));
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_reportable' });
  });

  it('409 from a non-accepted state', async () => {
    const { db } = makeDb(started({ state: 'in-progress' }));
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken()));
    expect(res.status).toBe(409);
  });

  it("404 when the Booking is not the caller's", async () => {
    const { db } = makeDb(started());
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken('uid-other')));
    expect(res.status).toBe(404);
  });
});

// ── Adjust booked time (OH-212) ────────────────────────────────────────────────
// A deterministic 3h window (10:00–13:00) so extend/shorten math is stable
// regardless of wall-clock (the base fixture derives start_min from `now`).
const adjustable = (over: Record<string, unknown> = {}) =>
  caregiverBooking({ start_min: 600, end_min: 780, per_child_surcharge_cents: 0, ...over });

/** Fixtures for the re-auth path: a payable caregiver + a Parent with a card. */
const payFixtures = (booking: Record<string, unknown>) => ({
  ...fixtures(booking),
  providers: [{ id: PID, uid: 'uid-cg' }],
  provider_connect_accounts: [
    { provider_id: PID, stripe_account_id: 'acct_1', charges_enabled: true, payouts_enabled: true },
  ],
  parent_subscriptions: [{ uid: 'uid-par', stripe_customer_id: 'cus_1' }],
});

const reauthStripe = (over: Record<string, unknown> = {}) =>
  makeStripe({
    retrieveCustomerDefaultPaymentMethod: vi.fn(async () => 'pm_1'),
    createBookingPaymentIntent: vi.fn(async () => ({ id: 'pi_2', status: 'requires_capture', client_secret: 'cs_2', amount: 0 })),
    ...over,
  });

describe('POST /v1/bookings/{bookingId}/extend', () => {
  const path = `/v1/bookings/${BID}/extend`;

  it('re-authorizes the larger total (cancels old hold, creates new) + returns clientSecret', async () => {
    const cancel = vi.fn(async () => ({ id: 'pi_1', status: 'canceled', amount: 0 }));
    const create = vi.fn(async () => ({ id: 'pi_2', status: 'requires_action', client_secret: 'cs_2', amount: 0 }));
    const { db, captures } = makeDb(payFixtures(adjustable()));
    const app = buildApp(makeDeps(db, reauthStripe({ cancelPaymentIntent: cancel, createBookingPaymentIntent: create })));
    const res = await app.request(path, post(await parentToken(), { newDurationHours: 5 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      state: 'accepted',
      endMin: 900,
      durationHours: 5,
      computedTotalCents: 25000,
      authorizedAmountCents: 25000,
      paymentStatus: 'requires_action',
      paymentIntentId: 'pi_2',
      clientSecret: 'cs_2',
    });
    expect(cancel).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 25000, applicationFeeCents: 3750 }),
    );
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({
      end_min: 900,
      computed_total_cents: 25000,
      payment_intent_id: 'pi_2',
    });
  });

  it('scheduled Booking (no hold yet): raises the amount, no Stripe call', async () => {
    const create = vi.fn(async () => ({ id: 'pi_x', status: 'requires_capture', client_secret: null, amount: 0 }));
    const { db, captures } = makeDb(payFixtures(adjustable({ payment_status: 'scheduled', payment_intent_id: null })));
    const app = buildApp(makeDeps(db, reauthStripe({ createBookingPaymentIntent: create })));
    const res = await app.request(path, post(await parentToken(), { newDurationHours: 4 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      endMin: 840,
      durationHours: 4,
      authorizedAmountCents: 20000,
      paymentStatus: 'scheduled',
      paymentIntentId: null,
      clientSecret: null,
    });
    expect(create).not.toHaveBeenCalled();
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({
      end_min: 840,
      authorized_amount_cents: 20000,
    });
  });

  it('409 when the new duration does not add time', async () => {
    const { db } = makeDb(payFixtures(adjustable()));
    const res = await buildApp(makeDeps(db, reauthStripe())).request(path, post(await parentToken(), { newDurationHours: 2 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_extendable' });
  });

  it('409 from a non-accepted state', async () => {
    const { db } = makeDb(payFixtures(adjustable({ state: 'in-progress' })));
    const res = await buildApp(makeDeps(db, reauthStripe())).request(path, post(await parentToken(), { newDurationHours: 5 }));
    expect(res.status).toBe(409);
  });

  it('409 when a shorten is already pending', async () => {
    const { db } = makeDb(
      payFixtures(adjustable({ pending_time_change_hours: 2, pending_time_change_requested_at: new Date() })),
    );
    const res = await buildApp(makeDeps(db, reauthStripe())).request(path, post(await parentToken(), { newDurationHours: 5 }));
    expect(res.status).toBe(409);
  });

  it('400 when the target is not a half-hour increment', async () => {
    const { db } = makeDb(payFixtures(adjustable()));
    const res = await buildApp(makeDeps(db, reauthStripe())).request(path, post(await parentToken(), { newDurationHours: 5.25 }));
    expect(res.status).toBe(400);
  });

  it('409 for a provider consultation (no adjust-time)', async () => {
    const { db } = makeDb(payFixtures(adjustable({ kind: 'provider' })));
    const res = await buildApp(makeDeps(db, reauthStripe())).request(path, post(await parentToken(), { newDurationHours: 5 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_adjustable' });
  });
});

describe('POST /v1/bookings/{bookingId}/reduce-request', () => {
  const path = `/v1/bookings/${BID}/reduce-request`;

  it('writes a pending shorten (no duration change) + notifies the caregiver', async () => {
    const { db, captures } = makeDb(payFixtures(adjustable()));
    const res = await buildApp(makeDeps(db)).request(
      path,
      post(await parentToken(), { newDurationHours: 2, note: 'wrap up early' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      state: 'accepted',
      pendingTimeChange: { proposedDurationHours: 2, proposedEndMin: 720, note: 'wrap up early' },
    });
    const set = captures.updates.find((u) => u.table === 'bookings')?.set as Record<string, unknown>;
    expect(set).toMatchObject({ pending_time_change_hours: 2, pending_time_change_note: 'wrap up early' });
    expect(set.pending_time_change_requested_at).toBeInstanceOf(Date);
    expect(set).not.toHaveProperty('end_min'); // original duration is untouched
    expect(captures.inserts.find((i) => i.table === 'notification_outbox')?.values).toMatchObject({
      recipient_uid: 'uid-cg',
      event_type: 'booking_time_reduce_requested',
    });
  });

  it('409 when the new duration does not shorten', async () => {
    const { db } = makeDb(payFixtures(adjustable()));
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken(), { newDurationHours: 3 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_reducible' });
  });

  it('409 when a shorten is already pending', async () => {
    const { db } = makeDb(
      payFixtures(adjustable({ pending_time_change_hours: 2, pending_time_change_requested_at: new Date() })),
    );
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken(), { newDurationHours: 1.5 }));
    expect(res.status).toBe(409);
  });
});

describe('DELETE /v1/bookings/{bookingId}/reduce-request', () => {
  const path = `/v1/bookings/${BID}/reduce-request`;

  it('rescinds a pending shorten → clears the proposal', async () => {
    const { db, captures } = makeDb(
      payFixtures(adjustable({ pending_time_change_hours: 2, pending_time_change_requested_at: new Date() })),
    );
    const res = await buildApp(makeDeps(db)).request(path, del(await parentToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'accepted', pendingTimeChange: null });
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({
      pending_time_change_hours: null,
      pending_time_change_requested_at: null,
    });
    expect(captures.inserts.find((i) => i.table === 'notification_outbox')?.values).toMatchObject({
      event_type: 'booking_time_reduce_rescinded',
    });
  });

  it('409 when there is no pending shorten', async () => {
    const { db } = makeDb(payFixtures(adjustable()));
    const res = await buildApp(makeDeps(db)).request(path, del(await parentToken()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'no_pending_change' });
  });

  it("404 when the Booking is not the caller's", async () => {
    const { db } = makeDb(payFixtures(adjustable({ pending_time_change_hours: 2, pending_time_change_requested_at: new Date() })));
    const res = await buildApp(makeDeps(db)).request(path, del(await parentToken('uid-other')));
    expect(res.status).toBe(404);
  });
});
