/**
 * useInbox (OH-205) — the caller's Direct-Message threads (the Messages tab).
 *
 * Fetches `GET /v1/threads` from the viewer's perspective (a Parent sees the
 * Caregivers they messaged; a Caregiver sees the Parents who messaged them) and
 * exposes loading/error + a `refetch`. v1's inbox refreshes on focus/refetch;
 * the OPEN thread is the live (Realtime) surface — see useMessageThread.
 */
import { useCallback, useEffect, useState } from 'react';

import { ApiError, getThreads, type MessageThreadSummary } from '@/api/client';

export interface UseInboxResult {
  data: MessageThreadSummary[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useInbox(): UseInboxResult {
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<MessageThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getThreads()
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'Could not load your messages.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { data, loading, error, refetch: useCallback(() => setTick((t) => t + 1), []) };
}
