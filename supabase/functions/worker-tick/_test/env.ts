// Test-only helpers, co-located under an underscore dir so Supabase never
// deploys it as a function and it is never part of index.ts's bundle graph.
import { loadEnv, type Env } from '../config/env.ts';
import { createDb, type Db } from '../db/kysely.ts';

export function buildTestEnv(overrides: Record<string, string | undefined> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test:test@localhost:5432/our_haven_test',
    DATABASE_SSL: 'false',
    WORKER_TICK_SECRET: 'test-worker-tick-secret',
    ...overrides,
  });
}

/**
 * A real Kysely instance for compile-only assertions. postgres.js connects
 * lazily (on first query), so building this and calling `.compile()` never
 * opens a socket — safe in unit tests with no database.
 */
export function compileOnlyDb(): Db {
  return createDb(buildTestEnv());
}
