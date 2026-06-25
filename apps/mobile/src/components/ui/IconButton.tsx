/**
 * IconButton — circular 44px button used in app bars (design: primitives.jsx IconBtn).
 */
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { colors, radii } from '@/theme/tokens';

interface IconButtonProps {
  name: IconName;
  onPress?: () => void;
  size?: number;
  dark?: boolean;
  active?: boolean;
  badge?: boolean;
  accessibilityLabel?: string;
  style?: ViewStyle;
}

export function IconButton({ name, onPress, size = 20, dark, active, badge, accessibilityLabel, style }: IconButtonProps) {
  const onDark = active || dark;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? name}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: onDark ? colors.ink : colors.surface, opacity: pressed ? 0.7 : 1 },
        style,
      ]}
    >
      <Icon name={name} size={size} color={onDark ? colors.inkInv : colors.ink} />
      {badge ? <View style={styles.badge} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.surface,
  },
});
