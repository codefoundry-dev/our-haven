/**
 * useMessageThread (OH-205) — one open 1:1 conversation: resolve the thread,
 * load the transcript, subscribe to Supabase Realtime, and send.
 *
 * Resolution: a Parent arrives with a `providerId` (the Caregiver they tapped)
 * → `openThread` get-or-creates the thread; a Caregiver (or a Parent from the
 * inbox) arrives with a `threadId` → used directly. Either way we end up with a
 * `threadId`, load its transcript (bodies already redacted — delivery-safe), and
 * subscribe to INSERTs on `messages` filtered by `thread_id` (mirroring the
 * backend realtime helper). The participant-scoped RLS SELECT policy on
 * `messages` (OH-205 migration) is what authorises Realtime to deliver the row —
 * we set the channel's auth token from the session before subscribing.
 *
 * Send awaits the POST and appends the returned (redacted) message; the Realtime
 * echo of our own insert is de-duped by id, so messages never double up
 * regardless of which arrives first.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import {
  ApiError,
  getThreadMessages,
  openThread,
  sendMessage as apiSendMessage,
  type ChatMessage,
  type MessageThreadSummary,
} from '@/api/client';
import { supabase } from '@/auth/supabase';

export interface UseMessageThreadArgs {
  /** A Parent opening from a Caregiver profile → get-or-create by this id. */
  providerId?: string | null;
  /** An existing thread id (Caregiver inbox, or a Parent from the inbox). */
  threadId?: string | null;
}

export interface UseMessageThreadResult {
  thread: MessageThreadSummary | null;
  threadId: string | null;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  sending: boolean;
  /** Send a message; resolves once delivered (returns false if it was a no-op). */
  send: (body: string) => Promise<boolean>;
}

interface RealtimeMessageRow {
  id: string;
  thread_id: string;
  sender_uid: string;
  body: string;
  redacted: boolean;
  created_at: string;
}

export function useMessageThread({ providerId, threadId: threadIdArg }: UseMessageThreadArgs): UseMessageThreadResult {
  const [thread, setThread] = useState<MessageThreadSummary | null>(null);
  const [threadId, setThreadId] = useState<string | null>(threadIdArg ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Ids already in `messages`, so the Realtime echo of our own send (and any
  // duplicate event) is ignored.
  const seenIds = useRef<Set<string>>(new Set());

  // ── resolve the thread + load the transcript ───────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setThread(null);
    (async () => {
      try {
        let tid = threadIdArg ?? null;
        let summary: MessageThreadSummary | null = null;
        if (!tid && providerId) {
          summary = await openThread(providerId);
          tid = summary.id;
        }
        if (!tid) throw new ApiError(0, 'No conversation to open.');
        const msgs = await getThreadMessages(tid);
        if (cancelled) return;
        seenIds.current = new Set(msgs.map((m) => m.id));
        setThread(summary);
        setThreadId(tid);
        setMessages(msgs);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'Could not open this conversation.');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providerId, threadIdArg]);

  // ── Supabase Realtime: live INSERTs on this thread ─────────────────────────
  useEffect(() => {
    if (!threadId) return;
    let active = true;
    let channel: RealtimeChannel | null = null;
    (async () => {
      // RLS evaluates the subscriber's JWT — make sure the realtime socket carries it.
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
      if (!active) return;
      channel = supabase
        .channel(`messages:thread:${threadId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` },
          (payload) => {
            const row = payload.new as RealtimeMessageRow;
            if (!row?.id || seenIds.current.has(row.id)) return;
            seenIds.current.add(row.id);
            setMessages((prev) => [
              ...prev,
              {
                id: row.id,
                threadId: row.thread_id,
                senderUid: row.sender_uid,
                body: row.body,
                redacted: row.redacted,
                createdAt: row.created_at,
              },
            ]);
          },
        )
        .subscribe();
    })();
    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [threadId]);

  const send = useCallback(
    async (raw: string): Promise<boolean> => {
      const text = raw.trim();
      if (!text || !threadId) return false;
      setSending(true);
      try {
        const msg = await apiSendMessage(threadId, text);
        if (!seenIds.current.has(msg.id)) {
          seenIds.current.add(msg.id);
          setMessages((prev) => [...prev, msg]);
        }
        return true;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Message failed to send.');
        throw e;
      } finally {
        setSending(false);
      }
    },
    [threadId],
  );

  return { thread, threadId, messages, loading, error, sending, send };
}
