/**
 * SelectableCard — a tappable option row with a selected affordance. Used for
 * the Caregiver category multi-select and the Provider specialty single-select
 * on supply onboarding (OH-183). Visual language matches RolePickCards.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { colors, fonts, radii, type ColorToken } from '@/theme/tokens';

interface SelectableCardProps {
  label: string;
  blurb?: string;
  selected: boolean;
  onPress: () => void;
  /** Optional accent swatch (category tone). Omitted for plain options. */
  tone?: ColorToken;
  /** 'checkbox' for multi-select, 'radio' for single-select (a11y semantics). */
  selectionMode?: 'checkbox' | 'radio';
}

export function SelectableCard({
  label,
  blurb,
  selected,
  onPress,
  tone,
  selectionMode = 'checkbox',
}: SelectableCardProps) {
  return (
    <Pressable
      accessibilityRole={selectionMode}
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { borderColor: selected ? colors.brand : colors.hairline, backgroundColor: selected ? colors.brandSoft : colors.surface },
        pressed && styles.pressed,
      ]}
    >
      {tone ? <View style={[styles.swatch, { backgroundColor: colors[tone] }]} /> : null}
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        {blurb ? <Text style={styles.blurb}>{blurb}</Text> : null}
      </View>
      <View style={[styles.indicator, selected ? styles.indicatorOn : styles.indicatorOff]}>
        {selected ? <Icon name="check" size={14} color={colors.inkInv} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: radii.lg,
    borderWidth: 1.5,
  },
  pressed: { opacity: 0.92 },
  swatch: { width: 22, height: 22, borderRadius: 7 },
  copy: { flex: 1, minWidth: 0 },
  label: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: -0.2, color: colors.ink },
  blurb: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 2, color: colors.ink2 },
  indicator: {
    width: 24,
    height: 24,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorOn: { backgroundColor: colors.brand },
  indicatorOff: { borderWidth: 1.5, borderColor: colors.monoGray },
});
