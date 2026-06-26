/**
 * Role pick (WEB) — split-screen desktop layout (AuthWebShell). Same RolePickCards
 * and the same router push to sign-up as the native screen; only the layout
 * differs. Metro resolves this over role-pick.tsx on web.
 */
import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AuthWebShell } from '@/components/auth/AuthWebShell';
import { RolePickCards } from '@/components/RolePickCards';
import { colors, fonts } from '@/theme/tokens';

export default function RolePickScreen() {
  const router = useRouter();

  return (
    <AuthWebShell
      panel={{
        kicker: 'create account',
        eyebrow: 'Get started',
        title: 'What brings you\nto Our Haven?',
        subtitle:
          'Pick the side that fits and we’ll set up the right experience. Your role is permanent — it’s set when you sign up and can’t be changed later.',
        featuresHead: 'One platform, three sides',
        features: [
          { icon: 'house', label: 'Parents — find & book care' },
          { icon: 'person', label: 'Caregivers — get hired' },
          { icon: 'shield', label: 'Providers — list your practice' },
          { icon: 'lock', label: 'Verified & background-checked' },
        ],
      }}
    >
      <Text style={styles.eyebrow}>Choose your role</Text>
      <Text style={styles.h2}>Who are you on Our Haven?</Text>

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
    </AuthWebShell>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2 },
  h2: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.8, color: colors.ink, marginTop: 8, marginBottom: 22 },
  cards: { marginBottom: 18 },
  permanence: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink3 },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 18 },
  footerText: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, textDecorationLine: 'underline' },
});
