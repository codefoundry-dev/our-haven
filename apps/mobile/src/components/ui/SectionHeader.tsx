/**
 * SectionHeader — a section title with an optional trailing "See all" link or
 * action cluster (DESIGN.md §4.2 discovery scaffold).
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

export function SectionHeader({
  title,
  action,
  onAction,
  right,
  size = 'lg',
  style,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  right?: ReactNode;
  size?: 'lg' | 'md';
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.row, style]}>
      <Text style={[styles.title, size === 'md' ? styles.md : styles.lg]}>{title}</Text>
      {right ??
        (action ? (
          <Pressable onPress={onAction} hitSlop={8}>
            <Text style={styles.action}>{action}</Text>
          </Pressable>
        ) : null)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, fontFamily: fonts.bold, color: colors.ink },
  lg: { fontSize: 22, lineHeight: 28, letterSpacing: -0.5 },
  md: { fontSize: 18, letterSpacing: -0.3 },
  action: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
});
