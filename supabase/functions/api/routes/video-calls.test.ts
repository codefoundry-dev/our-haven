import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Ad-hoc video-call routes (OH-216). Table-routed Kysely fake (mirrors
 * messaging.test.ts): selects resolve to a table's canned rows; the
 * video_call_links + messages inserts + the thread update run inside the faked
 * `transaction()`. A messages insert returns a FULL row (the route
 * `.returning(MESSAGE_COLUMNS)` → toMessage), a video_call_links insert returns
 * its new id. The Daily adapter is a recording fake (the Proxy stub can't be
 * awaited), so a start/join reaches a deterministic room + token.
 */
function makeDb(tables: Record<string, Record<string, unknown>[]> = {}) {
  const captures = {
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  };
  const NOW = '2026-07-12T00:00:00.000Z';
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
    if (t === 'video_call_links') return { id: 'call-1' };
    if (t === 'messages') {
      return {
        id: 'msg-1',
        thread_id: values.thread_id,
        sender_uid: values.sender_uid,
        body: values.body,
        redacted: values.redacted ?? false,
        kind: values.kind ?? 'text',
        video_call_link_id: values.video_call_link_id ?? null,
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

function makeDaily() {
  const calls = {
    rooms: [] as Array<{ expiresAt: Date }>,
    tokens: [] as Array<{ roomName: string; userId: string; isOwner?: boolean }>,
  };
  const daily = {
    createRoom: async (input: { expiresAt: Date }) => {
      calls.rooms.push(input);
      return { name: 'room-abc', url: 'https://ourhaven.daily.co/room-abc' };
    },
    createMeetingToken: async (input: { roomName: string; userId: string; isOwner?: boolean }) => {
      calls.tokens.push(input);
      return { token: `tok-${input.userId}${input.isOwner ? '-owner' : ''}` };
    },
  } as unknown as AppDeps['daily'];
  return { daily, calls };
}

function makeDeps(
  db: AppDeps['db'],
  over: { daily?: AppDeps['daily']; dailyKey?: string | undefined } = {},
): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  const env = buildTestEnv({ DAILY_API_KEY: 'dailyKey' in over ? over.dailyKey : 'sk_daily_test' });
  return {
    env,
    db,
    supabase: stub,
    stripe: stub,
    backgroundCheck: stub,
    daily: over.daily ?? (makeDaily().daily),
  };
}

const parentToken = (uid = 'uid-par') =>
  mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'parent' } });
const caregiverToken = (uid = 'uid-cg') =>
  mintAccessToken({ sub: uid, appMetadata: { role: 'caregiver', categories: ['tutor'] } });

// ── fixtures ─────────────────────────────────────────────────────────────────
const TID = '22222222-2222-4222-8222-222222222222';
const CALL_ID = '33333333-3333-4333-8333-333333333333';
const START_PATH = `/v1/threads/${TID}/calls`;
const JOIN_PATH = `/v1/calls/${CALL_ID}/join`;

const threadRow = (over: Record<string, unknown> = {}) => ({
  id: TID,
  parent_uid: 'uid-par',
  supply_uid: 'uid-cg',
  ...over,
});
const callRow = (over: Record<string, unknown> = {}) => ({
  id: CALL_ID,
  thread_id: TID,
  initiator_uid: 'uid-par',
  daily_room_name: 'room-abc',
  daily_room_url: 'https://ourhaven.daily.co/room-abc',
  expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  ...over,
});

const post = (token: string): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
});

