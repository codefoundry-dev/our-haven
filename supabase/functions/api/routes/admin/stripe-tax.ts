import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../../auth/middleware.ts';
import type { AppEnv } from '../../context.ts';
import type { TaxPurpose } from '../../vendors/stripe.ts';

/**
 * Admin Stripe Tax routes (OH-192).
 *
 * Ported from the OH-111 Fastify plugin (apps/backend/src/routes/admin/stripe-tax.ts)
 * onto the Hono fat Edge Function (ADR-0019). Four endpoints, all scoped to the
 * internal `admin` role (which the auth middleware additionally requires to be
 * aal2+TOTP). Tax-registration creation layers a step-up-MFA gate on top —
 * registering Our Haven for sales tax in a US state is a binding compliance
 * action.
 *
 *   POST /v1/admin/stripe-tax/preview-calculation
 *     - Run a Stripe Tax calculation for a state + amount + purpose, persist the
 *       result to `stripe_tax_calculations` for audit, and return it. Used during
 *       launch to verify per-state taxability on the Subscription (AC #1) and the
 *       Commission (AC #2) without exercising the live Subscription/Booking flows
 *       (OH-193 not built yet).
 *
 *   GET /v1/admin/stripe-tax/calculations
 *     - Read the recent audit log (purpose + state + subject filterable).
 *
 *   GET /v1/admin/stripe-tax/registrations
 *     - Mirror of Stripe's Tax Registrations API — the admin nexus dashboard
 *       (AC: nexus tracking + registration prompts surfaced).
 *
 *   POST /v1/admin/stripe-tax/registrations
 *     - Step-up-MFA gated. Pre-register in a US state (priority-state posture,
 *       OH-163) or react to a Stripe-surfaced nexus threshold crossing.
 *
 * NO endpoint here computes tax for Bookings. Bookings flow through Stripe
 * Connect without `automatic_tax`, by design — Providers carry their own
 * services' sales-tax exposure (CONTEXT § Sales tax model, ADR-0009). The Zod
 * `purpose` enum (`subscription | commission` only) is the structural guard: a
 * future engineer wiring Booking-tax here hits a schema rejection.
 */

// Registering for sales-tax collection is the most compliance-sensitive action
// here, so it takes a tight 5-minute step-up window (mirrors the OH-111 posture).
const ADMIN_STEP_UP_MAX_AGE_SEC = 5 * 60;

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const UsStateCode = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/, 'state must be the 2-letter US-state code (e.g. CA)');

const TaxPurposeEnum = z.enum(['subscription', 'commission']);

const PreviewCalculationBody = z
  .object({
    purpose: TaxPurposeEnum,
    amountCents: z.number().int().positive(),
    state: UsStateCode,
    postalCode: z.string().min(3).max(10).optional(),
    city: z.string().max(80).optional(),
    /** Caller-supplied id so the audit row joins back to subscriber/commission. */
    reference: z.string().min(1).max(120),
    /** Optional Supabase uid of the subject (Parent for subscription, Provider for commission). */
    subjectUid: z.string().uuid().optional(),
  })
  .openapi('AdminStripeTaxPreviewRequest');

const TaxBreakdownEntrySchema = z.object({
  amount: z.number().int(),
  inclusive: z.boolean(),
  taxabilityReason: z.string().nullable(),
  taxableAmount: z.number().int().nullable(),
  state: z.string().nullable(),
  taxType: z.string().nullable(),
  percentageDecimal: z.string().nullable(),
});

const CalculationResponse = z
  .object({
    calculationId: z.string(),
    stripeCalculationId: z.string(),
    purpose: TaxPurposeEnum,
    customerState: UsStateCode,
    customerPostalCode: z.string().nullable(),
    amountCents: z.number().int(),
    taxAmountCents: z.number().int(),
    amountTotalCents: z.number().int(),
    taxBehavior: z.enum(['inclusive', 'exclusive']),
    taxCode: z.string(),
    taxBreakdown: z.array(TaxBreakdownEntrySchema),
    expiresAt: z.string().datetime(),
  })
  .openapi('AdminStripeTaxCalculation');

