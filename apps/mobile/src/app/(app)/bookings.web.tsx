/**
 * Bookings tab (WEB) — role-aware. The clinical Provider's incoming consultation
 * Bookings (WebShell chrome) vs the Parent's Bookings (ParentWebShell chrome).
 *  - WIDE   → the desktop layouts inside their side-rail chrome.
 *  - NARROW → the native mobile Bookings screens + BottomNav (mirrors
 *    bookings.tsx), so phone-width web matches the native design. Caregivers have
 *    no Bookings tab; they fall back to the native Parent list if reached.
 */
import { useAuth } from '@/auth/AuthProvider';
import { WebShell } from '@/components/web/WebShell';
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { ProviderBookingsWeb } from '@/screens/web/cp/ProviderBookings';
import { ParentBookingsWeb } from '@/screens/web/parent/Bookings';
import { ProviderBookings } from '@/screens/provider/Bookings';
import { ParentBookings } from '@/screens/parent/Bookings';

export default function BookingsWeb() {
  const { role } = useAuth();
  const wide = useWebWide();

  // Phone-width web → native mobile UI/flow (same as bookings.tsx).
  if (!wide) {
    if (role === 'provider') return <ProviderBookings />;
    return <ParentBookings />;
  }

  if (role === 'provider') {
    return (
      <WebShell role="provider" active="bookings">
        <ProviderBookingsWeb />
      </WebShell>
    );
  }
  if (role === 'parent') {
    return (
      <ParentWebShell active="bookings">
        <ParentBookingsWeb />
      </ParentWebShell>
    );
  }
  return <ParentBookings />;
}
