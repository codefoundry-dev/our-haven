import { type Kysely, sql } from 'kysely';

/**
 * Ad-hoc embedded video calls (OH-216; ADR-0008; CONTEXT § Video call; PRD-0001
 * v1.7 stories 22, 113).
 *
 * Either party in a Direct-Message thread can start a Daily.co video call "now"
 * (no scheduling). The platform logs the **generation** of a call link — the
 * `video_call_links` row IS that audit record (timestamp, thread, initiator,
 * participants) for Trust & Safety review — but never records call content
 * (ADR-0008 § Audit posture). The room URL + per-join meeting tokens are minted
 * on Daily and returned only through the authenticated Edge route; they are NOT
 * stored on the realtime-published `messages` row.
 *
 * ── How the counterparty learns of the call (realtime) ─────────────────────
 * The only client realtime channel is `messages` INSERT (OH-205). So starting a
 * call also inserts a lightweight **poke** message of `kind = 'video_call'`
 * carrying `video_call_link_id` (but no URL/token) — Supabase Realtime delivers
 * it to both participants exactly like a chat message, and the client renders it
 * as a "Join video call" bubble. `messages` already has REPLICA IDENTITY FULL +
 * is in `supabase_realtime` (OH-174), so the two new columns publish with no
 * further wiring.
 *
 * ── Security posture ───────────────────────────────────────────────────────
 * `video_call_links` is service-role-only (RLS enabled, NO policy) — the same
 * secure default as `message_flags` and the other T&S / audit tables. All reads
 * go through the Edge route (participant-checked), which mints a short-lived
 * per-user Daily meeting token; a Daily private room is useless without one.
 * Pure DDL — no plpgsql (ADR-0019 canary stays green).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ── video_call_links — the link-generation audit log (ADR-0008) ────────────
  await db.schema
    .createTable('video_call_links')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // The thread the call was started from (Application or Direct-Message thread).
    .addColumn('thread_id', 'uuid', (c) =>
      c.references('message_threads.id').onDelete('cascade').notNull(),
    )
    // The party who tapped "start a call" (either the Parent or the supply member).
    .addColumn('initiator_uid', 'uuid', (c) => c.notNull())
    // Both thread participants at generation time — the audited "participants".
    .addColumn('participant_uids', sql`uuid[]`, (c) => c.notNull())
    // Video vendor (Daily.co in v1) — room identifiers below are vendor-scoped.
    .addColumn('provider', 'text', (c) => c.notNull().defaultTo('daily'))
    // The Daily room name (token minting is keyed by it) + its joinable URL.
    .addColumn('daily_room_name', 'text', (c) => c.notNull())
    .addColumn('daily_room_url', 'text', (c) => c.notNull())
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    // The room's ~30-minute validity window (ADR-0008); a join past this 410s.
    .addColumn('expires_at', 'timestamptz', (c) => c.notNull())
    .execute();

  // The thread's call history (T&S "calls in this thread" line-item, ADR-0008).
  await db.schema
    .createIndex('video_call_links_thread_idx')
    .on('video_call_links')
    .columns(['thread_id', 'created_at'])
    .execute();

  // Service-role-only: RLS enabled with NO policy (matches message_flags + the
  // other back-office/audit tables). The Edge route is the only reader/writer.
  await sql`ALTER TABLE public.video_call_links ENABLE ROW LEVEL SECURITY`.execute(db);

  // ── messages: the video-call poke discriminator + link reference ───────────
  // `kind` distinguishes a normal chat message from a video-call poke; the
  // client renders `video_call` rows as a Join bubble. Column-level CHECK +
  // inline FK keep each ADD COLUMN a single, re-runnable (IF NOT EXISTS) statement
  // — no DO block, no plpgsql. Existing rows backfill to 'text'.
  await sql`
    ALTER TABLE public.messages
      ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'text'
      CHECK (kind IN ('text','video_call'))
  `.execute(db);
  // The generated call link this poke announces (NULL for ordinary messages).
  // ON DELETE SET NULL so pruning an expired link never deletes the transcript row.
  await sql`
    ALTER TABLE public.messages
      ADD COLUMN IF NOT EXISTS video_call_link_id uuid
      REFERENCES public.video_call_links (id) ON DELETE SET NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE public.messages DROP COLUMN IF EXISTS video_call_link_id`.execute(db);
  await sql`ALTER TABLE public.messages DROP COLUMN IF EXISTS kind`.execute(db);
  await db.schema.dropTable('video_call_links').ifExists().execute();
}
