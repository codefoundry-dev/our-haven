import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Fake for the notifications registration + preferences routes (OH-223). Each
 * route is a single statement (upsert / delete / select) — no transaction — so
 * the fake just records inserts + deletes and serves a seeded preferences row.
 */
function makeDb(opts: { prefsRow?: { marketing_opt_in: boolean } } = {}) {
  const captures = {
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    deletes: [] as Array<{ table: string; wheres: Array<[string, string, unknown]> }>,
  };

  const insertChain = (table: string) => {
    const b: Record<string, unknown> = {};
    let captured: Record<string, unknown> = {};
    Object.assign(b, {
      values: (values: Record<string, unknown>) => {
        captured = values;
        return b;
      },
      onConflict: () => b,
      returning: () => b,
      returningAll: () => b,
      execute: async () => {
        captures.inserts.push({ table, values: captured });
        return [];
      },
    });
    return b;
  };

  const deleteChain = (table: string) => {
    const wheres: Array<[string, string, unknown]> = [];
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      where: (col: string, op: string, val: unknown) => {
        wheres.push([col, op, val]);
        return b;
      },
      execute: async () => {
        captures.deletes.push({ table, wheres });
        return [];
      },
    });
    return b;
  };

  const selectChain = () => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      where: () => b,
      executeTakeFirst: async () => opts.prefsRow,
    });
    return b;
  };

  const db = {
    insertInto: (table: string) => insertChain(table),
    deleteFrom: (table: string) => deleteChain(table),
    selectFrom: () => selectChain(),
  } as unknown as AppDeps['db'];

  return { db, captures };
}

function makeDeps(db: AppDeps['db']): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return { env: buildTestEnv(), db, supabase: stub, stripe: stub, backgroundCheck: stub, daily: stub };
}

const UID = '11111111-1111-4111-8111-111111111111';

async function bearer(role: string = 'caregiver'): Promise<Record<string, string>> {
  const token = await mintAccessToken({ sub: UID, appMetadata: { role } });
  return { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

const body = (payload: unknown, method: string, headers: Record<string, string>): RequestInit => ({
  method,
  headers,
  body: JSON.stringify(payload),
});

describe('notifications registration + preferences', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps(makeDb().db));
    const res = await app.request('/v1/notifications/push-tokens', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expoPushToken: 'ExponentPushToken[abc]', platform: 'ios' }),
    });
    expect(res.status).toBe(401);
  });

  it('PUT push-tokens upserts the caller uid + token + platform', async () => {
    const { db, captures } = makeDb();
    const app = buildApp(makeDeps(db));
    const res = await app.request(
      '/v1/notifications/push-tokens',
      body({ expoPushToken: 'ExponentPushToken[abc]', platform: 'android' }, 'PUT', await bearer()),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const insert = captures.inserts.find((i) => i.table === 'notification_push_tokens');
    expect(insert?.values).toMatchObject({
      uid: UID,
      expo_push_token: 'ExponentPushToken[abc]',
      platform: 'android',
    });
  });

  it('400 on an empty token / bad platform', async () => {
    const app = buildApp(makeDeps(makeDb().db));
    const bad = await app.request(
      '/v1/notifications/push-tokens',
      body({ expoPushToken: '', platform: 'ios' }, 'PUT', await bearer()),
    );
    expect(bad.status).toBe(400);
    const badPlatform = await app.request(
      '/v1/notifications/push-tokens',
      body({ expoPushToken: 'ExponentPushToken[abc]', platform: 'desktop' }, 'PUT', await bearer()),
    );
    expect(badPlatform.status).toBe(400);
  });

  it('DELETE push-tokens scopes the delete to token AND uid', async () => {
    const { db, captures } = makeDb();
    const app = buildApp(makeDeps(db));
    const res = await app.request(
      '/v1/notifications/push-tokens',
      body({ expoPushToken: 'ExponentPushToken[abc]' }, 'DELETE', await bearer()),
    );
    expect(res.status).toBe(200);

    const del = captures.deletes.find((d) => d.table === 'notification_push_tokens');
    expect(del?.wheres).toContainEqual(['expo_push_token', '=', 'ExponentPushToken[abc]']);
    expect(del?.wheres).toContainEqual(['uid', '=', UID]);
  });

  it('PUT web-push upserts the subscription', async () => {
    const { db, captures } = makeDb();
    const app = buildApp(makeDeps(db));
    const res = await app.request(
      '/v1/notifications/web-push',
      body(
        { endpoint: 'https://push.example.com/x', p256dh: 'key1', auth: 'key2' },
        'PUT',
        await bearer('provider'),
      ),
    );
    expect(res.status).toBe(200);
    const insert = captures.inserts.find((i) => i.table === 'notification_web_push_subscriptions');
    expect(insert?.values).toMatchObject({ uid: UID, endpoint: 'https://push.example.com/x' });
  });

  it('GET preferences defaults to marketingOptIn=false with no row', async () => {
    const app = buildApp(makeDeps(makeDb().db));
    const res = await app.request('/v1/notifications/preferences', { headers: await bearer() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marketingOptIn: false });
  });

  it('GET preferences reflects a stored opt-in', async () => {
    const app = buildApp(makeDeps(makeDb({ prefsRow: { marketing_opt_in: true } }).db));
    const res = await app.request('/v1/notifications/preferences', { headers: await bearer('parent') });
    expect(await res.json()).toEqual({ marketingOptIn: true });
  });

  it('PUT preferences upserts + echoes the value', async () => {
    const { db, captures } = makeDb();
    const app = buildApp(makeDeps(db));
    const res = await app.request(
      '/v1/notifications/preferences',
      body({ marketingOptIn: true }, 'PUT', await bearer('parent')),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ marketingOptIn: true });
    const insert = captures.inserts.find((i) => i.table === 'notification_preferences');
    expect(insert?.values).toMatchObject({ uid: UID, marketing_opt_in: true });
  });
});
