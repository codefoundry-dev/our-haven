import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import type { AppEnv } from '../../context.ts';
// The pure-TS reducer (@our-haven/domain, OH-181) folds a normalized
// background-check event into a `provider_verifications` patch. Value import via
// the explicit `.ts` specifier (the same pattern routes/verification.ts uses for
// computeVerificationState) — the Edge import map carries no `@our-haven/*` entry.
import {
  reduceBackgroundCheckEvent,
  type BackgroundCheckEvent,
} from '../../../../../packages/domain/src/background-check/index.ts';

/**
 * Checkr (background-check vendor) webhook (OH-185; ADR-0007, ADR-0019 §
 * Decision 5).
 *
 * Ported from apps/backend/src/routes/webhooks/checkr.ts. Public route (no
 * `requireAuth`), deployed under `--no-verify-jwt`; the Checkr HMAC signature is
 * the authentication. Raw bytes via `c.req.text()` BEFORE anything parses the
 * body so the HMAC matches what Checkr signed.
 *
 * Intentionally thin (ADR-0007 + ADR-0004):
 *   - The vendor adapter (`deps.backgroundCheck`) verifies the signature and
 *     normalizes the payload into a `BackgroundCheckEvent`.
 *   - The pure reducer (`reduceBackgroundCheckEvent`) folds the event into a
 *     `provider_verifications` patch (screening_initiated_at / screening_passed_at
 *     / rejected_at / rejection_reason).
 *   - The handler persists: the raw payload onto `provider_screenings.raw_payload`
 *     (FCRA-disposable at 6 months — OH-237 screening-disposal sweep), the
 *     lifecycle status onto `provider_screenings.status`, and the facts patch onto
 *     `provider_verifications` (what search ranking + the admin queue read).
 *
 * Idempotency: keyed off `(vendor, vendor_report_id)` — the unique partial index
 * on `provider_screenings` makes the lookup deterministic, and the terminal-status
 * guard ensures a retried delivery never downgrades a completed row. A second
 * vendor (Sterling, GoodHire) would land on a sibling route using the same adapter
 * contract.
 */

const Ack = z.object({ received: z.literal(true) }).openapi('CheckrWebhookAck');
const ErrorResponse = z.object({ error: z.string(), reason: z.string().optional() }).openapi('CheckrWebhookError');

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

interface ScreeningRow {
  id: string;
  provider_id: string;
  status: string;
}

const TERMINAL_STATUSES = new Set(['clear', 'consider', 'suspended', 'cancelled']);

type ScreeningStatus = 'in_progress' | 'clear' | 'consider' | 'suspended' | 'cancelled';

function nextStatusForEvent(event: BackgroundCheckEvent): ScreeningStatus {
  switch (event.kind) {
    case 'initiated':
      return 'in_progress';
    case 'cancelled':
      return 'cancelled';
    case 'completed':
      return event.outcome;
  }
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const webhookRoute = createRoute({
  method: 'post',
  path: '/webhooks/checkr',
  tags: ['webhooks'],
  summary: 'Checkr (background-check vendor) webhook — drives the Verification state machine',
  description:
    'Receives Checkr `report.*` deliveries. Verifies the `X-Checkr-Signature` HMAC against CHECKR_WEBHOOK_SECRET, normalizes the payload via the vendor-agnostic adapter, folds the result into the verification facts (screening_passed_at / rejected_at), and stamps the raw payload onto `provider_screenings.raw_payload` for FCRA-windowed retention. Idempotent on `(vendor, vendor_report_id)`. Public route — the Checkr signature is the authentication.',
  responses: {
    200: { description: 'Acknowledged', content: json(Ack) },
    400: { description: 'Invalid signature', content: json(ErrorResponse) },
  },
});

export function registerCheckrWebhookRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(webhookRoute, async (c) => {
    const { db, backgroundCheck } = c.var.deps;

    const rawBody = await c.req.text();
    const signatureHeader = c.req.header('x-checkr-signature') ?? null;

    if (!backgroundCheck.verifySignature(rawBody, signatureHeader)) {
      return c.json({ error: 'invalid_signature' }, 400);
    }

    const event = backgroundCheck.normalizeWebhookEvent(rawBody);
    if (!event) {
      // An event type we deliberately ignore (e.g. Checkr's redundant
      // report.created against our own bookkeeping). Ack so Checkr stops retrying.
      return c.json({ received: true as const }, 200);
    }

    const screening = (await db
      .selectFrom('provider_screenings')
      .select(['id', 'provider_id', 'status'])
      .where('vendor', '=', backgroundCheck.vendor)
      .where('vendor_report_id', '=', event.vendorReportId)
      .executeTakeFirst()) as ScreeningRow | undefined;

    if (!screening) {
      console.warn('[checkr] webhook: no screening row matches vendor report id', event.vendorReportId);
      return c.json({ received: true as const }, 200);
    }

    // Don't overwrite terminal states with a stale/retried event.
    if (TERMINAL_STATUSES.has(screening.status)) {
      return c.json({ received: true as const }, 200);
    }

    const now = new Date();
    const completedAt = event.kind === 'completed' ? event.occurredAt : null;

    await db
      .updateTable('provider_screenings')
      .set({
        status: nextStatusForEvent(event),
        raw_payload: safeParseJson(rawBody),
        completed_at: completedAt ?? undefined,
        updated_at: now,
      })
      .where('id', '=', screening.id)
      .execute();

    const factsPatch = reduceBackgroundCheckEvent(event);
    if (Object.keys(factsPatch).length > 0) {
      await db
        .updateTable('provider_verifications')
        .set({ ...factsPatch, updated_at: now })
        .where('provider_id', '=', screening.provider_id)
        .execute();
    }

    return c.json({ received: true as const }, 200);
  });
}
