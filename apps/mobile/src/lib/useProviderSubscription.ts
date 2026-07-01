/**
 * useProviderSubscription (OH-222) — the Provider's listing/billing state + the
 * two hosted linkouts, shared by the Subscription screen and the Schedule
 * pre-activation state.
 *
 * The Provider Subscription (OH-191) is a Stripe Customer subscription (NOT
 * Connect). Being `listed` (status active/trialing) is the gate that lets a
 * Provider publish bookable consultation slots and appear in Search. This hook
 * reads the summary, opens the Stripe-hosted Checkout to start (then polls the
 * summary until the billing webhook flips `listed`), lets the user re-check after
 * a poll timeout, and opens the Billing Portal to manage / cancel.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  createProviderCheckoutLink,
  createProviderPortalLink,
  getProviderSubscription,
  type ProviderSubscription,
} from '@/api/client';
import { openHostedFlow, openManagementUrl } from '@/lib/linkout';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ProviderSubscriptionFlow {
  summary: ProviderSubscription | null;
  /** True iff the practice is search-visible + bookable (status active/trialing). */
  listed: boolean;
  loading: boolean;
  error: string | null;
  /** 'polling' while waiting for the billing webhook after returning from checkout. */
  phase: 'idle' | 'polling';
  busy: boolean;
  actionError: string | null;
  refetch: () => Promise<ProviderSubscription | null>;
  /** Start the subscription via Stripe-hosted Checkout, then poll until listed. */
  startCheckout: () => Promise<void>;
  /** Manual "I've subscribed — check again" after a poll timeout. */
  recheck: () => Promise<void>;
  /** Manage / cancel via the Stripe Billing Portal. */
  openPortal: () => Promise<void>;
}

export function useProviderSubscription(): ProviderSubscriptionFlow {
  const [summary, setSummary] = useState<ProviderSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'polling'>('idle');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    try {
      const s = await getProviderSubscription();
      if (mountedRef.current) {
        setSummary(s);
        setError(null);
      }
      return s;
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof ApiError ? e.message : 'Could not load your subscription.');
      }
      return null;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const pollUntilListed = useCallback(async () => {
    for (let i = 0; i < 20 && mountedRef.current; i++) {
      const fresh = await refetch();
      if (fresh?.listed) return;
      await delay(3000);
    }
    if (mountedRef.current) {
      setActionError("We haven't seen your subscription yet. If you finished checkout, tap “I've subscribed”.");
    }
  }, [refetch]);

  const startCheckout = useCallback(async () => {
    setActionError(null);
    setBusy(true);
    try {
      const { url } = await createProviderCheckoutLink();
      const outcome = await openHostedFlow(url, 'subscription');
      if (outcome === 'redirected') return; // same-tab redirect: this page unloads
      setPhase('polling');
      await pollUntilListed();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not start checkout. Please try again.');
    } finally {
      if (mountedRef.current) {
        setBusy(false);
        setPhase('idle');
      }
    }
  }, [pollUntilListed]);

  const recheck = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const fresh = await refetch();
      if (!fresh?.listed) setActionError('Not active yet — give it a moment after completing checkout.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [refetch]);

  const openPortal = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const { url } = await createProviderPortalLink();
      await openManagementUrl(url);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not open the billing portal.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  return {
    summary,
    listed: summary?.listed ?? false,
    loading,
    error,
    phase,
    busy,
    actionError,
    refetch,
    startCheckout,
    recheck,
    openPortal,
  };
}
