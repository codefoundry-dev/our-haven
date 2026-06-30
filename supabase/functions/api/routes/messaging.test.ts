import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Table-routed Kysely fake for the messaging routes (OH-205). Selects resolve to
 * a table's canned rows (the routes apply no extra TS filtering, so one fixture
 * row per table is enough); inserts/updates are captured; the send write runs
 * inside the faked `transaction()`. Insert `returning(...).executeTakeFirstOrThrow`
 * yields a per-table canned row (a message gets {id, created_at}; a thread gets a
 * full row echoing its inserted values) so the get-or-create + send handlers can
 * build their responses.
 */
function makeDb(
  tables: Record<string, Record<string, unknown>[]> = {},
  opts: { insertedMessageId?: string; insertedThreadId?: string } = {},
) {
  const captures = {
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  };
  const NOW = '2026-07-08T00:00:00.000Z';
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
    if (t === 'messages') return { id: opts.insertedMessageId ?? 'msg-1', created_at: NOW };
    if (t === 'message_threads') {
      return {
        id: opts.insertedThreadId ?? 'thread-new',
        parent_uid: values.parent_uid,
        supply_uid: values.supply_uid,
        provider_id: values.provider_id,
        supply_role: values.supply_role,
        job_id: null,
        last_message_at: NOW,
        last_message_preview: null,
        last_message_redacted: false,
        created_at: NOW,
      };
    }
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
    const c: Record<string, unknown> = {
      set: (s: Record<string, unknown>) => {
        captures.updates.push({ table: t, set: s });
        return c;
      },
      where: () => c,
      returning: () => c,
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
  mintAccessToken({ sub: uid, appMetadata: { role: 'caregiver', categories: ['tutor'] } });
const providerToken = (uid = 'uid-prov') =>
  mintAccessToken({ sub: uid, appMetadata: { role: 'provider', specialty: 'slp', state: 'CA' } });

// ── fixtures ─────────────────────────────────────────────────────────────────
const PID = '11111111-1111-4111-8111-111111111111';
const TID = '22222222-2222-4222-8222-222222222222';
const MSG_PATH = `/v1/threads/${TID}/messages`;

const caregiverRow = (over: Record<string, unknown> = {}) => ({
  id: PID,
  uid: 'uid-cg',
  role: 'caregiver',
  ...over,
});
const listableVer = (over: Record<string, unknown> = {}) => ({
  provider_id: PID,
  phone_confirmed_at: '2026-06-01T00:00:00.000Z',
  screening_passed_at: '2026-06-01T00:00:00.000Z',
  license_verified_at: null,
  insurance_verified_at: null,
  rejected_at: null,
  ...over,
});
const threadRow = (over: Record<string, unknown> = {}) => ({
  id: TID,
  parent_uid: 'uid-par',
  supply_uid: 'uid-cg',
  provider_id: PID,
  supply_role: 'caregiver',
  job_id: null,
  last_message_at: '2026-07-08T00:00:00.000Z',
  last_message_preview: 'Earlier message',
  last_message_redacted: false,
  created_at: '2026-07-01T00:00:00.000Z',
  ...over,
});

/** A Caregiver a subscribed Parent can open a thread with. */
const openable = (over: Record<string, Record<string, unknown>[]> = {}) => ({
  providers: [caregiverRow()],
  provider_verifications: [listableVer()],
  provider_profiles: [{ provider_id: PID, display_name: 'Maya Okafor', paused: false }],
  parent_subscriptions: [{ status: 'active' }],
  message_threads: [],
  ...over,
});

const post = (token: string, body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const getReq = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });

// ── POST /v1/threads (open / get-or-create) ──────────────────────────────────
describe('POST /v1/threads', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps(makeDb(openable()).db));
    expect((await app.request('/v1/threads', { method: 'POST' })).status).toBe(401);
  });

  it('403 for a Caregiver (parent-only)', async () => {
    const app = buildApp(makeDeps(makeDb(openable()).db));
    expect((await app.request('/v1/threads', post(await caregiverToken(), { providerId: PID }))).status).toBe(403);
  });

  it('402 when the Parent has no active Subscription', async () => {
    const app = buildApp(makeDeps(makeDb(openable({ parent_subscriptions: [] })).db));
    const res = await app.request('/v1/threads', post(await parentToken(), { providerId: PID }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'subscription_required' });
  });

  it('404 when the supply member is unknown', async () => {
    const app = buildApp(makeDeps(makeDb(openable({ providers: [] })).db));
    expect((await app.request('/v1/threads', post(await parentToken(), { providerId: PID }))).status).toBe(404);
  });

  it('404 when the supply member is a Provider, not a Caregiver (ADR-0011)', async () => {
    const app = buildApp(makeDeps(makeDb(openable({ providers: [caregiverRow({ role: 'provider' })] })).db));
    expect((await app.request('/v1/threads', post(await parentToken(), { providerId: PID }))).status).toBe(404);
  });

  it('404 when the Caregiver is not listable (unverified phone)', async () => {
    const db = makeDb(openable({ provider_verifications: [listableVer({ phone_confirmed_at: null })] })).db;
    const app = buildApp(makeDeps(db));
    expect((await app.request('/v1/threads', post(await parentToken(), { providerId: PID }))).status).toBe(404);
  });

  it('404 when the Caregiver is paused', async () => {
    const db = makeDb(openable({ provider_profiles: [{ provider_id: PID, display_name: 'Maya Okafor', paused: true }] })).db;
    const app = buildApp(makeDeps(db));
    expect((await app.request('/v1/threads', post(await parentToken(), { providerId: PID }))).status).toBe(404);
  });

  it('200 creates a new thread for a subscribed Parent + listable Caregiver', async () => {
    const { db, captures } = makeDb(openable());
    const app = buildApp(makeDeps(db));
    const res = await app.request('/v1/threads', post(await parentToken(), { providerId: PID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: 'thread-new',
      providerId: PID,
      counterpartyName: 'Maya Okafor',
      counterpartyRole: 'caregiver',
      anchor: 'thread',
    });
    const ins = captures.inserts.find((i) => i.table === 'message_threads');
    expect(ins?.values).toMatchObject({
      parent_uid: 'uid-par',
      supply_uid: 'uid-cg',
      provider_id: PID,
      supply_role: 'caregiver',
    });
  });

  it('200 returns the existing thread (idempotent) without inserting', async () => {
    const { db, captures } = makeDb(openable({ message_threads: [threadRow()] }));
    const app = buildApp(makeDeps(db));
    const res = await app.request('/v1/threads', post(await parentToken(), { providerId: PID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: TID, providerId: PID });
    expect(captures.inserts.find((i) => i.table === 'message_threads')).toBeUndefined();
  });
});

