/**
 * Expo Push adapter for the Edge Functions — the v1 mobile-push vendor (OH-194;
 * ADR-0010, CONTEXT § Notifications). Expo Push wraps FCM (Android) + APNs (iOS),
 * so the platform sends one HTTP request per batch and Expo fans out per device.
 *
 * SDK-free (plain `fetch`), Deno-compatible, `fetchImpl` injectable for tests —
 * the same hygiene as `_shared/checkr.ts`. The only host that calls this is the
 * `worker-tick` notifications dispatcher draining `notification_outbox` rows.
 *
 * Expo's send endpoint accepts up to 100 messages per request and answers with a
 * parallel array of tickets (`{ status: 'ok' | 'error', ... }`). A transport
 * failure throws (the dispatcher retries the row); a per-ticket `DeviceNotRegistered`
 * is surfaced in the result so the caller can prune dead tokens, but is not itself
 * fatal (push is best-effort relative to the channel matrix).
 */

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const MAX_BATCH = 100;

export interface ExpoPushConfig {
  /**
   * Expo access token. Optional: only required when the Expo project enables
   * "Enhanced Security for Push Notifications". When set it is sent as a Bearer.
   */
  accessToken?: string;
  /** Endpoint override (defaults to Expo's). Tests inject this + `fetchImpl`. */
  endpoint?: string;
  /** `fetch` impl — defaults to the global. Tests inject a mock. */
  fetchImpl?: typeof fetch;
}

export interface ExpoPushMessage {
  /** An Expo push token, `ExponentPushToken[…]`. */
  to: string;
  title: string;
  body: string;
  /** Deep-link payload — `{ kind, route }` per the deep-link doc. */
  data?: Record<string, unknown>;
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface ExpoPushResult {
  tickets: ExpoPushTicket[];
  /** Tokens Expo reported as `DeviceNotRegistered` — the caller should prune them. */
  invalidTokens: string[];
}

export interface ExpoPushAdapter {
  /** Send a batch of messages. Throws on a transport/HTTP failure. */
  sendPush(messages: ExpoPushMessage[]): Promise<ExpoPushResult>;
}

interface ExpoPushResponseBody {
  data?: ExpoPushTicket[];
  errors?: Array<{ message?: string; code?: string }>;
}

export function createExpoPushAdapter(config: ExpoPushConfig = {}): ExpoPushAdapter {
  const endpoint = config.endpoint ?? EXPO_PUSH_ENDPOINT;
  const doFetch = config.fetchImpl ?? fetch;

  async function sendBatch(batch: ExpoPushMessage[]): Promise<ExpoPushResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (config.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;

    const res = await doFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`expo-push send failed: ${res.status} ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as ExpoPushResponseBody;
    if (json.errors?.length) {
      const first = json.errors[0];
      throw new Error(`expo-push send error: ${first?.code ?? ''} ${first?.message ?? ''}`.trim());
    }

    const tickets = json.data ?? [];
    const invalidTokens: string[] = [];
    tickets.forEach((ticket, i) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        const token = batch[i]?.to;
        if (token) invalidTokens.push(token);
      }
    });

    return { tickets, invalidTokens };
  }

  return {
    async sendPush(messages: ExpoPushMessage[]): Promise<ExpoPushResult> {
      const valid = messages.filter((m) => m.to);
      if (valid.length === 0) return { tickets: [], invalidTokens: [] };

      const merged: ExpoPushResult = { tickets: [], invalidTokens: [] };
      for (let i = 0; i < valid.length; i += MAX_BATCH) {
        const result = await sendBatch(valid.slice(i, i + MAX_BATCH));
        merged.tickets.push(...result.tickets);
        merged.invalidTokens.push(...result.invalidTokens);
      }
      return merged;
    },
  };
}
