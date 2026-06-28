/**
 * AppBar — screen header (DESIGN.md §3.17). Two shapes:
 *  - large feed header: a big `heading/xl` title left + an action cluster right
 *    (pass `large`).
 *  - detail header: a 44pt circular back button + centered `heading/sm` title +
 *    trailing actions (pass `onBack`).
 */
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { IconName } from '@/components/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { colors, fonts } from '@/theme/tokens';

export interface AppBarAction {
  icon: IconName;
  onPress?: () => void;
  badge?: boolean;
  label?: string;
}

export function AppBar({
  title,
  large,
  onBack,
  actions = [],
  style,
}: {
  title?: string;
  large?: boolean;
  onBack?: () => void;
  actions?: AppBarAction[];
  style?: ViewStyle;
}) {
  const cluster = (
    <View style={styles.cluster}>
      {actions.map((a, i) => (
        <IconButton key={`${a.icon}-${i}`} name={a.icon} onPress={a.onPress} badge={a.badge} accessibilityLabel={a.label ?? a.icon} />
      ))}
    </View>
  );

  if (large) {
    return (
      <View style={[styles.bar, style]}>
        <Text style={styles.largeTitle}>{title}</Text>
        {cluster}
      </View>
    );
  }

  return (
    <View style={[styles.bar, style]}>
      {onBack ? <IconButton name="chevron-left" onPress={onBack} accessibilityLabel="Back" /> : <View style={styles.spacer} />}
      {title ? (
        <Text style={styles.detailTitle} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View style={styles.flex} />
      )}
      {actions.length ? cluster : <View style={styles.spacer} />}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingTop: 4 },
  largeTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 26, letterSpacing: -0.6, color: colors.ink },
  detailTitle: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17, letterSpacing: -0.2, color: colors.ink },
  cluster: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spacer: { width: 44, height: 44 },
  flex: { flex: 1 },
});
