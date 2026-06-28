/**
 * Children/dependents tab (WEB) — Parent-only flow.
 *  - WIDE viewport  → bespoke desktop layout in <ParentWebShell active="account">.
 *  - NARROW (phone) → the native mobile Children roster, so mobile web matches the
 *    native design (no desktop form squeezed into a phone column).
 * Metro resolves this over children.tsx on web; the native file is untouched.
 *
 * Never `import ... from './children'` here — Metro resolves that back to this
 * .web.tsx (infinite loop). The native body is imported from `@/screens/...`.
 */
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { ParentChildrenWeb } from '@/screens/web/parent/Children';
import ChildrenScreen from '@/screens/parent/Children';

export default function ChildrenWebRoute() {
  if (!useWebWide()) return <ChildrenScreen />;
  return (
    <ParentWebShell active="account">
      <ParentChildrenWeb />
    </ParentWebShell>
  );
}
