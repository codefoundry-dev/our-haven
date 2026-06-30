import { type Kysely, sql } from 'kysely';

/**
 * Messaging (OH-205) — the Direct-Message data model the OH-174 `messages`
 * skeleton + the OH-180 disintermediation detector were waiting for.
 *
 * A thread is a 1:1 conversation between a Parent and a supply member. v1 only
 * materialises the **pre-acceptance Parent↔Caregiver Direct-Message thread**
 * (ADR-0011 — Offers/DM are Caregiver-only; Providers are slot-pick). The shape
 * stays role-agnostic so OH-179's Posted-Job / post-acceptance job-anchored
 * threads (and the thread→job rebind) slot in later via `job_id`.
 *
 * ── Redaction at delivery (CONTEXT § Message) ──────────────────────────────
 * Supabase Realtime broadcasts the `messages` row directly, so redaction must
 * happen at **write** time, not read time: the Edge send handler runs the body
 * through `disintermediation.scanMessage` and stores the **redacted**,
 * delivery-safe text in `messages.body` (with `messages.redacted` flagging that
 * contact info was stripped). The unredacted original + match metadata are
 * written to `message_flags` — the Trust & Safety flagged-thread queue
 * (CONTEXT § Trust & Safety) — which is service-role-only and NOT published to
 * Realtime.
 *
 * ── RLS powers Realtime (ADR-0010) ─────────────────────────────────────────
 * `messages` is already in the `supabase_realtime` publication with REPLICA
 * IDENTITY FULL (OH-174) but had RLS enabled with NO policy (service-role only,
 * OH-174 rls_hardening). This migration adds the participant-scoped SELECT
 * policy: that policy is what authorises Realtime `postgres_changes` to deliver
 * a row to the two thread participants. All WRITES still go through the Edge
 * function on the service role (which bypasses RLS) — there are no INSERT/UPDATE
 * policies.
 *
 * RLS enable/policy + the SECURITY DEFINER helper are an explicit
 * plpgsql-canary carve-out (ADR-0019); the rest is pure DDL.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ── message_threads ────────────────────────────────────────────────────────
  await db.schema
    .createTable('message_threads')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // The Parent (auth user uuid) — no FK (auth schema is protected; mirrors bookings).
    .addColumn('parent_uid', 'uuid', (c) => c.notNull())
    // The supply member's auth uid (the Caregiver), for participant checks + their inbox.
    .addColumn('supply_uid', 'uuid', (c) => c.notNull())
    // The supply profile row (Caregiver) the thread is with.
    .addColumn('provider_id', 'uuid', (c) => c.references('providers.id').onDelete('cascade').notNull())
    // 'caregiver' in v1 (room for 'provider' later).
    .addColumn('supply_role', 'text', (c) => c.notNull())
    // NULL pre-acceptance; OH-179 materialisation rebinds the thread to the new Job.
    .addColumn('job_id', 'uuid')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // Inbox sort key + last-row denormalisation (delivery-safe — never the original).
    .addColumn('last_message_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('last_message_preview', 'text')
    .addColumn('last_message_redacted', 'boolean', (c) => c.notNull().defaultTo(false))
    .addCheckConstraint('message_threads_supply_role_chk', sql`supply_role IN ('caregiver','provider')`)
    .execute();

  // One thread per (Parent, supply profile) — idempotent get-or-create.
  await db.schema
    .createIndex('message_threads_parent_provider_uniq')
    .unique()
    .on('message_threads')
    .columns(['parent_uid', 'provider_id'])
    .execute();

  // Each side's inbox, newest first.
  await db.schema
    .createIndex('message_threads_parent_idx')
    .on('message_threads')
    .columns(['parent_uid', 'last_message_at'])
    .execute();
  await db.schema
    .createIndex('message_threads_supply_idx')
    .on('message_threads')
    .columns(['supply_uid', 'last_message_at'])
    .execute();

  // ── messages: delivery-safe flag + thread FK ───────────────────────────────
  // body already holds the (now redacted) delivery text; `redacted` = true when
  // contact info was stripped (drives the inbox/bubble "Redacted" affordance).
  await sql`ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS redacted boolean NOT NULL DEFAULT false`.execute(
    db,
  );
  // Bind thread_id to a real thread now that the table exists (no DM rows yet).
  // Guarded so a manual re-run against an already-migrated DB is a no-op.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'messages_thread_id_fkey'
      ) THEN
        ALTER TABLE public.messages
          ADD CONSTRAINT messages_thread_id_fkey
          FOREIGN KEY (thread_id) REFERENCES public.message_threads (id) ON DELETE CASCADE;
      END IF;
    END $$;
  `.execute(db);

  // ── message_flags — Trust & Safety flagged-thread queue ────────────────────
  // The unredacted original + match metadata for every message that tripped the
  // disintermediation detector. Service-role-only; never published to Realtime.
  await db.schema
    .createTable('message_flags')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('message_id', 'uuid', (c) =>
      c.references('messages.id').onDelete('cascade').notNull(),
    )
    .addColumn('thread_id', 'uuid', (c) => c.notNull())
    .addColumn('sender_uid', 'uuid', (c) => c.notNull())
    // Distinct disintermediation categories (canonical order) that tripped.
    .addColumn('categories', sql`text[]`, (c) => c.notNull())
    // The UNREDACTED message body — T&S-only.
    .addColumn('original_body', 'text', (c) => c.notNull())
    // The detector's match metadata: [{category,value,start,end}].
    .addColumn('matches', 'jsonb', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // Stamped when a T&S admin reviews the flag (admin UI is a separate ticket).
    .addColumn('reviewed_at', 'timestamptz')
    .addColumn('reviewed_by', 'uuid')
    .execute();

  // The unreviewed queue the T&S admin works through.
  await sql`
    CREATE INDEX message_flags_unreviewed_idx
      ON public.message_flags (created_at)
      WHERE reviewed_at IS NULL
  `.execute(db);

  // ── RLS + Realtime (plpgsql-canary carve-out, ADR-0019) ────────────────────
  // SECURITY DEFINER participant check: lets the messages SELECT policy resolve
  // a thread's participants without nested cross-table RLS on every Realtime
  // change check (fast + correct). `auth.uid()` is the JWT `sub`, available even
  // inside a definer function (it reads the request claims GUC).
  await sql`
    CREATE OR REPLACE FUNCTION public.is_message_thread_participant(p_thread uuid)
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
    AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.message_threads t
        WHERE t.id = p_thread
          AND (SELECT auth.uid()) IN (t.parent_uid, t.supply_uid)
      );
    $$;
  `.execute(db);

  // A participant can read their own threads (inbox); also backs the messages
  // policy's view of who is in a thread.
  await sql`ALTER TABLE public.message_threads ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`
    CREATE POLICY message_threads_select_participant ON public.message_threads
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) IN (parent_uid, supply_uid))
  `.execute(db);

  // messages already has RLS ENABLED (OH-174 rls_hardening) — add the SELECT
  // policy that authorises Realtime delivery to the two participants.
  await sql`
    CREATE POLICY messages_select_participant ON public.messages
      FOR SELECT TO authenticated
      USING (public.is_message_thread_participant(thread_id))
  `.execute(db);

  // message_flags: enable RLS with NO policy — service-role only (the secure
  // default, matching the other T&S/back-office tables).
  await sql`ALTER TABLE public.message_flags ENABLE ROW LEVEL SECURITY`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP POLICY IF EXISTS messages_select_participant ON public.messages`.execute(db);
  await sql`ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_thread_id_fkey`.execute(db);
  await sql`ALTER TABLE public.messages DROP COLUMN IF EXISTS redacted`.execute(db);

  await db.schema.dropTable('message_flags').ifExists().execute();

  await sql`DROP POLICY IF EXISTS message_threads_select_participant ON public.message_threads`.execute(db);
  await db.schema.dropTable('message_threads').ifExists().execute();

  await sql`DROP FUNCTION IF EXISTS public.is_message_thread_participant(uuid)`.execute(db);
}
