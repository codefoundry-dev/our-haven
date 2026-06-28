/**
 * Post a Job (WEB) — the Parent multi-step job-posting wizard.
 *  - WIDE   → the bespoke desktop wizard (numbered step rail + step body) inside
 *    the ParentWebShell side-rail chrome.
 *  - NARROW → the native mobile PostJob screen (same body as the native route),
 *    so phone-width web matches the native design.
 * Metro resolves this over post-job.tsx on web; the native file is untouched.
 */
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { ParentPostJobWeb } from '@/screens/web/parent/PostJob';
import PostJobScreen from '@/screens/parent/PostJob';

export default function PostJobWeb() {
  if (!useWebWide()) return <PostJobScreen />;

  return (
    <ParentWebShell active="home">
      <ParentPostJobWeb />
    </ParentWebShell>
  );
}
