import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Table-routed Kysely fake for the Caregiver booking routes (OH-220). Selects
 * resolve to a table's canned rows (the `where` is ignored — fixtures are shaped
 * so the first row is the intended one), inserts/updates are captured, and the
 * transaction runs the callback against the same handle. Mirrors bookings.test's
 * fake (the Parent side).
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
    refundPaymentIntent: vi.fn(async () => ({ id: 'pi_1', status: 'canceled', amount: 0 })),
    ...over,
  } as unknown as AppDeps['stripe'];
}

function makeDeps(db: AppDeps['db'], stripe?: AppDeps['stripe']): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return { env: buildTestEnv(), db, supabase: stub, stripe: stripe ?? makeStripe(), backgroundCheck: stub, daily: stub };
}

const caregiverToken = (uid = 'uid-cg') =>
  mintAccessToken({ sub: uid, appMetadata: { role: 'caregiver', categories: ['babysitter'] } });
const parentToken = (uid = 'uid-par') =>
  mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'parent' } });

const BID = '33333333-3333-4333-8333-333333333333';
const PID = '55555555-5555-4555-8555-555555555555';

/** A caregiver Booking row with every column the route reads (all defaults sane). */
const booking = (over: Record<string, unknown> = {}) => ({
  id: BID,
  kind: 'caregiver',
  state: 'accepted',
  parent_uid: 'uid-par',
  provider_id: PID,
  origin: 'posted-job',
  job_id: 'job-1',
  offer_id: 'off-1',
  series_id: null,
  category: 'babysitter',
  scheduled_date: '2026-07-20',
  start_min: 600,
  end_min: 780,
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
  commission_bp: 1500,
  payment_intent_id: 'pi_1',
  payment_status: 'authorized',
  proposed_hours: null,
  proposed_amount_cents: null,
  request_expires_at: null,
  confirm_deadline_at: null,
  pending_time_change_hours: null,
  pending_time_change_note: null,
  pending_time_change_requested_at: null,
  ...over,
});

const fixtures = (b: Record<string, unknown>) => ({
  providers: [{ id: PID, uid: 'uid-cg', role: 'caregiver' }],
  bookings: [b],
  profiles: [{ id: 'uid-par', first_name: 'Pat', last_name: 'Lee' }],
});

