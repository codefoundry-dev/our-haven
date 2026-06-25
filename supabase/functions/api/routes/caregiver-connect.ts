import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';

/**
 * Stripe Connect Express routes — the Caregiver payment rail (OH-190).
 *
 * Ported from the OH-110 Fastify plugin (apps/backend/src/routes/stripe-connect.ts)
 * onto the Hono fat Edge Function (ADR-0019), and narrowed to **Caregiver-only**
 * per ADR-0011: a Provider is a clinical/SaaS listing role with no Connect, no
 * Commission, and no Payout (clinical fees are off-platform). The role gate is
 * `roles: ['caregiver']`, so a Provider token gets 403 `forbidden_role`.
 *
 * Three endpoints, all scoped to the authenticated Caregiver:
 *
 *   POST /v1/caregiver/connect/onboarding-link
 *     - Creates a Stripe Express account if the Caregiver doesn't have one yet
 *       (stamps `provider_connect_accounts.stripe_account_id`).
 *     - Issues a Stripe-hosted account-onboarding link that drives the KYC flow
 *       (identity / tax / bank details — PRD story 49). Stripe redirects back to
 *       STRIPE_CONNECT_RETURN_URL on completion, STRIPE_CONNECT_REFRESH_URL
 *       mid-flow.
 *     - Precondition: `screening_passed_at` is set — Connect onboarding unlocks
 *       only after Checkr clears (ADR-0007 gate, mirrored from OH-110).
 *
 *   GET /v1/caregiver/connect/summary
 *     - Read-only Connect account state mirrored from `account.updated`
 *       webhooks. `accountReady` is true iff both capabilities are enabled —
 *       the gate on verification activation + appearing in search.
 *
 *   POST /v1/caregiver/connect/dashboard-link
 *     - Step-up MFA gated. Returns a Stripe Express dashboard login link. The
 *       Express dashboard handles BOTH bank-detail changes AND payout
 *       withdrawals, so this single MFA-gated endpoint satisfies PRD story 57 /
 *       OH-190 AC #3 (step-up MFA enforced on bank/withdrawal). Without a fresh
 *       step-up grant the auth middleware returns 403 `step_up_required`.
 *
 * `provider_connect_accounts` is the unified supply table's Connect mirror; it
 * is keyed by `providers.id`, and for a Caregiver token that row is the
 * Caregiver's. We never poll Stripe to mutate state here — writes are owned by
 * the webhook (routes/webhooks/stripe-connect.ts); these endpoints only read,
 * plus the one-time account-create stamp on first onboarding.
 *
 * Form 1099-K issuance is automatic for Express accounts (ADR-0001 / CONTEXT §
 * Sales tax model) — no application plumbing. OH-190 AC #4 ("1099-K issuance
 * confirmed in Stripe") is a Stripe-dashboard / ops confirmation that the
 * Connect platform's tax-reporting is enabled, not code.
 */

// The dashboard-link is the bank-detail / withdrawal gate (the most
// payout-sensitive action), so it uses a tighter 5-minute step-up window than
// the 15-minute grant TTL — preserving the OH-110 posture for this endpoint.
const STEP_UP_MAX_AGE_SEC = 5 * 60;

const ConnectSummaryResponse = z
  .object({
    hasAccount: z.boolean(),
    stripeAccountId: z.string().nullable(),
    chargesEnabled: z.boolean(),
    payoutsEnabled: z.boolean(),
    detailsSubmitted: z.boolean(),
    disabledReason: z.string().nullable(),
    accountReady: z.boolean(),
    accountReadyAt: z.string().datetime().nullable(),
    requirementsCurrentlyDue: z.array(z.string()),
    requirementsPastDue: z.array(z.string()),
    requirementsPendingVerification: z.array(z.string()),
    lastWebhookAt: z.string().datetime().nullable(),
  })
  .openapi('CaregiverConnectSummary');

const OnboardingLinkResponse = z
  .object({
    stripeAccountId: z.string(),
    url: z.string().url(),
    expiresAt: z.string().datetime(),
  })
  .openapi('CaregiverConnectOnboardingLink');

const DashboardLinkResponse = z
  .object({
    url: z.string().url(),
    createdAt: z.string().datetime(),
  })
  .openapi('CaregiverConnectDashboardLink');

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('CaregiverConnectError');

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

interface ProviderRow {
  id: string;
  uid: string;
  role: 'caregiver' | 'provider';
  state: string;
}

interface ConnectAccountRow {
  provider_id: string;
  stripe_account_id: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  disabled_reason: string | null;
  requirements: Record<string, unknown>;
  account_ready_at: Date | null;
  last_webhook_at: Date | null;
}

