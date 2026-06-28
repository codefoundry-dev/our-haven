/**
 * Schedule tab (WEB) — role-aware. Caregiver booking calendar vs the clinical
 * Provider's consultation schedule.
 *  - WIDE   → each inside the WebShell side-rail chrome.
 *  - NARROW → the native mobile Schedule screens + BottomNav (mirrors
 *    schedule.tsx), so phone-width web matches the native design.
 * Metro resolves this over schedule.tsx on web; the native file is untouched.
 */
import { useAuth } from '@/auth/AuthProvider';
import { WebShell } from '@/components/web/WebShell';
import { useWebWide } from '@/lib/responsive';
import { CaregiverScheduleWeb } from '@/screens/web/cp/Schedule';
import { ProviderScheduleWeb } from '@/screens/web/cp/ProviderSchedule';
import { CaregiverSchedule } from '@/screens/caregiver/Schedule';
import { ProviderSchedule } from '@/screens/provider/Schedule';

export default function ScheduleWeb() {
  const { role } = useAuth();
  const wide = useWebWide();

  // Phone-width web → native mobile UI/flow (same as schedule.tsx).
  if (!wide) {
    if (role === 'provider') return <ProviderSchedule />;
    return <CaregiverSchedule />;
  }

  if (role === 'provider') {
    return (
      <WebShell role="provider" active="schedule">
        <ProviderScheduleWeb />
      </WebShell>
    );
  }
  return (
    <WebShell role="caregiver" active="schedule">
      <CaregiverScheduleWeb />
    </WebShell>
  );
}
