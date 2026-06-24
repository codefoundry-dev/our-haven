import { Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import postgres from 'postgres';

// The Database contract is owned by the migrations in apps/backend (single
// source of truth). It only imports the bare `kysely` types — no `@/` aliases,
// no `.js` relatives — so it is Deno-clean and safe to reach cross-tree with an
// explicit `.ts` specifier (the Gate-0 spike proved out-of-tree imports deploy).
import type { Database } from '../../../../apps/backend/src/db/schema.ts';
import type { Env } from '../config/env.ts';

export type Db = Kysely<Database>;

/**
 * The production query path (ADR-0019 § Decision 3): Kysely over postgres.js on
 * a Supavisor transaction-mode connection. The settings are the ones the Gate-0
 * spike (OH-236) proved green:
 *   - prepare:false  — MANDATORY; named prepared statements do not survive
 *                      across transaction-pooled connections.
 *   - max:1          — an isolate holds at most one connection; Supavisor does
 *                      the real pooling. Call once at module scope so a warm
 *                      isolate reuses it.
 *   - ssl:'require'  — TLS without CA verification (libpq sslmode=require).
 *
 * Atomicity is always a TS-orchestrated `db.transaction()`, never plpgsql —
 * the plpgsql canary's permanently-green state.
 */
export function createDb(env: Env): Db {
  const sql = postgres(env.DATABASE_URL, {
    prepare: false,
    max: 1,
    ssl: env.DATABASE_SSL ? 'require' : undefined,
    connect_timeout: 10,
    idle_timeout: 20,
  });

  return new Kysely<Database>({
    dialect: new PostgresJSDialect({ postgres: sql }),
  });
}
