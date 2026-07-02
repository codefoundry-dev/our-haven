/**
 * Marketing opt-in preference hook (OH-223) — the client of
 * `GET/PUT /v1/notifications/preferences`. Platform-agnostic (plain API calls,
 * no expo-notifications import), shared by the native Account screen and the
 * web Account cards. Follows the lib hook idiom (opportunities.ts): cancelled
 * guard + optimistic set with rollback on failure.
 *
 * This toggles ONLY marketing messages (CONTEXT § Notifications: a separate
 * opt-in, distinct from transactional). Transactional notifications — and the
 * four SMS-mandatory events in particular — are unaffected by this preference.
 */
import { useCallback, useEffect, useState } from 'react';

import { ApiError, getNotificationPreferences, setNotificationPreferences } from '@/api/client';

export interface UseNotificationPrefsResult {
  marketingOptIn: boolean;
  loading: boolean;
  /** True while a toggle write is in flight (disable the switch). */
  saving: boolean;
  error: string | null;
  setMarketingOptIn: (optIn: boolean) => void;
}

export function useNotificationPrefs(enabled = true): UseNotificationPrefsResult {
  const [marketingOptIn, setOptIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getNotificationPreferences()
      .then((prefs) => {
        if (cancelled) return;
        setOptIn(prefs.marketingOptIn);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'We couldn’t load your notification settings.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const setMarketingOptIn = useCallback((optIn: boolean) => {
    setOptIn(optIn); // optimistic — the switch answers immediately
    setSaving(true);
    setError(null);
    setNotificationPreferences(optIn)
      .then((prefs) => {
        setOptIn(prefs.marketingOptIn);
        setSaving(false);
      })
      .catch((e: unknown) => {
        setOptIn(!optIn); // roll back
        setError(e instanceof ApiError ? e.message : 'We couldn’t save that — try again.');
        setSaving(false);
      });
  }, []);

  return { marketingOptIn, loading, saving, error, setMarketingOptIn };
}
