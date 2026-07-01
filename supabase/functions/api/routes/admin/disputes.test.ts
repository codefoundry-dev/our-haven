import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../app.ts';
import { buildTestEnv, mintAccessToken } from '../../_test/jwt.ts';
import type { AppDeps } from '../../deps.ts';

/**
 * Admin dispute-queue routes (OH-213). Table-routed Kysely fake: `selectFrom`
 * resolves canned rows per table (the dispute, its booking, the step-up grant,
 * the flag-count for standing), updates are captured. Modelled on the
 * stripe-tax admin fake + the bookings fake.
 */
function makeDb(tables: Record<string, Record<string, unknown>[]> = {}) {
  const captures = {
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
    refundPaymentIntent: vi.fn(async () => ({ id: 're_1', status: 'succeeded', amount: 0 })),
    ...over,
  } as unknown as AppDeps['stripe'];
}

function makeDeps(db: AppDeps['db'], stripe?: AppDeps['stripe']): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return { env: buildTestEnv(), db, supabase: stub, stripe: stripe ?? makeStripe(), backgroundCheck: stub, daily: stub };
}

async function adminToken() {
  const now = Math.floor(Date.now() / 1000);
  return mintAccessToken({
    sub: 'admin-1',
    email: 'admin@ourhaven.example',
    appMetadata: { role: 'admin' },
    aal: 'aal2',
    amr: [{ method: 'mfa/totp', timestamp: now }],
  });
}
const parentToken = () => mintAccessToken({ sub: 'p-1', appMetadata: { role: 'parent' } });

const DID = '77777777-7777-4777-8777-777777777777';
const BID = '33333333-3333-4333-8333-333333333333';
const PID = '55555555-5555-4555-8555-555555555555';

const grant = () => ({ auth_step_up_grants: [{ granted_at: new Date() }] });
const dispute = (over: Record<string, unknown> = {}) => ({
  id: DID,
  subject_type: 'booking',
  subject_id: BID,
  filed_by_uid: 'uid-par',
  reason: 'overcharged',
  details: null,
  in_window: true,
  hold_applied: true,
  status: 'open',
  created_at: new Date('2026-07-10T00:00:00Z'),
  ...over,
});
const booking = (over: Record<string, unknown> = {}) => ({
  id: BID,
  kind: 'caregiver',
  state: 'disputed',
  origin: 'posted-job',
  provider_id: PID,
  parent_uid: 'uid-par',
  payment_intent_id: 'pi_1',
  payment_status: 'authorized',
  authorized_amount_cents: 15000,
  captured_amount_cents: null,
  computed_total_cents: 15000,
  proposed_amount_cents: null,
  commission_bp: 1500,
  ...over,
});

const authGet = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });
const authPost = (token: string, body: unknown): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// ── GET /v1/admin/disputes ─────────────────────────────────────────────────────
describe('GET /v1/admin/disputes', () => {
  it('lists open disputes for an admin', async () => {
    const { db } = makeDb({ disputes: [dispute()] });
    const res = await buildApp(makeDeps(db)).request('/v1/admin/disputes', authGet(await adminToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { disputes: unknown[] };
    expect(body.disputes).toHaveLength(1);
    expect(body.disputes[0]).toMatchObject({ id: DID, subjectType: 'booking', reason: 'overcharged' });
  });

  it('403 for a non-admin', async () => {
    const { db } = makeDb({ disputes: [dispute()] });
    const res = await buildApp(makeDeps(db)).request('/v1/admin/disputes', authGet(await parentToken()));
    expect(res.status).toBe(403);
  });
});

// ── POST /v1/admin/disputes/{id}/resolve ───────────────────────────────────────
describe('POST /v1/admin/disputes/{disputeId}/resolve', () => {
  const path = `/v1/admin/disputes/${DID}/resolve`;

  it('released on a held dispute → captures the payout + completes the booking', async () => {
    const capture = vi.fn(async () => ({ id: 'pi_1', status: 'succeeded', amount: 0 }));
    const { db, captures } = makeDb({ ...grant(), disputes: [dispute()], bookings: [booking()] });
    const res = await buildApp(makeDeps(db, makeStripe({ capturePaymentIntent: capture }))).request(
      path,
      authPost(await adminToken(), { resolution: 'released' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'resolved', resolution: 'released' });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ amountToCaptureCents: 15000 }));
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({ state: 'completed' });
    expect(captures.updates.find((u) => u.table === 'disputes')?.set).toMatchObject({ status: 'resolved' });
  });

  it('refunded on a held dispute → releases the hold + cancels the booking', async () => {
    const cancel = vi.fn(async () => ({ id: 'pi_1', status: 'canceled', amount: 0 }));
    const { db, captures } = makeDb({ ...grant(), disputes: [dispute()], bookings: [booking()] });
    const res = await buildApp(makeDeps(db, makeStripe({ cancelPaymentIntent: cancel }))).request(
      path,
      authPost(await adminToken(), { resolution: 'refunded' }),
    );
    expect(res.status).toBe(200);
    expect(cancel).toHaveBeenCalled();
    expect(captures.updates.find((u) => u.table === 'bookings')?.set).toMatchObject({ state: 'cancelled' });
  });

  it('dismiss on a held dispute is rejected (money must move)', async () => {
    const { db } = makeDb({ ...grant(), disputes: [dispute()], bookings: [booking()] });
    const res = await buildApp(makeDeps(db)).request(path, authPost(await adminToken(), { resolution: 'dismissed' }));
    expect(res.status).toBe(409);
  });

  it('dismiss a no-show → clears the flag + re-evaluates standing (no money)', async () => {
    const { db, captures } = makeDb({
      ...grant(),
      disputes: [dispute({ reason: 'no-show', in_window: false, hold_applied: false })],
      bookings: [booking({ state: 'cancelled', no_show_at: new Date() })],
      supply_flags: [{ c: '0' }], // after clearing → below threshold
    });
    const res = await buildApp(makeDeps(db)).request(path, authPost(await adminToken(), { resolution: 'dismissed' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'dismissed' });
    expect(captures.updates.find((u) => u.table === 'supply_flags')?.set).toMatchObject({ status: 'cleared' });
    // Standing recompute lifts a suspension when the count drops below threshold.
    expect(captures.updates.find((u) => u.table === 'providers')?.set).toHaveProperty('suspended_at', null);
  });

  it('a Job dispute resolves as dismissed only; other resolutions 400', async () => {
    const { db } = makeDb({ ...grant(), disputes: [dispute({ subject_type: 'job', subject_id: BID })] });
    const app = buildApp(makeDeps(db));
    const ok = await app.request(path, authPost(await adminToken(), { resolution: 'dismissed' }));
    expect(ok.status).toBe(200);
    const bad = await app.request(path, authPost(await adminToken(), { resolution: 'refunded' }));
    expect(bad.status).toBe(400);
  });

  it('404 for an unknown dispute', async () => {
    const { db } = makeDb({ ...grant(), disputes: [] });
    const res = await buildApp(makeDeps(db)).request(path, authPost(await adminToken(), { resolution: 'dismissed' }));
    expect(res.status).toBe(404);
  });

  it('409 when the dispute is already resolved', async () => {
    const { db } = makeDb({ ...grant(), disputes: [dispute({ status: 'resolved' })] });
    const res = await buildApp(makeDeps(db)).request(path, authPost(await adminToken(), { resolution: 'dismissed' }));
    expect(res.status).toBe(409);
  });
});
