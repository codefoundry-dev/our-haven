/**
 * Job apply (WEB) — the Caregiver's compose-an-Offer apply flow.
 *  - WIDE   → the desktop two-column composer (Job recap + proposal | Offer total)
 *    inside the WebShell side-rail chrome.
 *  - NARROW → the native mobile JobApply screen (same body as the native route),
 *    so phone-width web matches the native design.
 * Metro resolves this over job-apply.tsx on web; the native file is untouched.
 */
import { WebShell } from '@/components/web/WebShell';
import { useWebWide } from '@/lib/responsive';
import { CaregiverJobApplyWeb } from '@/screens/web/cp/JobApply';
import JobApplyScreen from '@/screens/caregiver/JobApply';

export default function JobApplyWebRoute() {
  if (!useWebWide()) return <JobApplyScreen />;

  return (
    <WebShell role="caregiver" active="opportunities">
      <CaregiverJobApplyWeb />
    </WebShell>
  );
}
