import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Table-routed Kysely fake for the Caregiver Opportunities routes (OH-218/OH-219).
 * Every `selectFrom(t)` resolves to `tables[t]`'s canned rows; `.where()` /
 * `.orderBy()` are NO-OPS (SQL-level filtering — state/origin/category/created_at —
 * is the real DB's job, so these tests exercise only the in-JS logic: category
 * resolution, the visibility rule, ranking, the quota math, and the apply/withdraw
 * gates + materialisation). Inserts/updates are CAPTURED and the transaction runs
 * the callback against the same handle; an insert `returning(…)` echoes the
 * captured values over an id (+ Application/Offer defaults) so the handler can
 * project its DTO.
 */
function makeDb(tables: Record<string, Record<string, unknown>[]> = {}) {
  const captures = {
    inserts: [] as Array<{ table: string; values: Record<string, unknown> | Record<string, unknown>[] }>,
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  };
  const NOW = '2026-07-15T00:00:00.000Z';

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
    if (t === 'applications') {
      return { id: 'application-new', accepted_offer_id: null, awarded_at: null, created_at: NOW, ...values };
    }
    return { id: `${t}-new`, ...values };
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
    const c: Record<string, unknown> = {
      set: (s: Record<string, unknown>) => {
        captures.updates.push({ table: t, set: s });
        return c;
      },
      where: () => c,
      returning: () => c,
      executeTakeFirstOrThrow: async () => ({ id: 'x' }),
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
  return { env: buildTestEnv(), db, supabase: stub, stripe: stub, backgroundCheck: stub, daily: stub };
}

const caregiverToken = (uid = 'uid-cg') =>
  mintAccessToken({ sub: uid, appMetadata: { role: 'caregiver', categories: ['babysitter'] } });
const parentToken = (uid = 'uid-par') =>
  mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'parent' } });

const getReq = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });

const JID = '11111111-1111-4111-8111-111111111111';
const FEED = '/v1/opportunities';
const APPS = '/v1/applications';

/** The caller's supply row (id + offered categories). */
const provider = (categories: string[] = ['babysitter'], id = 'prov-1') => ({ id, categories });

/** A posted, open Job row carrying every field the Caregiver DTO projects. */
const oppJobRow = (over: Record<string, unknown> = {}) => ({
  id: JID,
  origin: 'posted',
  state: 'open',
  category: 'babysitter',
  description: 'After-school care for two kids',
  child_count: 2,
  child_ages: [4, 7],
  safety_behaviors: ['wandering'],
  schedule_kind: 'one-off',
  slots: [{ date: '2026-08-01', startMin: 1080, endMin: 1320 }],
  recurrence: null,
  budget_hint_cents: 2500,
  service_city: 'Austin',
  service_state: 'TX',
  service_postal_code: '78701',
  created_at: '2026-06-01T00:00:00.000Z', // >7d before now → recency 0 (deterministic ranking)
  ...over,
});

