/**
 * useMessageThread (OH-205 + OH-206) — one open 1:1 conversation: resolve the
 * thread, load the transcript + Offers, subscribe to Supabase Realtime, send
 * messages, and compose / act on structured Offers.
 *
 * Resolution: a Parent arrives with a `providerId` (the Caregiver they tapped)
 * → `openThread` get-or-creates the thread; a Caregiver (or a Parent from the
 * inbox) arrives with a `threadId` → used directly. Either way we end up with a
 * `threadId`, load its transcript (bodies already redacted — delivery-safe) and
 * its Offers, and subscribe to INSERTs on `messages` filtered by `thread_id`. The
 * participant-scoped RLS SELECT policy on `messages` (OH-205) is what authorises
 * Realtime to deliver the row — we set the channel's auth token first.
 *
 * Offers (OH-206) are NOT Realtime-published (the row carries the exact service
 * address, which must stay hidden from the Caregiver until accept — story 124),
 * so they are read through the Edge GET, which projects the address per viewer +
 * status. The thread stays live for Offers by refetching them on each message
 * Realtime poke + on `refetchOffers()` (the screen calls it on focus) + after any
 * local Offer action. Messages + Offers are merged into one chronological
 * `timeline` the bubble list renders.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import {
  ApiError,
  acceptOffer as apiAcceptOffer,
  counterOffer as apiCounterOffer,
  declineOffer as apiDeclineOffer,
  getThreadMessages,
  getThreadOffers,
  openThread,
  sendMessage as apiSendMessage,
  sendOffer as apiSendOffer,
  withdrawOffer as apiWithdrawOffer,
  type ChatMessage,
  type ComposeOfferBody,
  type CounterOfferBody,
  type MessageThreadSummary,
  type Offer,
} from '@/api/client';
import { supabase } from '@/auth/supabase';

export interface UseMessageThreadArgs {
  /** A Parent opening from a Caregiver profile → get-or-create by this id. */
  providerId?: string | null;
  /** An existing thread id (Caregiver inbox, or a Parent from the inbox). */
  threadId?: string | null;
}

/** One row in the merged transcript — a chat message or an Offer bubble. */
export type ThreadTimelineItem =
  | { kind: 'message'; id: string; at: string; message: ChatMessage }
  | { kind: 'offer'; id: string; at: string; offer: Offer };

export interface UseMessageThreadResult {
  thread: MessageThreadSummary | null;
  threadId: string | null;
  messages: ChatMessage[];
  offers: Offer[];
  /** Messages + Offers merged, oldest first — what the bubble list renders. */
  timeline: ThreadTimelineItem[];
  loading: boolean;
  error: string | null;
  sending: boolean;
  /** Send a message; resolves once delivered (returns false if it was a no-op). */
  send: (body: string) => Promise<boolean>;
  /** Re-pull the thread's Offers (the screen calls this on focus). */
  refetchOffers: () => Promise<void>;
  /** Compose + send a structured Offer. */
  composeOffer: (body: ComposeOfferBody) => Promise<Offer | null>;
  acceptOffer: (offerId: string) => Promise<Offer | null>;
  declineOffer: (offerId: string) => Promise<Offer | null>;
  withdrawOffer: (offerId: string) => Promise<Offer | null>;
  counterOffer: (offerId: string, body: CounterOfferBody) => Promise<Offer | null>;
}

interface RealtimeMessageRow {
  id: string;
  thread_id: string;
  sender_uid: string;
  body: string;
  redacted: boolean;
  created_at: string;
}

/** Replace an Offer by id (or append), keeping the list createdAt-ordered. */
function upsertOffer(prev: Offer[], next: Offer): Offer[] {
  const without = prev.filter((o) => o.id !== next.id);
  return [...without, next].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function useMessageThread({ providerId, threadId: threadIdArg }: UseMessageThreadArgs): UseMessageThreadResult {
  const [thread, setThread] = useState<MessageThreadSummary | null>(null);
  const [threadId, setThreadId] = useState<string | null>(threadIdArg ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Ids already in `messages`, so the Realtime echo of our own send (and any
  // duplicate event) is ignored.
  const seenIds = useRef<Set<string>>(new Set());

  // ── resolve the thread + load the transcript + Offers ──────────────────────
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
        const [msgs, offs] = await Promise.all([getThreadMessages(tid), getThreadOffers(tid)]);
        if (cancelled) return;
        seenIds.current = new Set(msgs.map((m) => m.id));
        setThread(summary);
        setThreadId(tid);
        setMessages(msgs);
        setOffers(offs);
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

  const refetchOffers = useCallback(async () => {
    if (!threadId) return;
    try {
      const offs = await getThreadOffers(threadId);
      setOffers(offs);
    } catch {
      // Keep the prior Offers on a transient failure — the next poke retries.
    }
  }, [threadId]);

  // ── Supabase Realtime: live INSERTs on this thread (+ Offer poke) ───────────
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
            // Offers aren't Realtime-published — a new message is a cheap poke to
            // re-pull any Offer the counterparty just sent / acted on.
            void refetchOffers();
          },
        )
        .subscribe();
    })();
    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [threadId, refetchOffers]);

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

  const composeOffer = useCallback(
    async (body: ComposeOfferBody): Promise<Offer | null> => {
      if (!threadId) return null;
      const offer = await apiSendOffer(threadId, body);
      setOffers((prev) => upsertOffer(prev, offer));
      return offer;
    },
    [threadId],
  );

  // accept / decline / withdraw return the updated Offer; counter returns the new
  // successor (and flips the predecessor to `countered` server-side), so we
  // refetch to reconcile both. Optimistically upsert the returned row either way.
  const runOfferAction = useCallback(
    async (action: () => Promise<Offer>): Promise<Offer | null> => {
      const offer = await action();
      setOffers((prev) => upsertOffer(prev, offer));
      void refetchOffers();
      return offer;
    },
    [refetchOffers],
  );

  const acceptOffer = useCallback((id: string) => runOfferAction(() => apiAcceptOffer(id)), [runOfferAction]);
  const declineOffer = useCallback((id: string) => runOfferAction(() => apiDeclineOffer(id)), [runOfferAction]);
  const withdrawOffer = useCallback((id: string) => runOfferAction(() => apiWithdrawOffer(id)), [runOfferAction]);
  const counterOffer = useCallback(
    (id: string, body: CounterOfferBody) => runOfferAction(() => apiCounterOffer(id, body)),
    [runOfferAction],
  );

  const timeline = useMemo<ThreadTimelineItem[]>(() => {
    const items: ThreadTimelineItem[] = [
      ...messages.map((m) => ({ kind: 'message' as const, id: m.id, at: m.createdAt, message: m })),
      ...offers.map((o) => ({ kind: 'offer' as const, id: o.id, at: o.createdAt, offer: o })),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [messages, offers]);

  return {
    thread,
    threadId,
    messages,
    offers,
    timeline,
    loading,
    error,
    sending,
    send,
    refetchOffers,
    composeOffer,
    acceptOffer,
    declineOffer,
    withdrawOffer,
    counterOffer,
  };
}
