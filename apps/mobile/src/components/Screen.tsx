/**
 * Screen — page shell. Cream canvas, safe-area aware, and width-constrained on
 * web so the phone-shaped layouts don't stretch on desktop.
 */
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, maxContentWidth } from '@/theme/tokens';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  edges?: readonly Edge[];
  style?: ViewStyle;
  contentStyle?: ViewStyle;
}

export function Screen({ children, scroll, edges = ['top', 'bottom'], style, contentStyle }: ScreenProps) {
  return (
    <SafeAreaView edges={edges} style={[styles.safe, style]}>
      <View style={styles.center}>
        {scroll ? (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={[styles.content, contentStyle]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.fill, styles.content, contentStyle]}>{children}</View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { flex: 1, alignItems: 'center' },
  fill: { flex: 1, width: '100%', maxWidth: maxContentWidth },
  content: { paddingHorizontal: 24 },
});
