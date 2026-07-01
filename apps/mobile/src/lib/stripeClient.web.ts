/**
 * Stripe client seam (web) — OH-211 opportunistic 3DS. The web analogue of
 * `stripeClient.ts` (native): `usePaymentAuthenticator().authenticate` runs the
 * 3DS challenge with Stripe.js `handleNextAction` on a lazily-loaded Stripe
 * instance. Identical shape to the native hook so callers are platform-blind.
 */
import { useCallback } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';

const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

export interface AuthenticateResult {
  ok: boolean;
  error?: string;
}

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) stripePromise = loadStripe(PUBLISHABLE_KEY);
  return stripePromise;
}

export function usePaymentAuthenticator() {
  const authenticate = useCallback(async (clientSecret: string): Promise<AuthenticateResult> => {
    if (!PUBLISHABLE_KEY) {
      return { ok: false, error: 'Payments are not configured on this build.' };
    }
    try {
      const stripe = await getStripe();
      if (!stripe) return { ok: false, error: 'Could not load Stripe.' };
      const { error } = await stripe.handleNextAction({ clientSecret });
      if (error) return { ok: false, error: error.message ?? 'Card authentication failed.' };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Card authentication failed.' };
    }
  }, []);

  return { authenticate, configured: PUBLISHABLE_KEY.length > 0 };
}
