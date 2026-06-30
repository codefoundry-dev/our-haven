/**
 * useSupplyProfile (OH-202) — fetch one listable supply member's Parent-facing
 * profile (the destination of a Search result tap).
 *
 * Re-fetches whenever the id or viewer ZIP changes and exposes a `refetch`. A
 * 404 (unknown / not-listable) is surfaced as `notFound` so the screen can show
 * a dedicated empty state rather than a generic error. Shared by the native +
 * web Provider-detail screens.
 */
import { useEffect, useState } from 'react';

import { ApiError, getSupplyProfile, type SupplyProfile } from '@/api/client';

export interface UseSupplyProfileResult {
  data: SupplyProfile | null;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  refetch: () => void;
}

export function useSupplyProfile(providerId: string | null, zip?: string): UseSupplyProfileResult {
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<SupplyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!providerId) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    getSupplyProfile(providerId, zip)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setNotFound(true);
        } else {
          setError(e instanceof ApiError ? e.message : 'This profile is unavailable right now.');
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, zip, tick]);

  return { data, loading, error, notFound, refetch: () => setTick((t) => t + 1) };
}
