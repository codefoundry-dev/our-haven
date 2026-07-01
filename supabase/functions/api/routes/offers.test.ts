import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Table-routed Kysely fake for the Offer routes (OH-206). Modelled on the
 * messaging fake: selects resolve to a table's canned rows (the routes apply no
 * extra TS filtering, so one fixture row per table suffices); inserts/updates are
 * captured. An `offers` insert/update `returning(...)` echoes the captured values
 * over a full default offer row so the compose + transition handlers can project
 * the response DTO.
 */
function makeDb(
  tables: Record<string, Record<string, unknown>[]> = {},
  opts: { insertedOfferId?: string } = {},
) {
  const captures = {
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  };
  const NOW = '2026-07-09T00:00:00.000Z';

  const offerDefaults = (): Record<string, unknown> => ({
    id: opts.insertedOfferId ?? 'offer-new',
    status: 'pending',
    scope_note: '',
    scope_note_redacted: false,
    child_ages: [],
    safety_behaviors: [],
    slots: [],
    recurrence: null,
    service_address_line1: null,
    service_address_line2: null,
    service_city: null,
    service_state: null,
    service_postal_code: null,
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
    let captured: Record<string, unknown> = {};
    const c: Record<string, unknown> = {
      values: (v: Record<string, unknown>) => {
        captured = v;
        captures.inserts.push({ table: t, values: v });
        return c;
      },
      returning: () => c,
      onConflict: () => c,
      executeTakeFirstOrThrow: async () => insertResult(t, captured),
      executeTakeFirst: async () => insertResult(t, captured),
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
      // An offers update returns the fixture row merged with the new set values.
      executeTakeFirstOrThrow: async () =>
        t === 'offers' ? { ...(tables.offers?.[0] ?? {}), ...captured } : { id: 'x' },
      executeTakeFirst: async () => ({ id: 'x' }),
      execute: async () => [],
    };
    return c;
  };

  const handle: Record<string, unknown> = {
    selectFrom: (t: string) => selectChain(tables[t] ?? []),
    insertInto: (t: string) => insertChain(t),
    updateTable: (t: string) => updateChain(t),
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
const providerToken = (uid = 'uid-prov') =>
  mintAccessToken({ sub: uid, appMetadata: { role: 'provider', specialty: 'slp', state: 'CA' } });

// ── fixtures ─────────────────────────────────────────────────────────────────
const PID = '11111111-1111-4111-8111-111111111111';
const TID = '22222222-2222-4222-8222-222222222222';
const OID = '33333333-3333-4333-8333-333333333333';
const OFFERS_PATH = `/v1/threads/${TID}/offers`;

const threadRow = (over: Record<string, unknown> = {}) => ({
  id: TID,
  parent_uid: 'uid-par',
  supply_uid: 'uid-cg',
  provider_id: PID,
  job_id: null,
  ...over,
});

const rateRow = (over: Record<string, unknown> = {}) => ({
  published_rate_cents: 5000,
  per_child_surcharge_cents: 1000,
  ...over,
});

const slot = (date = '2026-08-01', startMin = 1080, endMin = 1260) => ({ date, startMin, endMin });

/** A pending Offer the Parent sent (so the Caregiver is the counterparty). */
const offerRow = (over: Record<string, unknown> = {}) => ({
  id: OID,
  thread_id: TID,
  sender_uid: 'uid-par',
  sender: 'parent',
  status: 'pending',
  category: 'babysitter',
  proposed_rate_cents: 5000,
  scope_minutes: 180,
  per_child_surcharge_cents: 1000,
  computed_total_cents: 15000,
  scope_note: '',
  scope_note_redacted: false,
  negotiable: true,
  valid_until: '2099-12-31T00:00:00.000Z',
  child_count: 1,
  child_ages: [4],
  safety_behaviors: [],
  service_address_line1: '12 Oak St',
  service_address_line2: null,
  service_city: 'Austin',
  service_state: 'TX',
  service_postal_code: '78701',
  schedule_kind: 'one-off',
  slots: [slot()],
  recurrence: null,
  supersedes_offer_id: null,
  job_id: null,
  created_at: '2026-07-09T00:00:00.000Z',
  updated_at: '2026-07-09T00:00:00.000Z',
  ...over,
});

const composeBody = (over: Record<string, unknown> = {}) => ({
  category: 'babysitter',
  proposedRateCents: 5000,
  childCount: 1,
  childAges: [4],
  safetyBehaviors: [],
  serviceAddress: { line1: '12 Oak St', city: 'Austin', state: 'TX', postalCode: '78701' },
  schedule: { kind: 'one-off', slot: slot() },
  ...over,
});

const composable = (over: Record<string, Record<string, unknown>[]> = {}) => ({
  message_threads: [threadRow()],
  parent_subscriptions: [{ status: 'active' }],
  provider_category_rates: [rateRow()],
  provider_profiles: [{ negotiable: true }],
  ...over,
});

const post = (token: string, body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const getReq = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });

// ── POST /v1/threads/{id}/offers (compose) ───────────────────────────────────
describe('POST /v1/threads/{threadId}/offers (compose)', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps(makeDb(composable()).db));
    expect((await app.request(OFFERS_PATH, { method: 'POST' })).status).toBe(401);
  });

  it('403 for a Provider (offers are Caregiver-side only)', async () => {
    const app = buildApp(makeDeps(makeDb(composable()).db));
    expect((await app.request(OFFERS_PATH, post(await providerToken(), composeBody()))).status).toBe(403);
  });

  it('404 for a non-participant', async () => {
    const app = buildApp(makeDeps(makeDb(composable()).db));
    const res = await app.request(OFFERS_PATH, post(await parentToken('uid-other'), composeBody()));
    expect(res.status).toBe(404);
  });

  it('402 when the Parent has no active Subscription', async () => {
    const app = buildApp(makeDeps(makeDb(composable({ parent_subscriptions: [] })).db));
    const res = await app.request(OFFERS_PATH, post(await parentToken(), composeBody()));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'subscription_required' });
  });

  it('201 composes a one-off Offer with a server-computed total + 72h validity', async () => {
    const { db, captures } = makeDb(composable());
    const app = buildApp(makeDeps(db));
    const res = await app.request(OFFERS_PATH, post(await parentToken(), composeBody()));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      sender: 'parent',
      status: 'pending',
      category: 'babysitter',
      proposedRateCents: 5000,
      scopeMinutes: 180,
      // 5000¢/h × 3h, single child → no surcharge.
      computedTotalCents: 15000,
      scheduleKind: 'one-off',
    });
    const ins = captures.inserts.find((i) => i.table === 'offers');
    expect(ins?.values).toMatchObject({
      sender: 'parent',
      status: 'pending',
      proposed_rate_cents: 5000,
      // The surcharge SNAPSHOT is the caregiver's per-hour rate (1000¢), stored
      // regardless of child count; it just isn't applied to the total for 1 child.
      per_child_surcharge_cents: 1000,
      computed_total_cents: 15000,
      scope_minutes: 180,
    });
    expect(ins?.values.valid_until).toBeInstanceOf(Date);
    // The thread's last-activity is bumped with an offer preview.
    expect(captures.updates.find((u) => u.table === 'message_threads')?.set).toMatchObject({
      last_message_redacted: false,
    });
  });

  it('201 bakes the per-child surcharge into the total for 2 children', async () => {
    const { db } = makeDb(composable());
    const app = buildApp(makeDeps(db));
    const res = await app.request(
      OFFERS_PATH,
      post(await parentToken(), composeBody({ childCount: 2, childAges: [3, 6] })),
    );
    expect(res.status).toBe(201);
    // base 5000×3 = 15000; surcharge 1000¢/h × 3h × (2-1) = 3000 → 18000.
    expect(((await res.json()) as Record<string, unknown>).computedTotalCents).toBe(18000);
  });

  it('400 when safetyBehaviors is omitted (explicit disclose-or-none required)', async () => {
    const { safetyBehaviors, ...withoutDisclosure } = composeBody();
    void safetyBehaviors;
    const app = buildApp(makeDeps(makeDb(composable()).db));
    expect((await app.request(OFFERS_PATH, post(await parentToken(), withoutDisclosure))).status).toBe(400);
  });

  it('201 with an explicit empty disclosure (disclose none is a valid choice)', async () => {
    const app = buildApp(makeDeps(makeDb(composable()).db));
    const res = await app.request(OFFERS_PATH, post(await parentToken(), composeBody({ safetyBehaviors: [] })));
    expect(res.status).toBe(201);
    expect(((await res.json()) as Record<string, unknown>).safetyBehaviors).toEqual([]);
  });

  it('201 normalises a disclosed Safety-Behaviors subset', async () => {
    const { db, captures } = makeDb(composable());
    const app = buildApp(makeDeps(db));
    const res = await app.request(
      OFFERS_PATH,
      post(await parentToken(), composeBody({ safetyBehaviors: ['wandering', 'aggression'] })),
    );
    expect(res.status).toBe(201);
    const ins = captures.inserts.find((i) => i.table === 'offers');
    // canonical declaration order (aggression before wandering)
    expect(ins?.values.safety_behaviors).toEqual(['aggression', 'wandering']);
  });

  it('201 multi-day sums minutes across slots and tags the schedule', async () => {
    const { db, captures } = makeDb(composable());
    const app = buildApp(makeDeps(db));
    const res = await app.request(
      OFFERS_PATH,
      post(
        await parentToken(),
        composeBody({
          schedule: {
            kind: 'multi-day',
            slots: [slot('2026-08-01', 1080, 1260), slot('2026-08-03', 1020, 1200)],
          },
        }),
      ),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.scheduleKind).toBe('multi-day');
    expect(body.scopeMinutes).toBe(360); // 180 + 180
    const ins = captures.inserts.find((i) => i.table === 'offers');
    expect((ins?.values.slots as unknown[]).length).toBe(2);
  });

  it('locks a Parent rate to the published Rate when the Caregiver is non-negotiable (ADR-0017)', async () => {
    const { db, captures } = makeDb(composable({ provider_profiles: [{ negotiable: false }] }));
    const app = buildApp(makeDeps(db));
    // Parent tries to haggle below the published rate; it must be overridden.
    const res = await app.request(OFFERS_PATH, post(await parentToken(), composeBody({ proposedRateCents: 3000 })));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.proposedRateCents).toBe(5000);
    expect(body.negotiable).toBe(false);
    expect(captures.inserts.find((i) => i.table === 'offers')?.values.proposed_rate_cents).toBe(5000);
  });

  it('400 when a Tutor booking is not single-child', async () => {
    const db = makeDb(composable({ provider_category_rates: [rateRow({ per_child_surcharge_cents: null })] })).db;
    const app = buildApp(makeDeps(db));
    const res = await app.request(
      OFFERS_PATH,
      post(await parentToken(), composeBody({ category: 'tutor', childCount: 2, childAges: [5, 8] })),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_child_detail' });
  });

  it('400 when childAges length does not match childCount', async () => {
    const app = buildApp(makeDeps(makeDb(composable()).db));
    const res = await app.request(OFFERS_PATH, post(await parentToken(), composeBody({ childCount: 2, childAges: [4] })));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_child_detail' });
  });

  it('400 when the Caregiver does not offer the chosen category', async () => {
    const app = buildApp(makeDeps(makeDb(composable({ provider_category_rates: [] })).db));
    const res = await app.request(OFFERS_PATH, post(await parentToken(), composeBody()));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'category_unavailable' });
  });

  it('400 when the schedule is recurring (not composable in OH-206)', async () => {
    const app = buildApp(makeDeps(makeDb(composable()).db));
    const res = await app.request(
      OFFERS_PATH,
      post(await parentToken(), composeBody({ schedule: { kind: 'recurring', rule: {} } })),
    );
    expect(res.status).toBe(400);
  });

  it('redacts the scope_note and queues the unredacted original (offer_id) for T&S', async () => {
    const { db, captures } = makeDb(composable());
    const app = buildApp(makeDeps(db));
    const note = 'text me at 415-555-1234';
    const res = await app.request(OFFERS_PATH, post(await parentToken(), composeBody({ scopeNote: note })));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { scopeNote: string; scopeNoteRedacted: boolean };
    expect(body.scopeNoteRedacted).toBe(true);
    expect(body.scopeNote).not.toContain('415-555-1234');
    const offerIns = captures.inserts.find((i) => i.table === 'offers');
    expect(offerIns?.values.scope_note).not.toContain('415-555-1234');
    const flag = captures.inserts.find((i) => i.table === 'message_flags');
    expect(flag?.values).toMatchObject({ original_body: note });
    expect(flag?.values.offer_id).toBeDefined();
    expect(flag?.values.categories).toContain('phone');
  });

  it('201 for a Caregiver-sent Offer — not Subscription-gated, no service address', async () => {
    const { db, captures } = makeDb(composable({ parent_subscriptions: [] }));
    const app = buildApp(makeDeps(db));
    const res = await app.request(OFFERS_PATH, post(await caregiverToken(), composeBody()));
    expect(res.status).toBe(201);
    expect(((await res.json()) as Record<string, unknown>).sender).toBe('caregiver');
    // A Caregiver-sent Offer never carries the parent's service address.
    const ins = captures.inserts.find((i) => i.table === 'offers');
    expect(ins?.values.service_address_line1).toBeNull();
  });
});

