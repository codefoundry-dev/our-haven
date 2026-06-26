/**
 * Home (WEB) — same stub as the native Home tab, with the supply "Finish your
 * setup" banner on top. The banner renders only for a not-yet-activated
 * Caregiver/Provider (null for Parents), so Parents see the unchanged stub.
 * Metro resolves this over home.tsx on web; the native file is untouched.
 */
import { View } from 'react-native';

import { OnboardingBanner } from '@/components/OnboardingBanner';
import { ScreenStub } from '@/components/ScreenStub';
import { colors } from '@/theme/tokens';

export default function HomeScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <OnboardingBanner />
      <View style={{ flex: 1 }}>
        <ScreenStub title="Home" icon="house" subtitle="Your personalized home feed lands in the next milestone." />
      </View>
    </View>
  );
}
