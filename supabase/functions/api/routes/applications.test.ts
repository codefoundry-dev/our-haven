import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Table-routed Kysely fake for the Applications review + Award routes (OH-210).
 * Modelled on the Offer fake: selects resolve to a table's canned rows (routes
 * apply no extra TS filtering, so one fixture row per table suffices — for the
 * auto-decline the route uses a single bulk UPDATE, not a per-row loop); inserts
 * (single or array) + updates are captured. An `offers` insert/update returning(…)
 * echoes the captured values over a full default offer row so the counter handler
 * can project the successor DTO.
 */
function makeDb(tables: Record<string, Record<string, unknown>[]> = {}) {
  const captures = {
    inserts: [] as Array<{ table: string; values: Record<string, unknown> | Record<string, unknown>[] }>,
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  };
  const NOW = '2026-07-11T00:00:00.000Z';

  const offerDefaults = (): Record<string, unknown> => ({
    id: 'offer-new',
    thread_id: 'thread-x',
    sender: 'parent',
    status: 'pending',
    category: 'babysitter',
    proposed_rate_cents: 0,
    scope_minutes: 0,
    per_child_surcharge_cents: 0,
    computed_total_cents: 0,
    scope_note: '',
    scope_note_redacted: false,
    negotiable: true,
    valid_until: NOW,
    child_count: 1,
    child_ages: [],
    safety_behaviors: [],
    service_address_line1: null,
    service_address_line2: null,
    service_city: null,
    service_state: null,
    service_postal_code: null,
    schedule_kind: 'one-off',
    slots: [],
    recurrence: null,
    supersedes_offer_id: null,
    job_id: null,
    created_at: NOW,
    updated_at: NOW,
  });

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

  const insertResult = (t: string, values: Record<string, unknown>): Record<string, unknown> => {
    if (t === 'offers') return { ...offerDefaults(), ...values };
    return { id: 'x' };
  };

  const insertChain = (t: string) => {
    let captured: Record<string, unknown> | Record<string, unknown>[] = {};
    const c: Record<string, unknown> = {
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        captured = v;
        captures.inserts.push({ table: t, values: v });
        return c;
      },
      returning: () => c,
      onConflict: () => c,
      executeTakeFirstOrThrow: async () =>
        insertResult(t, Array.isArray(captured) ? (captured[0] ?? {}) : captured),
      executeTakeFirst: async () => insertResult(t, Array.isArray(captured) ? (captured[0] ?? {}) : captured),
      execute: async () => [],
    };
    return c;
  };

  const updateChain = (t: string) => {
    let captured: Record<string, unknown> = {};
    const c: Record<string, unknown> = {
      set: (s: Record<string, unknown>) => {
        captured = s;
        captures.updates.push({ table: t, set: s });
        return c;
      },
      where: () => c,
      returning: () => c,
      executeTakeFirstOrThrow: async () =>
        t === 'offers' ? { ...offerDefaults(), ...(tables.offers?.[0] ?? {}), ...captured } : { id: 'x' },
      executeTakeFirst: async () => ({ id: 'x' }),
      execute: async () => [],
    };
    return c;
  };

  const deleteChain = (t: string) => {
    const c: Record<string, unknown> = { where: () => c, execute: async () => [] };
    void t;
    return c;
  };

  const handle: Record<string, unknown> = {
    selectFrom: (t: string) => selectChain(tables[t] ?? []),
    insertInto: (t: string) => insertChain(t),
    updateTable: (t: string) => updateChain(t),
    deleteFrom: (t: string) => deleteChain(t),
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
const caregiverToken = (uid = 'uid-cg') =>
  mintAccessToken({ sub: uid, appMetadata: { role: 'caregiver', categories: ['babysitter'] } });

// ── fixtures ─────────────────────────────────────────────────────────────────
const JID = '11111111-1111-4111-8111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';
const TID = '33333333-3333-4333-8333-333333333333';
const OID = '44444444-4444-4444-8444-444444444444';
const PID = '55555555-5555-4555-8555-555555555555';

const slot = (date = '2026-08-01', startMin = 1080, endMin = 1260) => ({ date, startMin, endMin });

const jobRow = (over: Record<string, unknown> = {}) => ({
  id: JID,
  parent_uid: 'uid-par',
  origin: 'posted',
  state: 'open',
  category: 'babysitter',
  description: 'After-school care for one kid',
  schedule_kind: 'one-off',
  slots: [slot()],
  recurrence: null,
  child_count: 1,
  child_ages: [4],
  safety_behaviors: [],
  service_address_line1: '12 Oak St',
  service_address_line2: null,
  service_city: 'Austin',
  service_state: 'TX',
  service_postal_code: '78701',
  ...over,
});

const applicationRow = (over: Record<string, unknown> = {}) => ({
  id: AID,
  job_id: JID,
  provider_id: PID,
  origin: 'posted',
  state: 'submitted',
  accepted_offer_id: null,
  proposal: 'I can help after school',
  awarded_at: null,
  created_at: '2026-07-10T00:00:00.000Z',
  updated_at: '2026-07-10T00:00:00.000Z',
  ...over,
});

const threadRow = (over: Record<string, unknown> = {}) => ({
  id: TID,
  parent_uid: 'uid-par',
  supply_uid: 'uid-cg',
  provider_id: PID,
  job_id: JID,
  ...over,
});

/** The caregiver's pending, job-anchored Offer (the one the Parent awards). */
const offerRow = (over: Record<string, unknown> = {}) => ({
  id: OID,
  thread_id: TID,
  sender_uid: 'uid-cg',
  sender: 'caregiver',
  status: 'pending',
  category: 'babysitter',
  proposed_rate_cents: 5000,
  scope_minutes: 180,
  per_child_surcharge_cents: 0,
  computed_total_cents: 15000,
  scope_note: '',
  scope_note_redacted: false,
  negotiable: true,
  valid_until: '2099-12-31T00:00:00.000Z',
  child_count: 1,
  child_ages: [4],
  safety_behaviors: [],
  service_address_line1: null,
  service_address_line2: null,
  service_city: null,
  service_state: null,
  service_postal_code: null,
  schedule_kind: 'one-off',
  slots: [slot()],
  recurrence: null,
  supersedes_offer_id: null,
  job_id: JID,
  created_at: '2026-07-10T01:00:00.000Z',
  updated_at: '2026-07-10T01:00:00.000Z',
  ...over,
});

/** The full fixture set for an awardable Application. */
const awardable = (over: Record<string, Record<string, unknown>[]> = {}) => ({
  jobs: [jobRow()],
  applications: [applicationRow()],
  message_threads: [threadRow()],
  offers: [offerRow()],
  providers: [{ id: PID, uid: 'uid-cg', role: 'caregiver' }],
  provider_profiles: [{ provider_id: PID, display_name: 'Casey', negotiable: true }],
  provider_category_rates: [{ provider_id: PID, published_rate_cents: 5000, per_child_surcharge_cents: 0 }],
  provider_verifications: [{ provider_id: PID, screening_passed_at: '2026-06-01T00:00:00.000Z' }],
  parent_subscriptions: [{ status: 'active' }],
  ...over,
});

const post = (token: string, body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const getReq = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });

// ── GET /v1/jobs/{jobId}/applications ─────────────────────────────────────────
describe('GET /v1/jobs/{jobId}/applications', () => {
  const path = `/v1/jobs/${JID}/applications`;

  it('404 when the Job is not the caller\'s', async () => {
    const app = buildApp(makeDeps(makeDb(awardable()).db));
    expect((await app.request(path, getReq(await parentToken('uid-other')))).status).toBe(404);
  });

  it('403 for a Caregiver', async () => {
    const app = buildApp(makeDeps(makeDb(awardable()).db));
    expect((await app.request(path, getReq(await caregiverToken()))).status).toBe(403);
  });

  it('200 lists Applications with caregiver summary + live Offer', async () => {
    const app = buildApp(makeDeps(makeDb(awardable()).db));
    const res = await app.request(path, getReq(await parentToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { applications: Array<Record<string, any>> };
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0]).toMatchObject({
      id: AID,
      state: 'submitted',
      proposal: 'I can help after school',
    });
    expect(body.applications[0]!.caregiver).toMatchObject({
      providerId: PID,
      name: 'Casey',
      negotiable: true,
      backgroundChecked: true,
      publishedRateCents: 5000,
    });
    expect(body.applications[0]!.offer).toMatchObject({ id: OID, status: 'pending', computedTotalCents: 15000 });
  });
});

