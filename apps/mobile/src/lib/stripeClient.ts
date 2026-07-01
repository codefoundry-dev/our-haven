/**
 * Stripe client seam (native) — OH-211 opportunistic 3DS.
 *
 * The booking authorize happens server-side against the Parent's saved card; the
 * client only steps in when Stripe demands a 3DS challenge (`requires_action`).
 * `usePaymentAuthenticator().authenticate(clientSecret)` runs that challenge via
 * `@stripe/stripe-react-native`'s `handleNextAction`. The native SDK is set up
 * lazily with `initStripe` (no root `<StripeProvider>` needed for this one call).
 *
 * The web build resolves `stripeClient.web.ts` instead (Stripe.js). Both expose
 * the identical hook, so callers (AwardSheet, BookingDetail) are platform-blind.
 * With no publishable key configured the hook degrades gracefully (returns a
 * clear error) rather than throwing.
 */
import { useCallback } from 'react';
import { initStripe, useStripe } from '@stripe/stripe-react-native';

const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

export interface AuthenticateResult {
  ok: boolean;
  error?: string;
}

let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = initStripe({ publishableKey: PUBLISHABLE_KEY }).then(() => undefined);
  }
  return initPromise;
}

export function usePaymentAuthenticator() {
  const { handleNextAction } = useStripe();

  const authenticate = useCallback(
    async (clientSecret: string): Promise<AuthenticateResult> => {
      if (!PUBLISHABLE_KEY) {
        return { ok: false, error: 'Payments are not configured on this build.' };
      }
      try {
        await ensureInit();
        const { error } = await handleNextAction(clientSecret);
        if (error) return { ok: false, error: error.message ?? 'Card authentication failed.' };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Card authentication failed.' };
      }
    },
    [handleNextAction],
  );

  return { authenticate, configured: PUBLISHABLE_KEY.length > 0 };
}
