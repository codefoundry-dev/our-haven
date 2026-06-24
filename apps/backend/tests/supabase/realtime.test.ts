import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { initRealtime, type MessageRow } from '@/supabase/realtime.js';

type OnArgs = [event: string, config: Record<string, unknown>, handler: (payload: { new: MessageRow }) => void];

const mockRealtimeClient = () => {
  const captured: { topic?: string; onArgs?: OnArgs; subscribed?: boolean; removed?: unknown } = {};
  const channel = {
    on(event: string, config: Record<string, unknown>, handler: (payload: { new: MessageRow }) => void) {
      captured.onArgs = [event, config, handler];
      return channel;
    },
    subscribe() {
      captured.subscribed = true;
      return channel;
    },
  };
  const client = {
    channel: vi.fn((topic: string) => {
      captured.topic = topic;
      return channel;
    }),
    removeChannel: vi.fn(async (ch: unknown) => {
      captured.removed = ch;
    }),
  } as unknown as SupabaseClient;
  return { client, captured, channel };
};

const sampleRow = (overrides: Partial<MessageRow> = {}): MessageRow => ({
  id: 'm1',
  thread_id: 'thread-1',
  sender_uid: 'user-1',
  body: 'hello',
  created_at: '2026-06-24T00:00:00.000Z',
  ...overrides,
});

describe('initRealtime().subscribeToThread', () => {
  it('subscribes to INSERTs on the messages table filtered by thread and forwards the new row', () => {
    const { client, captured } = mockRealtimeClient();
    const realtime = initRealtime(client);

    const received: MessageRow[] = [];
    realtime.subscribeToThread({ threadId: 'thread-1', onInsert: (row) => received.push(row) });

    expect(captured.onArgs).toBeDefined();
    const [event, config, handler] = captured.onArgs!;
    expect(event).toBe('postgres_changes');
    expect(config).toMatchObject({
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: 'thread_id=eq.thread-1',
    });
    expect(captured.subscribed).toBe(true);

    const row = sampleRow();
    handler({ new: row });
    expect(received).toEqual([row]);
  });

  it('unsubscribe() tears down the underlying realtime channel', async () => {
    const { client, captured, channel } = mockRealtimeClient();
    const realtime = initRealtime(client);

    const subscription = realtime.subscribeToThread({ threadId: 'thread-1', onInsert: () => {} });
    expect(client.removeChannel).not.toHaveBeenCalled();

    await subscription.unsubscribe();
    expect(client.removeChannel).toHaveBeenCalledTimes(1);
    expect(captured.removed).toBe(channel);
  });

  it('scopes each thread to its own channel topic so subscriptions do not collide', () => {
    const { client } = mockRealtimeClient();
    const realtime = initRealtime(client);

    realtime.subscribeToThread({ threadId: 'thread-A', onInsert: () => {} });
    realtime.subscribeToThread({ threadId: 'thread-B', onInsert: () => {} });

    const topics = vi.mocked(client.channel).mock.calls.map((args) => args[0]);
    expect(topics[0]).not.toBe(topics[1]);
    expect(topics[0]).toContain('thread-A');
    expect(topics[1]).toContain('thread-B');
  });
});
