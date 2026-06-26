import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
import { NotConfiguredError } from '../errors.ts';
// Cross-tree, Deno-clean domain module (ADR-0019; the explicit-`.ts` pattern).
// The listing gate lives in the domain so every surface (this summary, the
// clinical-profile projection, the slot-publish gate, and the later Parent
// search query) reads one source of truth.
import {
  deriveListingDecision,
  type StripeSubscriptionStatus,
} from '../../../../packages/domain/src/provider-subscription/index.ts';

/**
 * Provider Subscription — Stripe Billing onboarding (OH-191) — PRD-0001 v1.7
 * story 49a; ADR-0011 / CONTEXT.md § Subscription.
 *
 * The clinical tier is monetized by a **Provider Subscription**: the Provider is
 * a Stripe *Customer* (NOT a Connect account — Providers receive no Payouts), and
 * an *active* subscription is what "lists the Provider in search and enables
 * consultation Bookings". Three provider-role-gated endpoints:
 *
 *   GET  /v1/providers/me/subscription                read the subscription + listing state
 *   POST /v1/providers/me/subscription/checkout-link  create/reuse Customer → hosted Checkout URL
 *   POST /v1/providers/me/subscription/portal-link    Stripe Billing Portal URL (manage / cancel)
 *
 * The subscription is sold on **web** (Stripe-hosted checkout) to dodge the
 * iOS/Android in-app-purchase rules — the app reads status but never sells it.
 * State is owned by the billing webhook (routes/webhooks/stripe-billing.ts);
 * these endpoints only read + the one-time Customer-create stamp at checkout
 * start (so the customer id is on file before any webhook fires — the join key).
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('ProviderSubscriptionError');

const SubscriptionStatusEnum = z.enum([
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
]);

const SubscriptionSummaryResponse = z
  .object({
    /** Stripe Billing lifecycle status, or null before the Provider has checked out. */
    status: SubscriptionStatusEnum.nullable(),
    /** The gate: true iff the Provider appears in search + can take consultation Bookings. */
    listed: z.boolean(),
    listingReason: z.enum(['active', 'trialing', 'none', 'inactive']),
    hasCustomer: z.boolean(),
    hasSubscription: z.boolean(),
    cancelAtPeriodEnd: z.boolean(),
    currentPeriodEnd: z.string().datetime().nullable(),
    priceId: z.string().nullable(),
    listedAt: z.string().datetime().nullable(),
  })
  .openapi('ProviderSubscriptionSummary');

const CheckoutLinkResponse = z
  .object({
    url: z.string().url(),
    sessionId: z.string(),
    stripeCustomerId: z.string(),
  })
  .openapi('ProviderSubscriptionCheckoutLink');

const PortalLinkResponse = z
  .object({ url: z.string().url() })
  .openapi('ProviderSubscriptionPortalLink');

interface ProviderRow {
  id: string;
  uid: string;
  role: 'caregiver' | 'provider';
  state: string;
}

interface SubscriptionRow {
  provider_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: StripeSubscriptionStatus | null;
  price_id: string | null;
  current_period_end: Date | string | null;
  cancel_at_period_end: boolean;
  listed_at: Date | string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function loadProvider(db: Db, uid: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'state'])
    .where('uid', '=', uid)
    .executeTakeFirst();
  return row ? (row as ProviderRow) : null;
}

async function loadSubscription(db: Db, providerId: string): Promise<SubscriptionRow | null> {
  const row = await db
    .selectFrom('provider_subscriptions')
    .select([
      'provider_id',
      'stripe_customer_id',
      'stripe_subscription_id',
      'status',
      'price_id',
      'current_period_end',
      'cancel_at_period_end',
      'listed_at',
    ])
    .where('provider_id', '=', providerId)
    .executeTakeFirst();
  return row ? (row as unknown as SubscriptionRow) : null;
}

async function loadOrCreateSubscription(db: Db, providerId: string): Promise<SubscriptionRow> {
  const existing = await loadSubscription(db, providerId);
  if (existing) return existing;
  const inserted = await db
    .insertInto('provider_subscriptions')
    .values({ provider_id: providerId })
    .returningAll()
    .executeTakeFirstOrThrow();
  return inserted as unknown as SubscriptionRow;
}

function summaryFromRow(row: SubscriptionRow | null) {
  const status = row?.status ?? null;
  const decision = deriveListingDecision({ status });
  return {
    status,
    listed: decision.listed,
    listingReason: decision.reason,
    hasCustomer: !!row?.stripe_customer_id,
    hasSubscription: !!row?.stripe_subscription_id,
    cancelAtPeriodEnd: row?.cancel_at_period_end ?? false,
    currentPeriodEnd: toIso(row?.current_period_end ?? null),
    priceId: row?.price_id ?? null,
    listedAt: toIso(row?.listed_at ?? null),
  };
}

