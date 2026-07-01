import { type Kysely, sql } from 'kysely';

/**
 * Posted-Job compose columns (OH-209) — the persistence the **Post-a-Job**
 * composer was waiting for. OH-207 shipped the `jobs` table but only the
 * **Direct-Message** accept path writes to it (a DM Job is born `awarded` and
 * carries none of the compose bundle — its schedule / child detail / address
 * live on the Offer + the materialised Bookings). This migration adds the
 * columns a **posted** Job carries directly, so a Parent can compose + publish
 * an open Job that verified in-category Caregivers apply to (CONTEXT § Job /
 * § Service address; ADR-0014 concrete scheduling; ADR-0016 disclose-or-none).
 *
 * ── All new columns land NULLable (DM Jobs leave them unset) ────────────────
 * A Direct-Message Job (`origin='direct-message'`) sets none of these — its
 * schedule + child bundle are on the Offer/Bookings, not the Job row. A posted
 * Job (`origin='posted'`) populates them at publish. `safety_behaviors` /
 * `slots` default to empty (a DM Job's empties mean "no posted disclosure /
 * schedule", accurate) so the existing DM insert path is untouched.
 *
 * ── Schedule shape mirrors the Offer, minus `multi-day` (ADR-0014 §A1) ──────
 * A posted Job is either **one-off** (a single date+window → `slots` len 1) or
 * **recurring** (an anchored rule → `recurrence`). A **multi-day** one-off is
 * NOT a Job shape: the composer fans it out into **one one-off Job per date**
 * (the deliberate asymmetry vs the Book-request path, which bundles into one
 * Offer → many Bookings). So `schedule_kind` here is `one-off | recurring` only.
 *
 * ── Disclosure consent (ADR-0016 §6) ───────────────────────────────────────
 * `disclosure_consent_at` records the timestamped compose consent covering the
 * structured child detail (count + ages + disclosed Safety-Behaviors subset)
 * shown to Caregivers who open the Job. This is the *disclosure* act — distinct
 * from, and additional to, the ADR-0012 consent-to-store gate on the Parent's
 * profile checklist (`parent_profiles.safety_behaviors_consent_at`).
 *
 * Pure DDL + CHECK backstops (the Edge validates richly) — no stored routine,
 * so the plpgsql canary stays green; RLS is already service-role-only on `jobs`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('jobs')
    // ── schedule (ADR-0014): one-off | recurring (no multi-day — fanned out) ──
    .addColumn('schedule_kind', 'text')
    // [{date:'YYYY-MM-DD',startMin,endMin}] — a single-element list for a one-off
    // posted Job. Empty for recurring (the rule is in `recurrence`) and for DM Jobs.
    .addColumn('slots', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    // RecurrenceRule (booking-lifecycle shape) for a recurring Job; NULL otherwise.
    .addColumn('recurrence', 'jsonb')
    // ── child-detail bundle (ad-hoc; no Child entity — ADR-0012/0016) ─────────
    .addColumn('child_count', 'integer')
    // Integer ages in years (0–17), one per child (Edge-validated range).
    .addColumn('child_ages', sql`integer[]`)
    // Parent-disclosed Safety-Behaviors subset (taxonomy keys). [] = explicit
    // "disclose none" — the disclose-or-none choice is recorded, never defaulted.
    .addColumn('safety_behaviors', sql`text[]`, (c) =>
      c.notNull().defaultTo(sql`'{}'::text[]`),
    )
    // The timestamped compose disclosure consent (ADR-0016 §6). Set at publish
    // for a posted Job; NULL for a DM Job (no Job-level disclosure).
    .addColumn('disclosure_consent_at', 'timestamptz')
    // ── service address (split columns; mirrors offers/parent_profiles) ───────
    // Exact street reveals to Caregivers at `accepted`; the open-Job card shows
    // ZIP-centroid distance + area only (CONTEXT § Service address).
    .addColumn('service_address_line1', 'text')
    .addColumn('service_address_line2', 'text')
    .addColumn('service_city', 'text')
    .addColumn('service_state', 'text')
    .addColumn('service_postal_code', 'text')
    // Optional parent hourly-rate hint (integer cents). Advisory only — the
    // Agreed Rate is negotiated on the Offer, not set here.
    .addColumn('budget_hint_cents', 'integer')
    .execute();

  // CHECK backstops. Each is NULL-safe so a Direct-Message Job (every new column
  // unset / defaulted) passes untouched; the posted-completeness backstop only
  // bites on a published (`origin='posted'`, non-`draft`) Job.
  await sql`
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_schedule_kind_chk
        CHECK (schedule_kind IS NULL OR schedule_kind IN ('one-off','recurring')),
      ADD CONSTRAINT jobs_recurrence_presence_chk
        CHECK ((schedule_kind = 'recurring') = (recurrence IS NOT NULL)),
      ADD CONSTRAINT jobs_child_count_chk
        CHECK (child_count IS NULL OR child_count >= 1),
      ADD CONSTRAINT jobs_child_ages_count_chk
        CHECK (child_ages IS NULL OR child_count IS NULL OR cardinality(child_ages) = child_count),
      ADD CONSTRAINT jobs_tutor_single_child_chk
        CHECK (category <> 'tutor' OR child_count IS NULL OR child_count = 1),
      ADD CONSTRAINT jobs_budget_nonneg_chk
        CHECK (budget_hint_cents IS NULL OR budget_hint_cents >= 0),
      ADD CONSTRAINT jobs_service_state_chk
        CHECK (service_state IS NULL OR service_state ~ '^[A-Z]{2}$'),
      ADD CONSTRAINT jobs_service_postal_chk
        CHECK (service_postal_code IS NULL OR service_postal_code ~ '^[0-9]{5}$'),
      ADD CONSTRAINT jobs_posted_completeness_chk
        CHECK (
          origin <> 'posted'
          OR state = 'draft'
          OR (
            schedule_kind IS NOT NULL
            AND child_count IS NOT NULL
            AND service_postal_code IS NOT NULL
            AND disclosure_consent_at IS NOT NULL
          )
        )
  `.execute(db);

  // Open posted Jobs, newest first — the Caregiver discovery feed reads this.
  await sql`
    CREATE INDEX jobs_open_posted_idx
      ON public.jobs (created_at DESC)
      WHERE origin = 'posted' AND state = 'open'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('jobs_open_posted_idx').ifExists().execute();
  for (const name of [
    'jobs_schedule_kind_chk',
    'jobs_recurrence_presence_chk',
    'jobs_child_count_chk',
    'jobs_child_ages_count_chk',
    'jobs_tutor_single_child_chk',
    'jobs_budget_nonneg_chk',
    'jobs_service_state_chk',
    'jobs_service_postal_chk',
    'jobs_posted_completeness_chk',
  ]) {
    await sql`ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS ${sql.raw(name)}`.execute(db);
  }
  for (const col of [
    'schedule_kind',
    'slots',
    'recurrence',
    'child_count',
    'child_ages',
    'safety_behaviors',
    'disclosure_consent_at',
    'service_address_line1',
    'service_address_line2',
    'service_city',
    'service_state',
    'service_postal_code',
    'budget_hint_cents',
  ]) {
    await db.schema.alterTable('jobs').dropColumn(col).execute();
  }
}
