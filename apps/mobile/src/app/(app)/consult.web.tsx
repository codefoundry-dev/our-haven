/**
 * Consultation session (WEB) — the clinical Provider's live consultation room.
 *  - WIDE   → the desktop two-column video room inside the WebShell side-rail chrome.
 *  - NARROW → the native mobile Consult screen (same body as the native route),
 *    so phone-width web matches the native design.
 * Metro resolves this over consult.tsx on web; the native file is untouched.
 */
import { WebShell } from '@/components/web/WebShell';
import { useWebWide } from '@/lib/responsive';
import { ProviderConsultWeb } from '@/screens/web/cp/Consult';
import ConsultScreen from '@/screens/provider/Consult';

export default function ConsultWeb() {
  if (!useWebWide()) return <ConsultScreen />;

  return (
    <WebShell role="provider" active="schedule">
      <ProviderConsultWeb />
    </WebShell>
  );
}
