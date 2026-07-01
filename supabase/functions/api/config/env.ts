import { z } from 'zod';

/**
 * Edge-side environment for the `api` fat function (ADR-0019). Deliberately a
 * separate, leaner schema from `apps/backend/src/config/env.ts` (the Fastify
 * stack): the Edge host self-verifies JWTs and talks to Postgres over the
 * Supavisor transaction pooler, so the host skeleton only needs the data-plane
 * + auth essentials. Route ports (OH-175…) extend this as they land.
 *
 * `loadEnv` takes the source record explicitly (rather than reading
 * `Deno.env` / `process.env` itself) so the whole app stays runtime-agnostic
 * and Node-testable: `index.ts` passes `Deno.env.toObject()`, tests pass a
 * literal.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z
    .string()
    .url()
    .describe(
      'Postgres connection string pointed at the Supavisor TRANSACTION pooler (:6543) per ADR-0019 § Decision 3. postgres.js connects with prepare:false through it.',
    ),
  DATABASE_SSL: z
    .coerce.boolean()
    .default(true)
    .describe('TLS to Postgres. Supavisor requires TLS in prod; local dev may set false.'),

  JWT_SECRET: z
    .string()
    .min(1)
    .describe(
      "Supabase project JWT secret (HS256) — Dashboard → Settings → API → JWT Secret. The auth middleware verifies access tokens locally on every request. NOT named SUPABASE_JWT_SECRET: Supabase reserves the SUPABASE_ prefix for its own auto-injected vars, so a SUPABASE_*-prefixed secret can't be set via `supabase secrets set`.",
    ),

  // SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY power the management-plane admin
  // client (auth.admin.updateUserById for role-claim — OH-175). Unlike
  // JWT_SECRET, the SUPABASE_-prefixed vars ARE auto-injected by the platform
  // into every deployed Edge Function (and by local `supabase functions serve`);
  // tests + the OpenAPI emit script supply them explicitly.
  SUPABASE_URL: z
    .string()
    .url()
    .describe('Supabase project URL (https://<ref>.supabase.co). US-region project (ADR-0010). Auto-injected into deployed Edge Functions.'),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1)
    .describe(
      'Supabase service-role key — server-only, full Auth admin access (writes role claims to app_metadata). NEVER ship to clients. Auto-injected into deployed Edge Functions.',
    ),

  // ── Vendor secrets (Stripe / Checkr) — OPTIONAL by design ─────────────────
  // None of these gate boot. The fat function's core surface (auth, role-claim,
  // verification, uploads) must come up without any payment config — a missing
  // Stripe key or price id used to throw in loadEnv and 503 the WHOLE function,
  // including routes that never touch Stripe (the role-claim outage). Now each is
  // optional, and the route that actually needs one throws NotConfiguredError →
  // a clean 503 `not_configured` (see errors.ts). Set via `supabase secrets set`.

  // ── Stripe Connect Express (OH-190) ──────────────────────────────────────
  // Caregiver-only payment rail (ADR-0001 / ADR-0011): hosted KYC onboarding,
  // the `account.updated` Connect webhook, and the destination-charge
  // application_fee skim. Providers carry no Connect (clinical fees are
  // off-platform).
  STRIPE_SECRET_KEY: z
    .string()
    .min(1)
    .optional()
    .describe('Stripe secret API key (sk_test_… in dev, sk_live_… in prod). Server-only.'),
  STRIPE_CONNECT_WEBHOOK_SECRET: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Stripe Connect webhook signing secret (whsec_…) for `account.updated` events on Caregiver Connect Express accounts. Distinct endpoint + secret from the screening webhook (OH-106).',
    ),
  STRIPE_CONNECT_RETURN_URL: z
    .string()
    .url()
    .default('http://localhost:8081/caregiver/verification?stripe=return')
    .describe(
      'Where Stripe redirects a Caregiver after they finish (or close) the hosted Connect Express onboarding flow. The page re-fetches the Connect summary to reflect new capabilities.',
    ),
  STRIPE_CONNECT_REFRESH_URL: z
    .string()
    .url()
    .default('http://localhost:8081/caregiver/verification?stripe=refresh')
    .describe(
      'Where Stripe redirects when the Caregiver needs a fresh onboarding link mid-flow (e.g. the previous link expired). The page requests a new onboarding link and continues.',
    ),
  STRIPE_API_BASE: z
    .string()
    .url()
    .default('https://api.stripe.com/v1')
    .describe('Stripe API base URL. Overridable for staging / sandbox; tests inject a fetch stub instead.'),

  // ── Background screening (OH-185; ADR-0007) ──────────────────────────────
  // The $35 Stripe charge + Checkr standard-package screening. The Checkr
  // invitation (the slow vendor call) is made by the worker-tick off the
  // notification outbox; the `api` function only (1) creates the charge, (2)
  // verifies the payments webhook, and (3) verifies the Checkr report webhook —
  // so it needs the two webhook secrets + the charge amount + the package slug
  // (stamped onto the screening row), but NOT CHECKR_API_KEY (that lives on the
  // worker-tick, which is the only host that calls Checkr's REST API).
  STRIPE_PAYMENTS_WEBHOOK_SECRET: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Stripe webhook signing secret (whsec_…) for the payments endpoint that delivers `payment_intent.succeeded` for the screening charge. Distinct endpoint + secret from the Connect webhook (OH-190).',
    ),
  CHECKR_WEBHOOK_SECRET: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Checkr webhook signing secret. The Checkr webhook route HMAC-verifies the raw body against it (X-Checkr-Signature). Server-only; set via `supabase secrets set`.',
    ),
  CHECKR_PACKAGE: z
    .string()
    .min(1)
    .default('tasker_standard')
    .describe(
      'Checkr package slug stamped onto provider_screenings.package and used by the worker-tick invitation call (ADR-0007: county criminal 7yr + national criminal DB + national sex-offender registry + SSN trace).',
    ),
  SCREENING_CHARGE_CENTS: z
    .coerce.number()
    .int()
    .positive()
    .default(3500)
    .describe(
      'The background-screening fee charged to the applicant, in cents (default 3500 = $35). Platform margin over Checkr’s ~$30 standard-package cost (PRD-0001 story 42).',
    ),

  // ── Supply verification (OH-184 / OH-186) ────────────────────────────────
  // Resident-state slate for the Provider license gate. The CANONICAL slate is
  // `LICENSE_BOARD_LAUNCH_STATES` in @our-haven/domain (license-board); OH-186
  // made that module Deno-clean, so the provider-credentials route now reads the
  // board slate (name/register-URL/mode) straight from the domain. This CSV
  // remains the ops-overridable seam that drives ONLY the verification
  // holding-state branch (verification.ts → computeVerificationState), letting
  // ops toggle a state without a deploy; it defaults to the same 12 states as the
  // domain slate. A Provider whose resident state is outside this set rests in
  // `holding-state-not-supported`. Caregivers ignore it (Checkr is multi-state).
  LICENSE_BOARD_SUPPORTED_STATES: z
    .string()
    .default('CA,FL,TX,NY,IL,GA,NC,PA,OH,AZ,WA,MA')
    .describe(
      'Comma-separated US state codes with a shipped license-board adapter (mirrors @our-haven/domain LICENSE_BOARD_LAUNCH_STATES). Drives the Provider holding-state branch (OH-184/OH-186).',
    ),
  ID_DOC_BUCKET: z
    .string()
    .min(1)
    .default('id-docs')
    .describe(
      'Private Supabase Storage bucket holding government-ID uploads. Signed upload URLs are minted by the service-role admin client (POST /v1/uploads/signed-url); objects are namespaced id-doc/<uid>/<uuid>. Provisioned by migration 20260627000001.',
    ),
  AVATAR_BUCKET: z
    .string()
    .min(1)
    .default('avatars')
    .describe(
      'PUBLIC Supabase Storage bucket holding Caregiver/Provider profile photos. Unlike ID_DOC_BUCKET it is public (avatars are shown to Parents in search) so photo_object_path resolves to a stable /storage/v1/object/public/<bucket>/<path> URL. Uploads are still client-direct via a one-time signed upload URL (kind `avatar`, namespaced avatar/<uid>/<uuid>). Provisioned by migration 20260705000001.',
    ),

  // ── Stripe Tax (OH-192) ──────────────────────────────────────────────────
  // Per-state taxability on the Parent Subscription + the platform Commission
  // (ADR-0009 / CONTEXT § Sales tax model). Tax codes drive the Stripe Tax
  // Calculation line item; Bookings are deliberately never plumbed through
  // Stripe Tax (the route layer enforces the `subscription | commission` guard).
  // Defaults keep the host bootable without extra secrets — both are stable,
  // non-sensitive Stripe tax-code identifiers, not credentials.
  STRIPE_TAX_SUBSCRIPTION_TAX_CODE: z
    .string()
    .min(1)
    .default('txcd_10103001')
    .describe(
      'Stripe Tax product tax code for the Parent Subscription line (default txcd_10103001 — "Software as a service (SaaS) — business use"). State = subscriber\'s resident state.',
    ),
  STRIPE_TAX_COMMISSION_TAX_CODE: z
    .string()
    .min(1)
    .default('txcd_20030000')
    .describe(
      'Stripe Tax product tax code for the platform Commission line (default txcd_20030000 — "General services"). State = Provider\'s resident state (B2B service).',
    ),
  STRIPE_TAX_ORIGIN_STATE: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/)
    .optional()
    .describe(
      "2-letter US state where Our Haven is registered as the seller. Stripe Tax uses it alongside the customer address to decide nexus; omitted falls back to the account's primary address.",
    ),

  // ── Provider Subscription — Stripe Billing (OH-191; ADR-0011) ─────────────
  // The clinical tier's listing fee: the Provider is a Stripe Customer (NOT a
  // Connect account), drives a Stripe-hosted Checkout Session in subscription
  // mode (sold on web to dodge iOS/Android IAP), and the billing webhook mirrors
  // the lifecycle onto provider_subscriptions. Distinct endpoint + secret from
  // the Connect (OH-190) and payments (OH-185) webhooks.
  STRIPE_BILLING_WEBHOOK_SECRET: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Stripe webhook signing secret (whsec_…) for the billing endpoint that delivers checkout.session.completed + customer.subscription.* for the Provider Subscription. Distinct endpoint + secret from the Connect + payments webhooks. Server-only; set via `supabase secrets set`.',
    ),
  STRIPE_PROVIDER_SUBSCRIPTION_PRICE_ID: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Stripe recurring Price id (price_…) for the self-serve Provider Subscription. No sensible default; the provider-subscription checkout route throws NotConfiguredError (503) if a Provider tries to subscribe while this is unset.',
    ),
  STRIPE_SUBSCRIPTION_SUCCESS_URL: z
    .string()
    .url()
    .default('http://localhost:8081/provider/subscription?checkout=success')
    .describe('Where Stripe Checkout redirects a Provider after a completed subscription checkout.'),
  STRIPE_SUBSCRIPTION_CANCEL_URL: z
    .string()
    .url()
    .default('http://localhost:8081/provider/subscription?checkout=cancel')
    .describe('Where Stripe Checkout redirects a Provider who abandons the subscription checkout.'),
  STRIPE_BILLING_PORTAL_RETURN_URL: z
    .string()
    .url()
    .default('http://localhost:8081/provider/subscription')
    .describe('Where the Stripe Billing Portal returns a Provider after managing/cancelling their subscription.'),

  // ── Parent Subscription — Stripe Billing (OH-193; ADR-0011) ──────────────
  // The demand-side access fee: the Parent is a Stripe Customer, drives a
  // Stripe-hosted Checkout Session in subscription mode (sold on web to dodge
  // iOS/Android IAP), and the SAME billing webhook (STRIPE_BILLING_WEBHOOK_SECRET
  // above — one endpoint, one secret per Stripe billing event family) mirrors the
  // lifecycle onto parent_subscriptions. Checkout supports Stripe Promotion Codes.
  STRIPE_PARENT_SUBSCRIPTION_PRICE_ID: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Stripe recurring Price id (price_…) for the self-serve Parent Subscription. No sensible default; the parent-subscription checkout route throws NotConfiguredError (503) if a Parent tries to subscribe while this is unset.',
    ),
  STRIPE_PARENT_SUBSCRIPTION_SUCCESS_URL: z
    .string()
    .url()
    .default('http://localhost:8081/parent/subscription?checkout=success')
    .describe('Where Stripe Checkout redirects a Parent after a completed subscription checkout.'),
  STRIPE_PARENT_SUBSCRIPTION_CANCEL_URL: z
    .string()
    .url()
    .default('http://localhost:8081/parent/subscription?checkout=cancel')
    .describe('Where Stripe Checkout redirects a Parent who abandons the subscription checkout.'),
  STRIPE_PARENT_BILLING_PORTAL_RETURN_URL: z
    .string()
    .url()
    .default('http://localhost:8081/parent/subscription')
    .describe('Where the Stripe Billing Portal returns a Parent after managing/cancelling their subscription.'),

  // ── Corporate Contact-Us routing (OH-191) ────────────────────────────────
  // The sales/ops Supabase user a captured corporate intake is "routed" to via a
  // notification-outbox handoff. Optional: when unset the intake is still
  // captured (the row persists for ops to read), it just is not enqueued. Set to
  // the sales distribution user's uuid in prod.
  CONTACT_INTAKE_NOTIFY_UID: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Supabase auth uid (uuid) the corporate Contact-Us intake is routed to via the notification outbox. Unset → the intake is captured but not enqueued.',
    ),

  // ── Embedded video — Daily.co (OH-216; ADR-0008) ─────────────────────────
  // Ad-hoc, in-chat video calls. Optional by design (like the vendor secrets
  // above): the host boots without it, and the video route throws
  // NotConfiguredError → 503 `not_configured` only when a party tries to start a
  // call while it is unset. Not SUPABASE_-prefixed (reserved). Server-only.
  DAILY_API_KEY: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Daily.co server API key. Used to create short-lived private rooms + per-join meeting tokens for ad-hoc in-chat video (OH-216). Server-only; set via `supabase secrets set`.',
    ),
  DAILY_API_BASE: z
    .string()
    .url()
    .default('https://api.daily.co/v1')
    .describe('Daily.co REST API base URL. Overridable for staging; tests inject a fetch stub instead.'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined>): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
