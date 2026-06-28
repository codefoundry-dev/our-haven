/**
 * Job applicants (WEB) — Parent's posted Jobs + applicant review.
 *  - WIDE   → the desktop review layout inside the ParentWebShell side-rail chrome.
 *  - NARROW → the native mobile Job applicants screen (same body as
 *    job-applicants.tsx), so phone-width web matches the native design.
 * Metro resolves this over job-applicants.tsx on web.
 */
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { ParentJobsWeb } from '@/screens/web/parent/Jobs';
import JobApplicantsScreen from '@/screens/parent/JobApplicants';

export default function JobApplicantsWeb() {
  if (!useWebWide()) return <JobApplicantsScreen />;

  return (
    <ParentWebShell active="bookings">
      <ParentJobsWeb />
    </ParentWebShell>
  );
}
