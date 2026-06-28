/**
 * Availability (WEB) — the clinical Provider's consultation-slot editor.
 *  - WIDE   → the desktop two-column editor inside the WebShell side-rail chrome.
 *  - NARROW → the native mobile Availability screen (same body as the native
 *    route), so phone-width web matches the native design.
 * Metro resolves this over availability.tsx on web; the native file is untouched.
 */
import { WebShell } from '@/components/web/WebShell';
import { useWebWide } from '@/lib/responsive';
import { ProviderAvailabilityWeb } from '@/screens/web/cp/Availability';
import AvailabilityScreen from '@/screens/provider/Availability';

export default function AvailabilityWeb() {
  if (!useWebWide()) return <AvailabilityScreen />;

  return (
    <WebShell role="provider" active="availability">
      <ProviderAvailabilityWeb />
    </WebShell>
  );
}