// ── GET /v1/threads/{id}/offers (list) ───────────────────────────────────────
describe('GET /v1/threads/{threadId}/offers', () => {
  it('returns the thread Offers for a participant', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()], offers: [offerRow()] }).db));
    const res = await app.request(OFFERS_PATH, getReq(await parentToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { offers: Array<Record<string, unknown>> };
    expect(body.offers[0]).toMatchObject({ id: OID, status: 'pending', sender: 'parent' });
  });

  it('hides the exact street address from the Caregiver before acceptance (story 124)', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()], offers: [offerRow()] }).db));
    const res = await app.request(OFFERS_PATH, getReq(await caregiverToken()));
    const body = (await res.json()) as { offers: Array<{ serviceAddress: Record<string, unknown> }> };
    expect(body.offers[0]?.serviceAddress.line1).toBeNull();
    // …but the area (city/state) is shown so they can gauge distance.
    expect(body.offers[0]?.serviceAddress.city).toBe('Austin');
  });

  it('shows the full address to the Parent (sender) before acceptance', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()], offers: [offerRow()] }).db));
    const res = await app.request(OFFERS_PATH, getReq(await parentToken()));
    const body = (await res.json()) as { offers: Array<{ serviceAddress: Record<string, unknown> }> };
    expect(body.offers[0]?.serviceAddress.line1).toBe('12 Oak St');
  });

  it('reveals the exact address to the Caregiver once accepted', async () => {
    const app = buildApp(
      makeDeps(makeDb({ message_threads: [threadRow()], offers: [offerRow({ status: 'accepted' })] }).db),
    );
    const res = await app.request(OFFERS_PATH, getReq(await caregiverToken()));
    const body = (await res.json()) as { offers: Array<{ serviceAddress: Record<string, unknown> }> };
    expect(body.offers[0]?.serviceAddress.line1).toBe('12 Oak St');
  });

  it('404 for a non-participant', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()], offers: [offerRow()] }).db));
    expect((await app.request(OFFERS_PATH, getReq(await parentToken('uid-other')))).status).toBe(404);
  });
});

