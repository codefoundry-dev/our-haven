/**
 * BottomNav — the floating, role-aware bottom tab bar (design: primitives.jsx BottomNav).
 * Rendered as the custom `tabBar` of the (app) Tabs navigator, so it owns which
 * destinations show (and in what order) per role while React Navigation owns
 * the actual screen state.
 */
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { WEB_WIDE_BREAKPOINT } from '@/lib/responsive';
import { ROLE_TABS, type Role } from '@/lib/roles';
import { colors, radii, shadow } from '@/theme/tokens';

/**
 * Above this width on the web, the desktop side-rail (WebShell / ParentWebShell)
 * is the primary navigation, so the floating mobile tab bar is suppressed. It
 * still shows on native and on narrow/mobile-web (where the rail collapses).
 * Shared with the web shells via src/lib/responsive.ts.
 */
const WEB_RAIL_WIDTH = WEB_WIDE_BREAKPOINT;

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
  const { width } = useWindowDimensions();
  const items = ROLE_TABS[role];
  const activeName = state.routes[state.index]?.name;

  // On desktop web the side-rail (WebShell / ParentWebShell) owns navigation, so
  // the floating tab bar must not also render. Native + narrow web keep it.
  if (Platform.OS === 'web' && width >= WEB_RAIL_WIDTH) return null;

  // The supply onboarding wizard is a full-takeover flow (its own CAREGIVER SETUP
  // rail + sticky Back/Continue footer), so the floating tab bar is suppressed there.
  if (activeName === 'onboarding') return null;

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