// ── GET /v1/threads (inbox) ──────────────────────────────────────────────────
describe('GET /v1/threads', () => {
  it('parent inbox: counterparty is the Caregiver', async () => {
    const db = makeDb({
      message_threads: [threadRow()],
      provider_profiles: [{ provider_id: PID, display_name: 'Maya Okafor' }],
    }).db;
    const app = buildApp(makeDeps(db));
    const res = await app.request('/v1/threads', getReq(await parentToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { threads: Array<Record<string, unknown>> };
    expect(body.threads[0]).toMatchObject({
      id: TID,
      providerId: PID,
      counterpartyName: 'Maya Okafor',
      counterpartyRole: 'caregiver',
    });
  });

  it('caregiver inbox: counterparty is the Parent', async () => {
    const db = makeDb({
      message_threads: [threadRow()],
      profiles: [{ id: 'uid-par', first_name: 'Sam', last_name: 'Lee' }],
    }).db;
    const app = buildApp(makeDeps(db));
    const res = await app.request('/v1/threads', getReq(await caregiverToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { threads: Array<Record<string, unknown>> };
    expect(body.threads[0]).toMatchObject({
      id: TID,
      counterpartyName: 'Sam Lee',
      counterpartyRole: 'parent',
    });
  });

  it('provider inbox is empty in v1', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()] }).db));
    const res = await app.request('/v1/threads', getReq(await providerToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ threads: [] });
  });
});

