import { z } from 'zod';

/**
 * Edge-side environment for the `worker-tick` function (ADR-0019 § Decision 4;
 * OH-237). Leaner than the `api` function: the tick only needs the data-plane
 * connection and the shared secret that authenticates the pg_cron caller — no
 * JWT verification, no management-plane admin client.
 *
 * `loadEnv` takes the source record explicitly (rather than reading `Deno.env`
 * itself) so the whole module stays runtime-agnostic and Node-testable:
 * `index.ts` passes `Deno.env.toObject()`, tests pass a literal.
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

  WORKER_TICK_SECRET: z
    .string()
    .min(1)
    .describe(
      'Shared secret presented as `Authorization: Bearer <secret>` by the pg_cron + pg_net minute tick. The function rejects any caller that does not match it (constant-time). Set via `supabase secrets set` and mirrored into the `app.worker_tick_secret` DB GUC the cron command reads. NOT SUPABASE_-prefixed: the platform reserves that prefix for its own auto-injected vars.',
    ),

  // ── Background screening (OH-185; ADR-0007) ──────────────────────────────
  // The worker-tick is the ONLY host that calls Checkr's REST API: the
  // screening-invite dispatcher drains `screening.invite` outbox rows and makes
  // the slow candidate + invitation calls durably, off the request path. It does
  // not verify Checkr webhooks (that is the `api` host), so no webhook secret here.
  CHECKR_API_KEY: z
    .string()
    .min(1)
    .describe(
      'Checkr secret API key (Basic auth) used to create candidates + invitations. Server-only; set via `supabase secrets set`.',
    ),
  CHECKR_PACKAGE: z
    .string()
    .min(1)
    .default('tasker_standard')
    .describe(
      'Checkr package slug requested on the invitation (ADR-0007). Must match the slug stamped onto provider_screenings.package by the api initiate route.',
    ),
  CHECKR_API_BASE: z
    .string()
    .url()
    .default('https://api.checkr.com/v1')
    .describe('Checkr API base URL. Overridable for staging / sandbox; tests inject a fetch stub instead.'),

  // ── Notifications dispatcher (OH-194; CONTEXT § Notifications) ────────────
  // ALL optional so the function still boots with only DB + secret + Checkr set:
  // an unconfigured channel is simply skipped (best-effort) or, for the four
  // SMS-mandatory event kinds, makes the row fail loudly (so a misconfigured prod
  // can never silently drop a mandatory SMS). The dispatcher builds an adapter
  // only when its secrets are present.
  NOTIFICATIONS_DEEP_LINK_BASE_MOBILE: z
    .string()
    .min(1)
    .default('ourhaven://')
    .describe('Mobile custom-scheme base for deep links (docs/notifications-deep-link-format.md).'),
  NOTIFICATIONS_DEEP_LINK_BASE_WEB: z
    .string()
    .url()
    .default('https://provider.ourhaven.com/')
    .describe('Web portal base for deep links (used in web-push + email bodies).'),

  // Resend (email) — both required together to enable the email channel.
  RESEND_API_KEY: z.string().min(1).optional().describe('Resend API key (re_…).'),
  RESEND_FROM: z
    .string()
    .min(1)
    .default('Our Haven <notifications@ourhaven.com>')
    .describe('Verified Resend From address.'),

  // Twilio (SMS) — all three required together to enable the SMS channel.
  TWILIO_ACCOUNT_SID: z.string().min(1).optional().describe('Twilio Account SID (AC…).'),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional().describe('Twilio auth token.'),
  TWILIO_FROM_NUMBER: z.string().min(1).optional().describe('Twilio sender number (E.164).'),

  // Expo Push (mobile) — access token optional (only needed with Enhanced Security).
  EXPO_ACCESS_TOKEN: z
    .string()
    .min(1)
    .optional()
    .describe('Expo access token; required only when the project enables push Enhanced Security.'),

  // VAPID (web push) — public + private required together to enable web push.
  VAPID_PUBLIC_KEY: z
    .string()
    .min(1)
    .optional()
    .describe('VAPID public key (base64url uncompressed P-256 point).'),
  VAPID_PRIVATE_KEY: z
    .string()
    .min(1)
    .optional()
    .describe('VAPID private key (base64url 32-byte P-256 scalar).'),
  VAPID_SUBJECT: z
    .string()
    .min(1)
    .default('mailto:notifications@ourhaven.com')
    .describe('VAPID sub claim — a contact URI for the push service.'),
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
