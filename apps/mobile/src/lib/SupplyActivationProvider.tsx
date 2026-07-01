/**
 * SupplyActivationProvider — the client-side source of truth for a supply user's
 * (Caregiver / Provider) *activation* state: whether verification has cleared and,
 * if not, which onboarding step is blocking them.
 *
 * The Caregiver mobile shell (OH-217) needs this in two places: the Opportunities
 * tab shows a pre-activation empty state naming the blocking step (PRD story 83)
 * until the user is activated, and the bottom-nav badges stay suppressed until then
 * (an un-activated Caregiver has no Jobs to be badged about, PRD story 81). One
 * shared context fetched once keeps both surfaces consistent instead of each
 * fetching its own verification snapshot (as OnboardingBanner does on web).
 *
 * Inert for Parents: it only fetches when the authenticated role is supply, so
 * mounting it app-wide costs a Parent nothing. On any fetch failure (backend
 * unreachable / API URL unset) it falls back to `activated: true` — the
 * non-blocking choice, mirroring OnboardingBanner's "don't nag on error" — so the
 * Jobs feed is never hidden behind an empty state we couldn't justify.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getVerification, type Verification } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { firstActionableStep, onboardingSteps, type OnboardingStep } from '@/lib/onboarding';

interface SupplyActivationValue {
  /** True while the first verification fetch is in flight (supply roles only). */
  loading: boolean;
  /** The raw verification snapshot, or null before load / for Parents / on error. */
  verification: Verification | null;
  /** True once verification has cleared (state === 'activated'), or for Parents. */
  activated: boolean;
  /** The first actionable, not-done onboarding step — what to do next, or null. */
  blockingStep: OnboardingStep | null;
}

/** Value for non-supply roles (and the pre-fetch default): nothing to gate on. */
const INERT: SupplyActivationValue = { loading: false, verification: null, activated: true, blockingStep: null };

const SupplyActivationContext = createContext<SupplyActivationValue>(INERT);

export function SupplyActivationProvider({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const supply = role === 'caregiver' || role === 'provider';

  // Role is permanent and the provider only mounts inside (app) once it's resolved
  // (the layout returns null while `role` is null), so `supply` is stable for this
  // provider's life: `loading` starts true only for supply users and the fetch
  // flips it false in .finally — no synchronous setState in the effect body.
  const [loading, setLoading] = useState(supply);
  const [verification, setVerification] = useState<Verification | null>(null);

  useEffect(() => {
    if (!supply) return;
    let cancelled = false;
    getVerification()
      .then((v) => {
        if (!cancelled) setVerification(v);
      })
      .catch(() => {
        // Backend unreachable — leave the snapshot null; the memo defaults to
        // activated so we never hide the feed behind an empty state we can't justify.
        if (!cancelled) setVerification(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supply]);

  const value = useMemo<SupplyActivationValue>(() => {
    if (!supply) return INERT;
    // No snapshot yet (still loading, or the fetch failed): default activated=true.
    // The Opportunities screen gates on `loading` first, so the feed never flashes
    // before the empty state during the initial fetch.
    if (!verification) return { loading, verification: null, activated: true, blockingStep: null };
    const steps = onboardingSteps(verification);
    return {
      loading,
      verification,
      activated: verification.state === 'activated',
      blockingStep: firstActionableStep(steps),
    };
  }, [supply, loading, verification]);

  return <SupplyActivationContext.Provider value={value}>{children}</SupplyActivationContext.Provider>;
}

export function useSupplyActivation(): SupplyActivationValue {
  return useContext(SupplyActivationContext);
}
