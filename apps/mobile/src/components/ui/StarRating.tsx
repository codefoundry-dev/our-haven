/**
 * StarRating — two views (DESIGN.md §3.27):
 *  - inline display: a single 16pt star + numeric value ("★ 4.9").
 *  - input row: 5 large tappable stars for blind rating submission.
 */
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Icon } from '@/components/Icon';
import { colors, fonts } from '@/theme/tokens';

export function RatingValue({ value, count, size = 16, style }: { value: number; count?: number; size?: number; style?: ViewStyle }) {
  return (
    <View style={[styles.inline, style]}>
      <Icon name="star" size={size} color={colors.highlight} />
      <Text style={[styles.value, { fontSize: size - 2 }]}>{value.toFixed(1)}</Text>
      {count != null ? <Text style={styles.count}>({count})</Text> : null}
    </View>
  );
}

export function StarInput({ value, onChange, size = 32 }: { value: number; onChange: (v: number) => void; size?: number }) {
  return (
    <View style={styles.inputRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${n} stars`}>
          <Icon name="star" size={size} color={n <= value ? colors.highlight : colors.monoGray} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  value: { fontFamily: fonts.semibold, color: colors.ink },
  count: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