// ── GET /v1/applications/{applicationId} ──────────────────────────────────────
describe('GET /v1/applications/{applicationId}', () => {
  const path = `/v1/applications/${AID}`;

  it('200 returns the Application detail with the live Offer', async () => {
    const app = buildApp(makeDeps(makeDb(awardable()).db));
    const res = await app.request(path, getReq(await parentToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body).toMatchObject({ id: AID, state: 'submitted', proposal: 'I can help after school' });
    expect(body.offer).toMatchObject({ id: OID, sender: 'caregiver', negotiable: true });
  });

  it('404 when the Application\'s Job is not the caller\'s', async () => {
    const app = buildApp(makeDeps(makeDb(awardable()).db));
    expect((await app.request(path, getReq(await parentToken('uid-other')))).status).toBe(404);
  });
});

// ── POST /v1/applications/{applicationId}/award ───────────────────────────────
describe('POST /v1/applications/{applicationId}/award', () => {
  const path = `/v1/applications/${AID}/award`;

  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps(makeDb(awardable()).db));
    expect((await app.request(path, { method: 'POST' })).status).toBe(401);
  });

  it('403 for a Caregiver', async () => {
    const app = buildApp(makeDeps(makeDb(awardable()).db));
    expect((await app.request(path, post(await caregiverToken(), {}))).status).toBe(403);
  });

  it('402 when the Parent has no active Subscription', async () => {
    const app = buildApp(makeDeps(makeDb(awardable({ parent_subscriptions: [] })).db));
    const res = await app.request(path, post(await parentToken(), {}));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'subscription_required' });
  });

  it('200 awards: one-off Booking `requested`, Job/App awarded, others auto-declined, notify', async () => {
    const { db, captures } = makeDb(awardable());
    const app = buildApp(makeDeps(db));
    const res = await app.request(path, post(await parentToken(), { paymentMethodId: 'pm_mock' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body).toMatchObject({ applicationId: AID, jobId: JID, state: 'awarded', seriesId: null });
    expect(body.bookingIds).toHaveLength(1);

    // One caregiver Booking, born `requested` (posted-Job), carrying the chain FKs.
    const bookingIns = captures.inserts.find((i) => i.table === 'bookings');
    const rows = bookingIns?.values as Record<string, unknown>[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'caregiver',
      state: 'requested',
      origin: 'posted-job',
      job_id: JID,
      application_id: AID,
      offer_id: OID,
      provider_id: PID,
      parent_uid: 'uid-par',
      series_id: null,
      agreed_rate_cents: 5000,
      scheduled_date: '2026-08-01',
      // JOB child detail + service address carried onto the Booking.
      child_count: 1,
      service_address_line1: '12 Oak St',
    });
    expect(captures.inserts.find((i) => i.table === 'booking_series')).toBeUndefined();

    // Offer → accepted; Application → awarded; Job → awarded.
    expect(captures.updates.find((u) => u.table === 'offers')?.set).toMatchObject({ status: 'accepted' });
    const appUpdates = captures.updates.filter((u) => u.table === 'applications');
    expect(appUpdates.some((u) => u.set.state === 'awarded' && u.set.accepted_offer_id === OID)).toBe(true);
    // The auto-decline bulk update (story 91).
    expect(appUpdates.some((u) => u.set.state === 'declined')).toBe(true);
    expect(captures.updates.find((u) => u.table === 'jobs')?.set).toMatchObject({
      state: 'awarded',
      provider_id: PID,
    });

    // The awarded Caregiver is notified (job_awarded, SMS-mandatory).
    const outbox = captures.inserts.find((i) => i.table === 'notification_outbox');
    expect(outbox?.values).toMatchObject({ recipient_uid: 'uid-cg', event_type: 'job_awarded' });
  });

  it('200 awards a recurring Job → a Booking Series + one Booking per occurrence', async () => {
    const rule = { startDate: '2026-08-01', endDate: '2026-08-15', weekdays: [6], startMin: 1080, endMin: 1260 };
    const { db, captures } = makeDb(
      awardable({ jobs: [jobRow({ schedule_kind: 'recurring', slots: [], recurrence: rule })] }),
    );
    const app = buildApp(makeDeps(db));
    const res = await app.request(path, post(await parentToken(), {}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.seriesId).toEqual(expect.any(String));
    // 2026-08-01, 08 and 15 are Saturdays (weekday 6) → 3 occurrences.
    expect(body.bookingIds).toHaveLength(3);
    const series = captures.inserts.find((i) => i.table === 'booking_series');
    const seriesId = (series?.values as Record<string, unknown>).id;
    expect(series?.values).toMatchObject({ job_id: JID, provider_id: PID, agreed_rate_cents: 5000 });
    const rows = captures.inserts.find((i) => i.table === 'bookings')?.values as Record<string, unknown>[];
    expect(rows).toHaveLength(3);
    // Every occurrence is `requested` and grouped under the same Series.
    expect(rows.every((b) => b.state === 'requested' && b.series_id === seriesId)).toBe(true);
  });

  it('409 when the Job is no longer open', async () => {
    const app = buildApp(makeDeps(makeDb(awardable({ jobs: [jobRow({ state: 'awarded' })] })).db));
    const res = await app.request(path, post(await parentToken(), {}));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_awardable' });
  });

  it('409 when there is no caregiver Offer to award', async () => {
    const app = buildApp(makeDeps(makeDb(awardable({ offers: [] })).db));
    const res = await app.request(path, post(await parentToken(), {}));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'no_offer' });
  });

  it('409 when the live Offer is the Parent\'s own outstanding counter', async () => {
    const app = buildApp(
      makeDeps(makeDb(awardable({ offers: [offerRow({ sender: 'parent', sender_uid: 'uid-par' })] })).db),
    );
    const res = await app.request(path, post(await parentToken(), {}));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'awaiting_caregiver' });
  });

  it('404 for an unknown Application', async () => {
    const app = buildApp(makeDeps(makeDb(awardable({ applications: [] })).db));
    expect((await app.request(path, post(await parentToken(), {}))).status).toBe(404);
  });
});

