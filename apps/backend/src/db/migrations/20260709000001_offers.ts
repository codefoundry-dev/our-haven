import { type Kysely, sql } from 'kysely';

/**
 * Offers / Book-requests (OH-206) — the structured price-and-scope proposal that
 * rides inside a Direct-Message thread (CONTEXT § Offer; ADR-0006/0014/0016/0017).
 * The Offer *state machine* + pricing snapshot already exist as pure domain
 * (OH-179 `offer-lifecycle`); this migration is the persistence the composer +
 * inline Offer bubble were waiting for.
 *
 * ── Anchored to the thread, rendered inline (like a message) ────────────────
 * An Offer is anchored to a `message_threads` row and interleaves chronologically
 * with messages in the transcript. It carries its own MUTABLE `status`
 * (`pending → accepted | countered | declined | expired | withdrawn`).
 *
 * ── Read ONLY through the Edge (reveal-at-accept) ───────────────────────────
 * Unlike `messages`, the table is service-role-only — NO participant SELECT
 * policy and NOT in the Realtime publication. An Offer row carries the exact
 * service address, which must stay hidden from the Caregiver until they accept
 * (story 124); a participant SELECT policy would leak the raw row (address
 * included) over a direct supabase-js read / Realtime frame. So all reads go
 * through the Edge GET, which projects the address per viewer + status. The
 * thread surface stays live via the messages Realtime channel (a poke) + focus.
 *
 * ── Scope boundary with OH-207 ──────────────────────────────────────────────
 * OH-206 owns the Offer object + the Offer-LEVEL transitions (accept flips
 * `status` to `accepted`). The atomic Job + Application + Booking materialisation
 * + thread→job rebind on accept is OH-207 — hence `job_id` is the forward-compat
 * rebind target, NULL throughout OH-206.
 *
 * ── Snapshot fidelity (CONTEXT § Offer) ─────────────────────────────────────
 * `proposed_rate_cents`, `per_child_surcharge_cents` (cents-PER-HOUR), and
 * `computed_total_cents` are snapshotted at send time and never re-derived from
 * the Caregiver's profile, so an in-flight Offer doesn't drift when the profile
 * changes. The child-detail bundle (`child_count`, `child_ages`,
 * `safety_behaviors`) + `service_address` are compose-time copies (ADR-0012/0016).
 *
 * Pure DDL + RLS policy + Realtime publication — it defines no stored routine of
 * its own (it reuses OH-205's participant helper), so no new plpgsql-canary
 * exception is needed.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('offers')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // The thread this Offer rides in. CASCADE so deleting a thread clears its Offers.
    .addColumn('thread_id', 'uuid', (c) =>
      c.references('message_threads.id').onDelete('cascade').notNull(),
    )
    // Who composed it (auth uid) + which side they are (OfferSender).
    .addColumn('sender_uid', 'uuid', (c) => c.notNull())
    .addColumn('sender', 'text', (c) => c.notNull())
    // Offer state machine (OH-179 offer-lifecycle). Born 'pending'.
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('pending'))
    // The single Caregiver service category this Offer is pinned to (ADR-0015).
    .addColumn('category', 'text', (c) => c.notNull())
    // ── pricing snapshot (integer cents; CONTEXT § Offer) ────────────────────
    .addColumn('proposed_rate_cents', 'integer', (c) => c.notNull())
    // Billable minutes summed across slots (atomic integer; hours = /60 for Pricing).
    .addColumn('scope_minutes', 'integer', (c) => c.notNull())
    // Babysitter/Nanny per-child surcharge, cents-PER-HOUR snapshot. Tutor = 0.
    .addColumn('per_child_surcharge_cents', 'integer', (c) => c.notNull().defaultTo(0))
    // Snapshot of the parent charge at send time (proposed_rate × hours + surcharge).
    .addColumn('computed_total_cents', 'integer', (c) => c.notNull())
    // Free-text note — stored REDACTED (disintermediation runs on it at write time).
    .addColumn('scope_note', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('scope_note_redacted', 'boolean', (c) => c.notNull().defaultTo(false))
    // The involved Caregiver's `negotiable` flag at send time (ADR-0017) — gates Counter.
    .addColumn('negotiable', 'boolean', (c) => c.notNull())
    // Offer TTL — default 72h, set by the handler (CONTEXT § Offer).
    .addColumn('valid_until', 'timestamptz', (c) => c.notNull())
    // ── child-detail bundle (ad-hoc; no Child entity — ADR-0012/0016) ────────
    .addColumn('child_count', 'integer', (c) => c.notNull())
    // Integer ages in years (0–17), one per child (Edge-validated range).
    .addColumn('child_ages', sql`integer[]`, (c) => c.notNull().defaultTo(sql`'{}'::integer[]`))
    // Parent-disclosed Safety-Behaviors subset (taxonomy keys). [] = explicit
    // "disclose none" — the disclose-or-none choice is recorded, never defaulted.
    .addColumn('safety_behaviors', sql`text[]`, (c) =>
      c.notNull().defaultTo(sql`'{}'::text[]`),
    )
    // ── service address (split columns; mirrors parent_profiles) ─────────────
    // Reveals to the Caregiver at accept (OH-207); pre-accept the UI shows area only.
    .addColumn('service_address_line1', 'text')
    .addColumn('service_address_line2', 'text')
    .addColumn('service_city', 'text')
    .addColumn('service_state', 'text')
    .addColumn('service_postal_code', 'text')
    // ── schedule (ADR-0014): one-off | multi-day | recurring ─────────────────
    .addColumn('schedule_kind', 'text', (c) => c.notNull())
    // [{date:'YYYY-MM-DD',startMin,endMin}] for one-off (len 1) / multi-day; [] for recurring.
    .addColumn('slots', 'jsonb', (c) => c.notNull().defaultTo(sql`'[]'::jsonb`))
    // RecurrenceRule (booking-lifecycle shape) for recurring; NULL otherwise.
    .addColumn('recurrence', 'jsonb')
    // ── counter chain + materialisation linkage ──────────────────────────────
    // The Offer this one counters (supersedes). NULL for an initial Offer.
    .addColumn('supersedes_offer_id', 'uuid', (c) =>
      c.references('offers.id').onDelete('set null'),
    )
    // NULL pre-acceptance; OH-207 sets it when the accepted Offer materialises a Job.
    .addColumn('job_id', 'uuid')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // ── invariants (CHECK backstops; the Edge validates richly) ──────────────
    .addCheckConstraint('offers_sender_chk', sql`sender IN ('parent','caregiver')`)
    .addCheckConstraint(
      'offers_status_chk',
      sql`status IN ('pending','accepted','countered','declined','expired','withdrawn')`,
    )
    .addCheckConstraint('offers_category_chk', sql`category IN ('babysitter','tutor','nanny')`)
    .addCheckConstraint(
      'offers_schedule_kind_chk',
      sql`schedule_kind IN ('one-off','multi-day','recurring')`,
    )
    // Tutor is single-child with no surcharge (CONTEXT § Rate).
    .addCheckConstraint(
      'offers_tutor_single_child_chk',
      sql`category <> 'tutor' OR (child_count = 1 AND per_child_surcharge_cents = 0)`,
    )
    .addCheckConstraint('offers_child_count_chk', sql`child_count >= 1`)
    // One integer age per child (the honest "count AND ages" model).
    .addCheckConstraint('offers_child_ages_count_chk', sql`cardinality(child_ages) = child_count`)
    .addCheckConstraint('offers_scope_note_len_chk', sql`char_length(scope_note) <= 280`)
    .addCheckConstraint('offers_money_nonneg_chk', sql`proposed_rate_cents >= 0 AND per_child_surcharge_cents >= 0 AND computed_total_cents >= 0 AND scope_minutes >= 0`)
    // recurrence present iff recurring (slots carry one-off/multi-day instead).
    .addCheckConstraint(
      'offers_recurrence_presence_chk',
      sql`(schedule_kind = 'recurring') = (recurrence IS NOT NULL)`,
    )
    .addCheckConstraint(
      'offers_service_state_chk',
      sql`service_state IS NULL OR service_state ~ '^[A-Z]{2}$'`,
    )
    .addCheckConstraint(
      'offers_service_postal_chk',
      sql`service_postal_code IS NULL OR service_postal_code ~ '^[0-9]{5}$'`,
    )
    .execute();

  // A thread's Offer bubbles, in send order (merged with messages by created_at).
  await db.schema
    .createIndex('offers_thread_idx')
    .on('offers')
    .columns(['thread_id', 'created_at'])
    .execute();

  // ── T&S queue covers Offer scope_note flags too (PRD story 109) ────────────
  // An Offer's free-text scope_note runs through the SAME disintermediation
  // detector as a message; a trip queues the UNREDACTED original to the same
  // service-role-only flagged-thread queue (the offers row itself is
  // participant-readable, so it may only hold the redacted text). `message_id`
  // becomes nullable; an offer flag sets `offer_id` instead — exactly one of the
  // two subject FKs is set.
  await sql`ALTER TABLE public.message_flags ALTER COLUMN message_id DROP NOT NULL`.execute(db);
  await sql`ALTER TABLE public.message_flags ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES public.offers (id) ON DELETE CASCADE`.execute(
    db,
  );
  await sql`
    ALTER TABLE public.message_flags
      ADD CONSTRAINT message_flags_subject_chk
      CHECK ((message_id IS NOT NULL) <> (offer_id IS NOT NULL))
  `.execute(db);

  // The still-open queue an auto-expire sweep (valid_until passed) will drain.
  await sql`
    CREATE INDEX offers_pending_expiry_idx
      ON public.offers (valid_until)
      WHERE status = 'pending'
  `.execute(db);

  // ── RLS: service-role-only (NO participant SELECT policy) ────────────────
  // Deliberately UNLIKE messages: an Offer row carries the exact service address,
  // which must stay hidden from the Caregiver until they accept (story 124).
  // A participant SELECT policy would expose the raw row — and thus the exact
  // address — to the Caregiver via a direct supabase-js read / Realtime frame,
  // defeating reveal-at-accept. So offers are READ ONLY through the Edge GET,
  // which applies the address projection; the table is service-role-only (RLS
  // enabled, no policy) and is NOT in the `supabase_realtime` publication. The
  // thread surface stays live via the messages Realtime channel (a poke that
  // refetches the projected Offers) + a focus refetch. (Promoting Offers to their
  // own Realtime channel later would split the exact address into a separate
  // service-role-only table; out of scope for OH-206.)
  await sql`ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Unwind the message_flags extension (drop the offer FK before the table it
  // references). message_id is left nullable — re-adding NOT NULL could trip on
  // existing offer-flag rows; a dev down doesn't need to restore the constraint.
  await sql`ALTER TABLE public.message_flags DROP CONSTRAINT IF EXISTS message_flags_subject_chk`.execute(db);
  await sql`ALTER TABLE public.message_flags DROP COLUMN IF EXISTS offer_id`.execute(db);
  await db.schema.dropTable('offers').ifExists().execute();
}
