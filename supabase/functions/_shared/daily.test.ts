import { describe, expect, it, vi } from 'vitest';

import { createDailyAdapter } from './daily.ts';

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

const EXP = new Date('2026-07-01T12:30:00.000Z'); // → 1782909000 unix seconds

describe('createDailyAdapter.createRoom', () => {
  it('POSTs a private room with an exp to the rooms endpoint with Bearer auth', async () => {
    const { impl, call } = fakeFetch({ name: 'abc123', url: 'https://ourhaven.daily.co/abc123' });
    const room = await createDailyAdapter({ apiKey: 'sk_daily', fetchImpl: impl }).createRoom({
      expiresAt: EXP,
    });

    expect(call().url).toBe('https://api.daily.co/v1/rooms');
    const headers = call().init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk_daily');
    expect(headers['Content-Type']).toBe('application/json');

    const sent = JSON.parse(String(call().init.body));
    expect(sent.privacy).toBe('private');
    expect(sent.properties.exp).toBe(Math.floor(EXP.getTime() / 1000));
    expect(sent.properties.eject_at_room_exp).toBe(true);
    expect(room).toEqual({ name: 'abc123', url: 'https://ourhaven.daily.co/abc123' });
  });

  it('throws on a Daily error response', async () => {
    const { impl } = fakeFetch({ error: 'invalid-request', info: 'bad exp' }, 400);
    await expect(
      createDailyAdapter({ apiKey: 'sk', fetchImpl: impl }).createRoom({ expiresAt: EXP }),
    ).rejects.toThrow(/daily create room failed: 400 invalid-request bad exp/);
  });

  it('throws (and makes no request) when the API key is missing', async () => {
    const { impl, calls } = fakeFetch({ name: 'x', url: 'y' });
    await expect(
      createDailyAdapter({ fetchImpl: impl }).createRoom({ expiresAt: EXP }),
    ).rejects.toThrow(/DAILY_API_KEY required/);
    expect(calls).toHaveLength(0);
  });
});

describe('createDailyAdapter.createMeetingToken', () => {
  it('POSTs a room-scoped token with the user identity + owner flag', async () => {
    const { impl, call } = fakeFetch({ token: 'jwt.token.here' });
    const result = await createDailyAdapter({ apiKey: 'sk', fetchImpl: impl }).createMeetingToken({
      roomName: 'abc123',
      userId: 'uid-1',
      userName: 'Jesse',
      isOwner: true,
      expiresAt: EXP,
    });

    expect(call().url).toBe('https://api.daily.co/v1/meeting-tokens');
    const sent = JSON.parse(String(call().init.body));
    expect(sent.properties).toMatchObject({
      room_name: 'abc123',
      user_id: 'uid-1',
      user_name: 'Jesse',
      is_owner: true,
      exp: Math.floor(EXP.getTime() / 1000),
    });
    expect(result).toEqual({ token: 'jwt.token.here' });
  });

  it('defaults is_owner to false and omits user_name when absent', async () => {
    const { impl, call } = fakeFetch({ token: 't' });
    await createDailyAdapter({ apiKey: 'sk', fetchImpl: impl }).createMeetingToken({
      roomName: 'r',
      userId: 'uid-2',
      expiresAt: EXP,
    });
    const sent = JSON.parse(String(call().init.body));
    expect(sent.properties.is_owner).toBe(false);
    expect(sent.properties).not.toHaveProperty('user_name');
  });

  it('throws on a Daily error response', async () => {
    const { impl } = fakeFetch({ error: 'authentication-error' }, 401);
    await expect(
      createDailyAdapter({ apiKey: 'bad', fetchImpl: impl }).createMeetingToken({
        roomName: 'r',
        userId: 'u',
        expiresAt: EXP,
      }),
    ).rejects.toThrow(/daily create meeting token failed: 401 authentication-error/);
  });
});
