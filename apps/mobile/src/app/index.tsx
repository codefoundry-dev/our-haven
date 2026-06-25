/** Entry splash — the auth gate (root _layout) redirects away from here immediately. */
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

export default function Index() {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' },
});
