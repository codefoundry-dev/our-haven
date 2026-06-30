/**
 * useSearch (OH-201) — fetch unified search results for the given query.
 *
 * Re-fetches whenever the query changes (keyed on its JSON) and exposes a
 * `refetch`. The query is built by `buildSearchQuery` in `@/lib/search`; the
 * response carries the entitlement flag + the rank-ordered, preview-walled
 * results. Shared by the native + web Search screens.
 */
import { useEffect, useState } from 'react';

import { ApiError, getSearch, type SearchQuery, type SearchResponse } from '@/api/client';

export interface UseSearchResult {
  data: SearchResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useSearch(query: SearchQuery): UseSearchResult {
  const key = JSON.stringify(query);
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSearch(query)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'Search is unavailable right now.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `key` captures the query; `tick` forces a manual refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  return { data, loading, error, refetch: () => setTick((t) => t + 1) };
}
