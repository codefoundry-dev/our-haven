/**
 * Admin Stripe Tax routes (OH-111).
 *
 * Four endpoints, all scoped to the `admin` role. Tax registration creation
 * additionally requires step-up MFA (5-minute window) — registering Our
 * Haven for sales tax in a US state is a binding compliance action.
 *
 *   POST /admin/stripe-tax/preview-calculation
 *     - Run a Stripe Tax calculation for any state + amount + purpose, persist
 *       the result to `stripe_tax_calculations` for audit, and return the
 *       calculation. Used during launch to verify the 5+ state Subscription
 *       sample (AC #1) and to verify Commission taxability per Provider state
 *       (AC #2) without exercising the live Subscription/Booking flows that
 *       don't exist yet.
 *
 *   GET /admin/stripe-tax/calculations
 *     - Read the recent audit log (purpose + state filterable).
 *
 *   GET /admin/stripe-tax/registrations
 *     - Mirror of Stripe's Tax Registrations API. Powers the admin dashboard
 *       nexus view (AC #4 — Stripe Tax dashboard accessible to admin).
 *
 *   POST /admin/stripe-tax/registrations
 *     - Step-up-MFA-gated. Pre-register in a US state per the posture
 *       decision in OH-97 (or react to a Stripe-surfaced nexus threshold).
 *
 * NO endpoint here computes tax for Bookings. Bookings flow through Stripe
 * Connect without `automatic_tax`, by design — Providers carry their own
 * services' sales-tax exposure (CONTEXT.md § Sales tax model). This file's
 * Zod purpose enum is the structural guard: `'subscription' | 'commission'`
 * only; a future engineer attempting to wire Booking-tax here will hit a
 * schema rejection.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { TaxPurpose } from '@/vendors/stripe.js';

const ADMIN_STEP_UP_MAX_AGE_SEC = 300;

const UsStateCode = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/, 'state must be the 2-letter US-state code (e.g. CA)');

const TaxPurposeEnum = z.enum(['subscription', 'commission']);

const PreviewCalculationBody = z.object({
  purpose: TaxPurposeEnum,
  amountCents: z.number().int().positive(),
  state: UsStateCode,
  postalCode: z.string().min(3).max(10).optional(),
  city: z.string().max(80).optional(),
  /** Caller-supplied id so the audit row joins back to subscriber/commission. */
  reference: z.string().min(1).max(120),
  /** Optional Supabase uid of the subject (Parent for subscription, Provider for commission). */
  subjectUid: z.uuid().optional(),
});

const TaxBreakdownEntrySchema = z.object({
  amount: z.number().int(),
  inclusive: z.boolean(),
  taxabilityReason: z.string().nullable(),
  taxableAmount: z.number().int().nullable(),
  state: z.string().nullable(),
  taxType: z.string().nullable(),
  percentageDecimal: z.string().nullable(),
});

const PreviewCalculationResponse = z.object({
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
  expiresAt: z.iso.datetime(),
});