interface VerificationGateRow {
  screening_passed_at: Date | null;
  rejected_at: Date | null;
}

async function loadCaregiver(db: Db, uid: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'state'])
    .where('uid', '=', uid)
    .executeTakeFirst();
  return row ? (row as ProviderRow) : null;
}

async function loadConnectAccount(db: Db, providerId: string): Promise<ConnectAccountRow | null> {
  const row = await db
    .selectFrom('provider_connect_accounts')
    .selectAll()
    .where('provider_id', '=', providerId)
    .executeTakeFirst();
  return row ? (row as unknown as ConnectAccountRow) : null;
}

async function loadOrCreateConnectAccount(db: Db, providerId: string): Promise<ConnectAccountRow> {
  const existing = await loadConnectAccount(db, providerId);
  if (existing) return existing;
  const inserted = await db
    .insertInto('provider_connect_accounts')
    .values({ provider_id: providerId })
    .returningAll()
    .executeTakeFirstOrThrow();
  return inserted as unknown as ConnectAccountRow;
}

async function loadVerificationGate(db: Db, providerId: string): Promise<VerificationGateRow | null> {
  const row = await db
    .selectFrom('provider_verifications')
    .select(['screening_passed_at', 'rejected_at'])
    .where('provider_id', '=', providerId)
    .executeTakeFirst();
  return row ? (row as VerificationGateRow) : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function summaryFromRow(row: ConnectAccountRow | null) {
  if (!row) {
    return {
      hasAccount: false,
      stripeAccountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      disabledReason: null,
      accountReady: false,
      accountReadyAt: null,
      requirementsCurrentlyDue: [],
      requirementsPastDue: [],
      requirementsPendingVerification: [],
      lastWebhookAt: null,
    };
  }
  const req = (row.requirements ?? {}) as Record<string, unknown>;
  return {
    hasAccount: !!row.stripe_account_id,
    stripeAccountId: row.stripe_account_id,
    chargesEnabled: row.charges_enabled,
    payoutsEnabled: row.payouts_enabled,
    detailsSubmitted: row.details_submitted,
    disabledReason: row.disabled_reason,
    accountReady: row.charges_enabled && row.payouts_enabled,
    accountReadyAt: toIso(row.account_ready_at),
    requirementsCurrentlyDue: asStringArray(req.currently_due),
    requirementsPastDue: asStringArray(req.past_due),
    requirementsPendingVerification: asStringArray(req.pending_verification),
    lastWebhookAt: toIso(row.last_webhook_at),
  };
}

const summaryRoute = createRoute({
  method: 'get',
  path: '/caregiver/connect/summary',
  tags: ['caregiver'],
  summary: "Read the authenticated Caregiver's Stripe Connect Express account summary",
  description:
    'Returns the read-only Connect account state mirrored from `account.updated` webhooks: charges_enabled / payouts_enabled / details_submitted, the disabled_reason if Stripe paused the account, and the requirement lists (currently_due, past_due, pending_verification). `accountReady` is true iff both capabilities are enabled — the gate on verification activation + appearing in search (OH-190).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  responses: {
    200: { description: 'Connect account summary', content: json(ConnectSummaryResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (Providers have no Connect)', content: json(ErrorResponse) },
    404: { description: 'Caregiver not found', content: json(ErrorResponse) },
  },
});

const onboardingLinkRoute = createRoute({
  method: 'post',
  path: '/caregiver/connect/onboarding-link',
  tags: ['caregiver'],
  summary: 'Create / reuse a Stripe Connect Express account and return a hosted onboarding URL',
  description:
    'Idempotent: if the Caregiver already has a `provider_connect_accounts` row with a `stripe_account_id`, reuses it; otherwise creates a fresh Express account (type=express, country=US, capabilities=card_payments+transfers, business_type=individual) and stamps it onto the row. Returns a freshly-issued Stripe-hosted account-onboarding link (the KYC flow — PRD story 49). Precondition: Checkr screening has cleared (`screening_passed_at`).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  responses: {
    200: { description: 'Onboarding link issued', content: json(OnboardingLinkResponse) },
    400: { description: 'Screening not cleared / no email', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (Providers have no Connect)', content: json(ErrorResponse) },
    404: { description: 'Caregiver not found', content: json(ErrorResponse) },
    409: { description: 'Verification terminated', content: json(ErrorResponse) },
  },
});

const dashboardLinkRoute = createRoute({
  method: 'post',
  path: '/caregiver/connect/dashboard-link',
  tags: ['caregiver'],
  summary: 'Issue a Stripe Express dashboard login link — requires step-up MFA (bank/withdrawal gate)',
  description:
    'Returns a one-time Stripe Express dashboard login URL. Bank-detail edits and payout withdrawals both happen inside the Express dashboard, so this single MFA-gated endpoint satisfies OH-190 AC #3 (step-up MFA enforced on bank/withdrawal — PRD story 57). Requires a step-up MFA grant issued within the last 5 minutes (`POST /v1/auth/step-up/refresh`); without it the auth middleware returns 403 `step_up_required`.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'], stepUpMaxAgeSec: STEP_UP_MAX_AGE_SEC })] as const,
  responses: {
    200: { description: 'Dashboard login link issued', content: json(DashboardLinkResponse) },
    400: { description: 'Connect account missing', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role or step-up required', content: json(ErrorResponse) },
    404: { description: 'Caregiver not found', content: json(ErrorResponse) },
  },
});