// ── POST /v1/applications/{applicationId}/decline ─────────────────────────────
describe('POST /v1/applications/{applicationId}/decline', () => {
  const path = `/v1/applications/${AID}/decline`;

  it('200 declines the Application and its pending Offer', async () => {
    const { db, captures } = makeDb(awardable());
    const app = buildApp(makeDeps(db));
    const res = await app.request(path, post(await parentToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ applicationId: AID, state: 'declined' });
    expect(captures.updates.find((u) => u.table === 'applications')?.set).toMatchObject({ state: 'declined' });
    expect(captures.updates.find((u) => u.table === 'offers')?.set).toMatchObject({ status: 'declined' });
  });

  it('409 when the Application is already terminal', async () => {
    const app = buildApp(makeDeps(makeDb(awardable({ applications: [applicationRow({ state: 'awarded' })] })).db));
    const res = await app.request(path, post(await parentToken()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_declinable' });
  });
});

// ── POST /v1/applications/{applicationId}/counter ─────────────────────────────
describe('POST /v1/applications/{applicationId}/counter', () => {
  const path = `/v1/applications/${AID}/counter`;
  const counterBody = { proposedRateCents: 4500 };

  it('200 opens a Parent successor Offer linked via supersedes', async () => {
    const { db, captures } = makeDb(awardable());
    const app = buildApp(makeDeps(db));
    const res = await app.request(path, post(await parentToken(), counterBody));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body).toMatchObject({ applicationId: AID, state: 'countered' });
    // Predecessor Offer → countered; Application → countered.
    expect(captures.updates.find((u) => u.table === 'offers')?.set).toMatchObject({ status: 'countered' });
    expect(captures.updates.find((u) => u.table === 'applications')?.set).toMatchObject({ state: 'countered' });
    // Successor Offer inserted: Parent-sent, superseding, revised rate, JOB child detail.
    const ins = captures.inserts.find((i) => i.table === 'offers');
    expect(ins?.values).toMatchObject({
      status: 'pending',
      sender: 'parent',
      supersedes_offer_id: OID,
      proposed_rate_cents: 4500,
      job_id: JID,
      child_count: 1,
    });
    // The Caregiver is notified of the counter.
    const outbox = captures.inserts.find((i) => i.table === 'notification_outbox');
    expect(outbox?.values).toMatchObject({ recipient_uid: 'uid-cg', event_type: 'counter_offer_received' });
  });

  it('409 when the Caregiver is non-negotiable (ADR-0017)', async () => {
    const app = buildApp(makeDeps(makeDb(awardable({ offers: [offerRow({ negotiable: false })] })).db));
    const res = await app.request(path, post(await parentToken(), counterBody));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'counter_unavailable' });
  });

  it('402 when the Parent has no active Subscription', async () => {
    const app = buildApp(makeDeps(makeDb(awardable({ parent_subscriptions: [] })).db));
    expect((await app.request(path, post(await parentToken(), counterBody))).status).toBe(402);
  });
});
