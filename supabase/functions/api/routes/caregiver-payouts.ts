import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';

/**
 * Read-only Caregiver Payouts (OH-221) — the in-app list the Account tab's
 * "Payouts" row opens. Withdrawal + bank management stay web-of-record (the
 * Stripe Express dashboard, reached via the mobile→web handoff, PRD story 80);
 * this endpoint is a pure read.
 *
 *   GET /v1/caregiver/payouts   the caller's captured/refunded Bookings, newest first
 *
 * A "payout" is the capture of a Booking's manual-capture destination charge
 * (OH-211 — "the capture IS the payout"). There is no separate payouts/transfers
 * ledger in v1 (see 20260712000001_booking_payments), so the list is projected
 * straight off `bookings`: only `kind = 'caregiver'` rows whose `payment_status`
 * has reached `captured` or `refunded`. Provider consultations (NULL payment)
 * and un-captured Bookings never appear.
 *
 * `netCents` is the Caregiver's take-home estimate: the captured total minus the
 * platform Commission (the destination charge's application_fee) minus any
 * refund. It is a display figure — the authoritative money movement lives in
 * Stripe (the Express dashboard is the source of truth for actual balances).
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('CaregiverPayoutError');

const PayoutStatusEnum = z.enum(['captured', 'refunded']);

const PayoutItem = z
  .object({
    bookingId: z.string(),
    category: z.enum(['babysitter', 'tutor', 'nanny']).nullable(),
    /** The date the work happened (YYYY-MM-DD). */
    scheduledDate: z.string(),
    /** When the payout settled (capture/confirm instant), ISO — null if unstamped. */
    paidAt: z.string().datetime().nullable(),
    status: PayoutStatusEnum,
    /** Gross captured from the Parent, integer cents. */
    grossCents: z.number().int(),
    /** Platform Commission skimmed (the destination charge's application_fee). */
    commissionCents: z.number().int(),
    /** Refunded back to the Parent (0 unless status is `refunded`). */
    refundedCents: z.number().int(),
    /** Caregiver take-home estimate = gross − commission − refunded (≥ 0). */
    netCents: z.number().int(),
  })
  .openapi('CaregiverPayoutItem');

const PayoutListResponse = z
  .object({
    payouts: z.array(PayoutItem),
    // A glance total: sum of net take-home across every captured/refunded payout.
    totalNetCents: z.number().int(),
    count: z.number().int(),
  })
  .openapi('CaregiverPayoutList');

interface CaregiverRow {
  id: string;
  role: 'caregiver' | 'provider';
}

interface PayoutRow {
  id: string;
  category: 'babysitter' | 'tutor' | 'nanny' | null;
  scheduled_date: Date | string;
  payment_status: string | null;
  captured_amount_cents: number | null;
  commission_cents: number | null;
  refunded_amount_cents: number | null;
  confirmed_at: Date | string | null;
  updated_at: Date | string | null;
}

function toDateStr(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function toIsoOrNull(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function loadCaregiverByUid(db: Db, uid: string): Promise<CaregiverRow | null> {
  const row = (await db
    .selectFrom('providers')
    .select(['id', 'role'])
    .where('uid', '=', uid)
    .executeTakeFirst()) as CaregiverRow | undefined;
  if (!row || row.role !== 'caregiver') return null;
  return row;
}

function serialise(row: PayoutRow): z.infer<typeof PayoutItem> {
  const gross = row.captured_amount_cents ?? 0;
  const commission = row.commission_cents ?? 0;
  const refunded = row.refunded_amount_cents ?? 0;
  const net = Math.max(0, gross - commission - refunded);
  const status = row.payment_status === 'refunded' ? 'refunded' : 'captured';
  return {
    bookingId: row.id,
    category: row.category,
    scheduledDate: toDateStr(row.scheduled_date),
    // Capture happens at confirm; fall back to the last-touched stamp if unset.
    paidAt: toIsoOrNull(row.confirmed_at ?? row.updated_at),
    status,
    grossCents: gross,
    commissionCents: commission,
    refundedCents: refunded,
    netCents: net,
  };
}

const listRoute = createRoute({
  method: 'get',
  path: '/caregiver/payouts',
  tags: ['caregiver'],
  summary: "The Caregiver's read-only payouts list — OH-221",
  description:
    "Returns the authenticated Caregiver's settled payouts — their `kind = 'caregiver'` Bookings whose payment has reached `captured` or `refunded` — newest first, with a glance total of net take-home. A payout is a captured destination charge (OH-211); withdrawal + bank changes happen in the Stripe Express dashboard (reached via the web handoff), not here. `netCents` is a display estimate (gross − Commission − refund); Stripe holds the authoritative balance.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  responses: {
    200: { description: 'The payouts list', content: json(PayoutListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (Providers have no payouts)', content: json(ErrorResponse) },
  },
});

export function registerCaregiverPayoutRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;

    const caregiver = await loadCaregiverByUid(db, principal.uid);
    // No provider row yet → an empty list (never 500); a Provider token was
    // already rejected 403 by the role gate.
    if (!caregiver) return c.json({ payouts: [], totalNetCents: 0, count: 0 }, 200);

    const rows = (await db
      .selectFrom('bookings')
      .select([
        'id',
        'category',
        'scheduled_date',
        'payment_status',
        'captured_amount_cents',
        'commission_cents',
        'refunded_amount_cents',
        'confirmed_at',
        'updated_at',
      ])
      .where('provider_id', '=', caregiver.id)
      .where('kind', '=', 'caregiver')
      .where('payment_status', 'in', ['captured', 'refunded'])
      .orderBy('confirmed_at', 'desc')
      .orderBy('scheduled_date', 'desc')
      .execute()) as PayoutRow[];

    const payouts = rows.map(serialise);
    const totalNetCents = payouts.reduce((sum, p) => sum + p.netCents, 0);
    return c.json({ payouts, totalNetCents, count: payouts.length }, 200);
  });
}
