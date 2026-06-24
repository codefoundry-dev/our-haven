import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase Realtime wiring for live messaging (OH-174 skeleton).
 *
 * Per ADR-0010, messaging is delivered over Supabase Realtime row-level
 * subscriptions on the `messages` table. The RN/Expo client subscribes
 * directly; this helper gives the backend (and integration tests) a typed,
 * reusable way to subscribe to a thread's inserts — e.g. a future
 * notifications worker (OH-194) reacting to new messages, or an end-to-end
 * channel check. The full messaging data model + endpoints land in the
 * Direct-Message ticket (OH-2.13); this is the foundational channel wiring.
 */

export interface MessageRow {
  id: string;
  thread_id: string;
  sender_uid: string;
  body: string;
  created_at: string;
}

export interface SubscribeToThreadInput {
  threadId: string;
  onInsert: (row: MessageRow) => void;
}

export interface ThreadSubscription {
  unsubscribe(): Promise<void>;
}

export interface RealtimeHandles {
  subscribeToThread(input: SubscribeToThreadInput): ThreadSubscription;
}

export function initRealtime(supabase: SupabaseClient): RealtimeHandles {
  return {
    subscribeToThread({ threadId, onInsert }) {
      const channel = supabase
        .channel(`messages:thread:${threadId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` },
          (payload) => onInsert(payload.new as MessageRow),
        )
        .subscribe();

      return {
        async unsubscribe() {
          await supabase.removeChannel(channel);
        },
      };
    },
  };
}
