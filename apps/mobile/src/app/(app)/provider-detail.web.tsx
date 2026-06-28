/**
 * Provider detail (WEB) — Parent-facing Provider profile.
 *  - WIDE   → the desktop profile inside the ParentWebShell side-rail chrome.
 *  - NARROW → the native mobile Provider detail screen (same body as
 *    provider-detail.tsx), so phone-width web matches the native design.
 * Metro resolves this over provider-detail.tsx on web.
 */
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { ParentProviderWeb } from '@/screens/web/parent/Provider';
import ProviderDetailScreen from '@/screens/parent/ProviderDetail';

export default function ProviderDetailWeb() {
  if (!useWebWide()) return <ProviderDetailScreen />;

  return (
    <ParentWebShell active="search">
      <ParentProviderWeb />
    </ParentWebShell>
  );
}