describe('GET /v1/opportunities (feed)', () => {
  it('401 without a token; 403 for a Parent', async () => {
    const app = buildApp(makeDeps(makeDb({ providers: [provider()] }).db));
    expect((await app.request(FEED, getReq(''))).status).toBe(401);
    expect((await app.request(FEED, getReq(await parentToken()))).status).toBe(403);
  });

  it('404 when the caller has not claimed a supply role', async () => {
    const app = buildApp(makeDeps(makeDb({ providers: [] }).db));
    const res = await app.request(FEED, getReq(await caregiverToken()));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'provider_not_found' });
  });

  it('200 returns in-category Jobs; exposes area + no street', async () => {
    const app = buildApp(
      makeDeps(makeDb({ providers: [provider()], jobs: [oppJobRow()] }).db),
    );
    const res = await app.request(FEED, getReq(await caregiverToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobs: Array<Record<string, unknown>> };
    expect(body.jobs).toHaveLength(1);
    const job = body.jobs[0]!;
    expect(job).toMatchObject({ id: JID, category: 'babysitter', childCount: 2 });
    // Location carries city/state/ZIP + area label, never a street line.
    expect(job.location).toMatchObject({ city: 'Austin', state: 'TX', postalCode: '78701' });
    expect(JSON.stringify(job)).not.toContain('line1');
    expect(JSON.stringify(job)).not.toContain('Oak St');
  });

  it('empty feed when the requested category is not one the Caregiver offers', async () => {
    const app = buildApp(
      makeDeps(makeDb({ providers: [provider(['tutor'])], jobs: [oppJobRow()] }).db),
    );
    const res = await app.request(`${FEED}?category=babysitter`, getReq(await caregiverToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobs: [] });
  });

  it('distance is null without a Caregiver ZIP, a number once both ZIPs resolve', async () => {
    const noZip = buildApp(makeDeps(makeDb({ providers: [provider()], jobs: [oppJobRow()] }).db));
    const a = (await (await noZip.request(FEED, getReq(await caregiverToken()))).json()) as {
      jobs: Array<{ location: { distanceMiles: number | null } }>;
    };
    expect(a.jobs[0]!.location.distanceMiles).toBeNull();

    const withZip = buildApp(
      makeDeps(
        makeDb({
          providers: [provider()],
          provider_profiles: [{ zip: '78704' }], // ~2 mi from the Job's 78701
          jobs: [oppJobRow()],
        }).db,
      ),
    );
    const b = (await (await withZip.request(FEED, getReq(await caregiverToken()))).json()) as {
      jobs: Array<{ location: { distanceMiles: number | null } }>;
    };
    expect(typeof b.jobs[0]!.location.distanceMiles).toBe('number');
    expect(b.jobs[0]!.location.distanceMiles!).toBeGreaterThan(0);
  });

  it('ranks nearer Jobs above farther ones (recency tie → proximity decides)', async () => {
    const app = buildApp(
      makeDeps(
        makeDb({
          providers: [provider()],
          provider_profiles: [{ zip: '78701' }], // Austin
          jobs: [
            oppJobRow({ id: 'job-far', service_postal_code: '10001' }), // NYC, far — seeded first
            oppJobRow({ id: 'job-near', service_postal_code: '78704' }), // Austin, near
          ],
        }).db,
      ),
    );
    const res = await app.request(FEED, getReq(await caregiverToken()));
    const body = (await res.json()) as { jobs: Array<{ id: string }> };
    expect(body.jobs.map((j) => j.id)).toEqual(['job-near', 'job-far']);
  });

  it('folds in the actionable applicant count + my own Application state', async () => {
    const app = buildApp(
      makeDeps(
        makeDb({
          providers: [provider()],
          jobs: [oppJobRow()],
          applications: [
            { job_id: JID, provider_id: 'p-a', state: 'submitted' }, // counts
            { job_id: JID, provider_id: 'p-b', state: 'countered' }, // counts
            { job_id: JID, provider_id: 'p-c', state: 'declined' }, // terminal → not counted
            { job_id: JID, provider_id: 'prov-1', state: 'awarded' }, // mine; awarded not in cap count
          ],
        }).db,
      ),
    );
    const res = await app.request(FEED, getReq(await caregiverToken()));
    const body = (await res.json()) as { jobs: Array<Record<string, unknown>> };
    expect(body.jobs[0]).toMatchObject({ applicantCount: 2, myApplicationState: 'awarded' });
  });
});

