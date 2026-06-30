/**
 * ParentSubscriptionProvider — the single client-side source of truth for the
 * Parent's subscription + access state (OH-204; reads the OH-193 server endpoints).
 *
 * The demand-side paywall gate ("is the marketplace unlocked?") is needed in many
 * places — the four gated action entry points (Message / Book-request / Post-Job /
 * Consultation), the paywall screen itself, and the web shell's status chip — and
 * must reflect a completed Stripe checkout "immediately in-app". A shared context
 * (fetched once, refreshable) keeps every surface consistent rather than each
 * screen fetching independently and drifting.
 *
 * `entitled` mirrors the server's gate (true iff status is active/trialing — the
 * same `deriveAccessDecision` the backend applies). Phone state is read from the
 * Supabase session (phone lives on `auth.users`, not a parent table; CONTEXT §
 * Subscription — collected + verified at the paywall step), so a parent who verifies
 * their phone in the paywall is reflected after `AuthProvider.refresh()`.
 *
 * Inert for non-parent roles: it only fetches when the authenticated role is
 * `parent`, so mounting it app-wide costs a caregiver/provider nothing.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { ApiError, getParentSubscription, type ParentSubscription } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';

interface ParentSubscriptionValue {
  /** The raw server summary, or null before the first load (or for non-parents). */
  summary: ParentSubscription | null;
  /** The gate: true iff the marketplace is unlocked (status active/trialing). */
  entitled: boolean;
  /** The phone on file (from the Supabase session), or null. */
  phone: string | null;
  /** True once the phone has been confirmed via OTP (auth.users.phone_confirmed_at). */
  phoneVerified: boolean;
  loading: boolean;
  error: string | null;
  /** Re-fetch the summary; resolves to the fresh summary (or null on failure). */
  refresh: () => Promise<ParentSubscription | null>;
}

const ParentSubscriptionContext = createContext<ParentSubscriptionValue | null>(null);

export function ParentSubscriptionProvider({ children }: { children: ReactNode }) {
  const { role, session } = useAuth();
  const isParent = role === 'parent';

  const [summary, setSummary] = useState<ParentSubscription | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against overlapping fetches (poll loop + focus refresh racing).
  const inflight = useRef<Promise<ParentSubscription | null> | null>(null);

  const refresh = useCallback(async (): Promise<ParentSubscription | null> => {
    if (!isParent) return null;
    if (inflight.current) return inflight.current;
    setLoading(true);
    setError(null);
    const p = (async () => {
      try {
        const res = await getParentSubscription();
        setSummary(res);
        return res;
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not load your subscription.');
        return null;
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, [isParent]);

  // Initial load (and reload when the user becomes a parent / signs in).
  useEffect(() => {
    if (isParent) {
      void refresh();
    } else {
      setSummary(null);
      setError(null);
    }
  }, [isParent, refresh]);

  // Refresh when the app returns to the foreground — catches a subscription that
  // completed while the user was away in the Stripe checkout browser (native).
  useEffect(() => {
    if (!isParent || Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => sub.remove();
  }, [isParent, refresh]);

  const value = useMemo<ParentSubscriptionValue>(() => {
    const user = session?.user;
    return {
      summary,
      entitled: summary?.entitled ?? false,
      phone: user?.phone && user.phone.length > 0 ? user.phone : null,
      phoneVerified: Boolean(user?.phone_confirmed_at),
      loading,
      error,
      refresh,
    };
  }, [summary, loading, error, refresh, session]);

  return <ParentSubscriptionContext.Provider value={value}>{children}</ParentSubscriptionContext.Provider>;
}

export function useParentSubscription(): ParentSubscriptionValue {
  const ctx = useContext(ParentSubscriptionContext);
  if (!ctx) throw new Error('useParentSubscription must be used within a ParentSubscriptionProvider');
  return ctx;
}
