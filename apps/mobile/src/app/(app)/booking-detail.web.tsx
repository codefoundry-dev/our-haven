/**
 * Booking detail (WEB) — Parent viewing a single booking.
 *  - WIDE   → the desktop two-column booking detail inside the ParentWebShell
 *    side-rail chrome.
 *  - NARROW → the native mobile BookingDetail screen (same body as the native
 *    route), so phone-width web matches the native design.
 * Metro resolves this over booking-detail.tsx on web; the native file is untouched.
 */
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { ParentBookingDetailWeb } from '@/screens/web/parent/BookingDetail';
import BookingDetailScreen from '@/screens/parent/BookingDetail';

export default function BookingDetailWebRoute() {
  if (!useWebWide()) return <BookingDetailScreen />;

  return (
    <ParentWebShell active="bookings">
      <ParentBookingDetailWeb />
    </ParentWebShell>
  );
}