const CalculationsListQuery = z.object({
  purpose: TaxPurposeEnum.optional(),
  state: UsStateCode.optional(),
  subjectUid: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const CalculationsListResponse = z.object({
  calculations: z.array(PreviewCalculationResponse),
});

const RegistrationSchema = z.object({
  id: z.string(),
  state: z.string().nullable(),
  registrationType: z.string().nullable(),
  status: z.string(),
  activeFrom: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
});

const RegistrationsListQuery = z.object({
  status: z.enum(['active', 'expired', 'scheduled', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

const RegistrationsListResponse = z.object({
  registrations: z.array(RegistrationSchema),
  hasMore: z.boolean(),
});

const CreateRegistrationBody = z.object({
  state: UsStateCode,
  /**
   * Stripe Tax registration sub-type. Sensible default for US states is
   * `state_sales_tax`. Admin can override for niche state filings.
   */
  registrationType: z.string().min(1).default('state_sales_tax'),
  /** Optional unix-seconds activation; defaults to now. */
  activeFromUnixSec: z.number().int().optional(),
});

const ErrorResponse = z.object({
  error: z.string(),
  reason: z.string().optional(),
});

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

function rowToResponse(row: StoredCalculation): z.infer<typeof PreviewCalculationResponse> {
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

export const adminStripeTaxRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/admin/stripe-tax/preview-calculation',
    {
      preHandler: app.requireAuth({ roles: ['admin'] }),
      schema: {
        tags: ['admin', 'tax'],
        summary:
          'Compute a Stripe Tax preview for a given purpose + US state + amount. Persists an audit row.',
        description:
          'Calls Stripe Tax `POST /v1/tax/calculations` for either `subscription` (state = subscriber\'s resident state) or `commission` (state = Provider\'s resident state). Persists the result to `stripe_tax_calculations`. Used during launch verification to sample tax outcomes across multiple states (OH-111 ACs #1 + #2) and at runtime as a preview before the Subscription/Commission flow actually charges. The purpose enum deliberately excludes Bookings — Our Haven does not collect sales tax on Bookings (CONTEXT.md § Sales tax model).',
        security: [{ supabaseAccessToken: [] }],
        body: PreviewCalculationBody,
        response: {
          200: PreviewCalculationResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const body = req.body;
      let calc;
      try {
        calc = await app.deps.stripe.createTaxCalculation({
          purpose: body.purpose,
          amountCents: body.amountCents,
          reference: body.reference,
          customerAddress: {
            state: body.state,
            postalCode: body.postalCode,
            city: body.city,
          },
          metadata: body.subjectUid ? { subject_uid: body.subjectUid } : undefined,
        });
      } catch (err) {
        req.log.warn({ err, purpose: body.purpose, state: body.state }, 'stripe tax calculation failed');
        reply.code(502);
        return { error: 'stripe_tax_calculation_failed', reason: (err as Error).message };
      }

      const taxAmount = calc.tax_amount_exclusive ?? 0;
      const breakdown = calc.tax_breakdown ?? [];
      const inserted = await app.deps.db
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
          tax_code: calc.line_items?.data[0]?.tax_code ?? '',
          tax_breakdown: breakdown as unknown[],
          raw_payload: calc as unknown as Record<string, unknown>,
          stripe_expires_at: new Date(calc.expires_at * 1000),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      return rowToResponse({
        id: inserted.id,
        stripe_calculation_id: calc.id,
        purpose: body.purpose,
        customer_state: body.state,
        customer_postal_code: body.postalCode ?? null,
        amount_cents: body.amountCents,
        tax_amount_cents: taxAmount,
        amount_total_cents: calc.amount_total,
        tax_behavior: 'exclusive',
        tax_code: calc.line_items?.data[0]?.tax_code ?? '',
        tax_breakdown: breakdown as unknown[],
        stripe_expires_at: new Date(calc.expires_at * 1000),
      });
    },
  );

  app.get(
    '/admin/stripe-tax/calculations',
    {
      preHandler: app.requireAuth({ roles: ['admin'] }),
      schema: {
        tags: ['admin', 'tax'],
        summary: 'List recent Stripe Tax calculation audit rows.',
        description:
          'Reads the `stripe_tax_calculations` audit table. Filterable by purpose, customer state, and subject uid. Returns up to 100 rows ordered by creation time (newest first).',
        security: [{ supabaseAccessToken: [] }],
        querystring: CalculationsListQuery,
        response: {
          200: CalculationsListResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req) => {
      const { purpose, state, subjectUid, limit } = req.query;
      let q = app.deps.db
        .selectFrom('stripe_tax_calculations')
        .select([
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
        ])
        .orderBy('created_at', 'desc')
        .limit(limit);

      if (purpose) q = q.where('purpose', '=', purpose);
      if (state) q = q.where('customer_state', '=', state);
      if (subjectUid) q = q.where('subject_uid', '=', subjectUid);

      const rows = (await q.execute()) as StoredCalculation[];
      return { calculations: rows.map(rowToResponse) };
    },
  );

  app.get(
    '/admin/stripe-tax/registrations',
    {
      preHandler: app.requireAuth({ roles: ['admin'] }),
      schema: {
        tags: ['admin', 'tax'],
        summary: 'List Stripe Tax registrations (the nexus dashboard view).',
        description:
          'Mirrors Stripe Tax `GET /v1/tax/registrations`. Status defaults to `active`; pass `all` to include scheduled + expired. This is the source of truth admins use to see which states Our Haven is collecting in.',
        security: [{ supabaseAccessToken: [] }],
        querystring: RegistrationsListQuery,
        response: {
          200: RegistrationsListResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const { status, limit } = req.query;
      let list;
      try {
        list = await app.deps.stripe.listTaxRegistrations({ status, limit });
      } catch (err) {
        req.log.warn({ err }, 'stripe tax list_registrations failed');
        reply.code(502);
        return { error: 'stripe_list_failed', reason: (err as Error).message };
      }
      return {
        registrations: list.data.map((reg) => {
          const usOpts = ((reg.country_options ?? {}) as Record<string, unknown>).us as
            | { state?: string; type?: string }
            | undefined;
          return {
            id: reg.id,
            state: usOpts?.state ?? null,
            registrationType: usOpts?.type ?? null,
            status: reg.status,
            activeFrom: new Date(reg.active_from * 1000).toISOString(),
            expiresAt: reg.expires_at ? new Date(reg.expires_at * 1000).toISOString() : null,
          };
        }),
        hasMore: list.has_more,
      };
    },
  );

  app.post(
    '/admin/stripe-tax/registrations',
    {
      preHandler: app.requireAuth({ roles: ['admin'], stepUpMaxAgeSec: ADMIN_STEP_UP_MAX_AGE_SEC }),
      schema: {
        tags: ['admin', 'tax'],
        summary:
          'Register Our Haven for sales-tax collection in a US state — step-up MFA required.',
        description:
          'Creates a Stripe Tax registration for the named US state (country=US, country_options[us][state]=...). Step-up-MFA-gated because registering for sales-tax collection is a binding compliance action. Used both for the pre-registration posture in priority states (per the OH-97 decision) and reactively when Stripe Tax surfaces a nexus threshold crossing.',
        security: [{ supabaseAccessToken: [] }],
        body: CreateRegistrationBody,
        response: {
          200: RegistrationSchema,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const { state, registrationType, activeFromUnixSec } = req.body;
      let registration;
      try {
        registration = await app.deps.stripe.createUsStateRegistration({
          state,
          registrationType,
          activeFrom: activeFromUnixSec,
        });
      } catch (err) {
        req.log.warn({ err, state, registrationType }, 'stripe tax create_registration failed');
        reply.code(502);
        return { error: 'stripe_create_failed', reason: (err as Error).message };
      }
      const usOpts = ((registration.country_options ?? {}) as Record<string, unknown>).us as
        | { state?: string; type?: string }
        | undefined;
      return {
        id: registration.id,
        state: usOpts?.state ?? state,
        registrationType: usOpts?.type ?? registrationType,
        status: registration.status,
        activeFrom: new Date(registration.active_from * 1000).toISOString(),
        expiresAt: registration.expires_at
          ? new Date(registration.expires_at * 1000).toISOString()
          : null,
      };
    },
  );
};
