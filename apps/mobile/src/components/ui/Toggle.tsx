/**
 * Toggle — iOS-style switch (design: primitives.jsx Toggle). Used for the
 * negotiable opt-out (ADR-0017) and notification-preference rows.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radii } from '@/theme/tokens';

export function Toggle({ on, onPress, color = colors.brand }: { on: boolean; onPress?: () => void; color?: string }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={[styles.track, { backgroundColor: on ? color : colors.monoGray }]}
    >
      <View style={[styles.knob, { left: on ? 23 : 3 }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: 50, height: 30, borderRadius: radii.pill, justifyContent: 'center' },
  knob: {
    position: 'absolute',
    top: 3,
    width: 24,
    height: 24,
    borderRadius: radii.pill,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
