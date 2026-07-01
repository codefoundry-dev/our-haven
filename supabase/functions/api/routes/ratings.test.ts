import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Table-routed Kysely fake for the two-way rating submit route (OH-214). Selects
 * resolve to a table's canned rows (the `where` is ignored — fixtures are already
 * scoped); the ratings insert supports `.returning().executeTakeFirst()` (the
 * on-conflict duplicate guard) and captures every insert.
 */
function makeDb(tables: Record<string, Record<string, unknown>[]> = {}) {
  const captures = { inserts: [] as Array<{ table: string; values: Record<string, unknown> }> };
  const selectChain = (rows: Record<string, unknown>[]) => {
    const c: Record<string, unknown> = {
      select: () => c,
      where: () => c,
      orderBy: () => c,
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
        onConflict: () => c,
        returning: () => c,
        execute: async () => [],
        // A fresh insert returns its row; the duplicate path is pre-checked before
        // we ever reach here, so the fake always "wins" the insert.
        executeTakeFirst: async () => ({ id: 'rating-1' }),
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
  return { env: buildTestEnv(), db, supabase: stub, stripe: stub, backgroundCheck: stub, daily: stub };
}

const parentToken = (uid = 'uid-par') =>
  mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'parent' } });
const caregiverToken = (uid = 'uid-cg') =>
  mintAccessToken({ sub: uid, appMetadata: { role: 'caregiver', categories: ['babysitter'] } });
const providerToken = (uid = 'uid-prov') =>
  mintAccessToken({ sub: uid, appMetadata: { role: 'provider' } });

const BID = '33333333-3333-4333-8333-333333333333';
const PID = '55555555-5555-4555-8555-555555555555';
const path = `/v1/bookings/${BID}/rating`;

const post = (token: string, body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

/** A completed Caregiver Booking whose 14-day window is open (confirmed 1 day ago). */
const completed = (over: Record<string, unknown> = {}) => ({
  id: BID,
  kind: 'caregiver',
  state: 'completed',
  parent_uid: 'uid-par',
  provider_id: PID,
  confirmed_at: daysAgo(1),
  auto_complete_at: null,
  updated_at: daysAgo(1),
  ...over,
});

const fixtures = (booking: Record<string, unknown>, ratings: Record<string, unknown>[] = []) => ({
  bookings: [booking],
  providers: [{ id: PID, uid: 'uid-cg' }],
  ratings,
});

const rating = (direction: string, over: Record<string, unknown> = {}) => ({
  booking_id: BID,
  direction,
  stars: 4,
  text: null,
  ...over,
});

describe('POST /v1/bookings/{bookingId}/rating', () => {
  it('parent rates the supply → parent-to-supply row + notifies the supply; blind until reveal', async () => {
    const { db, captures } = makeDb(fixtures(completed()));
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken(), { stars: 5, text: 'Wonderful' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      canRate: false,
      revealed: false, // the supply hasn't rated yet
      mine: { stars: 5, text: 'Wonderful' },
      counterparty: null,
    });
    expect(captures.inserts.find((i) => i.table === 'ratings')?.values).toMatchObject({
      direction: 'parent-to-supply',
      subject_provider_id: PID,
      subject_parent_uid: null,
      stars: 5,
    });
    expect(captures.inserts.find((i) => i.table === 'notification_outbox')?.values).toMatchObject({
      recipient_uid: 'uid-cg',
      event_type: 'booking_rated',
    });
  });

  it('caregiver rates the parent → supply-to-parent row + notifies the parent', async () => {
    const { db, captures } = makeDb(fixtures(completed()));
    const res = await buildApp(makeDeps(db)).request(path, post(await caregiverToken(), { stars: 4 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mine: { stars: 4, text: null }, revealed: false });
    expect(captures.inserts.find((i) => i.table === 'ratings')?.values).toMatchObject({
      direction: 'supply-to-parent',
      subject_parent_uid: 'uid-par',
      subject_provider_id: null,
      stars: 4,
    });
    expect(captures.inserts.find((i) => i.table === 'notification_outbox')?.values).toMatchObject({
      recipient_uid: 'uid-par',
    });
  });

  it('a provider rates the parent on a provider consultation', async () => {
    const booking = completed({ kind: 'provider', confirmed_at: null, auto_complete_at: daysAgo(1) });
    const { db, captures } = makeDb({ ...fixtures(booking), providers: [{ id: PID, uid: 'uid-prov' }] });
    const res = await buildApp(makeDeps(db)).request(path, post(await providerToken(), { stars: 5 }));
    expect(res.status).toBe(200);
    expect(captures.inserts.find((i) => i.table === 'ratings')?.values).toMatchObject({
      direction: 'supply-to-parent',
      subject_parent_uid: 'uid-par',
    });
  });

  it('blind mutual reveal: parent submitting AFTER the supply already rated reveals stars only (no text)', async () => {
    // The supply already left a 3★ "internal" review of the parent.
    const { db } = makeDb(fixtures(completed(), [rating('supply-to-parent', { stars: 3, text: 'chaotic home' })]));
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken(), { stars: 5 }));
    expect(res.status).toBe(200);
    // Both sides in → revealed; the Parent sees the supply's STARS but never the text.
    expect(await res.json()).toMatchObject({
      revealed: true,
      counterparty: { stars: 3, text: null },
    });
  });

  it('blind mutual reveal: supply submitting AFTER the parent rated sees the parent stars + text (public)', async () => {
    const { db } = makeDb(fixtures(completed(), [rating('parent-to-supply', { stars: 5, text: 'lovely family' })]));
    const res = await buildApp(makeDeps(db)).request(path, post(await caregiverToken(), { stars: 4 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      revealed: true,
      counterparty: { stars: 5, text: 'lovely family' },
    });
  });

  it('409 when the Booking is not completed', async () => {
    const { db } = makeDb(fixtures(completed({ state: 'accepted' })));
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken(), { stars: 5 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_ratable' });
  });

  it('409 when the 14-day window has closed', async () => {
    const { db } = makeDb(fixtures(completed({ confirmed_at: daysAgo(15), updated_at: daysAgo(15) })));
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken(), { stars: 5 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_ratable' });
  });

  it('409 when the caller already rated their side', async () => {
    const { db } = makeDb(fixtures(completed(), [rating('parent-to-supply', { stars: 4 })]));
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken(), { stars: 5 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'already_rated' });
  });

  it("404 when the Booking is not the caller's (parent)", async () => {
    const { db } = makeDb(fixtures(completed()));
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken('uid-other'), { stars: 5 }));
    expect(res.status).toBe(404);
  });

  it('404 when a supply caller is not the Booking’s provider', async () => {
    const { db } = makeDb({ ...fixtures(completed()), providers: [{ id: 'other-pid', uid: 'uid-cg' }] });
    const res = await buildApp(makeDeps(db)).request(path, post(await caregiverToken(), { stars: 5 }));
    expect(res.status).toBe(404);
  });

  it('400 on an out-of-range star score', async () => {
    const { db } = makeDb(fixtures(completed()));
    const res = await buildApp(makeDeps(db)).request(path, post(await parentToken(), { stars: 6 }));
    expect(res.status).toBe(400);
  });
});
