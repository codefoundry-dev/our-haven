/**
 * Availability (WEB) — role-aware.
 *  - Caregiver → the native 7×3 grid editor (OH-220) at every width. The desktop
 *    caregiver portal chrome for this surface is a follow-up.
 *  - Provider → WIDE: the two-column consultation-slot editor inside the WebShell
 *    side-rail; NARROW: the native mobile Availability screen.
 * Metro resolves this over availability.tsx on web; the native file is untouched.
 */
import { useAuth } from '@/auth/AuthProvider';
import { WebShell } from '@/components/web/WebShell';
import { useWebWide } from '@/lib/responsive';
import { ProviderAvailabilityWeb } from '@/screens/web/cp/Availability';
import { CaregiverAvailability } from '@/screens/caregiver/Availability';
import ProviderAvailabilityScreen from '@/screens/provider/Availability';

export default function AvailabilityWeb() {
  const { role } = useAuth();
  const wide = useWebWide();

  if (role !== 'provider') return <CaregiverAvailability />;
  if (!wide) return <ProviderAvailabilityScreen />;

  return (
    <WebShell role="provider" active="availability">
      <ProviderAvailabilityWeb />
    </WebShell>
  );
}
