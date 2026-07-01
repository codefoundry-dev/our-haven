import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Table-routed Kysely fake for the posted-Job routes (OH-209). Selects resolve
 * to a table's canned rows (the gate reads `parent_subscriptions.status`); a
 * `jobs` insert captures its values array and echoes each row back over an id +
 * `created_at` default so the handler can project the response DTO list.
 */
function makeDb(tables: Record<string, Record<string, unknown>[]> = {}) {
  const captures = {
    inserts: [] as Array<{ table: string; values: Record<string, unknown>[] }>,
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  };
  const NOW = '2026-07-11T00:00:00.000Z';

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

  const insertChain = (t: string) => {
    let captured: Record<string, unknown>[] = [];
    const c: Record<string, unknown> = {
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        captured = Array.isArray(v) ? v : [v];
        captures.inserts.push({ table: t, values: captured });
        return c;
      },
      returning: () => c,
      execute: async () =>
        captured.map((v, i) => ({ id: `job-${i}`, created_at: NOW, ...v })),
      executeTakeFirstOrThrow: async () => ({ id: 'job-0', created_at: NOW, ...captured[0] }),
    };
    return c;
  };

  // An `updateTable('jobs').returning(...)` echoes the fixture Job merged with the
  // new set values so the edit/close handlers can project the response DTO.
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
        t === 'jobs' ? { id: 'job-0', created_at: NOW, ...(tables.jobs?.[0] ?? {}), ...captured } : { id: 'x' },
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

const JOBS_PATH = '/v1/jobs';

const slot = (date = '2026-08-01', startMin = 1080, endMin = 1320) => ({ date, startMin, endMin });

const createBody = (over: Record<string, unknown> = {}) => ({
  category: 'babysitter',
  description: 'After-school care for two kids',
  childCount: 2,
  childAges: [4, 7],
  safetyBehaviors: [],
  serviceAddress: { line1: '12 Oak St', city: 'Austin', state: 'TX', postalCode: '78701' },
  budgetHintCents: 2500,
  disclosureConsent: true,
  schedule: { kind: 'one-off', slot: slot() },
  ...over,
});

/** Subscribed by default (the gate reads active|trialing). */
const subscribed = (over: Record<string, Record<string, unknown>[]> = {}) => ({
  parent_subscriptions: [{ status: 'active' }],
  ...over,
});

