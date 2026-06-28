/**
 * Chip — small pill labels used across the supply/demand surfaces.
 * (design: primitives.jsx ComfortChip / SafetyChip / ChildDetailChip + the
 * filter chips of DESIGN.md §3.6).
 *
 * - `FilterChip`  — toggleable filter (active = ink fill).
 * - `Chip`        — static labelled chip with a tone variant + optional icon.
 */
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { colors, fonts, radii } from '@/theme/tokens';

export function FilterChip({
  label,
  active,
  onPress,
  removable,
  onRemove,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  removable?: boolean;
  onRemove?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.filter,
        { backgroundColor: active ? colors.ink : colors.surfaceAlt, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={[styles.filterText, { color: active ? colors.inkInv : colors.ink2 }]}>{label}</Text>
      {removable ? (
        <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel={`Remove ${label}`}>
          <Icon name="x" size={13} color={active ? colors.inkInv : colors.ink2} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

type ChipTone = 'neutral' | 'comfort' | 'safety' | 'child' | 'info' | 'success' | 'warning';

const TONES: Record<ChipTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surfaceAlt, fg: colors.ink },
  comfort: { bg: 'rgba(30,122,134,0.10)', fg: colors.brand },
  safety: { bg: 'rgba(58,111,168,0.10)', fg: colors.info },
  child: { bg: colors.surfaceAlt, fg: colors.ink },
  info: { bg: 'rgba(58,111,168,0.12)', fg: colors.info },
  success: { bg: 'rgba(47,122,77,0.12)', fg: colors.success },
  warning: { bg: 'rgba(201,122,42,0.14)', fg: colors.warning },
};

export function Chip({
  label,
  tone = 'neutral',
  icon,
  style,
}: {
  label: string;
  tone?: ChipTone;
  icon?: IconName;
  style?: ViewStyle;
}) {
  const t = TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }, style]}>
      {icon ? <Icon name={icon} size={12} color={t.fg} /> : null}
      <Text style={[styles.chipText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  filter: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 16, borderRadius: radii.pill },
  filterText: { fontFamily: fonts.semibold, fontSize: 13 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', height: 30, paddingHorizontal: 12, borderRadius: radii.pill },
  chipText: { fontFamily: fonts.semibold, fontSize: 12.5 },
});
