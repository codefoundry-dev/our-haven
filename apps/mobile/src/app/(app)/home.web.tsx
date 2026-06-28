/**
 * Home tab (WEB) — role-aware dispatcher.
 *  - WIDE viewport  → desktop chrome: caregiver gets the supply dashboard inside
 *    the WebShell side-rail; parent gets marketplace discovery in ParentWebShell.
 *  - NARROW (phone) → the native mobile Home screens + floating BottomNav, so the
 *    mobile web view matches the native designs instead of cramming the desktop
 *    dashboard into a phone column. Mirrors home.tsx exactly.
 * Metro resolves this over home.tsx on web; the native file is untouched.
 */
import { useAuth } from '@/auth/AuthProvider';
import { WebShell } from '@/components/web/WebShell';
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { CaregiverDashboardWeb } from '@/screens/web/cp/Dashboard';
import { ParentDiscoveryWeb } from '@/screens/web/parent/Discovery';
import { CaregiverHome } from '@/screens/caregiver/Home';
import { ParentHome } from '@/screens/parent/Home';

export default function HomeWeb() {
  const { role } = useAuth();
  const wide = useWebWide();

  // Phone-width web → native mobile UI/flow (same as home.tsx).
  if (!wide) {
    if (role === 'caregiver') return <CaregiverHome />;
    return <ParentHome />;
  }

  if (role === 'caregiver') {
    return (
      <WebShell role="caregiver" active="home">
        <CaregiverDashboardWeb />
      </WebShell>
    );
  }
  if (role === 'parent') {
    return (
      <ParentWebShell active="home">
        <ParentDiscoveryWeb />
      </ParentWebShell>
    );
  }
  return <ParentHome />;
}
