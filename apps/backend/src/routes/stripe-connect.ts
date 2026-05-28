/**
 * Stripe Connect Express routes (OH-110).
 *
 * Three endpoints, all scoped to the authenticated Provider:
 *
 *   POST /providers/me/stripe-connect/onboarding-link
 *     - Creates a Stripe Express account if the Provider doesn't have one yet
 *       (stamps `provider_connect_accounts.stripe_account_id`).
 *     - Issues a Stripe-hosted account-onboarding link that drives the KYC
 *       flow (identity / tax / bank details). Stripe redirects back to
 *       STRIPE_CONNECT_RETURN_URL on completion, STRIPE_CONNECT_REFRESH_URL
 *       on mid-flow refresh.
 *     - Precondition: `screening_passed_at` is set. The design's step-7
 *       "Bank details" copy says "Unlocks after Checkr clears" — same gate.
 *
 *   GET /providers/me/stripe-connect/summary
 *     - Read-only summary for the verification screen's right-rail and the
 *       account-settings page. Returns Connect account id, charges_enabled,
 *       payouts_enabled, details_submitted, disabled_reason, requirements,
 *       and whether the account is ready (both capabilities enabled).
 *
 *   POST /providers/me/stripe-connect/dashboard-link
 *     - Step-up MFA gated (5-minute window). Returns a Stripe Express
 *       dashboard login link. The Express dashboard handles bank-detail
 *       changes AND payout withdrawals — both are payout-sensitive actions
 *       that AC #3 and AC #4 require be MFA-protected. A single endpoint
 *       behind the MFA gate is the simplest fit, since the actual editing UI
 *       lives on Stripe's side.
 *
 * Form 1099-K issuance is handled automatically by Stripe Connect; no
 * application-side plumbing is required.
 *
 * Webhook-driven state sync lives in routes/webhooks/stripe-connect.ts —
 * these endpoints never poll Stripe to mutate state; they only read.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const ConnectSummaryResponse = z.object({
  hasAccount: z.boolean(),
  stripeAccountId: z.string().nullable(),
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
  detailsSubmitted: z.boolean(),
  disabledReason: z.string().nullable(),
  accountReady: z.boolean(),
  accountReadyAt: z.iso.datetime().nullable(),
  requirementsCurrentlyDue: z.array(z.string()),
  requirementsPastDue: z.array(z.string()),
  requirementsPendingVerification: z.array(z.string()),
  lastWebhookAt: z.iso.datetime().nullable(),
});

const OnboardingLinkResponse = z.object({
  stripeAccountId: z.string(),
  url: z.url(),
  expiresAt: z.iso.datetime(),
});

const DashboardLinkResponse = z.object({
  url: z.url(),
  createdAt: z.iso.datetime(),
});

const ErrorResponse = z.object({
  error: z.string(),
  reason: z.string().optional(),
});

interface ProviderRow {
  id: string;
  uid: string;
  kind: 'caregiver' | 'specialist';
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

interface SupabaseUserShape {
  email?: string | null;
}

const STEP_UP_MAX_AGE_SEC = 300;

export const stripeConnectRoutes: FastifyPluginAsyncZod = async (app) => {
  async function loadProvider(uid: string): Promise<ProviderRow | null> {
    const row = await app.deps.db
      .selectFrom('providers')
      .select(['id', 'uid', 'kind', 'state'])
      .where('uid', '=', uid)
      .executeTakeFirst();
    return row ? (row as ProviderRow) : null;
  }

  async function loadConnectAccount(providerId: string): Promise<ConnectAccountRow | null> {
    const row = await app.deps.db
      .selectFrom('provider_connect_accounts')
      .selectAll()
      .where('provider_id', '=', providerId)
      .executeTakeFirst();
    return row ? (row as ConnectAccountRow) : null;
  }

  async function loadOrCreateConnectAccount(providerId: string): Promise<ConnectAccountRow> {
    const existing = await loadConnectAccount(providerId);
    if (existing) return existing;
    const inserted = await app.deps.db
      .insertInto('provider_connect_accounts')
      .values({ provider_id: providerId })
      .returningAll()
      .executeTakeFirstOrThrow();
    return inserted as ConnectAccountRow;
  }

  async function loadVerificationGate(providerId: string): Promise<VerificationGateRow | null> {
    const row = await app.deps.db
      .selectFrom('provider_verifications')
      .select(['screening_passed_at', 'rejected_at'])
      .where('provider_id', '=', providerId)
      .executeTakeFirst();
    return row ? (row as VerificationGateRow) : null;
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
      accountReadyAt: row.account_ready_at ? new Date(row.account_ready_at).toISOString() : null,
      requirementsCurrentlyDue: asStringArray(req.currently_due),
      requirementsPastDue: asStringArray(req.past_due),
      requirementsPendingVerification: asStringArray(req.pending_verification),
      lastWebhookAt: row.last_webhook_at ? new Date(row.last_webhook_at).toISOString() : null,
    };
  }

  app.get(
    '/providers/me/stripe-connect/summary',
    {
      preHandler: app.requireAuth({ roles: ['provider'] }),
      schema: {
        tags: ['providers'],
        summary: 'Read the authenticated Provider\'s Stripe Connect Express account summary',
        description:
          'Returns the read-only Connect account state mirrored from `account.updated` webhooks. Includes charges_enabled / payouts_enabled / details_submitted, the disabled_reason if Stripe has paused the account, and the requirement lists (currently_due, past_due, pending_verification) so the UI can surface what the Provider still needs to fix on Stripe\'s side. `accountReady` is true iff both capabilities are enabled — this is the OH-110 gate for verification activation + appearing in search.',
        security: [{ supabaseAccessToken: [] }],
        response: {
          200: ConnectSummaryResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const provider = await loadProvider(principal.uid);
      if (!provider) {
        reply.code(404);
        return { error: 'provider_not_found' };
      }
      const row = await loadConnectAccount(provider.id);
      return summaryFromRow(row);
    },
  );

  app.post(
    '/providers/me/stripe-connect/onboarding-link',
    {
      preHandler: app.requireAuth({ roles: ['provider'] }),
      schema: {
        tags: ['providers'],
        summary: 'Create / reuse a Stripe Connect Express account and return a hosted onboarding URL',
        description:
          'Idempotent: if the Provider already has a `provider_connect_accounts` row with a `stripe_account_id`, reuses it; otherwise creates a fresh Express account (type=express, country=US, capabilities=card_payments+transfers, business_type=individual) and stamps it onto the row. Returns a freshly-issued account-onboarding link the client should redirect to. Stripe redirects back to `STRIPE_CONNECT_RETURN_URL` on completion (the verification page picks up the change via the webhook + summary refresh).',
        security: [{ supabaseAccessToken: [] }],
        response: {
          200: OnboardingLinkResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const provider = await loadProvider(principal.uid);
      if (!provider) {
        reply.code(404);
        return { error: 'provider_not_found' };
      }

      const gate = await loadVerificationGate(provider.id);
      if (!gate?.screening_passed_at) {
        reply.code(400);
        return {
          error: 'screening_not_cleared',
          reason: 'Stripe Connect onboarding unlocks after Checkr clears the Provider',
        };
      }
      if (gate.rejected_at) {
        reply.code(409);
        return { error: 'verification_terminated' };
      }

      const row = await loadOrCreateConnectAccount(provider.id);

      let stripeAccountId = row.stripe_account_id;
      if (!stripeAccountId) {
        const user = await fetchSupabaseUser(app, principal.uid);
        const email = user.email ?? principal.email ?? '';
        if (!email) {
          reply.code(400);
          return { error: 'email_required', reason: 'verify your email before linking Stripe' };
        }
        const account = await app.deps.stripe.createConnectAccount({
          email,
          providerId: provider.id,
          metadata: { uid: principal.uid, state: provider.state, kind: provider.kind },
        });
        stripeAccountId = account.id;
        await app.deps.db
          .updateTable('provider_connect_accounts')
          .set({
            stripe_account_id: stripeAccountId,
            details_submitted: account.details_submitted,
            charges_enabled: account.charges_enabled,
            payouts_enabled: account.payouts_enabled,
            updated_at: new Date(),
          })
          .where('provider_id', '=', provider.id)
          .execute();
      }

      const link = await app.deps.stripe.createAccountLink({
        accountId: stripeAccountId,
        refreshUrl: app.deps.env.STRIPE_CONNECT_REFRESH_URL,
        returnUrl: app.deps.env.STRIPE_CONNECT_RETURN_URL,
        type: 'account_onboarding',
      });

      return {
        stripeAccountId,
        url: link.url,
        expiresAt: new Date(link.expires_at * 1000).toISOString(),
      };
    },
  );

  app.post(
    '/providers/me/stripe-connect/dashboard-link',
    {
      preHandler: app.requireAuth({ roles: ['provider'], stepUpMaxAgeSec: STEP_UP_MAX_AGE_SEC }),
      schema: {
        tags: ['providers'],
        summary:
          'Issue a Stripe Express dashboard login link — requires step-up MFA. Used for bank-detail edits and payout withdrawals (OH-110 AC #3, AC #4).',
        description:
          'Returns a one-time Stripe Express dashboard login URL. Bank-detail edits and payout withdrawals both happen inside the Express dashboard, so this single MFA-gated endpoint covers OH-110 AC #3 (bank-detail change requires step-up MFA) and AC #4 (withdrawal initiation requires step-up MFA). Requires a step-up MFA grant issued within the last 5 minutes (`POST /v1/auth/step-up` from OH-103); without it the auth plugin returns 403 `step_up_required`.',
        security: [{ supabaseAccessToken: [] }],
        response: {
          200: DashboardLinkResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const provider = await loadProvider(principal.uid);
      if (!provider) {
        reply.code(404);
        return { error: 'provider_not_found' };
      }
      const row = await loadConnectAccount(provider.id);
      if (!row?.stripe_account_id) {
        reply.code(400);
        return {
          error: 'connect_account_missing',
          reason: 'complete Stripe Connect onboarding before opening the Express dashboard',
        };
      }

      const link = await app.deps.stripe.createLoginLink(row.stripe_account_id);
      return {
        url: link.url,
        createdAt: new Date(link.created * 1000).toISOString(),
      };
    },
  );
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

async function fetchSupabaseUser(
  app: {
    deps: {
      supabase: {
        admin: {
          auth: {
            admin: {
              getUserById: (uid: string) => Promise<{
                data: { user: SupabaseUserShape | null } | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    };
  },
  uid: string,
): Promise<SupabaseUserShape> {
  const { data, error } = await app.deps.supabase.admin.auth.admin.getUserById(uid);
  if (error || !data?.user) {
    throw new Error(`supabase getUserById failed: ${error?.message ?? 'no user'}`);
  }
  return data.user;
}