const post = (token: string, body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('POST /v1/jobs (compose + publish)', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps(makeDb(subscribed()).db));
    expect((await app.request(JOBS_PATH, { method: 'POST' })).status).toBe(401);
  });

  it('403 for a Caregiver (posting is Parent-side only)', async () => {
    const app = buildApp(makeDeps(makeDb(subscribed()).db));
    expect((await app.request(JOBS_PATH, post(await caregiverToken(), createBody()))).status).toBe(403);
  });

  it('402 when the Parent has no active Subscription', async () => {
    const app = buildApp(makeDeps(makeDb(subscribed({ parent_subscriptions: [] })).db));
    const res = await app.request(JOBS_PATH, post(await parentToken(), createBody()));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'subscription_required' });
  });

  it('400 when the disclosure consent is not acknowledged', async () => {
    const app = buildApp(makeDeps(makeDb(subscribed()).db));
    const res = await app.request(JOBS_PATH, post(await parentToken(), createBody({ disclosureConsent: false })));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'consent_required' });
  });

  it('400 when childAges length does not equal childCount', async () => {
    const app = buildApp(makeDeps(makeDb(subscribed()).db));
    const res = await app.request(JOBS_PATH, post(await parentToken(), createBody({ childCount: 2, childAges: [4] })));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_job' });
  });

  it('400 for a tutor Job with more than one child', async () => {
    const app = buildApp(makeDeps(makeDb(subscribed()).db));
    const res = await app.request(
      JOBS_PATH,
      post(await parentToken(), createBody({ category: 'tutor', childCount: 2, childAges: [8, 10] })),
    );
    expect(res.status).toBe(400);
  });

  it('201 publishes a one-off Job born open with a server-stamped consent', async () => {
    const { db, captures } = makeDb(subscribed());
    const app = buildApp(makeDeps(db));
    const res = await app.request(JOBS_PATH, post(await parentToken(), createBody({ safetyBehaviors: ['wandering'] })));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { jobs: Record<string, unknown>[] };
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]).toMatchObject({
      origin: 'posted',
      state: 'open',
      category: 'babysitter',
      childCount: 2,
      scheduleKind: 'one-off',
      safetyBehaviors: ['wandering'],
    });
    expect(body.jobs[0]!.disclosureConsentAt).toEqual(expect.any(String));
    const ins = captures.inserts.find((i) => i.table === 'jobs');
    expect(ins?.values[0]).toMatchObject({
      origin: 'posted',
      state: 'open',
      parent_uid: 'uid-par',
      provider_id: null,
      service_postal_code: '78701',
    });
    expect(ins?.values[0]!.disclosure_consent_at).toEqual(expect.any(String));
  });

  it('201 fans a multi-day one-off out into one Job per date (ADR-0014 §A1)', async () => {
    const { db, captures } = makeDb(subscribed());
    const app = buildApp(makeDeps(db));
    const res = await app.request(
      JOBS_PATH,
      post(
        await parentToken(),
        createBody({ schedule: { kind: 'multi-day', slots: [slot('2026-08-01'), slot('2026-08-05')] } }),
      ),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { jobs: Record<string, unknown>[] };
    expect(body.jobs).toHaveLength(2);
    expect(body.jobs.every((j) => j.scheduleKind === 'one-off')).toBe(true);
    const ins = captures.inserts.find((i) => i.table === 'jobs');
    expect(ins?.values).toHaveLength(2);
    expect((ins?.values ?? []).map((v) => (v.slots as { date: string }[])[0]!.date)).toEqual([
      '2026-08-01',
      '2026-08-05',
    ]);
  });

  it('201 publishes a single recurring Job carrying the rule', async () => {
    const { db, captures } = makeDb(subscribed());
    const app = buildApp(makeDeps(db));
    const rule = { startDate: '2026-08-01', endDate: '2026-09-30', weekdays: [2, 4], startMin: 900, endMin: 1020 };
    const res = await app.request(JOBS_PATH, post(await parentToken(), createBody({ schedule: { kind: 'recurring', rule } })));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { jobs: Record<string, unknown>[] };
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]).toMatchObject({ scheduleKind: 'recurring' });
    const ins = captures.inserts.find((i) => i.table === 'jobs');
    expect(ins?.values[0]).toMatchObject({ schedule_kind: 'recurring' });
    expect(ins?.values[0]!.recurrence).toMatchObject({ weekdays: [2, 4] });
  });

  it('400 for a recurrence that generates no dates in its range', async () => {
    const app = buildApp(makeDeps(makeDb(subscribed()).db));
    // A single-day range on a weekday the rule does not select → zero occurrences.
    const rule = { startDate: '2026-08-03', endDate: '2026-08-03', weekdays: [0], startMin: 900, endMin: 1020 };
    const res = await app.request(JOBS_PATH, post(await parentToken(), createBody({ schedule: { kind: 'recurring', rule } })));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_schedule' });
  });
});

// ── My Jobs hub / detail / edit / close (OH-210) ──────────────────────────────
const JID = '11111111-1111-4111-8111-111111111111';

/** A full posted-Job row (every JOB_COLUMNS field the DTO projects). */
const jobRow = (over: Record<string, unknown> = {}) => ({
  id: JID,
  parent_uid: 'uid-par',
  origin: 'posted',
  state: 'open',
  category: 'babysitter',
  description: 'After-school care for two kids',
  child_count: 2,
  child_ages: [4, 7],
  safety_behaviors: [],
  schedule_kind: 'one-off',
  slots: [slot()],
  recurrence: null,
  service_address_line1: '12 Oak St',
  service_address_line2: null,
  service_city: 'Austin',
  service_state: 'TX',
  service_postal_code: '78701',
  budget_hint_cents: 2500,
  disclosure_consent_at: '2026-07-10T00:00:00.000Z',
  created_at: '2026-07-10T00:00:00.000Z',
  ...over,
});

