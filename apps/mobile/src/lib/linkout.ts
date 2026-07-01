/**
 * Hosted-flow linkouts — opening Stripe-hosted (and similar) web flows from the
 * app, with a return path back into it. The pattern (OH-204) is shared by the
 * Parent paywall (`usePaywallFlow`) and the Provider Subscription flow (OH-222):
 *
 *  - A flow that RETURNS to the app (Checkout): on web open a new tab so this tab
 *    keeps polling; on native open an in-app auth session bound to a return URL.
 *    Returns 'redirected' only when a blocked popup forced a same-tab redirect —
 *    the page then unloads, so the caller must NOT poll.
 *  - A fire-and-forget MANAGEMENT flow (Billing Portal): a new tab on web, a plain
 *    in-app browser on native.
 */
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

/** Open a hosted flow that returns to the app. `returnPath` is the in-app route
 *  (e.g. 'subscription') the native auth session comes back to. */
export async function openHostedFlow(url: string, returnPath: string): Promise<'opened' | 'redirected'> {
  if (isWeb) {
    const popup = typeof window !== 'undefined' ? window.open(url, '_blank', 'noopener,noreferrer') : null;
    if (!popup) {
      if (typeof window !== 'undefined') window.location.href = url;
      return 'redirected';
    }
    return 'opened';
  }
  const returnUrl = Linking.createURL(returnPath);
  await WebBrowser.openAuthSessionAsync(url, returnUrl);
  return 'opened';
}

/** Open a fire-and-forget management URL — a new tab on web, in-app browser native. */
export async function openManagementUrl(url: string): Promise<void> {
  if (isWeb) {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  await WebBrowser.openBrowserAsync(url);
}
