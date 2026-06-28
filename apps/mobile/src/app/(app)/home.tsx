/**
 * Home tab — role-aware dispatcher. Parents get the discovery/Jobs home;
 * Caregivers get the supply dashboard. (Providers have no Home tab — their
 * landing is Schedule.)
 */
import { useAuth } from '@/auth/AuthProvider';
import { CaregiverHome } from '@/screens/caregiver/Home';
import { ParentHome } from '@/screens/parent/Home';

export default function HomeRoute() {
  const { role } = useAuth();
  if (role === 'caregiver') return <CaregiverHome />;
  return <ParentHome />;
}
