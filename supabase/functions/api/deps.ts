import type { Env } from './config/env.ts';
import type { Db } from './db/kysely.ts';

/**
 * Collaborators handed to the Hono app at construction (ADR-0019 § Why —
 * testability). Mirrors the Fastify `AppDeps` shape so route ports carry over
 * with minimal change; grows as the management-plane SDK (supabase-js), Storage
 * and the vendor adapters are wired in later tickets.
 */
export interface AppDeps {
  env: Env;
  db: Db;
}