describe('GET /v1/opportunities/{jobId} (detail)', () => {
  it('200 for an in-category posted Job', async () => {
    const app = buildApp(makeDeps(makeDb({ providers: [provider()], jobs: [oppJobRow()] }).db));
    const res = await app.request(`${FEED}/${JID}`, getReq(await caregiverToken()));
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ id: JID, category: 'babysitter' });
  });

  it('404 for a Direct-Message Job (plumbing, never surfaced)', async () => {
    const app = buildApp(
      makeDeps(makeDb({ providers: [provider()], jobs: [oppJobRow({ origin: 'direct-message' })] }).db),
    );
    expect((await app.request(`${FEED}/${JID}`, getReq(await caregiverToken()))).status).toBe(404);
  });

  it('404 for a Job outside my categories that I have not applied to', async () => {
    const app = buildApp(
      makeDeps(makeDb({ providers: [provider(['tutor'])], jobs: [oppJobRow({ category: 'babysitter' })] }).db),
    );
    expect((await app.request(`${FEED}/${JID}`, getReq(await caregiverToken()))).status).toBe(404);
  });

  it('200 for a cross-category Job I have applied to (My Applications tap-through)', async () => {
    const app = buildApp(
      makeDeps(
        makeDb({
          providers: [provider(['tutor'])],
          jobs: [oppJobRow({ category: 'babysitter' })],
          applications: [{ job_id: JID, provider_id: 'prov-1', state: 'submitted' }],
        }).db,
      ),
    );
    const res = await app.request(`${FEED}/${JID}`, getReq(await caregiverToken()));
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ myApplicationState: 'submitted' });
  });

  it('404 for an unknown Job', async () => {
    const app = buildApp(makeDeps(makeDb({ providers: [provider()], jobs: [] }).db));
    expect((await app.request(`${FEED}/${JID}`, getReq(await caregiverToken()))).status).toBe(404);
  });
});

describe('GET /v1/applications (My Applications + quota)', () => {
  it('403 for a Parent; 404 without a supply row', async () => {
    expect((await buildApp(makeDeps(makeDb().db)).request(APPS, getReq(await parentToken()))).status).toBe(403);
    const noProv = buildApp(makeDeps(makeDb({ providers: [] }).db));
    expect((await noProv.request(APPS, getReq(await caregiverToken()))).status).toBe(404);
  });

  it('empty list + 0/30 quota when the Caregiver has no Applications yet', async () => {
    const app = buildApp(makeDeps(makeDb({ providers: [provider()], applications: [] }).db));
    const res = await app.request(APPS, getReq(await caregiverToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      applications: [],
      quota: { used: 0, cap: 30, remaining: 30, periodYearMonth: expect.any(String) },
    });
  });

  it('lists Applications with a Job summary and counts only THIS month toward the quota', async () => {
    const nowIso = new Date().toISOString();
    const lastMonthIso = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const app = buildApp(
      makeDeps(
        makeDb({
          providers: [provider()],
          jobs: [oppJobRow()],
          applications: [
            { id: 'a1', job_id: JID, provider_id: 'prov-1', origin: 'posted', state: 'submitted', accepted_offer_id: null, proposal: 'Keen to help', awarded_at: null, created_at: nowIso },
            { id: 'a2', job_id: JID, provider_id: 'prov-1', origin: 'posted', state: 'countered', accepted_offer_id: null, proposal: null, awarded_at: null, created_at: nowIso },
            { id: 'a3', job_id: JID, provider_id: 'prov-1', origin: 'posted', state: 'declined', accepted_offer_id: null, proposal: null, awarded_at: null, created_at: lastMonthIso },
          ],
        }).db,
      ),
    );
    const res = await app.request(APPS, getReq(await caregiverToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      applications: Array<Record<string, unknown>>;
      quota: { used: number; cap: number; remaining: number };
    };
    expect(body.applications).toHaveLength(3);
    expect(body.applications[0]).toMatchObject({ id: 'a1', state: 'submitted', proposal: 'Keen to help' });
    expect(body.applications[0]!.job).toMatchObject({ id: JID, category: 'babysitter' });
    // Two filed this month, one 60 days ago → used 2, remaining 28.
    expect(body.quota).toMatchObject({ used: 2, cap: 30, remaining: 28 });
  });
});

/* ── OH-219: apply + withdraw ──────────────────────────────────────────────────── */

const APPLY = `${FEED}/${JID}/apply`;
const WITHDRAW = `${FEED}/${JID}/withdraw`;

const cleared = (id = 'prov-1') => ({
  provider_id: id,
  screening_passed_at: '2026-06-01T00:00:00.000Z',
  rejected_at: null,
});
const rateRow = (over: Record<string, unknown> = {}) => ({
  published_rate_cents: 2500,
  per_child_surcharge_cents: 500,
  ...over,
});
const profileRow = (over: Record<string, unknown> = {}) => ({ negotiable: true, zip: '78701', ...over });
const applyBody = (over: Record<string, unknown> = {}) => ({ proposal: 'I can help after school', ...over });

const postJson = (token: string, body: unknown): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});
const post = (token: string): RequestInit => ({ method: 'POST', headers: { authorization: `Bearer ${token}` } });

