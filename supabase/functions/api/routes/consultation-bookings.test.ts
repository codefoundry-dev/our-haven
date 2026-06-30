import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Table-routed Kysely fake for the consultation-booking routes (OH-203). Selects
 * resolve to a table's canned rows (the route re-applies no filtering in TS, so a
 * single-row fixture per table is enough); inserts/updates are captured; the
 * conditional slot-hold + cancel writes run inside the faked `transaction()`.
 * `holdFails` simulates a slot taken concurrently (the conditional UPDATE returns
 * no row).
 */
function makeDb(
  tables: Record<string, Record<string, unknown>[]> = {},
  opts: { holdFails?: boolean; insertedBookingId?: string } = {},
) {
  const captures = {
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  };
  const selectChain = (rows: Record<string, unknown>[]) => {
    const c: Record<string, unknown> = {
      select: () => c,
      selectAll: () => c,
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
    insertInto: (t: string) => {
      const c: Record<string, unknown> = {
        values: (v: Record<string, unknown>) => {
          captures.inserts.push({ table: t, values: v });
          return c;
        },
        returning: () => c,
        executeTakeFirstOrThrow: async () => ({ id: opts.insertedBookingId ?? 'booking-1' }),
      };
      return c;
    },
    updateTable: (t: string) => {
      const c: Record<string, unknown> = {
        set: (s: Record<string, unknown>) => {
          captures.updates.push({ table: t, set: s });
          return c;
        },
        where: () => c,
        returning: () => c,
        // The slot-hold's conditional UPDATE … RETURNING: undefined ⇒ taken.
        executeTakeFirst: async () => (t === 'provider_slots' && opts.holdFails ? undefined : { id: 'x' }),
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

function makeDeps(db: AppDeps['db']): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return { env: buildTestEnv(), db, supabase: stub, stripe: stub, backgroundCheck: stub };
}

const parentToken = (uid = 'uid-par') =>
  mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'parent' } });
const providerToken = (uid = 'uid-prov') =>
  mintAccessToken({ sub: uid, appMetadata: { role: 'provider', specialty: 'slp', state: 'CA' } });
const caregiverToken = () =>
  mintAccessToken({ sub: 'uid-cg', appMetadata: { role: 'caregiver', categories: ['tutor'] } });

// ── fixtures ─────────────────────────────────────────────────────────────────
const PID = '11111111-1111-4111-8111-111111111111';
const SID = '22222222-2222-4222-8222-222222222222';
const BID = '33333333-3333-4333-8333-333333333333';
const BOOK_PATH = `/v1/supply/${PID}/consultation-bookings`;

const providerRow = (over: Record<string, unknown> = {}) => ({
  id: PID,
  uid: 'uid-prov',
  role: 'provider',
  specialty: 'slp',
  ...over,
});
const listableVer = (over: Record<string, unknown> = {}) => ({
  provider_id: PID,
  phone_confirmed_at: '2026-06-01T00:00:00.000Z',
  screening_passed_at: '2026-06-01T00:00:00.000Z',
  license_verified_at: '2026-06-01T00:00:00.000Z',
  insurance_verified_at: '2026-06-01T00:00:00.000Z',
  rejected_at: null,
  ...over,
});
const openSlot = (over: Record<string, unknown> = {}) => ({
  id: SID,
  provider_id: PID,
  slot_date: '2026-07-10',
  start_min: 540,
  end_min: 600,
  state: 'open',
  held_by_booking_id: null,
  ...over,
});

/** A fully bookable Provider: listed + a parent with an active Subscription. */
const bookable = (over: Record<string, Record<string, unknown>[]> = {}) => ({
  providers: [providerRow()],
  provider_profiles: [{ provider_id: PID, display_name: 'Dr. Maya Okafor', published_rate_cents: 12000 }],
  provider_verifications: [listableVer()],
  provider_subscriptions: [{ provider_id: PID, status: 'active' }],
  parent_subscriptions: [{ status: 'active' }],
  provider_slots: [openSlot()],
  ...over,
});

const post = (token: string, body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const getReq = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });

