/**
 * Bookings tab — role-aware. Parents see their Bookings across all Providers;
 * Providers (clinical) see incoming consultation Bookings to act on.
 */
import { useAuth } from '@/auth/AuthProvider';
import { ParentBookings } from '@/screens/parent/Bookings';
import { ProviderBookings } from '@/screens/provider/Bookings';

export default function BookingsRoute() {
  const { role } = useAuth();
  if (role === 'provider') return <ProviderBookings />;
  return <ParentBookings />;
}
