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

  SUPABASE_JWT_SECRET: z
    .string()
    .min(1)
    .describe(
      'Supabase project JWT secret (HS256). The auth middleware verifies access tokens locally on every request — no extra network call.',
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
