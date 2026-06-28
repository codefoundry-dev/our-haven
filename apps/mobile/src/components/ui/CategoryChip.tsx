/**
 * CategoryChip — pastel category pill stamped on a Provider/Job card
 * (design: primitives.jsx CatChip, DESIGN.md §3.7). 'Provider' is the clinical
 * role (ADR-0011); 'Specialist' kept as a legacy alias.
 */
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, fonts, radii, type ColorToken } from '@/theme/tokens';

export type Category = 'Babysitter' | 'Tutor' | 'Nanny' | 'Provider' | 'Specialist';

export const CATEGORY_TONE: Record<Category, ColorToken> = {
  Babysitter: 'catBaby',
  Tutor: 'catTutor',
  Nanny: 'catNanny',
  Provider: 'catSpec',
  Specialist: 'catSpec',
};

export function CategoryChip({ category, style }: { category: Category; style?: ViewStyle }) {
  return (
    <View style={[styles.chip, { backgroundColor: colors[CATEGORY_TONE[category]] }, style]}>
      <Text style={styles.label}>{category}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', height: 28, paddingHorizontal: 12, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.semibold, fontSize: 13, letterSpacing: -0.1, color: colors.ink },
});