export function registerCaregiverConnectRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(summaryRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const caregiver = await loadCaregiver(db, principal.uid);
    if (!caregiver) {
      return c.json({ error: 'caregiver_not_found' }, 404);
    }
    const row = await loadConnectAccount(db, caregiver.id);
    return c.json(summaryFromRow(row), 200);
  });

  app.openapi(onboardingLinkRoute, async (c) => {
    const { db, env, stripe, supabase } = c.var.deps;
    const principal = c.get('principal')!;

    const caregiver = await loadCaregiver(db, principal.uid);
    if (!caregiver) {
      return c.json({ error: 'caregiver_not_found' }, 404);
    }

    const gate = await loadVerificationGate(db, caregiver.id);
    if (!gate?.screening_passed_at) {
      return c.json(
        {
          error: 'screening_not_cleared',
          reason: 'Stripe Connect onboarding unlocks after Checkr clears the Caregiver',
        },
        400,
      );
    }
    if (gate.rejected_at) {
      return c.json({ error: 'verification_terminated' }, 409);
    }

    const row = await loadOrCreateConnectAccount(db, caregiver.id);

    let stripeAccountId = row.stripe_account_id;
    if (!stripeAccountId) {
      const email = principal.email ?? (await fetchSupabaseEmail(supabase, principal.uid));
      if (!email) {
        return c.json({ error: 'email_required', reason: 'verify your email before linking Stripe' }, 400);
      }
      const account = await stripe.createConnectAccount({
        email,
        providerId: caregiver.id,
        metadata: { uid: principal.uid, state: caregiver.state, role: caregiver.role },
      });
      stripeAccountId = account.id;
      await db
        .updateTable('provider_connect_accounts')
        .set({
          stripe_account_id: stripeAccountId,
          details_submitted: account.details_submitted,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          updated_at: new Date(),
        })
        .where('provider_id', '=', caregiver.id)
        .execute();
    }

    const link = await stripe.createAccountLink({
      accountId: stripeAccountId,
      refreshUrl: env.STRIPE_CONNECT_REFRESH_URL,
      returnUrl: env.STRIPE_CONNECT_RETURN_URL,
      type: 'account_onboarding',
    });

    return c.json(
      {
        stripeAccountId,
        url: link.url,
        expiresAt: new Date(link.expires_at * 1000).toISOString(),
      },
      200,
    );
  });

  app.openapi(dashboardLinkRoute, async (c) => {
    const { db, stripe } = c.var.deps;
    const principal = c.get('principal')!;

    const caregiver = await loadCaregiver(db, principal.uid);
    if (!caregiver) {
      return c.json({ error: 'caregiver_not_found' }, 404);
    }
    const row = await loadConnectAccount(db, caregiver.id);
    if (!row?.stripe_account_id) {
      return c.json(
        {
          error: 'connect_account_missing',
          reason: 'complete Stripe Connect onboarding before opening the Express dashboard',
        },
        400,
      );
    }

    const link = await stripe.createLoginLink(row.stripe_account_id);
    return c.json({ url: link.url, createdAt: new Date(link.created * 1000).toISOString() }, 200);
  });
}

/**
 * Fall back to the Supabase admin API for the user's email only when the JWT
 * carries none (the access token's `email` claim is the happy path). Kept
 * tolerant: a lookup failure surfaces as the 400 `email_required` upstream
 * rather than a 500.
 */
async function fetchSupabaseEmail(
  supabase: { admin: { auth: { admin: { getUserById: (uid: string) => Promise<unknown> } } } },
  uid: string,
): Promise<string | null> {
  try {
    const result = (await supabase.admin.auth.admin.getUserById(uid)) as {
      data?: { user?: { email?: string | null } | null } | null;
    };
    return result?.data?.user?.email ?? null;
  } catch {
    return null;
  }
}
