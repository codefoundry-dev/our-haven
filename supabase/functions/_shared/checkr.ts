/**
 * Checkr adapter for the Edge Functions — the v1 background-check vendor
 * (OH-185; ADR-0007, ADR-0019 § Decision 5).
 *
 * Ported from apps/backend/src/vendors/checkr.ts (the OH-106 Fastify adapter)
 * onto the Edge with explicit-.ts hygiene: the only `@our-haven/domain` import
 * is type-only (the vendor-agnostic `BackgroundCheckAdapter` contract), reached
 * by the relative `.ts` specifier the rest of the Edge tree uses — fully erased
 * at Deno runtime. The adapter itself is SDK-free (`fetch` + `node:crypto` +
 * `Buffer`, all Deno-compatible), so signature verification carries over
 * unchanged.
 *
 * Lives under `supabase/functions/_shared/` (the Supabase-idiomatic home for
 * code shared across functions; the `_` prefix keeps it from being deployed as
 * its own function) because TWO functions use complementary halves of it:
 *   - the `api` function calls `verifySignature` + `normalizeWebhookEvent` from
 *     the Checkr webhook route (needs only `webhookSecret`);
 *   - the `worker-tick` function calls `initiateScreening` from the deferred
 *     screening-invite dispatcher (needs only `apiKey` + `packageSlug`).
 * `apiKey` and `webhookSecret` are therefore each optional: a host configures
 * only the half it exercises, and the unused method fails closed.
 *
 * Per ADR-0007 the package is fixed to `tasker_standard` (county criminal
 * 7-year + national criminal DB + national sex-offender registry + SSN trace),
 * configured via env so the same code path supports a Checkr-quoted startup
 * package. Per CONTEXT § Data residency Checkr is US-only — no region selector.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

// Type-only (erased at Deno runtime) — the vendor-agnostic contract owned by the
// pure-TS domain module (OH-181). Reached by explicit `.ts` specifier, the same
// pattern routes/verification.ts uses; the Edge import map carries no
// `@our-haven/*` entry so a bare specifier would not resolve.
import type {
  BackgroundCheckAdapter,
  BackgroundCheckEvent,
  InitiateScreeningInput,
  InitiateScreeningResult,
} from '../../../packages/domain/src/background-check/index.ts';

export interface CheckrConfig {
  /** Checkr secret API key. Required only to `initiateScreening` (worker-tick). */
  apiKey?: string;
  /** Webhook signing secret. Required only to `verifySignature` (api webhook). */
  webhookSecret?: string;
  /** Checkr package slug, e.g. `tasker_standard`. */
  packageSlug: string;
  /** Base URL — defaults to https://api.checkr.com/v1. Overridable for tests. */
  apiBase?: string;
  /** `fetch` impl — defaults to the global fetch. Tests inject a mock. */
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
    if (!config.apiKey) {
      throw new Error('checkr: CHECKR_API_KEY required to initiate a screening');
    }
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
      if (!config.webhookSecret || !signatureHeader) return false;
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
