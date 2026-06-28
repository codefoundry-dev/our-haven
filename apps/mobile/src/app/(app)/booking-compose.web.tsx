/**
 * Booking compose (WEB) — dispatcher.
 *  - WIDE viewport  → bespoke desktop compose layout inside the Parent side-rail.
 *  - NARROW (phone) → the native mobile booking-compose body, so phone-width web
 *    matches the native design instead of stretching the desktop layout.
 * Metro resolves this over booking-compose.tsx on web; the native file is untouched.
 */
import { ParentWebShell } from '@/components/web/ParentWebShell';
import { useWebWide } from '@/lib/responsive';
import { ParentBookingComposeWeb } from '@/screens/web/parent/BookingCompose';
import BookingComposeScreen from '@/screens/parent/BookingCompose';

export default function BookingComposeWebRoute() {
  if (!useWebWide()) return <BookingComposeScreen />;
  return (
    <ParentWebShell active="bookings">
      <ParentBookingComposeWeb />
    </ParentWebShell>
  );
}
