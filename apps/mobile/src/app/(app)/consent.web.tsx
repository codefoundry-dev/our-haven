/**
 * Consent (WEB) — the Parent sensitive-information consent screen.
 *  - WIDE   → the focused desktop consent page inside the ParentWebShell rail.
 *  - NARROW → the native mobile Consent screen (same body as the native route),
 *    so phone-width web matches the native design.
 * Metro resolves this over consent.tsx on web; the native file is untouched.
 */
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { ParentConsentWeb } from '@/screens/web/parent/Consent';
import ConsentScreen from '@/screens/parent/Consent';

export default function ConsentWeb() {
  if (!useWebWide()) return <ConsentScreen />;

  return (
    <ParentWebShell active="account">
      <ParentConsentWeb />
    </ParentWebShell>
  );
}
