/**
 * useBookings (OH-203) — the caller's consultation schedule.
 *
 * Fetches `GET /v1/bookings` (the caller sees their own side — Parent or Provider)
 * and exposes loading/error + a `refetch`. Shared by the Parent and Provider
 * schedule screens so a booked/cancelled consultation shows on both.
 */
import { useCallback, useEffect, useState } from 'react';

import { ApiError, getBookings, type BookingSummary } from '@/api/client';

export interface UseBookingsResult {
  data: BookingSummary[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useBookings(): UseBookingsResult {
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<BookingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getBookings()
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'Could not load your schedule.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { data, loading, error, refetch: useCallback(() => setTick((t) => t + 1), []) };
}
