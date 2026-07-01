/**
 * My Jobs hub (WEB) — the Parent's posted Jobs.
 *  - WIDE   → the desktop two-pane (Jobs list + selected Job's applicants) inside
 *    the ParentWebShell side-rail chrome.
 *  - NARROW → the native mobile My Jobs list (same body as my-jobs.tsx).
 * Metro resolves this over my-jobs.tsx on web.
 */
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { ParentJobsWeb } from '@/screens/web/parent/Jobs';
import MyJobsScreen from '@/screens/parent/MyJobs';

export default function MyJobsWeb() {
  if (!useWebWide()) return <MyJobsScreen />;

  return (
    <ParentWebShell active="bookings">
      <ParentJobsWeb />
    </ParentWebShell>
  );
}
