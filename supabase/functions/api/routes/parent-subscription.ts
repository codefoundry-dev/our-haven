import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
import { NotConfiguredError } from '../errors.ts';
// Cross-tree, Deno-clean domain module (ADR-0019; the explicit-`.ts` pattern).
// The access gate lives in the domain so every surface (this summary today, and
// the M3 search-unblur / messaging / Book-request / Job-posting / consultation
// gates later) reads one source of truth.
import {
  deriveAccessDecision,
  type StripeSubscriptionStatus,
} from '../../../../packages/domain/src/parent-subscription/index.ts';

/**
 * Parent Subscription — Stripe Billing onboarding (OH-193) — PRD-0001 v1.7
 * stories 7–9; ADR-0011 / CONTEXT.md § Subscription.
 *
 * The demand side is monetized by a **Parent Subscription**: the Parent is a
 * Stripe *Customer*, and an *active* subscription is what unlocks full search
 * (lifting the preview blur), messaging, sending Book-requests, posting Jobs, and
 * booking Provider consultations. Three parent-role-gated endpoints:
 *
 *   GET  /v1/parents/me/subscription                read the subscription + access state
 *   POST /v1/parents/me/subscription/checkout-link  create/reuse Customer → hosted Checkout URL
 *   POST /v1/parents/me/subscription/portal-link    Stripe Billing Portal URL (manage / cancel)
 *
 * The subscription is sold on **web** (Stripe-hosted checkout) to dodge the
 * iOS/Android in-app-purchase rules — the app reads status but never sells it.
 * Checkout supports **Stripe Promotion Codes** (story 9 — "apply a discount
 * code"). State is owned by the billing webhook (routes/webhooks/stripe-billing.ts);
 * these endpoints only read + the one-time Customer-create stamp at checkout
 * start (so the customer id is on file before any webhook fires — the join key).
 *
 * Unlike the Provider Subscription there is **no `parents` table** — a Parent is
 * just the Supabase auth user — so the row is keyed by the JWT `uid` directly;
 * there is no supply-row lookup and so no 404-missing-row path.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('ParentSubscriptionError');

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
    /** Stripe Billing lifecycle status, or null before the Parent has checked out. */
    status: SubscriptionStatusEnum.nullable(),
    /** The gate: true iff the marketplace is unlocked (the M3 paywall reads this). */
    entitled: z.boolean(),
    accessReason: z.enum(['active', 'trialing', 'none', 'inactive']),
    hasCustomer: z.boolean(),
    hasSubscription: z.boolean(),
    cancelAtPeriodEnd: z.boolean(),
    currentPeriodEnd: z.string().datetime().nullable(),
    priceId: z.string().nullable(),
    entitledAt: z.string().datetime().nullable(),
  })
  .openapi('ParentSubscriptionSummary');

const CheckoutLinkRequest = z
  .object({
    /** A Stripe Promotion Code id (`promo_…`) to pre-apply (deep link from a launch promo). */
    promotionCode: z.string().min(1).max(255).optional(),
    /** Render the hosted "Add promotion code" field. Defaults true; ignored when promotionCode is set. */
    allowPromotionCodes: z.boolean().optional(),
  })
  .openapi('ParentSubscriptionCheckoutLinkRequest');

const CheckoutLinkResponse = z
  .object({
    url: z.string().url(),
    sessionId: z.string(),
    stripeCustomerId: z.string(),
  })
  .openapi('ParentSubscriptionCheckoutLink');

const PortalLinkResponse = z
  .object({ url: z.string().url() })
  .openapi('ParentSubscriptionPortalLink');