describe('POST /v1/opportunities/{jobId}/apply', () => {
  const baseTables = (): Record<string, Record<string, unknown>[]> => ({
    providers: [provider()],
    provider_verifications: [cleared()],
    provider_category_rates: [rateRow()],
    provider_profiles: [profileRow()],
    jobs: [oppJobRow()],
    applications: [],
  });

  it('401 without a token; 403 for a Parent', async () => {
    const app = buildApp(makeDeps(makeDb(baseTables()).db));
    expect((await app.request(APPLY, postJson('', applyBody()))).status).toBe(401);
    expect((await app.request(APPLY, postJson(await parentToken(), applyBody()))).status).toBe(403);
  });

  it('403 when the Caregiver Verification is not cleared', async () => {
    const t = baseTables();
    t.provider_verifications = [{ provider_id: 'prov-1', screening_passed_at: null, rejected_at: null }];
    const res = await buildApp(makeDeps(makeDb(t).db)).request(APPLY, postJson(await caregiverToken(), applyBody()));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'verification_not_cleared' });
  });

  it('404 for a Job outside my categories', async () => {
    const t = baseTables();
    t.providers = [provider(['tutor'])];
    expect(
      (await buildApp(makeDeps(makeDb(t).db)).request(APPLY, postJson(await caregiverToken(), applyBody()))).status,
    ).toBe(404);
  });

  it('409 when the Job is not open', async () => {
    const t = baseTables();
    t.jobs = [oppJobRow({ state: 'awarded' })];
    const res = await buildApp(makeDeps(makeDb(t).db)).request(APPLY, postJson(await caregiverToken(), applyBody()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'job_not_open' });
  });

  it('409 when no Rate is published for the category', async () => {
    const t = baseTables();
    t.provider_category_rates = [];
    const res = await buildApp(makeDeps(makeDb(t).db)).request(APPLY, postJson(await caregiverToken(), applyBody()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'rate_not_published' });
  });

  it('201 files the Application + first Offer (job-anchored); redacts the proposal to T&S', async () => {
    const { db, captures } = makeDb(baseTables());
    const res = await buildApp(makeDeps(db)).request(
      APPLY,
      postJson(await caregiverToken(), applyBody({ proposal: 'call me at 415-555-1234' })),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ state: 'submitted', origin: 'posted' });

    const tables = captures.inserts.map((i) => i.table);
    expect(tables).toEqual(expect.arrayContaining(['message_threads', 'offers', 'applications']));
    const offer = captures.inserts.find((i) => i.table === 'offers')!.values as Record<string, unknown>;
    expect(offer).toMatchObject({ sender: 'caregiver', status: 'pending', job_id: JID });
    const appIns = captures.inserts.find((i) => i.table === 'applications')!.values as Record<string, unknown>;
    expect(appIns.proposal_redacted).toBe(true);
    expect(appIns.proposal).not.toContain('415-555-1234');
    // The unredacted proposal is queued to T&S keyed by application_id (OH-219).
    expect(
      captures.inserts.some((i) => i.table === 'message_flags' && 'application_id' in (i.values as object)),
    ).toBe(true);
  });

  it('locks the rate to the published Rate when the Caregiver is non-negotiable (ADR-0017)', async () => {
    const t = baseTables();
    t.provider_profiles = [profileRow({ negotiable: false })];
    const { db, captures } = makeDb(t);
    const res = await buildApp(makeDeps(db)).request(
      APPLY,
      postJson(await caregiverToken(), applyBody({ proposedRateCents: 9999 })),
    );
    expect(res.status).toBe(201);
    const offer = captures.inserts.find((i) => i.table === 'offers')!.values as Record<string, unknown>;
    expect(offer.proposed_rate_cents).toBe(2500); // published, not the 9999 sent
  });

  it('409 job_application_cap_reached at 15 actionable Applications', async () => {
    const t = baseTables();
    t.applications = Array.from({ length: 15 }, (_, i) => ({
      job_id: JID,
      provider_id: `p-${i}`,
      state: 'submitted',
      origin: 'posted',
      created_at: '2026-06-01T00:00:00.000Z',
    }));
    const res = await buildApp(makeDeps(makeDb(t).db)).request(APPLY, postJson(await caregiverToken(), applyBody()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'job_application_cap_reached' });
  });

  it('409 monthly_cap_reached at 30 filed this month (withdrawn still consume the allowance)', async () => {
    const t = baseTables();
    // 30 withdrawn → none count toward the per-Job cap, all 30 toward the monthly cap.
    t.applications = Array.from({ length: 30 }, (_, i) => ({
      job_id: `j-${i}`,
      provider_id: 'prov-1',
      state: 'withdrawn',
      origin: 'posted',
      created_at: new Date().toISOString(),
    }));
    const res = await buildApp(makeDeps(makeDb(t).db)).request(APPLY, postJson(await caregiverToken(), applyBody()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'monthly_cap_reached' });
  });

  it('409 already_applied when an Application already exists on the Job', async () => {
    const t = baseTables();
    t.applications = [
      { job_id: JID, provider_id: 'prov-1', state: 'submitted', origin: 'posted', created_at: '2026-06-01T00:00:00.000Z' },
    ];
    const res = await buildApp(makeDeps(makeDb(t).db)).request(APPLY, postJson(await caregiverToken(), applyBody()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'already_applied' });
  });
});

