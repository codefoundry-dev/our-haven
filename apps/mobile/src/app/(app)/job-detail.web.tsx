/**
 * Job detail (WEB) — a Caregiver reading one open Parent Job.
 *  - WIDE   → the desktop two-column layout inside the WebShell side-rail chrome.
 *  - NARROW → the native mobile Job-detail screen (same body as the native route),
 *    so phone-width web matches the native design.
 * Metro resolves this over job-detail.tsx on web; the native file is untouched.
 */
import { WebShell } from '@/components/web/WebShell';
import { useWebWide } from '@/lib/responsive';
import { CaregiverJobDetailWeb } from '@/screens/web/cp/JobDetail';
import JobDetailScreen from '@/screens/caregiver/JobDetail';

export default function JobDetailWebRoute() {
  if (!useWebWide()) return <JobDetailScreen />;

  return (
    <WebShell role="caregiver" active="opportunities">
      <CaregiverJobDetailWeb />
    </WebShell>
  );
}
