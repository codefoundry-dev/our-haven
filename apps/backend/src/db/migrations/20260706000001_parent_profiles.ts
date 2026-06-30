import { type Kysely, sql } from 'kysely';

/**
 * Parent profile (OH-200) — ADR-0012 / ADR-0016; CONTEXT.md § Parent profile /
 * § Sensitive-data consent / § Service address & distance; PRD-0001 v1.7 stories
 * 3, 4, 74, 124.
 *
 * One greenfield table — the family-level Parent profile that replaces the
 * removed Child entity (ADR-0012). Like `parent_subscriptions` there is **no
 * `parents` table** — a Parent is just the Supabase auth user — so the row is
 * keyed by `uid` (the auth user uuid) directly, with no app-schema FK (the auth
 * schema is not reachable from the public API; same posture as
 * `parent_subscriptions.uid` / `notification_outbox.recipient_uid`).
 *
 * Columns:
 *   - `bio`               — free-text family info (the disintermediation detector
 *                           runs on it at the API layer; ADR-0012).
 *   - `preferences[]`     — desired-Caregiver-traits checklist. NOT safety
 *                           critical → no consent gate (ADR-0012). Taxonomy keys
 *                           from `@our-haven/shared/parent-preferences`.
 *   - `safety_behaviors[]`           — the fixed sensitive checklist. Taxonomy
 *                           keys from `@our-haven/shared/safety-behaviors`.
 *   - `safety_behaviors_consent_at`  — the explicit, timestamped consent. NULL
 *                           until the Parent consents; cleared on withdrawal.
 *   - `default_address_*`  — optional default service address that pre-fills a
 *                           transaction's `service_address` (ADR-0016; story 124).
 *
 * Taxonomy membership for `preferences` / `safety_behaviors` is enforced at the
 * API layer (the handler runs `normaliseParentPreferences` /
 * `normaliseSafetyBehaviors`, dropping unknown tokens) — NOT a DB check — so
 * swapping in Ci'erro's final lists (M0.8 / M2.10) needs no migration.
 *
 * The one invariant the DB DOES backstop is the **consent-to-store gate** (the
 * headline compliance rule, PRD story 3): there can be no Safety Behaviors
 * without a consent timestamp. The API gate (`resolveSafetyBehaviorsSave`) is the
 * primary enforcement; this CHECK makes a gate bypass structurally impossible.
 *
 * Pure DDL — no plpgsql (the canary stays green). `cardinality()` / `char_length()`
 * / the `~` regex operator are SQL built-ins, not plpgsql. RLS is enabled; the
 * `api` Edge Function reaches the table over the privileged pooler connection.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('parent_profiles')
    // The Supabase auth user uuid (JWT `sub`). No FK — auth.users lives in the
    // `auth` schema and there is no app-side `parents` table to reference.
    .addColumn('uid', 'uuid', (c) => c.primaryKey())
    .addColumn('bio', 'text')
    .addColumn('preferences', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'::text[]`))
    // Sensitive child data — gated by the consent timestamp below (see CHECK).
    .addColumn('safety_behaviors', sql`text[]`, (c) => c.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn('safety_behaviors_consent_at', 'timestamptz')
    // Optional default service address (ADR-0016). Split columns (not a JSON blob)
    // so state / ZIP can be CHECK-constrained and indexed if proximity needs it.
    .addColumn('default_address_line1', 'text')
    .addColumn('default_address_line2', 'text')
    .addColumn('default_city', 'text')
    .addColumn('default_state', 'text')
    .addColumn('default_postal_code', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // The consent-to-store gate, backstopped (PRD story 3 / ADR-0012): no Safety
    // Behaviors may be held without a consent timestamp. Mirrors the API gate.
    .addCheckConstraint(
      'parent_profiles_consent_gate_chk',
      sql`safety_behaviors_consent_at IS NOT NULL OR cardinality(safety_behaviors) = 0`,
    )
    .addCheckConstraint('parent_profiles_bio_len', sql`bio IS NULL OR char_length(bio) <= 600`)
    .addCheckConstraint('parent_profiles_line1_len', sql`default_address_line1 IS NULL OR char_length(default_address_line1) <= 120`)
    .addCheckConstraint('parent_profiles_line2_len', sql`default_address_line2 IS NULL OR char_length(default_address_line2) <= 120`)
    .addCheckConstraint('parent_profiles_city_len', sql`default_city IS NULL OR char_length(default_city) <= 80`)
    // 2-letter US state / DC + 5-digit ZIP — API-guarded, DB-backstopped (mirrors
    // the provider zip backstop convention).
    .addCheckConstraint('parent_profiles_state_chk', sql`default_state IS NULL OR default_state ~ '^[A-Z]{2}$'`)
    .addCheckConstraint('parent_profiles_postal_chk', sql`default_postal_code IS NULL OR default_postal_code ~ '^[0-9]{5}$'`)
    .execute();

  await sql`ALTER TABLE public.parent_profiles ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('parent_profiles').ifExists().execute();
}
