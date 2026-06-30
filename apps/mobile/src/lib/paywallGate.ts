/**
 * Parent paywall gate (OH-204) — intercepts a gated action and, when the Parent
 * is not entitled, routes to the paywall carrying the intent to resume.
 *
 * The four gated actions (Message / Book-request / Post-Job / Consultation) all
 * fire the same gate (CONTEXT § Subscription). Two shapes are exposed:
 *   - `gate(intent, proceed)` — the client-side pre-check for actions with no
 *     backend yet (Message / Book-request / Post-Job): runs `proceed()` when
 *     entitled, else opens the paywall. The server is the source of truth only
 *     where a backend exists.
 *   - `openPaywall(intent?)` — go straight to the paywall with an intent (used by
 *     the Consultation flow on the server's 402, where the action was attempted),
 *     or with no intent (Search "unlock" banner / web shell chip) which clears any
 *     stale stash so the paywall never resumes an unrelated action.
 *
 * The intent is both stashed (survives the web redirect) and passed as the `i`
 * route param; the paywall prefers the param, falling back to the stash.
 */
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { useParentSubscription } from '@/lib/ParentSubscriptionProvider';
import { clearIntent, encodeIntent, stashIntent, type PaywallIntent } from '@/lib/paywallIntent';

export interface ParentGate {
  entitled: boolean;
  /** Run `proceed` when entitled; otherwise open the paywall with this intent. */
  gate: (intent: PaywallIntent, proceed: () => void) => void;
  /** Open the paywall directly. With an intent → stash + resume; without → clear stash. */
  openPaywall: (intent?: PaywallIntent) => void;
}

export function useParentGate(): ParentGate {
  const router = useRouter();
  const { entitled } = useParentSubscription();

  const openPaywall = useCallback(
    (intent?: PaywallIntent) => {
      if (intent) {
        void stashIntent(intent);
        router.push({ pathname: '/paywall', params: { i: encodeIntent(intent) } });
      } else {
        // Clear any stale stash BEFORE navigating so the paywall (which reads the
        // stash when there's no param) can't resume an unrelated, abandoned action.
        void (async () => {
          await clearIntent();
          router.push('/paywall');
        })();
      }
    },
    [router],
  );

  const gate = useCallback(
    (intent: PaywallIntent, proceed: () => void) => {
      if (entitled) proceed();
      else openPaywall(intent);
    },
    [entitled, openPaywall],
  );

  return { entitled, gate, openPaywall };
}
