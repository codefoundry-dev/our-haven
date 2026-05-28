import { type Kysely, sql } from 'kysely';

/**
 * Install the pgmq extension and create the v1 queues.
 * Replaces Cloud Tasks per ADR-0010.
 *
 * Queues:
 *   - booking_lifecycle  : Booking 24h-expire, Session 24h-auto-confirm, Dispute window expiry
 *   - retention_planner  : 30d soft-delete, 7y financial pseudonymization, 3y messages,
 *                          6mo bg-check raw data, state-privacy SLA fan-out
 *
 * On Supabase, pgmq is enabled via the extensions catalog. Locally (docker-compose
 * Postgres) the extension must be available — Postgres 16 + the pgmq extension
 * package on the image, or run against `supabase start` for the full local stack.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS pgmq CASCADE`.execute(db);
  await sql`SELECT pgmq.create('booking_lifecycle')`.execute(db);
  await sql`SELECT pgmq.create('retention_planner')`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`SELECT pgmq.drop_queue('retention_planner')`.execute(db);
  await sql`SELECT pgmq.drop_queue('booking_lifecycle')`.execute(db);
  // Keep the extension installed — other tenants in the cluster may depend on it.
}