// ── transitions: accept / decline / withdraw / counter ───────────────────────
const acceptPath = `/v1/offers/${OID}/accept`;
const declinePath = `/v1/offers/${OID}/decline`;
const withdrawPath = `/v1/offers/${OID}/withdraw`;
const counterPath = `/v1/offers/${OID}/counter`;

describe('POST /v1/offers/{id}/accept', () => {
  it('200 the Caregiver counterparty accepts a Parent-sent Offer', async () => {
    const { db, captures } = makeDb({ message_threads: [threadRow()], offers: [offerRow()] });
    const app = buildApp(makeDeps(db));
    const res = await app.request(acceptPath, post(await caregiverToken()));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).status).toBe('accepted');
    expect(captures.updates.find((u) => u.table === 'offers')?.set).toMatchObject({ status: 'accepted' });
  });

  it('409 when the sender tries to accept their own Offer', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()], offers: [offerRow()] }).db));
    const res = await app.request(acceptPath, post(await parentToken()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_counterparty' });
  });

  it('402 when a Parent accepts a Caregiver-sent Offer without a Subscription', async () => {
    const db = makeDb({
      message_threads: [threadRow()],
      offers: [offerRow({ sender: 'caregiver', sender_uid: 'uid-cg' })],
      parent_subscriptions: [],
    }).db;
    const app = buildApp(makeDeps(db));
    expect((await app.request(acceptPath, post(await parentToken()))).status).toBe(402);
  });

  it('409 when accepting an expired Offer', async () => {
    const db = makeDb({
      message_threads: [threadRow()],
      offers: [offerRow({ valid_until: '2020-01-01T00:00:00.000Z' })],
    }).db;
    const app = buildApp(makeDeps(db));
    const res = await app.request(acceptPath, post(await caregiverToken()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'invalid_transition' });
  });

  it('404 for an unknown Offer', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()], offers: [] }).db));
    expect((await app.request(acceptPath, post(await caregiverToken()))).status).toBe(404);
  });

  it('materialises Job + Application + Booking and rebinds the thread (OH-207)', async () => {
    const { db, captures } = makeDb({ message_threads: [threadRow()], offers: [offerRow()] });
    const app = buildApp(makeDeps(db));
    const res = await app.request(acceptPath, post(await caregiverToken()));
    expect(res.status).toBe(200);

    // Job born awarded (direct-message), awarded to the thread's provider + parent.
    const job = captures.inserts.find((i) => i.table === 'jobs');
    expect(job?.values).toMatchObject({
      origin: 'direct-message',
      state: 'awarded',
      parent_uid: 'uid-par',
      provider_id: PID,
      category: 'babysitter',
    });
    // One Application, born awarded, on the accepted Offer.
    const application = captures.inserts.find((i) => i.table === 'applications');
    expect(application?.values).toMatchObject({
      origin: 'direct-message',
      state: 'awarded',
      provider_id: PID,
      accepted_offer_id: OID,
    });
    // One caregiver Booking (one-off), born accepted, carrying the Offer back-link.
    const bookingIns = captures.inserts.find((i) => i.table === 'bookings');
    const bookingRows = bookingIns?.values as unknown as Record<string, unknown>[];
    expect(Array.isArray(bookingRows)).toBe(true);
    expect(bookingRows).toHaveLength(1);
    expect(bookingRows[0]).toMatchObject({
      kind: 'caregiver',
      state: 'accepted',
      origin: 'direct-message',
      offer_id: OID,
      provider_id: PID,
      parent_uid: 'uid-par',
      scheduled_date: '2026-08-01',
      // reveal-at-accept address snapshot + child detail carried onto the Booking.
      service_address_line1: '12 Oak St',
      child_count: 1,
    });

    // The Offer + thread both rebind to the SAME new job id.
    const jobId = (job?.values as Record<string, unknown>).id;
    expect(jobId).toEqual(expect.any(String));
    expect(captures.updates.find((u) => u.table === 'offers')?.set).toMatchObject({
      status: 'accepted',
      job_id: jobId,
    });
    expect(captures.updates.find((u) => u.table === 'message_threads')?.set).toMatchObject({
      job_id: jobId,
    });
  });

  it('materialises one Booking per slot for a multi-day Offer, with no Series', async () => {
    const { db, captures } = makeDb({
      message_threads: [threadRow()],
      offers: [
        offerRow({
          schedule_kind: 'multi-day',
          slots: [slot('2026-08-01'), slot('2026-08-02')],
        }),
      ],
    });
    const app = buildApp(makeDeps(db));
    const res = await app.request(acceptPath, post(await caregiverToken()));
    expect(res.status).toBe(200);

    const bookingRows = captures.inserts.find((i) => i.table === 'bookings')
      ?.values as unknown as Record<string, unknown>[];
    expect(bookingRows).toHaveLength(2);
    // A multi-day one-off is not a Series (ADR-0014 §A1).
    expect(bookingRows.every((b) => b.series_id === null)).toBe(true);
    expect(captures.inserts.find((i) => i.table === 'booking_series')).toBeUndefined();
  });
});

