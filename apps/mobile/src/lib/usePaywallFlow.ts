/**
 * usePaywallFlow (OH-204) — the Parent paywall state machine, shared by the native
 * (`screens/parent/Paywall`) and desktop-web (`screens/web/parent/Paywall`) screens
 * so the gate, phone step, checkout, status-poll, and resume behave identically.
 *
 * Flow:
 *   1. Resolve the intent (route param `i`, falling back to the AsyncStorage stash
 *      that survives the web redirect).
 *   2. Phone step — collected + verified in the paywall (CONTEXT § Subscription).
 *      If the SMS can't be sent (no provider configured), it can be skipped so a
 *      subscription is never blocked at launch.
 *   3. Checkout — open the Stripe-hosted Checkout (a new tab on web, an in-app
 *      browser on native), then **poll** the subscription summary until `entitled`
 *      flips (the billing webhook owns the state). Env-agnostic: it does not depend
 *      on how the Stripe success URL is configured.
 *   4. Resume — once entitled, resume the originally-attempted action. Only the
 *      consultation re-attempts a real backend call (OH-203); the other three
 *      return the now-entitled Parent to their action screen.
 */
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { ApiError, bookConsultation, createParentCheckoutLink, createParentPortalLink } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useParentSubscription } from '@/lib/ParentSubscriptionProvider';
import {
  clearIntent,
  parseIntent,
  stashIntent,
  readIntent,
  type PaywallIntent,
} from '@/lib/paywallIntent';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const isWeb = Platform.OS === 'web';

/** Open the hosted Checkout. Web → a new tab (this tab keeps polling); native →
 *  an in-app browser. Returns 'redirected' only when a blocked popup forced a
 *  same-tab redirect (the page then unloads, so the caller must not poll). */
async function openCheckoutUrl(url: string): Promise<'opened' | 'redirected'> {
  if (isWeb) {
    const popup = typeof window !== 'undefined' ? window.open(url, '_blank', 'noopener,noreferrer') : null;
    if (!popup) {
      if (typeof window !== 'undefined') window.location.href = url;
      return 'redirected';
    }
    return 'opened';
  }
  const returnUrl = Linking.createURL('paywall');
  await WebBrowser.openAuthSessionAsync(url, returnUrl);
  return 'opened';
}

