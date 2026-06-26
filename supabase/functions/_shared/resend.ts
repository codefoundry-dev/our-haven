/**
 * Resend email adapter for the Edge Functions — the v1 email vendor (OH-194;
 * PRD-0001 v1.7 § Implementation Decisions, CONTEXT § Notifications).
 *
 * SDK-free (`fetch`), Deno-compatible, `fetchImpl` injectable — same hygiene as
 * `_shared/checkr.ts`. Called only by the `worker-tick` notifications dispatcher.
 *
 * v1 sends plain-text only (`text`, no HTML). Dispatcher-shaped `categories` +
 * `customArgs` are mapped onto Resend `tags` on the wire so a future Resend
 * webhook can correlate opens/clicks/bounces back to the originating outbox row
 * (docs/notifications-deep-link-format.md § Email body conventions).
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface ResendConfig {
  /** Resend API key (`re_…`). Required to send. */
  apiKey: string;
  /** The verified `From` address, e.g. `Our Haven <notifications@ourhaven.com>`. */
  from: string;
  /** Endpoint override. Tests inject this + `fetchImpl`. */
  endpoint?: string;
  /** `fetch` impl — defaults to the global. Tests inject a mock. */
  fetchImpl?: typeof fetch;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  /** Plain-text body (v1). */
  text: string;
  /** Resend tags (correlation), e.g. `[{ name: 'event_kind', value }]`. */
  tags?: Array<{ name: string; value: string }>;
}

export interface SendEmailResult {
  id: string;
}

export interface ResendAdapter {
  /** Send one email. Throws on a transport/HTTP failure. */
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}

interface ResendResponseBody {
  id?: string;
  message?: string;
  name?: string;
}

// Resend tag values are restricted to ASCII letters, digits, `_` and `-`. Sanitise
// so a tag value (e.g. a colon-bearing event id) never gets the whole send 422'd.
function sanitizeTagValue(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) || 'na';
}

export function createResendAdapter(config: ResendConfig): ResendAdapter {
  const endpoint = config.endpoint ?? RESEND_ENDPOINT;
  const doFetch = config.fetchImpl ?? fetch;

  return {
    async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
      if (!config.apiKey) throw new Error('resend: RESEND_API_KEY required to send email');

      const body: Record<string, unknown> = {
        from: config.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      };
      if (input.tags?.length) {
        body.tags = input.tags.map((t) => ({ name: t.name, value: sanitizeTagValue(t.value) }));
      }

      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const json = (await res.json().catch(() => ({}))) as ResendResponseBody;
      if (!res.ok || !json.id) {
        throw new Error(
          `resend send failed: ${res.status} ${json.name ?? ''} ${json.message ?? ''}`.trim(),
        );
      }
      return { id: json.id };
    },
  };
}
