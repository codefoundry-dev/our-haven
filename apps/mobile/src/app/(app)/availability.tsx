/**
 * Availability editor — role-aware. Caregivers edit their weekly 7×3 grid + note +
 * pause (OH-220); clinical Providers edit their consultation slots (OH-222). The
 * screen bodies live in `@/screens/*` so the `.web.tsx` desktop dispatcher can
 * render the same native UI at phone width.
 */
import { useAuth } from '@/auth/AuthProvider';
import { CaregiverAvailability } from '@/screens/caregiver/Availability';
import ProviderAvailability from '@/screens/provider/Availability';

export default function AvailabilityRoute() {
  const { role } = useAuth();
  if (role === 'provider') return <ProviderAvailability />;
  return <CaregiverAvailability />;
}