describe('POST /v1/offers/{id}/decline', () => {
  it('200 the counterparty declines', async () => {
    const { db, captures } = makeDb({ message_threads: [threadRow()], offers: [offerRow()] });
    const app = buildApp(makeDeps(db));
    const res = await app.request(declinePath, post(await caregiverToken()));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).status).toBe('declined');
    expect(captures.updates.find((u) => u.table === 'offers')?.set).toMatchObject({ status: 'declined' });
  });
});

describe('POST /v1/offers/{id}/withdraw', () => {
  it('200 the sender withdraws their pending Offer', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()], offers: [offerRow()] }).db));
    const res = await app.request(withdrawPath, post(await parentToken()));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).status).toBe('withdrawn');
  });

  it('409 when a non-sender tries to withdraw', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()], offers: [offerRow()] }).db));
    const res = await app.request(withdrawPath, post(await caregiverToken()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_sender' });
  });

  it('cascade-cancels the materialised Bookings when withdrawing an accepted Offer (OH-207)', async () => {
    const { db, captures } = makeDb({
      message_threads: [threadRow({ job_id: 'job-x' })],
      offers: [offerRow({ status: 'accepted', job_id: 'job-x' })],
    });
    const app = buildApp(makeDeps(db));
    const res = await app.request(withdrawPath, post(await parentToken()));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).status).toBe('withdrawn');

    // Every Booking this Offer materialised flips to cancelled.
    const bookingUpdate = captures.updates.find((u) => u.table === 'bookings');
    expect(bookingUpdate?.set).toMatchObject({ state: 'cancelled' });
    expect(captures.updates.find((u) => u.table === 'offers')?.set).toMatchObject({
      status: 'withdrawn',
    });
  });

  it('does NOT touch Bookings when withdrawing a pending Offer', async () => {
    const { db, captures } = makeDb({ message_threads: [threadRow()], offers: [offerRow()] });
    const app = buildApp(makeDeps(db));
    const res = await app.request(withdrawPath, post(await parentToken()));
    expect(res.status).toBe(200);
    expect(captures.updates.find((u) => u.table === 'bookings')).toBeUndefined();
  });
});

