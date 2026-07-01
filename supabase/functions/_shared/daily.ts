/**
 * Daily.co video adapter for the Edge Functions — the v1 embedded-video vendor
 * (OH-216; ADR-0008; CONTEXT § Video call). Ad-hoc, in-chat calls: the `api`
 * function creates a short-lived **private** room and mints a per-user **meeting
 * token** on each join. A private Daily room is un-joinable without a token, so
 * the room URL is never a shared secret — the token (scoped to one user, expiring
 * with the room) is the credential.
 *
 * SDK-free (`fetch` only), Deno-compatible, `fetchImpl` injectable — same hygiene
 * as `_shared/twilio.ts` / `_shared/checkr.ts`. The Daily REST API is JSON with
 * `Authorization: Bearer <DAILY_API_KEY>`. `exp` values are Unix **seconds**.
 */

const DAILY_API_BASE = 'https://api.daily.co/v1';

export interface DailyConfig {
  /** Daily API key (server-side; `DAILY_API_KEY`). Optional so the host boots
   *  without video config — the route throws NotConfiguredError (503) instead. */
  apiKey?: string;
  /** API base override. Tests inject this + `fetchImpl`. */
  apiBase?: string;
  /** `fetch` impl — defaults to the global. Tests inject a mock. */
  fetchImpl?: typeof fetch;
}

export interface CreateRoomInput {
  /** When the room stops being joinable (~30 min out — ADR-0008). */
  expiresAt: Date;
  /** Show Daily's pre-join (camera/mic check) UI. Defaults to true. */
  enablePrejoin?: boolean;
}

export interface DailyRoom {
  /** The room name — the key `createMeetingToken` is scoped to. */
  name: string;
  /** The joinable room URL (`https://<domain>.daily.co/<name>`). */
  url: string;
}

export interface CreateMeetingTokenInput {
  /** The room the token grants access to. */
  roomName: string;
  /** The joining user's stable id (their Supabase uid) — stamped on the token. */
  userId: string;
  /** Display name shown in the call, if any. */
  userName?: string;
  /** The initiator joins as owner; the counterparty as a regular participant. */
  isOwner?: boolean;
  /** Token expiry — matched to the room's `expiresAt`. */
  expiresAt: Date;
}

export interface DailyAdapter {
  /** Create a short-lived private room. Throws on a transport/HTTP failure. */
  createRoom(input: CreateRoomInput): Promise<DailyRoom>;
  /** Mint a per-user meeting token for a private room. Throws on failure. */
  createMeetingToken(input: CreateMeetingTokenInput): Promise<{ token: string }>;
}

interface DailyRoomResponse {
  name?: string;
  url?: string;
  error?: string;
  info?: string;
}
interface DailyTokenResponse {
  token?: string;
  error?: string;
  info?: string;
}

/** Unix **seconds** (Daily's `exp` unit), floored. */
function toUnixSeconds(when: Date): number {
  return Math.floor(when.getTime() / 1000);
}

export function createDailyAdapter(config: DailyConfig): DailyAdapter {
  const apiBase = config.apiBase ?? DAILY_API_BASE;
  const doFetch = config.fetchImpl ?? fetch;

  function authHeaders(): Record<string, string> {
    if (!config.apiKey) {
      throw new Error('daily: DAILY_API_KEY required to create rooms / meeting tokens');
    }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    };
  }

  return {
    async createRoom(input: CreateRoomInput): Promise<DailyRoom> {
      const headers = authHeaders();
      const res = await doFetch(`${apiBase}/rooms`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          // Private → un-joinable without a meeting token (the T&S posture).
          privacy: 'private',
          properties: {
            exp: toUnixSeconds(input.expiresAt),
            // Kick everyone when the room expires — no lingering sessions.
            eject_at_room_exp: true,
            enable_prejoin_ui: input.enablePrejoin ?? true,
          },
        }),
      });

      const json = (await res.json().catch(() => ({}))) as DailyRoomResponse;
      if (!res.ok || !json.name || !json.url) {
        throw new Error(
          `daily create room failed: ${res.status} ${json.error ?? ''} ${json.info ?? ''}`.trim(),
        );
      }
      return { name: json.name, url: json.url };
    },

    async createMeetingToken(input: CreateMeetingTokenInput): Promise<{ token: string }> {
      const headers = authHeaders();
      const res = await doFetch(`${apiBase}/meeting-tokens`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            room_name: input.roomName,
            user_id: input.userId,
            ...(input.userName ? { user_name: input.userName } : {}),
            is_owner: input.isOwner ?? false,
            exp: toUnixSeconds(input.expiresAt),
          },
        }),
      });

      const json = (await res.json().catch(() => ({}))) as DailyTokenResponse;
      if (!res.ok || !json.token) {
        throw new Error(
          `daily create meeting token failed: ${res.status} ${json.error ?? ''} ${json.info ?? ''}`.trim(),
        );
      }
      return { token: json.token };
    },
  };
}