const getReq = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });
const patchReq = (token: string, body?: unknown): RequestInit => ({
  method: 'PATCH',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('GET /v1/jobs (My Jobs hub)', () => {
  it('401 without a token; 403 for a Caregiver', async () => {
    const app = buildApp(makeDeps(makeDb({ jobs: [jobRow()] }).db));
    expect((await app.request(JOBS_PATH, getReq(''))).status).toBe(401);
    expect((await app.request(JOBS_PATH, getReq(await caregiverToken()))).status).toBe(403);
  });

  it('200 returns the Parent\'s Jobs with the actionable Application count', async () => {
    const app = buildApp(
      makeDeps(
        makeDb({
          jobs: [jobRow()],
          applications: [
            { job_id: JID, state: 'submitted' },
            { job_id: JID, state: 'countered' },
            { job_id: JID, state: 'declined' }, // terminal → not counted
          ],
        }).db,
      ),
    );
    const res = await app.request(JOBS_PATH, getReq(await parentToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobs: Array<Record<string, unknown>> };
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]).toMatchObject({ id: JID, state: 'open', applicationCount: 2 });
  });
});

describe('GET /v1/jobs/{jobId} (Job detail)', () => {
  it('200 for the owner', async () => {
    const app = buildApp(makeDeps(makeDb({ jobs: [jobRow()] }).db));
    const res = await app.request(`/v1/jobs/${JID}`, getReq(await parentToken()));
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ id: JID, applicationCount: 0 });
  });

  it('404 for a non-owner', async () => {
    const app = buildApp(makeDeps(makeDb({ jobs: [jobRow()] }).db));
    expect((await app.request(`/v1/jobs/${JID}`, getReq(await parentToken('uid-other')))).status).toBe(404);
  });

  it('404 for an unknown Job', async () => {
    const app = buildApp(makeDeps(makeDb({ jobs: [] }).db));
    expect((await app.request(`/v1/jobs/${JID}`, getReq(await parentToken()))).status).toBe(404);
  });
});

describe('PATCH /v1/jobs/{jobId} (edit)', () => {
  const editPath = `/v1/jobs/${JID}`;

  it('200 edits an open Job in place (re-stamps consent)', async () => {
    const { db, captures } = makeDb({ jobs: [jobRow()], parent_subscriptions: [{ status: 'active' }] });
    const app = buildApp(makeDeps(db));
    const res = await app.request(editPath, patchReq(await parentToken(), createBody({ description: 'Revised scope' })));
    expect(res.status).toBe(200);
    const upd = captures.updates.find((u) => u.table === 'jobs');
    expect(upd?.set).toMatchObject({ description: 'Revised scope' });
    expect(upd?.set.disclosure_consent_at).toEqual(expect.any(String));
  });

  it('402 when the Parent has no active Subscription', async () => {
    const app = buildApp(makeDeps(makeDb({ jobs: [jobRow()], parent_subscriptions: [] }).db));
    expect((await app.request(editPath, patchReq(await parentToken(), createBody()))).status).toBe(402);
  });

  it('409 when the Job is no longer open', async () => {
    const app = buildApp(
      makeDeps(makeDb({ jobs: [jobRow({ state: 'awarded' })], parent_subscriptions: [{ status: 'active' }] }).db),
    );
    const res = await app.request(editPath, patchReq(await parentToken(), createBody()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not_editable' });
  });

  it('400 for a multi-day schedule (fan-out is compose-only)', async () => {
    const app = buildApp(
      makeDeps(makeDb({ jobs: [jobRow()], parent_subscriptions: [{ status: 'active' }] }).db),
    );
    const res = await app.request(
      editPath,
      patchReq(await parentToken(), createBody({ schedule: { kind: 'multi-day', slots: [slot(), slot('2026-08-05')] } })),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_schedule' });
  });

  it('404 for a non-owner', async () => {
    const app = buildApp(
      makeDeps(makeDb({ jobs: [jobRow()], parent_subscriptions: [{ status: 'active' }] }).db),
    );
    expect((await app.request(editPath, patchReq(await parentToken('uid-other'), createBody()))).status).toBe(404);
  });
});

describe('POST /v1/jobs/{jobId}/close', () => {
  const closePath = `/v1/jobs/${JID}/close`;

  it('200 closes an open Job and withdraws its open Applications', async () => {
    const { db, captures } = makeDb({ jobs: [jobRow()] });
    const app = buildApp(makeDeps(db));
    const res = await app.request(closePath, post(await parentToken()));
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ state: 'cancelled', applicationCount: 0 });
    expect(captures.updates.find((u) => u.table === 'jobs')?.set).toMatchObject({ state: 'cancelled' });
    // Open Applications are bulk-expired (story 92).
    expect(captures.updates.find((u) => u.table === 'applications')?.set).toMatchObject({ state: 'expired' });
  });

  it('409 when the Job is already awarded', async () => {
    const app = buildApp(makeDeps(makeDb({ jobs: [jobRow({ state: 'awarded' })] }).db));
    const res = await app.request(closePath, post(await parentToken()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'cannot_close' });
  });

  it('404 for a non-owner', async () => {
    const app = buildApp(makeDeps(makeDb({ jobs: [jobRow()] }).db));
    expect((await app.request(closePath, post(await parentToken('uid-other')))).status).toBe(404);
  });
});