describe('POST /v1/offers/{id}/counter', () => {
  const counterBody = { proposedRateCents: 4500, schedule: { kind: 'one-off', slot: slot() } };

  it('200 opens a successor Offer linked via supersedes', async () => {
    const { db, captures } = makeDb({
      message_threads: [threadRow()],
      offers: [offerRow()],
      provider_category_rates: [rateRow()],
      provider_profiles: [{ negotiable: true }],
    });
    const app = buildApp(makeDeps(db));
    const res = await app.request(counterPath, post(await caregiverToken(), counterBody));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).status).toBe('pending');
    // old → countered, successor inserted with supersedes + inherited child detail.
    expect(captures.updates.find((u) => u.table === 'offers')?.set).toMatchObject({ status: 'countered' });
    const ins = captures.inserts.find((i) => i.table === 'offers');
    expect(ins?.values).toMatchObject({
      status: 'pending',
      supersedes_offer_id: OID,
      proposed_rate_cents: 4500,
      sender: 'caregiver',
      child_count: 1,
    });
  });

  it('409 when the Caregiver is non-negotiable (Counter is unavailable, ADR-0017)', async () => {
    const db = makeDb({
      message_threads: [threadRow()],
      offers: [offerRow({ negotiable: false })],
      provider_category_rates: [rateRow()],
      provider_profiles: [{ negotiable: false }],
    }).db;
    const app = buildApp(makeDeps(db));
    const res = await app.request(counterPath, post(await caregiverToken(), counterBody));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'counter_unavailable' });
  });

  it('409 when the sender tries to counter their own Offer', async () => {
    const db = makeDb({
      message_threads: [threadRow()],
      offers: [offerRow()],
      provider_category_rates: [rateRow()],
      provider_profiles: [{ negotiable: true }],
    }).db;
    const app = buildApp(makeDeps(db));
    const res = await app.request(counterPath, post(await parentToken(), counterBody));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_counterparty' });
  });
});
