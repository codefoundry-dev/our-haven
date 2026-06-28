/**
 * Paywall (WEB) — Parent Subscription gate / checkout.
 *  - WIDE   → the desktop checkout inside the ParentWebShell side-rail chrome.
 *  - NARROW → the native mobile Paywall screen (same body as paywall.tsx), so
 *    phone-width web matches the native design.
 * Metro resolves this over paywall.tsx on web.
 */
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { ParentPaywallWeb } from '@/screens/web/parent/Paywall';
import PaywallScreen from '@/screens/parent/Paywall';

export default function PaywallWeb() {
  if (!useWebWide()) return <PaywallScreen />;

  return (
    <ParentWebShell active="home">
      <ParentPaywallWeb />
    </ParentWebShell>
  );
}