const summaryRoute = createRoute({
  method: 'get',
  path: '/providers/me/subscription',
  tags: ['subscription'],
  summary: "Read the authenticated Provider's subscription + listing state",
  description:
    'Returns the Provider Subscription state mirrored from Stripe billing webhooks: the lifecycle `status`, whether the Provider is currently `listed` (search-visible + bookable — true iff status is active/trialing), the cancel-at-period-end flag and current period end, and the price id. Caregivers are rejected by the provider-only role guard (403).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['provider'] })] as const,
  responses: {
    200: { description: 'Subscription summary', content: json(SubscriptionSummaryResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (caregiver / parent / admin)', content: json(ErrorResponse) },
    404: { description: 'Supply (provider) row not found', content: json(ErrorResponse) },
  },
});

const checkoutLinkRoute = createRoute({
  method: 'post',
  path: '/providers/me/subscription/checkout-link',
  tags: ['subscription'],
  summary: 'Create / reuse a Stripe Customer and return a hosted subscription Checkout URL',
  description:
    'Idempotent on the Customer: if the Provider already has a `provider_subscriptions` row with a `stripe_customer_id`, reuses it; otherwise creates a Stripe Customer (Provider as Customer — NOT Connect) and stamps it onto the row before returning. Returns a Stripe-hosted Checkout Session URL in subscription mode (STRIPE_PROVIDER_SUBSCRIPTION_PRICE_ID). On completion Stripe redirects to STRIPE_SUBSCRIPTION_SUCCESS_URL and the billing webhook activates the listing.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['provider'] })] as const,
  responses: {
    200: { description: 'Checkout link issued', content: json(CheckoutLinkResponse) },
    400: { description: 'No email on file', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Supply (provider) row not found', content: json(ErrorResponse) },
  },
});

const portalLinkRoute = createRoute({
  method: 'post',
  path: '/providers/me/subscription/portal-link',
  tags: ['subscription'],
  summary: 'Issue a Stripe Billing Portal login link — manage / cancel the subscription',
  description:
    'Returns a one-time Stripe Billing Portal URL where the Provider can update their payment method or cancel the Provider Subscription. A cancellation flows back through the billing webhook, which clears the listing once the subscription ends. Requires an existing Stripe Customer (start checkout first).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['provider'] })] as const,
  responses: {
    200: { description: 'Billing Portal link issued', content: json(PortalLinkResponse) },
    400: { description: 'No Stripe Customer (start checkout first)', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Supply (provider) row not found', content: json(ErrorResponse) },
  },
});

export function registerProviderSubscriptionRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(summaryRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const provider = await loadProvider(db, principal.uid);
    if (!provider) {
      return c.json(
        { error: 'provider_not_found', reason: 'claim a supply role first (POST /v1/auth/role-claim)' },
        404,
      );
    }
    const row = await loadSubscription(db, provider.id);
    return c.json(summaryFromRow(row), 200);
  });

  app.openapi(checkoutLinkRoute, async (c) => {
    const { db, env, stripe, supabase } = c.var.deps;
    const principal = c.get('principal')!;

    const provider = await loadProvider(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    const row = await loadOrCreateSubscription(db, provider.id);

    let stripeCustomerId = row.stripe_customer_id;
    if (!stripeCustomerId) {
      const email = principal.email ?? (await fetchSupabaseEmail(supabase, principal.uid));
      if (!email) {
        return c.json({ error: 'email_required', reason: 'verify your email before subscribing' }, 400);
      }
      const customer = await stripe.createBillingCustomer({
        email,
        providerId: provider.id,
        metadata: { uid: principal.uid, state: provider.state },
      });
      stripeCustomerId = customer.id;
      await db
        .updateTable('provider_subscriptions')
        .set({ stripe_customer_id: stripeCustomerId, updated_at: new Date() })
        .where('provider_id', '=', provider.id)
        .execute();
    }

    if (!env.STRIPE_PROVIDER_SUBSCRIPTION_PRICE_ID) {
      throw new NotConfiguredError('STRIPE_PROVIDER_SUBSCRIPTION_PRICE_ID');
    }
    const session = await stripe.createSubscriptionCheckoutSession({
      customerId: stripeCustomerId,
      priceId: env.STRIPE_PROVIDER_SUBSCRIPTION_PRICE_ID,
      successUrl: env.STRIPE_SUBSCRIPTION_SUCCESS_URL,
      cancelUrl: env.STRIPE_SUBSCRIPTION_CANCEL_URL,
      clientReferenceId: provider.id,
      metadata: { uid: principal.uid },
    });

    return c.json({ url: session.url, sessionId: session.id, stripeCustomerId }, 200);
  });

  app.openapi(portalLinkRoute, async (c) => {
    const { db, env, stripe } = c.var.deps;
    const principal = c.get('principal')!;

    const provider = await loadProvider(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    const row = await loadSubscription(db, provider.id);
    if (!row?.stripe_customer_id) {
      return c.json(
        { error: 'no_customer', reason: 'start a subscription checkout before opening the billing portal' },
        400,
      );
    }

    const session = await stripe.createBillingPortalSession({
      customerId: row.stripe_customer_id,
      returnUrl: env.STRIPE_BILLING_PORTAL_RETURN_URL,
    });
    return c.json({ url: session.url }, 200);
  });
}

/**
 * Fall back to the Supabase admin API for the user's email only when the JWT
 * carries none (the access token's `email` claim is the happy path). Mirrors
 * caregiver-connect.ts — a lookup failure surfaces as the 400 `email_required`.
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
