/**
 * Checkr adapter (OH-106).
 *
 * Implements the vendor-agnostic `BackgroundCheckAdapter` from
 * `@our-haven/domain`. Owns:
 *   - HTTP calls to Checkr's REST API (candidates + invitations).
 *   - HMAC-SHA256 signature verification against the webhook secret.
 *   - Translation from Checkr's `report.*` events to the normalized
 *     `BackgroundCheckEvent` shape the verification handler folds in.
 *
 * Per ADR-0007: package is fixed to `tasker_standard` (county criminal 7-year
 * + national criminal DB + national sex offender registry + SSN trace). The
 * package name is configured via env so the same code path supports the
 * Checkr-startup-discount package if Checkr quotes one.
 *
 * Per CONTEXT.md § Data residency: Checkr is US-only by default — no
 * region selector to set.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  BackgroundCheckAdapter,
  BackgroundCheckEvent,
  InitiateScreeningInput,
  InitiateScreeningResult,
} from '@our-haven/domain';

export interface CheckrConfig {
  apiKey: string;
  webhookSecret: string;
  /** Checkr package slug, e.g. `tasker_standard`. */
  packageSlug: string;
  /** Base URL — defaults to https://api.checkr.com/v1. Overridable for tests. */
  apiBase?: string;
  /**
   * `fetch` impl — defaults to the global fetch. Tests inject a mock.
   * Typed loosely because Node's `fetch` returns DOM `Response`, which is
   * structurally compatible with the bits the adapter reads.
   */
  fetchImpl?: typeof fetch;
}

interface CheckrCandidateResponse {
  id: string;
  invitation_url?: string;
}

interface CheckrInvitationResponse {
  id: string;
  invitation_url?: string;
  report_id?: string | null;
}

interface CheckrWebhookEnvelope {
  id: string;
  type: string;
  created_at: string;
  data?: {
    object?: CheckrWebhookReport;
  };
}

interface CheckrWebhookReport {
  id?: string;
  status?: string;
  result?: string;
  completed_at?: string | null;
  package?: string;
}

export function createCheckrAdapter(config: CheckrConfig): BackgroundCheckAdapter {
  const apiBase = config.apiBase ?? 'https://api.checkr.com/v1';
  const doFetch = config.fetchImpl ?? fetch;

  async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const auth = `Basic ${Buffer.from(`${config.apiKey}:`).toString('base64')}`;
    const res = await doFetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`checkr ${path} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  return {
    vendor: 'checkr',

    async initiateScreening(input: InitiateScreeningInput): Promise<InitiateScreeningResult> {
      const candidate = await postJson<CheckrCandidateResponse>('/candidates', {
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        work_locations: [{ country: 'US', state: input.state }],
        custom_id: input.correlationId,
      });

      const invitation = await postJson<CheckrInvitationResponse>('/invitations', {
        candidate_id: candidate.id,
        package: config.packageSlug,
      });

      return {
        vendorReportId: invitation.report_id ?? invitation.id,
        candidateActionUrl: invitation.invitation_url ?? candidate.invitation_url,
      };
    },

    verifySignature(rawBody: string, signatureHeader: string | null): boolean {
      if (!signatureHeader) return false;
      const expected = createHmac('sha256', config.webhookSecret).update(rawBody).digest('hex');
      const provided = signatureHeader.trim();
      if (provided.length !== expected.length) return false;
      try {
        return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'));
      } catch {
        return false;
      }
    },

    normalizeWebhookEvent(rawBody: string): BackgroundCheckEvent | null {
      let parsed: CheckrWebhookEnvelope;
      try {
        parsed = JSON.parse(rawBody) as CheckrWebhookEnvelope;
      } catch {
        return null;
      }

      const report = parsed.data?.object;
      if (!report?.id) return null;

      const occurredAt = parsed.created_at ? new Date(parsed.created_at) : new Date();

      switch (parsed.type) {
        case 'report.created':
        case 'report.pending':
          return { kind: 'initiated', vendorReportId: report.id, occurredAt };

        case 'report.completed': {
          const status = (report.status ?? report.result ?? '').toLowerCase();
          if (status === 'clear') {
            return { kind: 'completed', vendorReportId: report.id, occurredAt, outcome: 'clear' };
          }
          if (status === 'suspended') {
            return {
              kind: 'completed',
              vendorReportId: report.id,
              occurredAt,
              outcome: 'suspended',
            };
          }
          return {
            kind: 'completed',
            vendorReportId: report.id,
            occurredAt,
            outcome: 'consider',
          };
        }

        case 'report.suspended':
          return {
            kind: 'completed',
            vendorReportId: report.id,
            occurredAt,
            outcome: 'suspended',
          };

        case 'report.canceled':
        case 'report.cancelled':
          return { kind: 'cancelled', vendorReportId: report.id, occurredAt };

        default:
          return null;
      }
    },
  };
}
