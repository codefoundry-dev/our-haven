/**
 * Opportunities tab (WEB) — Caregiver-only open-Jobs feed.
 *  - WIDE   → the desktop feed inside the WebShell side-rail chrome.
 *  - NARROW → the native mobile Opportunities screen + BottomNav (mirrors
 *    opportunities.tsx), so phone-width web matches the native design.
 */
import { WebShell } from '@/components/web/WebShell';
import { useWebWide } from '@/lib/responsive';
import { CaregiverOpportunitiesWeb } from '@/screens/web/cp/Opportunities';
import { CaregiverOpportunities } from '@/screens/caregiver/Opportunities';

export default function OpportunitiesWeb() {
  if (!useWebWide()) return <CaregiverOpportunities />;

  return (
    <WebShell role="caregiver" active="opportunities">
      <CaregiverOpportunitiesWeb />
    </WebShell>
  );
}
