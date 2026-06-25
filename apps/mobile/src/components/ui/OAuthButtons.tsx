/**
 * OAuthButtons — Apple / Google sign-in options (design: signin.jsx / signup.jsx).
 * Visually faithful but disabled: the OAuth wiring is a downstream M2 ticket.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii } from '@/theme/tokens';

function OutlineButton({ label }: { label: string }) {
  return (
    <View accessibilityRole="button" accessibilityState={{ disabled: true }} style={styles.btn}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

export function OAuthButtons({ verb = 'continue' }: { verb?: 'continue' | 'sign up' }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.dividerRow}>
        <View style={styles.line} />
        <Text style={styles.dividerText}>{verb === 'sign up' ? 'OR SIGN UP WITH' : 'OR CONTINUE WITH'}</Text>
        <View style={styles.line} />
      </View>
      <OutlineButton label="Continue with Apple" />
      <OutlineButton label="Continue with Google" />
      <Text style={styles.note}>Social sign-in coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 12 },
  line: { flex: 1, height: 1, backgroundColor: colors.hairline },
  dividerText: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.4, color: colors.ink3 },
  btn: {
    height: 52,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5,
  },
  label: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  note: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3, textAlign: 'center' },
});
