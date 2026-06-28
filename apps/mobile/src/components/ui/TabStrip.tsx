/**
 * TabStrip — segmented control (DESIGN.md §3.18). Used inside Bookings / Messages
 * lists and profile About/Availability/Reviews tabs.
 */
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, fonts, radii, shadow } from '@/theme/tokens';

export function TabStrip<T extends string>({
  tabs,
  value,
  onChange,
  style,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (t: T) => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.bar, style]}>
      {tabs.map((t) => {
        const active = t === value;
        return (
          <Pressable
            key={t}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(t)}
            style={[styles.tab, active ? [styles.tabActive, shadow.e1] : null]}
          >
            <Text style={[styles.label, { color: active ? colors.ink : colors.ink2 }]} numberOfLines={1}>
              {t}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radii.pill, padding: 4, height: 44 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
  tabActive: { backgroundColor: colors.surface },
  label: { fontFamily: fonts.semibold, fontSize: 13 },
});
