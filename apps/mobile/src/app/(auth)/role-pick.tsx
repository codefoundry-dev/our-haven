/** §5.1.1a Role pick — 3-tab, sign-up only (design: screens/role-pick.jsx). */
import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RolePickCards } from '@/components/RolePickCards';
import { Screen } from '@/components/Screen';
import { colors, fonts } from '@/theme/tokens';

export default function RolePickScreen() {
  const router = useRouter();

  return (
    <Screen scroll contentStyle={styles.content}>
      <Text style={styles.title}>What brings you{'\n'}to Our Haven?</Text>
      <Text style={styles.subtitle}>Pick the side that fits. We&apos;ll set up the right experience.</Text>

      <View style={styles.cards}>
        <RolePickCards
          onPick={(role) => router.push({ pathname: '/(auth)/sign-up', params: { role } } as Href)}
        />
      </View>

      <Text style={styles.permanence}>
        Your role is set when you sign up — it can&apos;t be changed later. Need more than one role? You&apos;ll
        need a separate account for each.
      </Text>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Already have an account? </Text>
        <Pressable onPress={() => router.push('/(auth)/sign-in' as Href)}>
          <Text style={styles.link}>Sign in</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 24, paddingBottom: 28 },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, color: colors.ink },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, marginTop: 10, marginBottom: 22 },
  cards: { marginBottom: 18 },
  permanence: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink3, textAlign: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 18 },
  footerText: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, textDecorationLine: 'underline' },
});