const CalculationsListQuery = z.object({
  purpose: TaxPurposeEnum.optional(),
  state: UsStateCode.optional(),
  subjectUid: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const CalculationsListResponse = z
  .object({ calculations: z.array(CalculationResponse) })
  .openapi('AdminStripeTaxCalculationList');

const RegistrationSchema = z
  .object({
    id: z.string(),
    state: z.string().nullable(),
    registrationType: z.string().nullable(),
    status: z.string(),
    activeFrom: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
  })
  .openapi('AdminStripeTaxRegistration');

const RegistrationsListQuery = z.object({
  status: z.enum(['active', 'expired', 'scheduled', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

const RegistrationsListResponse = z
  .object({
    registrations: z.array(RegistrationSchema),
    hasMore: z.boolean(),
  })
  .openapi('AdminStripeTaxRegistrationList');

const CreateRegistrationBody = z
  .object({
    state: UsStateCode,
    /**
     * Stripe Tax registration sub-type. The sensible default for US states is
     * `state_sales_tax`; admin can override for niche state filings.
     */
    registrationType: z.string().min(1).default('state_sales_tax'),
    /** Optional unix-seconds activation; defaults to now. */
    activeFromUnixSec: z.number().int().optional(),
  })
  .openapi('AdminStripeTaxCreateRegistrationRequest');

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('AdminStripeTaxError');

/* ── projection helpers (ported verbatim from the Fastify route) ─────────── */

interface StoredCalculation {
  id: string;
  stripe_calculation_id: string;
  purpose: TaxPurpose;
  customer_state: string;
  customer_postal_code: string | null;
  amount_cents: number;
  tax_amount_cents: number;
  amount_total_cents: number;
  tax_behavior: 'inclusive' | 'exclusive';
  tax_code: string;
  tax_breakdown: unknown[];
  stripe_expires_at: Date | string;
}

interface StripeTaxBreakdownRow {
  amount: number;
  inclusive: boolean;
  taxability_reason?: string | null;
  taxable_amount?: number | null;
  tax_rate_details?: {
    state?: string | null;
    tax_type?: string | null;
    percentage_decimal?: string | null;
  } | null;
}

function normaliseBreakdown(raw: unknown[]): Array<z.infer<typeof TaxBreakdownEntrySchema>> {
  if (!Array.isArray(raw)) return [];
  const items = raw as StripeTaxBreakdownRow[];
  return items.map((entry) => ({
    amount: entry.amount,
    inclusive: entry.inclusive,
    taxabilityReason: entry.taxability_reason ?? null,
    taxableAmount: entry.taxable_amount ?? null,
    state: entry.tax_rate_details?.state ?? null,
    taxType: entry.tax_rate_details?.tax_type ?? null,
    percentageDecimal: entry.tax_rate_details?.percentage_decimal ?? null,
  }));
}

function rowToResponse(row: StoredCalculation): z.infer<typeof CalculationResponse> {
  return {
    calculationId: row.id,
    stripeCalculationId: row.stripe_calculation_id,
    purpose: row.purpose,
    customerState: row.customer_state,
    customerPostalCode: row.customer_postal_code,
    amountCents: row.amount_cents,
    taxAmountCents: row.tax_amount_cents,
    amountTotalCents: row.amount_total_cents,
    taxBehavior: row.tax_behavior,
    taxCode: row.tax_code,
    taxBreakdown: normaliseBreakdown(row.tax_breakdown),
    expiresAt: new Date(row.stripe_expires_at).toISOString(),
  };
}

function registrationToResponse(
  reg: { id: string; country_options?: Record<string, unknown>; status: string; active_from: number; expires_at: number | null },
  fallback: { state?: string; registrationType?: string } = {},
): z.infer<typeof RegistrationSchema> {
  const usOpts = ((reg.country_options ?? {}) as Record<string, unknown>).us as
    | { state?: string; type?: string }
    | undefined;
  return {
    id: reg.id,
    state: usOpts?.state ?? fallback.state ?? null,
    registrationType: usOpts?.type ?? fallback.registrationType ?? null,
    status: reg.status,
    activeFrom: new Date(reg.active_from * 1000).toISOString(),
    expiresAt: reg.expires_at ? new Date(reg.expires_at * 1000).toISOString() : null,
  };
}

const CALCULATION_COLUMNS = [
  'id',
  'stripe_calculation_id',
  'purpose',
  'customer_state',
  'customer_postal_code',
  'amount_cents',
  'tax_amount_cents',
  'amount_total_cents',
  'tax_behavior',
  'tax_code',
  'tax_breakdown',
  'stripe_expires_at',
] as const;

/* ── routes ─────────────────────────────────────────────────────────────── */

const previewCalculationRoute = createRoute({
  method: 'post',
  path: '/admin/stripe-tax/preview-calculation',
  tags: ['admin', 'tax'],
  summary: 'Compute a Stripe Tax preview for a purpose + US state + amount; persists an audit row',
  description:
    "Calls Stripe Tax POST /v1/tax/calculations for either `subscription` (state = subscriber's resident state) or `commission` (state = Provider's resident state). Persists the result to `stripe_tax_calculations`. Used during launch verification to sample tax outcomes across states (OH-192 ACs #1 + #2) and at runtime as a preview before the Subscription/Commission flow charges. The purpose enum deliberately excludes Bookings — Our Haven does not collect sales tax on Bookings (CONTEXT § Sales tax model).",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['admin'] })] as const,
  request: {
    body: { content: json(PreviewCalculationBody), required: true },
  },
  responses: {
    200: { description: 'Tax calculation computed + persisted', content: json(CalculationResponse) },
    400: { description: 'Invalid request', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Not an admin / TOTP required', content: json(ErrorResponse) },
    502: { description: 'Stripe Tax call failed', content: json(ErrorResponse) },
  },
});

const calculationsListRoute = createRoute({
  method: 'get',
  path: '/admin/stripe-tax/calculations',
  tags: ['admin', 'tax'],
  summary: 'List recent Stripe Tax calculation audit rows',
  description:
    'Reads the `stripe_tax_calculations` audit table. Filterable by purpose, customer state, and subject uid. Returns up to 100 rows ordered by creation time (newest first).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['admin'] })] as const,
  request: { query: CalculationsListQuery },
  responses: {
    200: { description: 'Audit rows', content: json(CalculationsListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Not an admin / TOTP required', content: json(ErrorResponse) },
  },
});

const registrationsListRoute = createRoute({
  method: 'get',
  path: '/admin/stripe-tax/registrations',
  tags: ['admin', 'tax'],
  summary: 'List Stripe Tax registrations (the nexus dashboard view)',
  description:
    "Mirrors Stripe Tax GET /v1/tax/registrations. Status defaults to `active`; pass `all` to include scheduled + expired. The source of truth admins use to see which states Our Haven is collecting in — and where Stripe is prompting registration as nexus is crossed.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['admin'] })] as const,
  request: { query: RegistrationsListQuery },
  responses: {
    200: { description: 'Registrations (nexus view)', content: json(RegistrationsListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Not an admin / TOTP required', content: json(ErrorResponse) },
    502: { description: 'Stripe call failed', content: json(ErrorResponse) },
  },
});

const createRegistrationRoute = createRoute({
  method: 'post',
  path: '/admin/stripe-tax/registrations',
  tags: ['admin', 'tax'],
  summary: 'Register Our Haven for sales-tax collection in a US state — step-up MFA required',
  description:
    'Creates a Stripe Tax registration for the named US state (country=US, country_options[us][state]=...). Step-up-MFA gated because registering for sales-tax collection is a binding compliance action. Used both for the pre-registration posture in priority states (OH-163) and reactively when Stripe Tax surfaces a nexus threshold crossing.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [
    requireAuth({ roles: ['admin'], stepUpMaxAgeSec: ADMIN_STEP_UP_MAX_AGE_SEC }),
  ] as const,
  request: {
    body: { content: json(CreateRegistrationBody), required: true },
  },
  responses: {
    200: { description: 'Registration created', content: json(RegistrationSchema) },
    400: { description: 'Invalid request', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Not an admin / TOTP / step-up required', content: json(ErrorResponse) },
    502: { description: 'Stripe call failed', content: json(ErrorResponse) },
  },
});

export function registerAdminStripeTaxRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(previewCalculationRoute, async (c) => {
    const { db, stripe } = c.var.deps;
    const body = c.req.valid('json');

    let calc;
    try {
      calc = await stripe.createTaxCalculation({
        purpose: body.purpose,
        amountCents: body.amountCents,
        reference: body.reference,
        customerAddress: { state: body.state, postalCode: body.postalCode, city: body.city },
        metadata: body.subjectUid ? { subject_uid: body.subjectUid } : undefined,
      });
    } catch (err) {
      return c.json(
        { error: 'stripe_tax_calculation_failed', reason: (err as Error).message },
        502,
      );
    }

    const taxAmount = calc.tax_amount_exclusive ?? 0;
    const breakdown = (calc.tax_breakdown ?? []) as unknown[];
    const taxCode = calc.line_items?.data[0]?.tax_code ?? '';

    const inserted = await db
      .insertInto('stripe_tax_calculations')
      .values({
        stripe_calculation_id: calc.id,
        purpose: body.purpose,
        reference: body.reference,
        subject_uid: body.subjectUid ?? null,
        customer_state: body.state,
        customer_postal_code: body.postalCode ?? null,
        amount_cents: body.amountCents,
        tax_amount_cents: taxAmount,
        amount_total_cents: calc.amount_total,
        tax_behavior: 'exclusive',
        tax_code: taxCode,
        tax_breakdown: breakdown,
        raw_payload: calc as unknown as Record<string, unknown>,
        stripe_expires_at: new Date(calc.expires_at * 1000),
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    return c.json(
      rowToResponse({
        id: inserted.id,
        stripe_calculation_id: calc.id,
        purpose: body.purpose,
        customer_state: body.state,
        customer_postal_code: body.postalCode ?? null,
        amount_cents: body.amountCents,
        tax_amount_cents: taxAmount,
        amount_total_cents: calc.amount_total,
        tax_behavior: 'exclusive',
        tax_code: taxCode,
        tax_breakdown: breakdown,
        stripe_expires_at: new Date(calc.expires_at * 1000),
      }),
      200,
    );
  });

  app.openapi(calculationsListRoute, async (c) => {
    const { db } = c.var.deps;
    const { purpose, state, subjectUid, limit } = c.req.valid('query');

    let q = db
      .selectFrom('stripe_tax_calculations')
      .select(CALCULATION_COLUMNS)
      .orderBy('created_at', 'desc')
      .limit(limit);

    if (purpose) q = q.where('purpose', '=', purpose);
    if (state) q = q.where('customer_state', '=', state);
    if (subjectUid) q = q.where('subject_uid', '=', subjectUid);

    const rows = (await q.execute()) as StoredCalculation[];
    return c.json({ calculations: rows.map(rowToResponse) }, 200);
  });

  app.openapi(registrationsListRoute, async (c) => {
    const { stripe } = c.var.deps;
    const { status, limit } = c.req.valid('query');

    let list;
    try {
      list = await stripe.listTaxRegistrations({ status, limit });
    } catch (err) {
      return c.json({ error: 'stripe_list_failed', reason: (err as Error).message }, 502);
    }
    return c.json(
      {
        registrations: list.data.map((reg) => registrationToResponse(reg)),
        hasMore: list.has_more,
      },
      200,
    );
  });

  app.openapi(createRegistrationRoute, async (c) => {
    const { stripe } = c.var.deps;
    const { state, registrationType, activeFromUnixSec } = c.req.valid('json');

    let registration;
    try {
      registration = await stripe.createUsStateRegistration({
        state,
        registrationType,
        activeFrom: activeFromUnixSec,
      });
    } catch (err) {
      return c.json({ error: 'stripe_create_failed', reason: (err as Error).message }, 502);
    }
    return c.json(registrationToResponse(registration, { state, registrationType }), 200);
  });
}
