/**
 * Checkr webhook handler (OH-106).
 *
 * Receives report lifecycle events from Checkr (or any future vendor wired
 * behind the same adapter contract). Per ADR-0007 + ADR-0004 the route is
 * intentionally thin:
 *   - The vendor adapter (`app.deps.backgroundCheck`) verifies the HMAC
 *     signature and normalizes the payload into a `BackgroundCheckEvent`.
 *   - The pure-TS reducer (`reduceBackgroundCheckEvent`) folds the event
 *     into a `VerificationFacts` patch (screening_passed_at / rejected_at /
 *     rejection_reason).
 *   - The handler persists: the raw payload onto `provider_screenings.raw_payload`
 *     (FCRA-disposable at 6 months), the patch onto `provider_verifications`,
 *     and the lifecycle status onto `provider_screenings.status`.
 *
 * Idempotency: keyed off `(vendor, vendor_report_id)` — the unique partial
 * index on `provider_screenings` makes the lookup deterministic, and the
 * status check ensures we don't downgrade a completed row.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { reduceBackgroundCheckEvent } from '@our-haven/domain';

const Ack = z.object({ received: z.literal(true) });
const ErrorResponse = z.object({ error: z.string(), reason: z.string().optional() });

interface ScreeningRow {
  id: string;
  provider_id: string;
  vendor: string;
  status: string;
  vendor_report_id: string | null;
}

export const checkrWebhookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => done(null, body),
  );

  app.post(
    '/webhooks/checkr',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'Checkr (background-check vendor) webhook — drives the Verification state machine',
        description:
          'Receives Checkr `report.*` deliveries. Verifies the `X-Checkr-Signature` HMAC against the webhook secret, normalizes the payload via the vendor-agnostic adapter, folds the result into the verification facts (screening_passed_at / rejected_at), and stamps the raw payload onto `provider_screenings.raw_payload` for FCRA-windowed retention. A second vendor (Sterling, GoodHire) would land on a sibling route using the same adapter contract.',
        consumes: ['application/json'],
        response: {
          200: Ack,
          400: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const rawBody = typeof req.body === 'string' ? req.body : '';
      const headerVal = req.headers['x-checkr-signature'];
      const signatureHeader =
        typeof headerVal === 'string' ? headerVal : Array.isArray(headerVal) ? headerVal[0] ?? null : null;

      if (!app.deps.backgroundCheck.verifySignature(rawBody, signatureHeader)) {
        reply.code(400);
        return { error: 'invalid_signature' };
      }

      const event = app.deps.backgroundCheck.normalizeWebhookEvent(rawBody);
      if (!event) {
        return { received: true as const };
      }

      const screening = (await app.deps.db
        .selectFrom('provider_screenings')
        .select(['id', 'provider_id', 'vendor', 'status', 'vendor_report_id'])
        .where('vendor', '=', app.deps.backgroundCheck.vendor)
        .where('vendor_report_id', '=', event.vendorReportId)
        .executeTakeFirst()) as ScreeningRow | undefined;

      if (!screening) {
        req.log.warn(
          { vendor: app.deps.backgroundCheck.vendor, vendorReportId: event.vendorReportId },
          'checkr webhook: no screening row matches vendor report id',
        );
        return { received: true as const };
      }

      // Don't overwrite terminal states with stale events (Checkr can retry).
      const TERMINAL = new Set(['clear', 'consider', 'suspended', 'cancelled']);
      if (TERMINAL.has(screening.status)) {
        return { received: true as const };
      }

      const rawPayload = safeParseJson(rawBody);
      const nextStatus = nextStatusForEvent(event.kind, event);
      const completedAt = event.kind === 'completed' ? event.occurredAt : null;

      await app.deps.db
        .updateTable('provider_screenings')
        .set({
          status: nextStatus,
          raw_payload: rawPayload,
          completed_at: completedAt ?? undefined,
          updated_at: new Date(),
        })
        .where('id', '=', screening.id)
        .execute();

      const factsPatch = reduceBackgroundCheckEvent(event);
      if (Object.keys(factsPatch).length > 0) {
        await app.deps.db
          .updateTable('provider_verifications')
          .set({ ...factsPatch, updated_at: new Date() })
          .where('provider_id', '=', screening.provider_id)
          .execute();
      }

      return { received: true as const };
    },
  );
};

function nextStatusForEvent(
  kind: 'initiated' | 'completed' | 'cancelled',
  event: ReturnType<typeof reduceBackgroundCheckEvent> extends infer _T
    ? Parameters<typeof reduceBackgroundCheckEvent>[0]
    : never,
): 'in_progress' | 'clear' | 'consider' | 'suspended' | 'cancelled' {
  if (kind === 'initiated') return 'in_progress';
  if (kind === 'cancelled') return 'cancelled';
  // completed
  if (event.kind === 'completed') return event.outcome;
  return 'in_progress';
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
