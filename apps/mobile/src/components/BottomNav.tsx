/**
 * BottomNav — the floating, role-aware bottom tab bar (design: primitives.jsx BottomNav).
 * Rendered as the custom `tabBar` of the (app) Tabs navigator, so it owns which
 * destinations show (and in what order) per role while React Navigation owns
 * the actual screen state.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { ROLE_TABS, type Role } from '@/lib/roles';
import { colors, radii, shadow } from '@/theme/tokens';

/**
 * Minimal structural shape of the React Navigation bottom-tab bar props we use.
 * Declared locally because `@react-navigation/bottom-tabs` is nested under
 * expo-router and isn't directly resolvable from app code; expo-router's Tabs
 * still passes structurally-compatible props to our custom `tabBar`.
 */
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    navigate: (name: string) => void;
    emit: (event: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
  };
  role: Role;
}

export function BottomNav({ state, navigation, role }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const items = ROLE_TABS[role];
  const activeName = state.routes[state.index]?.name;

  return (
    <View style={[styles.bar, shadow.e2, { paddingBottom: Math.max(insets.bottom, 20) }]}>
      {items.map((item) => {
        const route = state.routes.find((r) => r.name === item.id);
        const focused = activeName === item.id;

        const onPress = () => {
          if (!route) return;
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={item.label}
            onPress={onPress}
            style={styles.item}
          >
            <View
              style={[
                styles.pill,
                {
                  backgroundColor: focused ? colors.brand : colors.surfaceAlt,
                  transform: [{ translateY: focused ? -4 : 0 }],
                },
              ]}
            >
              <Icon name={item.icon} size={20} color={focused ? colors.inkInv : colors.ink} />
            </View>
            <View style={styles.dotSlot}>{focused ? <View style={styles.dot} /> : null}</View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    paddingTop: 12,
    paddingHorizontal: 24,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  item: { alignItems: 'center' },
  pill: { width: 44, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  dotSlot: { height: 10, justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: radii.pill, backgroundColor: colors.highlight },
});
