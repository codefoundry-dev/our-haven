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
