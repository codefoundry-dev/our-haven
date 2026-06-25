/** BrandMark — the "oh" logo square (design: signin.jsx / signup.jsx). */
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

export function BrandMark({ size = 56 }: { size?: number }) {
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size * 0.32 }]}>
      <Text style={[styles.text, { fontSize: size * 0.39 }]}>oh</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: fonts.bold, color: colors.inkInv, letterSpacing: -1 },
});