// ── POST /v1/supply/{id}/consultation-bookings ───────────────────────────────
describe('POST /v1/supply/{id}/consultation-bookings', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps(makeDb(bookable()).db));
    expect((await app.request(BOOK_PATH, { method: 'POST' })).status).toBe(401);
  });

  it('403 for a Provider (parent-only)', async () => {
    const app = buildApp(makeDeps(makeDb(bookable()).db));
    expect((await app.request(BOOK_PATH, post(await providerToken(), { slotId: SID }))).status).toBe(403);
  });

  it('404 when the provider is unknown', async () => {
    const app = buildApp(makeDeps(makeDb({ providers: [] }).db));
    expect((await app.request(BOOK_PATH, post(await parentToken(), { slotId: SID }))).status).toBe(404);
  });

  it('404 when the provider is not listable (no active listing subscription)', async () => {
    const app = buildApp(makeDeps(makeDb(bookable({ provider_subscriptions: [] })).db));
    expect((await app.request(BOOK_PATH, post(await parentToken(), { slotId: SID }))).status).toBe(404);
  });

  it('402 when the Parent has no active Subscription', async () => {
    const app = buildApp(makeDeps(makeDb(bookable({ parent_subscriptions: [] })).db));
    const res = await app.request(BOOK_PATH, post(await parentToken(), { slotId: SID }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'subscription_required' });
  });

  it('404 when the slot does not belong to the provider', async () => {
    const app = buildApp(makeDeps(makeDb(bookable({ provider_slots: [] })).db));
    expect((await app.request(BOOK_PATH, post(await parentToken(), { slotId: SID }))).status).toBe(404);
  });

  it('409 when the slot is no longer open', async () => {
    const app = buildApp(makeDeps(makeDb(bookable({ provider_slots: [openSlot({ state: 'held', held_by_booking_id: 'b0' })] })).db));
    const res = await app.request(BOOK_PATH, post(await parentToken(), { slotId: SID }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'slot_unavailable' });
  });

  it('201 creates an accepted, null-payment booking and holds the slot', async () => {
    const { db, captures } = makeDb(bookable(), { insertedBookingId: BID });
    const app = buildApp(makeDeps(db));
    const res = await app.request(BOOK_PATH, post(await parentToken(), { slotId: SID }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { autoCompleteAt: string };
    expect(body).toMatchObject({
      id: BID,
      kind: 'provider',
      state: 'accepted',
      viewerRole: 'parent',
      counterpartyName: 'Dr. Maya Okafor',
      counterpartySpecialty: 'slp',
      scheduledDate: '2026-07-10',
      startMin: 540,
      endMin: 600,
      rateCents: 12000,
    });
    // auto-complete deadline = slot end (10:00 UTC) of the slot day.
    expect(body.autoCompleteAt).toBe('2026-07-10T10:00:00.000Z');

    // The Booking is born accepted with the parent + slot wired and NO payment id.
    const booking = captures.inserts.find((i) => i.table === 'bookings');
    expect(booking?.values).toMatchObject({ kind: 'provider', state: 'accepted', parent_uid: 'uid-par', slot_id: SID });
    expect(booking?.values).not.toHaveProperty('payment_intent_id');
    // The slot was held by the new booking.
    const hold = captures.updates.find((u) => u.table === 'provider_slots');
    expect(hold?.set).toMatchObject({ state: 'held', held_by_booking_id: BID });
  });

  it('409 when the slot is taken concurrently (the conditional hold finds no open row)', async () => {
    const app = buildApp(makeDeps(makeDb(bookable(), { holdFails: true }).db));
    const res = await app.request(BOOK_PATH, post(await parentToken(), { slotId: SID }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'slot_unavailable' });
  });
});

// ── GET /v1/bookings ─────────────────────────────────────────────────────────
const bookingRow = (over: Record<string, unknown> = {}) => ({
  id: BID,
  kind: 'provider',
  state: 'accepted',
  parent_uid: 'uid-par',
  provider_id: PID,
  slot_id: SID,
  scheduled_date: '2026-07-10',
  start_min: 540,
  end_min: 600,
  rate_cents: 12000,
  auto_complete_at: '2026-07-10T10:00:00.000Z',
  ...over,
});

describe('GET /v1/bookings', () => {
  it('returns the Parent schedule with the Provider as counterparty', async () => {
    const app = buildApp(
      makeDeps(
        makeDb({
          bookings: [bookingRow()],
          providers: [providerRow()],
          provider_profiles: [{ provider_id: PID, display_name: 'Dr. Maya Okafor' }],
        }).db,
      ),
    );
    const res = await app.request('/v1/bookings', getReq(await parentToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bookings: Record<string, unknown>[] };
    expect(body.bookings).toHaveLength(1);
    expect(body.bookings[0]).toMatchObject({
      id: BID,
      viewerRole: 'parent',
      counterpartyName: 'Dr. Maya Okafor',
      counterpartySpecialty: 'slp',
      state: 'accepted',
    });
  });

  it('returns the Provider schedule with the Parent as counterparty', async () => {
    const app = buildApp(
      makeDeps(
        makeDb({
          providers: [providerRow()],
          bookings: [bookingRow()],
          profiles: [{ id: 'uid-par', first_name: 'Pat', last_name: 'Parent' }],
        }).db,
      ),
    );
    const res = await app.request('/v1/bookings', getReq(await providerToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bookings: Record<string, unknown>[] };
    expect(body.bookings[0]).toMatchObject({
      viewerRole: 'provider',
      counterpartyName: 'Pat Parent',
      counterpartySpecialty: null,
    });
  });
});

// ── POST /v1/bookings/{id}/cancel ────────────────────────────────────────────
describe('POST /v1/bookings/{id}/cancel', () => {
  const CANCEL_PATH = `/v1/bookings/${BID}/cancel`;

  it('404 when the booking does not exist', async () => {
    const app = buildApp(makeDeps(makeDb({ bookings: [] }).db));
    expect((await app.request(CANCEL_PATH, post(await parentToken()))).status).toBe(404);
  });

  it("404 when the booking is not the caller's", async () => {
    const app = buildApp(makeDeps(makeDb({ bookings: [bookingRow({ parent_uid: 'someone-else' })] }).db));
    expect((await app.request(CANCEL_PATH, post(await parentToken()))).status).toBe(404);
  });

  it('200 cancels an accepted booking and releases the held slot (parent-cancel)', async () => {
    const { db, captures } = makeDb({ bookings: [bookingRow()] });
    const app = buildApp(makeDeps(db));
    const res = await app.request(CANCEL_PATH, post(await parentToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: BID, state: 'cancelled' });
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({ state: 'cancelled' });
    // release-consultation-slot side effect frees the slot.
    expect(captures.updates.find((u) => u.table === 'provider_slots')?.set).toMatchObject({
      state: 'released',
      held_by_booking_id: null,
    });
  });

  it('409 when the booking is past the cancellable window (already completed)', async () => {
    const app = buildApp(makeDeps(makeDb({ bookings: [bookingRow({ state: 'completed' })] }).db));
    const res = await app.request(CANCEL_PATH, post(await parentToken()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'cannot_cancel' });
  });
});
