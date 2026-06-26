/**
 * Twilio SMS adapter for the Edge Functions — the v1 SMS vendor (OH-194;
 * CONTEXT § Notifications). SMS is reserved for urgent events and is mandatory
 * (no opt-out) for the four SMS-mandatory event kinds; the dispatcher treats a
 * failure here as fatal for those (retry/back off).
 *
 * SDK-free (`fetch` + `node:crypto`-free), Deno-compatible, `fetchImpl`
 * injectable — same hygiene as `_shared/checkr.ts`. The Twilio Messages REST API
 * is `application/x-www-form-urlencoded` with HTTP Basic auth (AccountSID:authToken).
 * `Buffer` (Deno-compatible) builds the Basic credential.
 */

import { Buffer } from 'node:buffer';

const TWILIO_API_BASE = 'https://api.twilio.com';

export interface TwilioConfig {
  /** Account SID (`AC…`). */
  accountSid: string;
  /** Auth token (Basic-auth password). */
  authToken: string;
  /** The `From` number in E.164, e.g. `+19123013104`. */
  fromNumber: string;
  /** API base override. Tests inject this + `fetchImpl`. */
  apiBase?: string;
  /** `fetch` impl — defaults to the global. Tests inject a mock. */
  fetchImpl?: typeof fetch;
}

export interface SendSmsInput {
  /** Destination number in E.164. */
  to: string;
  body: string;
}

export interface SendSmsResult {
  sid: string;
}

export interface TwilioAdapter {
  /** Send one SMS. Throws on a transport/HTTP failure. */
  sendSms(input: SendSmsInput): Promise<SendSmsResult>;
}

interface TwilioResponseBody {
  sid?: string;
  message?: string;
  code?: number;
}

export function createTwilioAdapter(config: TwilioConfig): TwilioAdapter {
  const apiBase = config.apiBase ?? TWILIO_API_BASE;
  const doFetch = config.fetchImpl ?? fetch;

  return {
    async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
      if (!config.accountSid || !config.authToken || !config.fromNumber) {
        throw new Error('twilio: account SID, auth token and From number required to send SMS');
      }

      const url = `${apiBase}/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
      const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');
      const form = new URLSearchParams({
        To: input.to,
        From: config.fromNumber,
        Body: input.body,
      });

      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${auth}`,
        },
        body: form.toString(),
      });

      const json = (await res.json().catch(() => ({}))) as TwilioResponseBody;
      if (!res.ok || !json.sid) {
        throw new Error(
          `twilio send failed: ${res.status} ${json.code ?? ''} ${json.message ?? ''}`.trim(),
        );
      }
      return { sid: json.sid };
    },
  };
}
