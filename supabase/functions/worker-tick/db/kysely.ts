import { Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import postgres from 'postgres';

// The Database contract is owned by the migrations in apps/backend (single
// source of truth, shared with the `api` function). It imports only the bare
// `kysely` types — no `@/` aliases, no `.js` relatives — so it is Deno-clean and
// safe to reach cross-tree with an explicit `.ts` specifier.
import type { Database } from '../../../../apps/backend/src/db/schema.ts';
import type { Env } from '../config/env.ts';

export type Db = Kysely<Database>;

/**
 * Same production query path as the `api` function (ADR-0019 § Decision 3):
 * Kysely over postgres.js on a Supavisor transaction-mode connection.
 *   - prepare:false  — named prepared statements do not survive transaction-
 *                      pooled connections.
 *   - max:1          — an isolate holds at most one connection; Supavisor pools.
 *   - ssl:'require'  — TLS without CA verification (libpq sslmode=require).
 *
 * Sweep + drain atomicity is always a TS-orchestrated `db.transaction()` with
 * `FOR UPDATE SKIP LOCKED` row claims — never plpgsql.
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
