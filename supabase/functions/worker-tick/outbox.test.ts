import { describe, expect, it } from 'vitest';

import {
  backoffDelayMs,
  drainOutbox,
  dueOutboxQuery,
  type NotificationDispatcher,
  type OutboxRow,
  type OutboxStore,
} from './outbox.ts';
import { compileOnlyDb } from './_test/env.ts';

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: overrides.id ?? 'row-1',
    recipient_uid: overrides.recipient_uid ?? 'user-1',
    event_type: overrides.event_type ?? 'booking.requested',
    payload: overrides.payload ?? {},
    attempts: overrides.attempts ?? 0,
    max_attempts: overrides.max_attempts ?? 8,
  };
}

/** In-memory store recording every mark, so the orchestration is testable
 *  without a database. `claimDue` just hands back the seeded rows. */
class FakeOutboxStore implements OutboxStore {
  sent: string[] = [];
  retried: Array<{ id: string; nextAttemptAt: Date; error: string }> = [];
  failed: Array<{ id: string; error: string }> = [];

  constructor(private readonly rows: OutboxRow[]) {}

  claimDue(_now: Date, limit: number): Promise<OutboxRow[]> {
    return Promise.resolve(this.rows.slice(0, limit));
  }
  markSent(id: string): Promise<void> {
    this.sent.push(id);
    return Promise.resolve();
  }
  markRetry(id: string, nextAttemptAt: Date, error: string): Promise<void> {
    this.retried.push({ id, nextAttemptAt, error });
    return Promise.resolve();
  }
  markFailed(id: string, _now: Date, error: string): Promise<void> {
    this.failed.push({ id, error });
    return Promise.resolve();
  }
}

/** Dispatcher that throws for any row id in `failIds`. */
function dispatcherFailing(failIds: Set<string>): NotificationDispatcher {
  return {
    dispatch(r) {
      if (failIds.has(r.id)) return Promise.reject(new Error(`boom:${r.id}`));
      return Promise.resolve();
    },
  };
}

describe('backoffDelayMs', () => {
  it('doubles each attempt and caps at one hour', () => {
    expect(backoffDelayMs(1)).toBe(60_000);
    expect(backoffDelayMs(2)).toBe(120_000);
    expect(backoffDelayMs(3)).toBe(240_000);
    expect(backoffDelayMs(10)).toBe(60 * 60_000); // capped
  });
});

describe('drainOutbox', () => {
  const now = new Date('2026-06-26T12:00:00.000Z');

  it('marks every successfully dispatched row sent', async () => {
    const store = new FakeOutboxStore([row({ id: 'a' }), row({ id: 'b' })]);
    const result = await drainOutbox(store, dispatcherFailing(new Set()), { now });

    expect(result).toEqual({ claimed: 2, sent: 2, retried: 0, failed: 0 });
    expect(store.sent).toEqual(['a', 'b']);
    expect(store.retried).toHaveLength(0);
    expect(store.failed).toHaveLength(0);
  });

  it('retries a failed row with backoff and does not block the rest of the batch', async () => {
    const store = new FakeOutboxStore([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);
    const result = await drainOutbox(store, dispatcherFailing(new Set(['b'])), { now });

    expect(result).toEqual({ claimed: 3, sent: 2, retried: 1, failed: 0 });
    expect(store.sent).toEqual(['a', 'c']);
    expect(store.retried).toHaveLength(1);
    expect(store.retried[0]?.id).toBe('b');
    // attempts 0 → 1 → backoff 60s from now.
    expect(store.retried[0]?.nextAttemptAt.getTime()).toBe(now.getTime() + 60_000);
    expect(store.retried[0]?.error).toContain('boom:b');
  });

  it('gives up (markFailed) once the attempt budget is spent', async () => {
    // attempts 7, max 8 → this failure is attempt 8 → terminal.
    const store = new FakeOutboxStore([row({ id: 'x', attempts: 7, max_attempts: 8 })]);
    const result = await drainOutbox(store, dispatcherFailing(new Set(['x'])), { now });

    expect(result).toEqual({ claimed: 1, sent: 0, retried: 0, failed: 1 });
    expect(store.failed).toEqual([{ id: 'x', error: expect.stringContaining('boom:x') }]);
    expect(store.retried).toHaveLength(0);
  });

  it('honours the claim limit', async () => {
    const store = new FakeOutboxStore([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })]);
    const result = await drainOutbox(store, dispatcherFailing(new Set()), { now, limit: 2 });
    expect(result.claimed).toBe(2);
    expect(store.sent).toEqual(['a', 'b']);
  });
});

describe('dueOutboxQuery (SKIP LOCKED claim)', () => {
  it('compiles to a FOR UPDATE SKIP LOCKED select over still-pending rows', () => {
    const { sql } = dueOutboxQuery(compileOnlyDb(), new Date('2026-06-26T12:00:00Z'), 50).compile();
    const lower = sql.toLowerCase();

    expect(lower).toContain('for update');
    expect(lower).toContain('skip locked');
    expect(lower).toContain('"sent_at" is null');
    expect(lower).toContain('"failed_at" is null');
    expect(lower).toContain('"next_attempt_at" <=');
    expect(lower).toContain('order by "next_attempt_at"');
  });
});
