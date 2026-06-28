/**
 * Search (WEB) — the Parent marketplace search / discovery results.
 *  - WIDE   → the desktop filters-rail + results-grid layout inside the
 *    ParentWebShell side-rail chrome.
 *  - NARROW → the native mobile Search screen (same body as the native route),
 *    so phone-width web matches the native design.
 * Metro resolves this over search.tsx on web; the native file is untouched.
 */
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { ParentSearchWeb } from '@/screens/web/parent/Search';
import SearchScreen from '@/screens/parent/Search';

export default function SearchWeb() {
  if (!useWebWide()) return <SearchScreen />;

  return (
    <ParentWebShell active="search">
      <ParentSearchWeb />
    </ParentWebShell>
  );
}
