import { describe, expect, it, vi } from 'vitest';

import { createExpoPushAdapter, type ExpoPushMessage } from './expo-push.ts';

/** A fetch stub that records calls and returns canned JSON. */
function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const call = () => {
    const c = calls[0];
    if (!c) throw new Error('expected the adapter to make a fetch call');
    return c;
  };
  return { impl, calls, call };
}

const MSG: ExpoPushMessage = {
  to: 'ExponentPushToken[aaa]',
  title: 'New booking request',
  body: 'Alex sent a booking request.',
  data: { kind: 'booking_request_received', route: 'ourhaven://schedule/booking/b-1' },
};

describe('createExpoPushAdapter', () => {
  it('POSTs the batch to the Expo endpoint and returns tickets', async () => {
    const { impl, call } = fakeFetch({ data: [{ status: 'ok', id: 'r-1' }] });
    const result = await createExpoPushAdapter({ fetchImpl: impl, accessToken: 'tok' }).sendPush([MSG]);

    expect(call().url).toBe('https://exp.host/--/api/v2/push/send');
    expect(call().init.method).toBe('POST');
    const headers = call().init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(call().init.body))).toEqual([MSG]);
    expect(result.tickets).toEqual([{ status: 'ok', id: 'r-1' }]);
    expect(result.invalidTokens).toEqual([]);
  });

  it('omits the Authorization header when no access token is configured', async () => {
    const { impl, call } = fakeFetch({ data: [{ status: 'ok' }] });
    await createExpoPushAdapter({ fetchImpl: impl }).sendPush([MSG]);
    const headers = call().init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('surfaces DeviceNotRegistered tokens for pruning', async () => {
    const { impl } = fakeFetch({
      data: [
        { status: 'ok', id: 'r-1' },
        { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      ],
    });
    const result = await createExpoPushAdapter({ fetchImpl: impl }).sendPush([
      MSG,
      { ...MSG, to: 'ExponentPushToken[bbb]' },
    ]);
    expect(result.invalidTokens).toEqual(['ExponentPushToken[bbb]']);
  });

  it('no-ops on an empty or token-less message list (no fetch)', async () => {
    const { impl, calls } = fakeFetch({ data: [] });
    const adapter = createExpoPushAdapter({ fetchImpl: impl });
    expect(await adapter.sendPush([])).toEqual({ tickets: [], invalidTokens: [] });
    expect(await adapter.sendPush([{ ...MSG, to: '' }])).toEqual({ tickets: [], invalidTokens: [] });
    expect(calls).toHaveLength(0);
  });

  it('throws on a non-2xx transport failure (the row is retried)', async () => {
    const impl = vi.fn(async () => new Response('nope', { status: 502 })) as unknown as typeof fetch;
    await expect(createExpoPushAdapter({ fetchImpl: impl }).sendPush([MSG])).rejects.toThrow(
      /expo-push send failed: 502/,
    );
  });

  it('throws on a top-level Expo errors envelope', async () => {
    const { impl } = fakeFetch({ errors: [{ code: 'PUSH_TOO_MANY', message: 'slow down' }] });
    await expect(createExpoPushAdapter({ fetchImpl: impl }).sendPush([MSG])).rejects.toThrow(/PUSH_TOO_MANY/);
  });

  it('splits >100 messages into batches', async () => {
    const { impl, calls } = fakeFetch({ data: [{ status: 'ok' }] });
    const many = Array.from({ length: 150 }, (_, i) => ({ ...MSG, to: `ExponentPushToken[${i}]` }));
    await createExpoPushAdapter({ fetchImpl: impl }).sendPush(many);
    expect(calls).toHaveLength(2);
  });
});