interface SubscriptionRow {
  uid: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: StripeSubscriptionStatus | null;
  price_id: string | null;
  current_period_end: Date | string | null;
  cancel_at_period_end: boolean;
  entitled_at: Date | string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function loadSubscription(db: Db, uid: string): Promise<SubscriptionRow | null> {
  const row = await db
    .selectFrom('parent_subscriptions')
    .select([
      'uid',
      'stripe_customer_id',
      'stripe_subscription_id',
      'status',
      'price_id',
      'current_period_end',
      'cancel_at_period_end',
      'entitled_at',
    ])
    .where('uid', '=', uid)
    .executeTakeFirst();
  return row ? (row as unknown as SubscriptionRow) : null;
}

async function loadOrCreateSubscription(db: Db, uid: string): Promise<SubscriptionRow> {
  const existing = await loadSubscription(db, uid);
  if (existing) return existing;
  const inserted = await db
    .insertInto('parent_subscriptions')
    .values({ uid })
    .returningAll()
    .executeTakeFirstOrThrow();
  return inserted as unknown as SubscriptionRow;
}

function summaryFromRow(row: SubscriptionRow | null) {
  const status = row?.status ?? null;
  const decision = deriveAccessDecision({ status });
  return {
    status,
    entitled: decision.entitled,
    accessReason: decision.reason,
    hasCustomer: !!row?.stripe_customer_id,
    hasSubscription: !!row?.stripe_subscription_id,
    cancelAtPeriodEnd: row?.cancel_at_period_end ?? false,
    currentPeriodEnd: toIso(row?.current_period_end ?? null),
    priceId: row?.price_id ?? null,
    entitledAt: toIso(row?.entitled_at ?? null),
  };
}

const summaryRoute = createRoute({
  method: 'get',
  path: '/parents/me/subscription',
  tags: ['subscription'],
  summary: "Read the authenticated Parent's subscription + access state",
  description:
    'Returns the Parent Subscription state mirrored from Stripe billing webhooks: the lifecycle `status`, whether the Parent is currently `entitled` (the marketplace is unlocked — true iff status is active/trialing; this is the state the M3 paywall reads), the cancel-at-period-end flag and current period end, and the price id. Supply roles are rejected by the parent-only role guard (403).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  responses: {
    200: { description: 'Subscription summary', content: json(SubscriptionSummaryResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (caregiver / provider / admin)', content: json(ErrorResponse) },
  },
});

const checkoutLinkRoute = createRoute({
  method: 'post',
  path: '/parents/me/subscription/checkout-link',
  tags: ['subscription'],
  summary: 'Create / reuse a Stripe Customer and return a hosted subscription Checkout URL',
  description:
    'Idempotent on the Customer: if the Parent already has a `parent_subscriptions` row with a `stripe_customer_id`, reuses it; otherwise creates a Stripe Customer and stamps it onto the row before returning. Returns a Stripe-hosted Checkout Session URL in subscription mode (STRIPE_PARENT_SUBSCRIPTION_PRICE_ID). Supports Stripe Promotion Codes: by default the hosted "Add promotion code" field is shown; an optional `promotionCode` (promo_…) pre-applies a launch promo instead. The request body is optional — a bodyless POST starts a standard checkout. On completion Stripe redirects to STRIPE_PARENT_SUBSCRIPTION_SUCCESS_URL and the billing webhook unlocks access.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { body: { content: json(CheckoutLinkRequest), required: false } },
  responses: {
    200: { description: 'Checkout link issued', content: json(CheckoutLinkResponse) },
    400: { description: 'No email on file / invalid body', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
  },
});

const portalLinkRoute = createRoute({
  method: 'post',
  path: '/parents/me/subscription/portal-link',
  tags: ['subscription'],
  summary: 'Issue a Stripe Billing Portal login link — manage / cancel the subscription',
  description:
    'Returns a one-time Stripe Billing Portal URL where the Parent can update their payment method or cancel the Parent Subscription. A cancellation flows back through the billing webhook, which walls access once the subscription ends. Requires an existing Stripe Customer (start checkout first).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  responses: {
    200: { description: 'Billing Portal link issued', content: json(PortalLinkResponse) },
    400: { description: 'No Stripe Customer (start checkout first)', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
  },
});

export function registerParentSubscriptionRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(summaryRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const row = await loadSubscription(db, principal.uid);
    return c.json(summaryFromRow(row), 200);
  });

  app.openapi(checkoutLinkRoute, async (c) => {
    const { db, env, stripe, supabase } = c.var.deps;
    const principal = c.get('principal')!;

    // The body validator only runs for `required: true` bodies (the optional
    // promo body is parsed here so a bodyless POST starts a standard checkout).
    const rawBody = await c.req.text();
    let body: z.infer<typeof CheckoutLinkRequest> = {};
    if (rawBody.trim().length > 0) {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawBody);
      } catch {
        return c.json({ error: 'invalid_json' }, 400);
      }
      const parsed = CheckoutLinkRequest.safeParse(parsedJson);
      if (!parsed.success) {
        return c.json({ error: 'invalid_request', reason: parsed.error.issues[0]?.message }, 400);
      }
      body = parsed.data;
    }

    const row = await loadOrCreateSubscription(db, principal.uid);

    let stripeCustomerId = row.stripe_customer_id;
    if (!stripeCustomerId) {
      const email = principal.email ?? (await fetchSupabaseEmail(supabase, principal.uid));
      if (!email) {
        return c.json({ error: 'email_required', reason: 'verify your email before subscribing' }, 400);
      }
      const customer = await stripe.createParentBillingCustomer({
        email,
        uid: principal.uid,
      });
      stripeCustomerId = customer.id;
      await db
        .updateTable('parent_subscriptions')
        .set({ stripe_customer_id: stripeCustomerId, updated_at: new Date() })
        .where('uid', '=', principal.uid)
        .execute();
    }

    if (!env.STRIPE_PARENT_SUBSCRIPTION_PRICE_ID) {
      throw new NotConfiguredError('STRIPE_PARENT_SUBSCRIPTION_PRICE_ID');
    }
    const session = await stripe.createParentSubscriptionCheckoutSession({
      customerId: stripeCustomerId,
      priceId: env.STRIPE_PARENT_SUBSCRIPTION_PRICE_ID,
      successUrl: env.STRIPE_PARENT_SUBSCRIPTION_SUCCESS_URL,
      cancelUrl: env.STRIPE_PARENT_SUBSCRIPTION_CANCEL_URL,
      clientReferenceId: principal.uid,
      promotionCode: body.promotionCode,
      allowPromotionCodes: body.allowPromotionCodes,
    });

    return c.json({ url: session.url, sessionId: session.id, stripeCustomerId }, 200);
  });

  app.openapi(portalLinkRoute, async (c) => {
    const { db, env, stripe } = c.var.deps;
    const principal = c.get('principal')!;

    const row = await loadSubscription(db, principal.uid);
    if (!row?.stripe_customer_id) {
      return c.json(
        { error: 'no_customer', reason: 'start a subscription checkout before opening the billing portal' },
        400,
      );
    }

    const session = await stripe.createBillingPortalSession({
      customerId: row.stripe_customer_id,
      returnUrl: env.STRIPE_PARENT_BILLING_PORTAL_RETURN_URL,
    });
    return c.json({ url: session.url }, 200);
  });
}

/**
 * Fall back to the Supabase admin API for the user's email only when the JWT
 * carries none (the access token's `email` claim is the happy path). Mirrors
 * provider-subscription.ts / caregiver-connect.ts — a lookup failure surfaces as
 * the 400 `email_required`.
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
