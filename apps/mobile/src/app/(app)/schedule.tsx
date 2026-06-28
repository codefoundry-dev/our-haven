/**
 * Schedule tab — role-aware. Caregivers see their booking calendar + availability;
 * Providers (clinical) see their consultation schedule.
 */
import { useAuth } from '@/auth/AuthProvider';
import { CaregiverSchedule } from '@/screens/caregiver/Schedule';
import { ProviderSchedule } from '@/screens/provider/Schedule';

export default function ScheduleRoute() {
  const { role } = useAuth();
  if (role === 'provider') return <ProviderSchedule />;
  return <CaregiverSchedule />;
}
