import { type Kysely, sql } from 'kysely';

/**
 * messages — chat messages for live Direct-Message threads, enabled for
 * Supabase Realtime row-level subscriptions (OH-174 skeleton; ADR-0010).
 *
 * This is the foundational channel wiring the backend skeleton owns. The
 * Direct-Message ticket (OH-2.13) extends the model (attachments, read
 * receipts, thread→job rebind + atomic materialisation from the offer flow —
 * see packages/domain/direct-message-materialisation). What the skeleton must
 * guarantee is that `messages` exists and is a member of the
 * `supabase_realtime` publication, so the RN/Expo client + the backend
 * realtime helper can subscribe to INSERTs per thread.
 *
 * `thread_id` is the conversation anchor: a thread is born `thread_id`-anchored
 * and rebinds to the materialised `job_id` on Offer-accept. Realtime filters
 * on `thread_id=eq.<id>`; REPLICA IDENTITY FULL so the publication carries the
 * full row for filtered change events (not just INSERT).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id   uuid NOT NULL,
      sender_uid  uuid NOT NULL,
      body        text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS messages_thread_id_created_at_idx
      ON messages (thread_id, created_at)
  `.execute(db);

  await sql`ALTER TABLE messages REPLICA IDENTITY FULL`.execute(db);

  // Add to the Realtime publication. On Supabase `supabase_realtime` exists by
  // default; on a bare local Postgres it may not, so create it first. Guarded
  // so re-running against an already-wired DB is a no-op.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
      ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
      ) THEN
        ALTER PUBLICATION supabase_realtime DROP TABLE public.messages;
      END IF;
    END $$;
  `.execute(db);
  await sql`DROP TABLE IF EXISTS messages`.execute(db);
}
