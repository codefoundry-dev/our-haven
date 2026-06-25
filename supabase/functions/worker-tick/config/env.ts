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