describe('POST /v1/opportunities/{jobId}/withdraw', () => {
  it('404 without an Application on the Job', async () => {
    const app = buildApp(makeDeps(makeDb({ providers: [provider()], applications: [] }).db));
    expect((await app.request(WITHDRAW, post(await caregiverToken()))).status).toBe(404);
  });

  it('409 when the Application is already terminal', async () => {
    const app = buildApp(
      makeDeps(
        makeDb({
          providers: [provider()],
          applications: [{ id: 'a1', job_id: JID, provider_id: 'prov-1', origin: 'posted', state: 'awarded' }],
        }).db,
      ),
    );
    const res = await app.request(WITHDRAW, post(await caregiverToken()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_withdrawable' });
  });

  it('200 withdraws a submitted Application + seals the live pending Offer', async () => {
    const { db, captures } = makeDb({
      providers: [provider()],
      applications: [
        {
          id: 'a1',
          job_id: JID,
          provider_id: 'prov-1',
          origin: 'posted',
          state: 'submitted',
          accepted_offer_id: null,
          proposal: 'hi',
          awarded_at: null,
          created_at: '2026-07-01T00:00:00.000Z',
        },
      ],
      message_threads: [{ id: 'thread-1' }],
      offers: [{ id: 'offer-1', status: 'pending' }],
      jobs: [oppJobRow()],
    });
    const res = await buildApp(makeDeps(db)).request(WITHDRAW, post(await caregiverToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'a1', state: 'withdrawn' });
    expect(captures.updates.some((u) => u.table === 'applications' && u.set.state === 'withdrawn')).toBe(true);
    expect(captures.updates.some((u) => u.table === 'offers' && u.set.status === 'withdrawn')).toBe(true);
  });
});
