/**
 * useCaregiverBookings (OH-220) — the Caregiver's hourly Booking schedule.
 *
 * Fetches `GET /v1/caregiver/bookings` (all of the Caregiver's Bookings across
 * every state) and exposes loading/error + a `refetch`. The Schedule screen
 * buckets the result into Today / Upcoming / needs-attention. Mirrors
 * `useBookings` (the consultation feed) — the Caregiver hourly feed is a distinct
 * shape (proposed hours, pending shorten, service address) so it has its own hook.
 */
import { useCallback, useEffect, useState } from 'react';

import { ApiError, getCaregiverBookings, type CaregiverBooking } from '@/api/client';

export interface UseCaregiverBookingsResult {
  data: CaregiverBooking[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useCaregiverBookings(): UseCaregiverBookingsResult {
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<CaregiverBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCaregiverBookings()
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