// ── GET /v1/threads/{id}/messages (transcript) ───────────────────────────────
describe('GET /v1/threads/{threadId}/messages', () => {
  const msgRow = {
    id: 'm1',
    thread_id: TID,
    sender_uid: 'uid-cg',
    body: 'See you Wednesday.',
    redacted: false,
    created_at: '2026-07-07T10:00:00.000Z',
  };

  it('participant reads the transcript', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()], messages: [msgRow] }).db));
    const res = await app.request(MSG_PATH, getReq(await parentToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: Array<Record<string, unknown>> };
    expect(body.messages[0]).toMatchObject({ id: 'm1', threadId: TID, senderUid: 'uid-cg', body: 'See you Wednesday.', redacted: false });
  });

  it('404 for a non-participant (never reveal another thread)', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()], messages: [msgRow] }).db));
    const res = await app.request(MSG_PATH, getReq(await parentToken('uid-other')));
    expect(res.status).toBe(404);
  });

  it('404 when the thread is unknown', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [] }).db));
    expect((await app.request(MSG_PATH, getReq(await parentToken()))).status).toBe(404);
  });
});

// ── POST /v1/threads/{id}/messages (send + redaction) ────────────────────────
describe('POST /v1/threads/{threadId}/messages', () => {
  it('201 stores a clean body verbatim, unflagged, no T&S row', async () => {
    const { db, captures } = makeDb({ message_threads: [threadRow()], parent_subscriptions: [{ status: 'active' }] });
    const app = buildApp(makeDeps(db));
    const res = await app.request(MSG_PATH, post(await parentToken(), { body: 'See you Wednesday morning.' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ threadId: TID, senderUid: 'uid-par', body: 'See you Wednesday morning.', redacted: false });
    const msg = captures.inserts.find((i) => i.table === 'messages');
    expect(msg?.values).toMatchObject({ body: 'See you Wednesday morning.', redacted: false, sender_uid: 'uid-par' });
    expect(captures.inserts.find((i) => i.table === 'message_flags')).toBeUndefined();
    // The thread's last-activity denormalisation is bumped.
    expect(captures.updates.find((u) => u.table === 'message_threads')?.set).toMatchObject({ last_message_redacted: false });
  });

  it('201 redacts contact info before delivery and queues the unredacted original for T&S', async () => {
    const { db, captures } = makeDb({ message_threads: [threadRow()], parent_subscriptions: [{ status: 'active' }] });
    const app = buildApp(makeDeps(db));
    const original = 'call me at 415-555-1234 please';
    const res = await app.request(MSG_PATH, post(await parentToken(), { body: original }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { body: string; redacted: boolean };
    expect(body.redacted).toBe(true);
    expect(body.body).not.toContain('415-555-1234');
    expect(body.body).toContain('[redacted]');

    // The stored message body is the redacted text (Realtime broadcasts this row).
    const msg = captures.inserts.find((i) => i.table === 'messages');
    expect(msg?.values).toMatchObject({ redacted: true });
    expect(msg?.values.body).not.toContain('415-555-1234');

    // The Trust & Safety queue keeps the UNREDACTED original + categories.
    const flag = captures.inserts.find((i) => i.table === 'message_flags');
    expect(flag?.values).toMatchObject({ original_body: original, sender_uid: 'uid-par', thread_id: TID });
    expect(flag?.values.categories).toContain('phone');
    expect(captures.updates.find((u) => u.table === 'message_threads')?.set).toMatchObject({ last_message_redacted: true });
  });

  it('402 when a Parent without a Subscription sends', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()], parent_subscriptions: [] }).db));
    const res = await app.request(MSG_PATH, post(await parentToken(), { body: 'hi' }));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'subscription_required' });
  });

  it('201 for a Caregiver reply — supply replies are not Subscription-gated', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()], parent_subscriptions: [] }).db));
    const res = await app.request(MSG_PATH, post(await caregiverToken(), { body: 'Sounds good!' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ senderUid: 'uid-cg', redacted: false });
  });

  it('404 for a non-participant', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()] }).db));
    expect((await app.request(MSG_PATH, post(await parentToken('uid-other'), { body: 'hi' }))).status).toBe(404);
  });

  it('400 for a whitespace-only body', async () => {
    const app = buildApp(makeDeps(makeDb({ message_threads: [threadRow()], parent_subscriptions: [{ status: 'active' }] }).db));
    const res = await app.request(MSG_PATH, post(await parentToken(), { body: '   ' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'empty_message' });
  });
});
