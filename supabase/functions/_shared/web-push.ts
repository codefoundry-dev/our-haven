/**
 * VAPID web-push adapter for the Edge Functions — the v1 web-push vendor (OH-194;
 * CONTEXT § Notifications, docs/notifications-deep-link-format.md).
 *
 * v1 sends an EMPTY "tickle" payload (no RFC 8291 aes128gcm encryption — deferred):
 * the service worker receives a contentless `push` event and refetches state from
 * the API. An empty tickle still requires VAPID authentication, so this adapter's
 * job is to mint the VAPID `Authorization` header (an ES256 JWT over the push
 * service's origin) and POST an empty body to each subscription endpoint.
 *
 * SDK-free: the JWT is signed with WebCrypto (`crypto.subtle`, ECDSA P-256 / SHA-256),
 * which is a global in both Deno and Node ≥ 16 — no `web-push` npm dependency, no
 * `node:crypto` PEM juggling. ECDSA signatures from WebCrypto are already raw r||s,
 * exactly the JWS ES256 wire format.
 *
 * Web push is BEST-EFFORT (CONTEXT): per-endpoint HTTP failures are collected,
 * not thrown; a `404`/`410` marks the subscription gone so the caller can prune
 * it. Only a configuration/crypto error (bad keys) throws.
 */

import { Buffer } from 'node:buffer';
// Type-only (erased at Deno runtime) — the WebCrypto JSON Web Key shape. The
// node-only typecheck lib has no DOM `JsonWebKey`, so reach it via node:crypto's
// `webcrypto` namespace; at runtime the global `crypto.subtle` is used directly.
import type { webcrypto } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 2_419_200; // 28 days — push service may hold the tickle this long.
const JWT_LIFETIME_SECONDS = 12 * 60 * 60; // 12h, well under the 24h VAPID ceiling.

export interface WebPushConfig {
  /** VAPID public key, base64url of the uncompressed P-256 point (65 bytes). */
  publicKey: string;
  /** VAPID private key, base64url of the 32-byte P-256 scalar. */
  privateKey: string;
  /** VAPID `sub` claim — a contact URI, e.g. `mailto:ops@ourhaven.com`. */
  subject: string;
  /** `fetch` impl — defaults to the global. Tests inject a mock. */
  fetchImpl?: typeof fetch;
  /** TTL (seconds) override; defaults to 28 days. */
  ttlSeconds?: number;
  /** Clock override (seconds since epoch) for deterministic JWT `exp` in tests. */
  nowSeconds?: () => number;
}

export interface WebPushSubscription {
  /** The push service endpoint URL the browser handed the server at subscribe. */
  endpoint: string;
}

export interface WebPushResult {
  /** Endpoints that accepted the tickle (2xx). */
  sent: number;
  /** Endpoints the push service reported gone (404/410) — prune them. */
  goneEndpoints: string[];
}

export interface WebPushAdapter {
  /** POST an empty tickle to each subscription. Best-effort per endpoint. */
  sendTickle(subscriptions: WebPushSubscription[]): Promise<WebPushResult>;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function base64UrlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

/** Build the EC JWK WebCrypto needs from the base64url VAPID key pair. */
function buildJwk(publicKey: string, privateKey: string): webcrypto.JsonWebKey {
  const pub = base64UrlDecode(publicKey);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('web-push: VAPID public key must be the 65-byte uncompressed P-256 point');
  }
  const d = base64UrlDecode(privateKey);
  if (d.length !== 32) {
    throw new Error('web-push: VAPID private key must be the 32-byte P-256 scalar');
  }
  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(pub.subarray(1, 33)),
    y: base64UrlEncode(pub.subarray(33, 65)),
    d: base64UrlEncode(d),
    ext: true,
  };
}

/**
 * Mint a VAPID ES256 JWT for one push-service origin. Exported for unit testing
 * its structure (header/payload) independently of a live send.
 */
export async function buildVapidJwt(
  config: Pick<WebPushConfig, 'publicKey' | 'privateKey' | 'subject'>,
  audience: string,
  expSeconds: number,
): Promise<string> {
  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })),
  );
  const payload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ aud: audience, exp: expSeconds, sub: config.subject })),
  );
  const signingInput = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    'jwk',
    buildJwk(config.publicKey, config.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export function createWebPushAdapter(config: WebPushConfig): WebPushAdapter {
  const doFetch = config.fetchImpl ?? fetch;
  const ttl = config.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = config.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  async function authHeaderFor(endpoint: string): Promise<string> {
    const audience = new URL(endpoint).origin;
    const jwt = await buildVapidJwt(config, audience, now() + JWT_LIFETIME_SECONDS);
    return `vapid t=${jwt}, k=${config.publicKey}`;
  }

  return {
    async sendTickle(subscriptions: WebPushSubscription[]): Promise<WebPushResult> {
      const result: WebPushResult = { sent: 0, goneEndpoints: [] };
      for (const sub of subscriptions) {
        if (!sub.endpoint) continue;
        try {
          const res = await doFetch(sub.endpoint, {
            method: 'POST',
            headers: {
              TTL: String(ttl),
              Authorization: await authHeaderFor(sub.endpoint),
              // Empty tickle — no Content-Encoding / body (RFC 8291 deferred).
              'Content-Length': '0',
            },
          });
          if (res.status === 404 || res.status === 410) {
            result.goneEndpoints.push(sub.endpoint);
          } else if (res.ok) {
            result.sent += 1;
          } else {
            // Best-effort: log + continue (push is best-effort per CONTEXT).
            const text = await res.text().catch(() => '');
            console.warn(`[web-push] ${res.status} for ${sub.endpoint}: ${text.slice(0, 120)}`);
          }
        } catch (err) {
          console.warn(`[web-push] transport error for ${sub.endpoint}:`, err);
        }
      }
      return result;
    },
  };
}