/** Open a management URL (Billing Portal) — a new tab on web, in-app browser native. */
async function openExternalUrl(url: string): Promise<void> {
  if (isWeb) {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  await WebBrowser.openBrowserAsync(url);
}

export interface PaywallFlow {
  /** The marketplace gate. */
  entitled: boolean;
  /** Phone confirmed on auth.users (the paywall phone step is done). */
  phoneVerified: boolean;
  /** The Parent chose to continue without a verified phone (SMS unavailable). */
  phoneSkipped: boolean;
  /** True once an SMS send has failed — reveals the "Continue without phone" option. */
  sendFailed: boolean;
  /** Phone step still needs the user (not verified and not skipped). */
  phoneStepActive: boolean;
  /** The checkout CTA may show (phone verified or skipped). */
  readyForCheckout: boolean;
  /** Entitled + arrived without an intent → show the "you're subscribed" manage view. */
  manageMode: boolean;
  /** The summary status string, for the manage view. */
  status: string | null;
  /** 'polling' while waiting for the webhook after returning from checkout. */
  phase: 'idle' | 'polling';
  busy: boolean;
  error: string | null;

  onPhoneVerified: () => Promise<void>;
  onPhoneSendFailed: (message: string) => void;
  skipPhone: () => void;
  startCheckout: () => Promise<void>;
  /** Manual "I've subscribed — check again" after a poll timeout. */
  recheck: () => Promise<void>;
  /** Manage / cancel (entitled) via the Stripe Billing Portal. */
  openPortal: () => Promise<void>;
  /** "Show me the preview" — abandon the action and go back. */
  dismiss: () => void;
}

export function usePaywallFlow(paramIntentRaw: string | string[] | undefined): PaywallFlow {
  const router = useRouter();
  const auth = useAuth();
  const { entitled, phoneVerified, summary, refresh } = useParentSubscription();

  // Stabilise across renders (parseIntent returns a fresh object each call).
  const paramKey = Array.isArray(paramIntentRaw) ? paramIntentRaw[0] : paramIntentRaw;
  const paramIntent = useMemo(() => parseIntent(paramKey), [paramKey]);
  const [stashedIntent, setStashedIntent] = useState<PaywallIntent | null>(null);
  const [intentResolved, setIntentResolved] = useState<boolean>(paramIntent != null);
  const intent = paramIntent ?? stashedIntent;

  const [phoneSkipped, setPhoneSkipped] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'polling'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const resumedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Resolve the intent: the route param wins; otherwise read the stash (the
  // cold-return path after a web full-page redirect).
  useEffect(() => {
    if (paramIntent != null) {
      setIntentResolved(true);
      return;
    }
    let cancelled = false;
    void readIntent().then((i) => {
      if (cancelled) return;
      setStashedIntent(i);
      setIntentResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [paramIntent]);

  const doResume = useCallback(
    async (it: PaywallIntent) => {
      await clearIntent();
      switch (it.kind) {
        case 'post-job':
          router.replace('/post-job');
          return;
        case 'message':
          router.replace({
            pathname: '/message-thread',
            params: { id: it.id, ...(it.name ? { name: it.name } : {}) },
          });
          return;
        case 'book-request':
          router.replace({ pathname: '/booking-compose', params: { id: it.id } });
          return;
        case 'book-consultation':
          try {
            await bookConsultation(it.id, it.slotId);
            router.replace('/bookings');
          } catch {
            // Entitled now, but the slot may have been taken — back to the profile
            // to re-pick a time (it reloads fresh slots).
            router.replace({ pathname: '/provider-detail', params: { id: it.id } });
          }
          return;
      }
    },
    [router],
  );

  // Resume once entitlement is confirmed and we know the intent.
  useEffect(() => {
    if (!entitled || !intentResolved || !intent || resumedRef.current) return;
    resumedRef.current = true;
    void doResume(intent);
  }, [entitled, intentResolved, intent, doResume]);

  const pollUntilEntitled = useCallback(async () => {
    for (let i = 0; i < 20 && mountedRef.current && !resumedRef.current; i++) {
      const fresh = await refresh();
      if (fresh?.entitled) return; // the resume effect navigates away
      await delay(3000);
    }
    // Timed out: keep the polling card up (so its "I've subscribed" recheck button
    // stays available) and explain. `busy` is cleared by startCheckout's finally.
    if (mountedRef.current && !resumedRef.current) {
      setError("We haven't seen your subscription yet. If you finished checkout, tap “I've subscribed”.");
    }
  }, [refresh]);

  const onPhoneVerified = useCallback(async () => {
    // The verified number is now on auth.users; pull a fresh session so
    // phone_confirmed_at (→ phoneVerified) lands.
    await auth.refresh();
  }, [auth]);

  const onPhoneSendFailed = useCallback(() => setSendFailed(true), []);
  const skipPhone = useCallback(() => setPhoneSkipped(true), []);

  const startCheckout = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (intent) await stashIntent(intent); // persist across the web tab / redirect
      const { url } = await createParentCheckoutLink();
      const outcome = await openCheckoutUrl(url);
      if (outcome === 'redirected') return; // same-tab redirect: this page unloads
      setPhase('polling');
      await pollUntilEntitled();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start checkout. Please try again.');
      setPhase('idle');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [intent, pollUntilEntitled]);

  const recheck = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const fresh = await refresh();
      if (!fresh?.entitled) setError('Not active yet — give it a moment after completing checkout.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [refresh]);

  const openPortal = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await createParentPortalLink();
      await openExternalUrl(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open the billing portal.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    void clearIntent();
    router.back();
  }, [router]);

  const phoneStepActive = !phoneVerified && !phoneSkipped;
  const readyForCheckout = phoneVerified || phoneSkipped;
  const manageMode = entitled && intentResolved && intent == null;

  return {
    entitled,
    phoneVerified,
    phoneSkipped,
    sendFailed,
    phoneStepActive,
    readyForCheckout,
    manageMode,
    status: summary?.status ?? null,
    phase,
    busy,
    error,
    onPhoneVerified,
    onPhoneSendFailed,
    skipPhone,
    startCheckout,
    recheck,
    openPortal,
    dismiss,
  };
}
