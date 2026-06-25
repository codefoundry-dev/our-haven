import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z
    .string()
    .url()
    .describe(
      'Postgres connection string. Supabase Postgres (US `us-east-1`) in prod, local Postgres in dev. ADR-0010.',
    ),
  DATABASE_SSL: z.coerce.boolean().default(false),

  SUPABASE_URL: z
    .string()
    .url()
    .describe('Supabase project URL, e.g. https://<ref>.supabase.co. US-region project per ADR-0010.'),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1)
    .describe(
      'Supabase service-role key. Server-only; gives the backend full admin access (auth.admin.updateUserById, storage create-signed-upload-url, etc.). NEVER ship to clients.',
    ),
  SUPABASE_JWT_SECRET: z
    .string()
    .min(1)
    .describe(
      'Supabase project JWT secret (HS256). Used by the auth plugin to verify access tokens locally without an extra network call.',
    ),
  SUPABASE_STORAGE_BUCKET: z
    .string()
    .min(1)
    .describe('Supabase Storage bucket name for signed-URL uploads (ID docs, license docs, etc.).'),
  SUPABASE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),

  LICENSE_BOARD_SUPPORTED_STATES: z
    .string()
    .default('')
    .describe(
      'Comma-separated US-state codes whose per-state Specialist license-board adapter has shipped (OH-107). Specialists outside this list route to verification holding-state-not-supported. Empty = no adapter yet.',
    ),

  STRIPE_SECRET_KEY: z
    .string()
    .min(1)
    .describe('Stripe secret API key (sk_test_… in dev, sk_live_… in prod). Server-only.'),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .min(1)
    .describe(
      'Stripe webhook signing secret (whsec_…) for the screening-charge endpoint. Per Stripe webhook setup.',
    ),
  STRIPE_CONNECT_WEBHOOK_SECRET: z
    .string()
    .min(1)
    .describe(
      'Stripe Connect webhook signing secret (whsec_…) for `account.updated` events on Provider Connect Express accounts (OH-110). Configured separately from STRIPE_WEBHOOK_SECRET because Connect events ship on a distinct webhook endpoint.',
    ),
  STRIPE_CONNECT_RETURN_URL: z
    .string()
    .url()
    .default('http://localhost:3000/portal/verification?stripe=return')
    .describe(
      'Where Stripe redirects a Provider after they finish (or close) the hosted Connect Express onboarding flow. The page should re-fetch the verification + Stripe-Connect summary to reflect new capabilities.',
    ),
  STRIPE_CONNECT_REFRESH_URL: z
    .string()
    .url()
    .default('http://localhost:3000/portal/verification?stripe=refresh')
    .describe(
      'Where Stripe redirects when the Provider needs a fresh onboarding link mid-flow (e.g. the previous link expired). The page should request a new onboarding link and continue.',
    ),
  SCREENING_CHARGE_CENTS: z.coerce
    .number()
    .int()
    .positive()
    .default(3500)
    .describe('Amount charged to the Provider when initiating background screening (cents). $35 per ADR-0007.'),

  // OH-111 Stripe Tax. Wired up at launch across all US states per
  // ADR-0009 / CONTEXT.md § Sales tax model. The two tax codes are Stripe
  // Tax product-category codes (https://docs.stripe.com/tax/tax-codes) —
  // tweak per Stripe's taxonomy if their guidance shifts.
  STRIPE_TAX_SUBSCRIPTION_TAX_CODE: z
    .string()
    .min(1)
    .default('txcd_10103001')
    .describe(
      'Stripe Tax product tax code for Parent Subscription line items. `txcd_10103001` = "Software as a service (SaaS) — business use" which Stripe Tax routes per the subscriber\'s state for digital-access subscription taxability decisions.',
    ),
  STRIPE_TAX_COMMISSION_TAX_CODE: z
    .string()
    .min(1)
    .default('txcd_20030000')
    .describe(
      'Stripe Tax product tax code for Commission line items. `txcd_20030000` = "Services — general" — Commission is a B2B marketplace facilitator service charged to the Provider; Stripe Tax decides taxability per the Provider\'s state.',
    ),
  STRIPE_TAX_ORIGIN_STATE: z
    .string()
    .length(2)
    .optional()
    .describe(
      '2-letter US-state code where Our Haven is registered as the seller. Optional — when omitted, Stripe Tax falls back to the platform Stripe account\'s primary address for origin.',
    ),

  CHECKR_API_KEY: z
    .string()
    .min(1)
    .describe('Checkr secret API key. Used with HTTP Basic auth (key as username, empty password).'),
  CHECKR_WEBHOOK_SECRET: z
    .string()
    .min(1)
    .describe('Checkr webhook signing secret. HMAC-SHA256 over the raw body; matched against X-Checkr-Signature.'),
  CHECKR_PACKAGE: z
    .string()
    .min(1)
    .default('tasker_standard')
    .describe(
      'Checkr package slug — `tasker_standard` for the standard county+national+SO+SSN package per ADR-0007. May change if Checkr quotes a startup-discount package.',
    ),
  CHECKR_API_BASE: z
    .string()
    .url()
    .default('https://api.checkr.com/v1')
    .describe('Checkr API base URL. Overridable for staging / sandbox.'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvForTests(): void {
  cached = null;
}
