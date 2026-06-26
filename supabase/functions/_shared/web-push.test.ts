import { Buffer } from 'node:buffer';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { buildVapidJwt, createWebPushAdapter } from './web-push.ts';

// A real P-256 key pair, generated once, so the WebCrypto sign path is exercised
// end-to-end (the JWT can't be verified deterministically, but its structure can).
let publicKey = '';
let privateKey = '';

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  publicKey = Buffer.from(rawPub).toString('base64url');
  privateKey = jwk.d ?? ''; // base64url scalar
});

const CONFIG = () => ({ publicKey, privateKey, subject: 'mailto:ops@ourhaven.com' });

function fakeFetch(responder: (url: string) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responder(url);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('buildVapidJwt', () => {
  it('produces a 3-part JWT with an ES256 header and the aud/exp/sub claims', async () => {
    const jwt = await buildVapidJwt(CONFIG(), 'https://fcm.googleapis.com', 1_900_000_000);
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);

    const header = JSON.parse(Buffer.from(parts[0] ?? '', 'base64url').toString());
    const payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString());
    expect(header).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(payload).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1_900_000_000,
      sub: 'mailto:ops@ourhaven.com',
    });
    expect((parts[2] ?? '').length).toBeGreaterThan(0);
  });
});

describe('createWebPushAdapter', () => {
  it('POSTs an empty tickle with a VAPID Authorization + TTL header to each endpoint', async () => {
    const { impl, calls } = fakeFetch(() => new Response(null, { status: 201 }));
    const adapter = createWebPushAdapter({ ...CONFIG(), fetchImpl: impl, nowSeconds: () => 1_000 });

    const result = await adapter.sendTickle([{ endpoint: 'https://fcm.googleapis.com/send/abc' }]);

    const c = calls[0];
    if (!c) throw new Error('expected a send');
    expect(c.url).toBe('https://fcm.googleapis.com/send/abc');
    const headers = c.init.headers as Record<string, string>;
    expect(headers.TTL).toBe('2419200');
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(headers.Authorization).toContain(`k=${publicKey}`);
    expect(c.init.body).toBeUndefined();
    expect(result.sent).toBe(1);
    expect(result.goneEndpoints).toEqual([]);
  });

  it('marks 404/410 endpoints as gone (for pruning) and keeps going', async () => {
    const { impl } = fakeFetch((url) =>
      url.endsWith('dead') ? new Response(null, { status: 410 }) : new Response(null, { status: 201 }),
    );
    const adapter = createWebPushAdapter({ ...CONFIG(), fetchImpl: impl });

    const result = await adapter.sendTickle([
      { endpoint: 'https://push.example.com/live' },
      { endpoint: 'https://push.example.com/dead' },
    ]);
    expect(result.sent).toBe(1);
    expect(result.goneEndpoints).toEqual(['https://push.example.com/dead']);
  });

  it('swallows per-endpoint transport errors (best-effort)', async () => {
    const impl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const adapter = createWebPushAdapter({ ...CONFIG(), fetchImpl: impl });
    const result = await adapter.sendTickle([{ endpoint: 'https://push.example.com/x' }]);
    expect(result).toEqual({ sent: 0, goneEndpoints: [] });
  });

  it('no-ops on an empty subscription list', async () => {
    const { impl, calls } = fakeFetch(() => new Response(null, { status: 201 }));
    const result = await createWebPushAdapter({ ...CONFIG(), fetchImpl: impl }).sendTickle([]);
    expect(result).toEqual({ sent: 0, goneEndpoints: [] });
    expect(calls).toHaveLength(0);
  });

  it('treats a malformed VAPID key pair as a best-effort no-op (crypto error is caught per-endpoint)', async () => {
    const { impl, calls } = fakeFetch(() => new Response(null, { status: 201 }));
    const adapter = createWebPushAdapter({
      publicKey: 'short',
      privateKey: 'short',
      subject: 'mailto:x',
      fetchImpl: impl,
    });
    await expect(adapter.sendTickle([{ endpoint: 'https://push.example.com/x' }])).resolves.toEqual({
      sent: 0,
      goneEndpoints: [],
    });
    expect(calls).toHaveLength(0);
  });
});
