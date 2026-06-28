/**
 * Account tab (WEB) — role-aware account settings. Parents get the
 * ParentWebShell chrome; caregiver/clinical Provider get the WebShell chrome.
 *  - WIDE   → the desktop account layout inside the side-rail chrome.
 *  - NARROW → the native mobile Account screen + BottomNav (same body as
 *    account.tsx), so phone-width web matches the native design.
 */
import { useAuth } from '@/auth/AuthProvider';
import { WebShell } from '@/components/web/WebShell';
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { AccountWeb } from '@/screens/web/cp/Account';
import { ParentAccountWeb } from '@/screens/web/parent/Account';
import AccountScreen from '@/screens/shared/Account';

export default function AccountWebRoute() {
  const { role } = useAuth();
  const wide = useWebWide();

  // Phone-width web → native mobile Account (same as account.tsx).
  if (!wide) return <AccountScreen />;

  if (role === 'caregiver' || role === 'provider') {
    return (
      <WebShell role={role} active="account">
        <AccountWeb />
      </WebShell>
    );
  }
  return (
    <ParentWebShell active="account">
      <ParentAccountWeb />
    </ParentWebShell>
  );
}