// ── POST /v1/threads/{threadId}/calls (start) ─────────────────────────────────
describe('POST /v1/threads/{threadId}/calls', () => {
  it('401 without a token', async () => {
    const { db } = makeDb();
    const app = buildApp(makeDeps(db));
    const res = await app.request(START_PATH, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('starts a call (Parent), logs the link, and posts a video_call poke', async () => {
    const { db, captures } = makeDb({
      message_threads: [threadRow()],
      parent_subscriptions: [{ status: 'active' }],
    });
    const { daily, calls } = makeDaily();
    const app = buildApp(makeDeps(db, { daily }));
    const res = await app.request(START_PATH, post(await parentToken()));

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      call: { callId: string; roomUrl: string; token: string; expiresAt: string };
      message: { kind: string; videoCallLinkId: string; senderUid: string };
    };
    expect(body.call).toMatchObject({
      callId: 'call-1',
      roomUrl: 'https://ourhaven.daily.co/room-abc',
      token: 'tok-uid-par-owner',
    });
    expect(typeof body.call.expiresAt).toBe('string');
    // The poke is a video_call message referencing the generated link.
    expect(body.message).toMatchObject({
      kind: 'video_call',
      videoCallLinkId: 'call-1',
      senderUid: 'uid-par',
    });

    // The initiator joins as owner; the room carries an expiry.
    expect(calls.tokens[0]).toMatchObject({ roomName: 'room-abc', userId: 'uid-par', isOwner: true });
    expect(calls.rooms[0]?.expiresAt).toBeInstanceOf(Date);

    // Audit row: initiator + both participants.
    const audit = captures.inserts.find((i) => i.table === 'video_call_links');
    expect(audit?.values).toMatchObject({ initiator_uid: 'uid-par', thread_id: TID });
    expect(audit?.values.participant_uids).toEqual(['uid-par', 'uid-cg']);
    // The poke message insert.
    const poke = captures.inserts.find((i) => i.table === 'messages');
    expect(poke?.values).toMatchObject({ kind: 'video_call', sender_uid: 'uid-par', video_call_link_id: 'call-1' });
  });

  it('lets the supply side (Caregiver) start a call — not gated', async () => {
    const { db } = makeDb({ message_threads: [threadRow()] }); // no parent_subscriptions needed
    const app = buildApp(makeDeps(db));
    const res = await app.request(START_PATH, post(await caregiverToken()));
    expect(res.status).toBe(201);
  });

  it('404 when the caller is not a participant of the thread', async () => {
    const { db } = makeDb({ message_threads: [threadRow()] });
    const app = buildApp(makeDeps(db));
    const res = await app.request(START_PATH, post(await parentToken('uid-stranger')));
    expect(res.status).toBe(404);
  });

  it('402 when the Parent has no active Subscription', async () => {
    const { db } = makeDb({
      message_threads: [threadRow()],
      parent_subscriptions: [{ status: 'canceled' }],
    });
    const app = buildApp(makeDeps(db));
    const res = await app.request(START_PATH, post(await parentToken()));
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'subscription_required' });
  });

  it('503 when video is not configured (DAILY_API_KEY unset)', async () => {
    const { db } = makeDb({
      message_threads: [threadRow()],
      parent_subscriptions: [{ status: 'active' }],
    });
    const app = buildApp(makeDeps(db, { dailyKey: undefined }));
    const res = await app.request(START_PATH, post(await parentToken()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'not_configured' });
  });
});

// ── POST /v1/calls/{callId}/join ──────────────────────────────────────────────
describe('POST /v1/calls/{callId}/join', () => {
  it('mints a fresh participant token for a live call', async () => {
    const { db } = makeDb({
      video_call_links: [callRow()],
      message_threads: [threadRow()],
      parent_subscriptions: [{ status: 'active' }],
    });
    const app = buildApp(makeDeps(db));
    const res = await app.request(JOIN_PATH, post(await caregiverToken()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      callId: CALL_ID,
      roomUrl: 'https://ourhaven.daily.co/room-abc',
      token: 'tok-uid-cg', // caregiver is not the initiator → not owner
    });
  });

  it('410 once the call has expired', async () => {
    const { db } = makeDb({
      video_call_links: [callRow({ expires_at: new Date(Date.now() - 60_000).toISOString() })],
      message_threads: [threadRow()],
      parent_subscriptions: [{ status: 'active' }],
    });
    const app = buildApp(makeDeps(db));
    const res = await app.request(JOIN_PATH, post(await parentToken()));
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: 'call_expired' });
  });

  it('404 when the caller is not a participant of the call\'s thread', async () => {
    const { db } = makeDb({
      video_call_links: [callRow()],
      message_threads: [threadRow()],
    });
    const app = buildApp(makeDeps(db));
    const res = await app.request(JOIN_PATH, post(await caregiverToken('uid-stranger')));
    expect(res.status).toBe(404);
  });

  it('404 when the call is unknown', async () => {
    const { db } = makeDb({ video_call_links: [] });
    const app = buildApp(makeDeps(db));
    const res = await app.request(JOIN_PATH, post(await parentToken()));
    expect(res.status).toBe(404);
  });
});
