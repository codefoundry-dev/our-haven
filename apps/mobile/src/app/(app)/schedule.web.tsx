/**
 * Schedule (WEB) — same stub as the native Schedule tab (the Provider's landing
 * tab), with the supply "Finish your setup" banner on top. The banner renders only
 * for a not-yet-activated Caregiver/Provider. Metro resolves this over schedule.tsx
 * on web; the native file is untouched.
 */
import { View } from 'react-native';

import { OnboardingBanner } from '@/components/OnboardingBanner';
import { ScreenStub } from '@/components/ScreenStub';
import { colors } from '@/theme/tokens';

export default function ScheduleScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <OnboardingBanner />
      <View style={{ flex: 1 }}>
        <ScreenStub title="Schedule" icon="calendar" subtitle="Your upcoming sessions and availability will appear here." />
      </View>
    </View>
  );
}
