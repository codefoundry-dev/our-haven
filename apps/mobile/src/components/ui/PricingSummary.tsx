/**
 * PricingSummary — line-item breakdown used on Booking compose, cancellation
 * preview, and Subscription checkout (DESIGN.md §3.28). Subtotal is divided from
 * the total by a hairline; the total row is bold both sides.
 */
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

export interface PriceLine {
  label: string;
  value: string;
  helper?: string;
  muted?: boolean;
}

export function PricingSummary({ lines, total, style }: { lines: PriceLine[]; total: { label: string; value: string }; style?: ViewStyle }) {
  return (
    <View style={style}>
      {lines.map((l, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.labelWrap}>
            <Text style={[styles.label, l.muted ? styles.muted : null]}>{l.label}</Text>
            {l.helper ? <Text style={styles.helper}>{l.helper}</Text> : null}
          </View>
          <Text style={[styles.value, l.muted ? styles.muted : null]}>{l.value}</Text>
        </View>
      ))}
      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={styles.totalLabel}>{total.label}</Text>
        <Text style={styles.totalValue}>{total.value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 6 },
  labelWrap: { flex: 1, paddingRight: 12 },
  label: { fontFamily: fonts.regular, fontSize: 15, color: colors.ink },
  helper: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3, marginTop: 2 },
  muted: { color: colors.ink2 },
  value: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: 8 },
  totalLabel: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.2, color: colors.ink },
  totalValue: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.2, color: colors.ink, fontVariant: ['tabular-nums'] },
});
