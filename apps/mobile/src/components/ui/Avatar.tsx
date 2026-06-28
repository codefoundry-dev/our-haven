/**
 * Avatar — circular portrait with a colored monogram fallback (DESIGN.md §3.9).
 * Sizes: xs 24 · sm 32 · md 40 · lg 56 · xl 80 · hero 120. AvatarGroup stacks
 * with -8 overlap, max 3 visible + "+N" overflow tile.
 */
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, fonts, radii, type ColorToken } from '@/theme/tokens';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'hero';

const SIZE: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 40, lg: 56, xl: 80, hero: 120 };
const FONT: Record<AvatarSize, number> = { xs: 10, sm: 12, md: 15, lg: 20, xl: 28, hero: 40 };

export function Avatar({
  label,
  size = 'md',
  tone = 'monoGray',
  online,
  style,
}: {
  label?: string;
  size?: AvatarSize;
  tone?: ColorToken;
  online?: boolean;
  style?: ViewStyle;
}) {
  const d = SIZE[size];
  const initials = (label ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  const onDark = tone === 'brand' || tone === 'ink';
  return (
    <View style={[{ width: d, height: d, borderRadius: radii.pill, backgroundColor: colors[tone] }, styles.center, style]}>
      <Text style={{ fontFamily: fonts.bold, fontSize: FONT[size], color: onDark ? colors.inkInv : colors.ink }}>{initials}</Text>
      {online ? <View style={styles.onlineDot} /> : null}
    </View>
  );
}

export function AvatarGroup({ items, size = 24, max = 3 }: { items: { label?: string; tone?: ColorToken }[]; size?: number; max?: number }) {
  const visible = items.slice(0, max);
  const extra = items.length - visible.length;
  return (
    <View style={styles.row}>
      {visible.map((it, i) => (
        <View
          key={i}
          style={[
            { width: size, height: size, borderRadius: radii.pill, backgroundColor: colors[it.tone ?? 'monoGray'], marginLeft: i === 0 ? 0 : -8 },
            styles.center,
            styles.ring,
          ]}
        >
          {it.label ? <Text style={{ fontFamily: fonts.bold, fontSize: size * 0.4, color: colors.ink }}>{it.label[0]?.toUpperCase()}</Text> : null}
        </View>
      ))}
      {extra > 0 ? (
        <View style={[{ width: size, height: size, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, marginLeft: -8 }, styles.center, styles.ring]}>
          <Text style={{ fontFamily: fonts.bold, fontSize: size * 0.36, color: colors.ink }}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  ring: { borderWidth: 2, borderColor: colors.surface },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.surface,
  },
});