const getReq = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });
const post = (token: string, body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// ── GET /v1/caregiver/bookings ────────────────────────────────────────────────
describe('GET /v1/caregiver/bookings', () => {
  const path = '/v1/caregiver/bookings';

  it('200 returns the feed with the parent name + revealed address', async () => {
    const app = buildApp(makeDeps(makeDb(fixtures(booking())).db));
    const res = await app.request(path, getReq(await caregiverToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.bookings).toHaveLength(1);
    expect(body.bookings[0]).toMatchObject({
      id: BID,
      state: 'accepted',
      parentName: 'Pat Lee',
      offerId: 'off-1',
      pendingTimeChange: null,
    });
    expect(body.bookings[0].serviceAddress).toMatchObject({ line1: '12 Oak St', city: 'Austin' });
  });

  it('surfaces a live pending shorten request', async () => {
    const b = booking({
      pending_time_change_hours: 2,
      pending_time_change_note: 'running short',
      pending_time_change_requested_at: '2026-07-19T12:00:00.000Z',
    });
    const app = buildApp(makeDeps(makeDb(fixtures(b)).db));
    const res = await app.request(path, getReq(await caregiverToken()));
    const body = (await res.json()) as Record<string, any>;
    expect(body.bookings[0].pendingTimeChange).toMatchObject({
      proposedDurationHours: 2,
      proposedEndMin: 720,
      note: 'running short',
    });
  });

  it('surfaces a live tip as the additive payout line; hides failed/3DS-pending ones (OH-215)', async () => {
    const live = buildApp(
      makeDeps(makeDb(fixtures(booking({ state: 'completed', tip_cents: 1000, tip_status: 'authorized' }))).db),
    );
    const liveBody = (await (await live.request(path, getReq(await caregiverToken()))).json()) as Record<string, any>;
    expect(liveBody.bookings[0]).toMatchObject({ tipCents: 1000, tipSettled: false });

    const settled = buildApp(
      makeDeps(makeDb(fixtures(booking({ state: 'completed', tip_cents: 1000, tip_status: 'captured' }))).db),
    );
    const settledBody = (await (await settled.request(path, getReq(await caregiverToken()))).json()) as Record<string, any>;
    expect(settledBody.bookings[0]).toMatchObject({ tipCents: 1000, tipSettled: true });

    const pending = buildApp(
      makeDeps(makeDb(fixtures(booking({ state: 'completed', tip_cents: 1000, tip_status: 'requires_action' }))).db),
    );
    const pendingBody = (await (await pending.request(path, getReq(await caregiverToken()))).json()) as Record<string, any>;
    expect(pendingBody.bookings[0]).toMatchObject({ tipCents: null, tipSettled: false });
  });

  it('403 for a parent', async () => {
    const app = buildApp(makeDeps(makeDb(fixtures(booking())).db));
    expect((await app.request(path, getReq(await parentToken()))).status).toBe(403);
  });
});

// ── accept / decline (posted-Job award) ───────────────────────────────────────
describe('POST /v1/caregiver/bookings/{id}/accept', () => {
  const path = `/v1/caregiver/bookings/${BID}/accept`;

  it('requested → accepted + stamps accepted_at + notifies the parent', async () => {
    const { db, captures } = makeDb(fixtures(booking({ state: 'requested' })));
    const res = await buildApp(makeDeps(db)).request(path, post(await caregiverToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: BID, state: 'accepted' });
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({ state: 'accepted' });
    expect(captures.inserts.find((i) => i.table === 'notification_outbox')?.values).toMatchObject({
      event_type: 'booking_accepted',
    });
  });

  it('409 when not requested (already accepted)', async () => {
    const { db } = makeDb(fixtures(booking({ state: 'accepted' })));
    const res = await buildApp(makeDeps(db)).request(path, post(await caregiverToken()));
    expect(res.status).toBe(409);
  });

  it("404 when the Booking is not the caller's", async () => {
    const { db } = makeDb(fixtures(booking({ state: 'requested', provider_id: 'someone-else' })));
    const res = await buildApp(makeDeps(db)).request(path, post(await caregiverToken()));
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/caregiver/bookings/{id}/decline', () => {
  const path = `/v1/caregiver/bookings/${BID}/decline`;

  it('requested → declined + releases the hold', async () => {
    const cancel = vi.fn(async () => ({ id: 'pi_1', status: 'canceled', amount: 0 }));
    const { db, captures } = makeDb(fixtures(booking({ state: 'requested' })));
    const res = await buildApp(makeDeps(db, makeStripe({ cancelPaymentIntent: cancel }))).request(
      path,
      post(await caregiverToken()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'declined' });
    expect(cancel).toHaveBeenCalled();
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({
      state: 'declined',
      payment_status: 'canceled',
    });
  });
});

// ── session spine: start → propose-hours ──────────────────────────────────────
describe('POST /v1/caregiver/bookings/{id}/start', () => {
  const path = `/v1/caregiver/bookings/${BID}/start`;

  it('accepted → in-progress', async () => {
    const { db, captures } = makeDb(fixtures(booking({ state: 'accepted' })));
    const res = await buildApp(makeDeps(db)).request(path, post(await caregiverToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'in-progress' });
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({ state: 'in-progress' });
  });

  it('409 from requested', async () => {
    const { db } = makeDb(fixtures(booking({ state: 'requested' })));
    expect((await buildApp(makeDeps(db)).request(path, post(await caregiverToken()))).status).toBe(409);
  });
});

describe('POST /v1/caregiver/bookings/{id}/propose-hours', () => {
  const path = `/v1/caregiver/bookings/${BID}/propose-hours`;

  it('in-progress → awaiting-confirmation, scales + caps the proposed amount, arms the window', async () => {
    // Booked 3h @ $150 total; propose 2h → 2/3 × 15000 = 10000 (≤ authorized 15000).
    const { db, captures } = makeDb(fixtures(booking({ state: 'in-progress' })));
    const res = await buildApp(makeDeps(db)).request(path, post(await caregiverToken(), { hours: 2 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      state: 'awaiting-confirmation',
      proposedHours: 2,
      proposedAmountCents: 10000,
    });
    const set = captures.updates.find((u) => u.table === 'bookings')?.set as Record<string, unknown>;
    expect(set).toMatchObject({ state: 'awaiting-confirmation', proposed_hours: 2, proposed_amount_cents: 10000 });
    expect(set.confirm_deadline_at).toBeInstanceOf(Date);
  });

  it('409 when not in-progress', async () => {
    const { db } = makeDb(fixtures(booking({ state: 'accepted' })));
    const res = await buildApp(makeDeps(db)).request(path, post(await caregiverToken(), { hours: 2 }));
    expect(res.status).toBe(409);
  });
});

// ── time-change approve / decline ─────────────────────────────────────────────
describe('POST /v1/caregiver/bookings/{id}/time-change/{approve,decline}', () => {
  const withPending = () =>
    booking({
      state: 'accepted',
      pending_time_change_hours: 2,
      pending_time_change_requested_at: '2026-07-19T12:00:00.000Z',
    });

  it('approve applies the shorter window + re-derives the estimate, clears the proposal', async () => {
    const { db, captures } = makeDb(fixtures(withPending()));
    const res = await buildApp(makeDeps(db)).request(
      `/v1/caregiver/bookings/${BID}/time-change/approve`,
      post(await caregiverToken()),
    );
    expect(res.status).toBe(200);
    const set = captures.updates.find((u) => u.table === 'bookings')?.set as Record<string, unknown>;
    // 3h → 2h; total 15000 × 2/3 = 10000; endMin → 720; pending cleared.
    expect(set).toMatchObject({
      end_min: 720,
      computed_total_cents: 10000,
      pending_time_change_requested_at: null,
      pending_time_change_hours: null,
    });
  });

  it('decline drops the proposal, keeps the original window', async () => {
    const { db, captures } = makeDb(fixtures(withPending()));
    const res = await buildApp(makeDeps(db)).request(
      `/v1/caregiver/bookings/${BID}/time-change/decline`,
      post(await caregiverToken()),
    );
    expect(res.status).toBe(200);
    const set = captures.updates.find((u) => u.table === 'bookings')?.set as Record<string, unknown>;
    expect(set).toMatchObject({ pending_time_change_requested_at: null });
    expect(set).not.toHaveProperty('end_min');
  });

  it('409 when there is no pending change', async () => {
    const { db } = makeDb(fixtures(booking({ state: 'accepted' })));
    const res = await buildApp(makeDeps(db)).request(
      `/v1/caregiver/bookings/${BID}/time-change/approve`,
      post(await caregiverToken()),
    );
    expect(res.status).toBe(409);
  });
});
