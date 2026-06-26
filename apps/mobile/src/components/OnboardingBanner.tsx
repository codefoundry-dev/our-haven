/**
 * OnboardingBanner — dashboard nudge for supply users who haven't finished setup.
 *
 * The auth gate sends sign-ins straight to the dashboard (the hub is only landed on
 * right after role-claim), so this banner is the path back to (app)/onboarding. It
 * renders on the Caregiver/Provider dashboard (home / schedule) on WEB only and
 * returns null on native, for Parents, once activated, or before its status loads —
 * so it has zero footprint on the native build and never nags an activated user.
 */
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { getVerification } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { colors, fonts, maxContentWidth, radii, shadow } from '@/theme/tokens';

export function OnboardingBanner() {
  const router = useRouter();
  const { role } = useAuth();
  const [show, setShow] = useState(false);

  const supply = role === 'caregiver' || role === 'provider';

  useEffect(() => {
    if (Platform.OS !== 'web' || !supply) return;
    let cancelled = false;
    getVerification()
      .then((v) => {
        if (!cancelled) setShow(v.state !== 'activated');
      })
      .catch(() => {
        /* backend unreachable — don't nag the user */
      });
    return () => {
      cancelled = true;
    };
  }, [supply]);

  if (Platform.OS !== 'web' || !supply || !show) return null;

  return (
    <View style={styles.outer}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/(app)/onboarding' as Href)}
        style={styles.card}
      >
        <View style={styles.iconWrap}>
          <Icon name="sparkle" size={18} color={colors.ink} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>Finish your setup</Text>
          <Text style={styles.sub}>Complete verification to start getting bookings.</Text>
        </View>
        <Icon name="arrow-right" size={18} color={colors.ink} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.highlight,
    borderRadius: radii.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
    ...shadow.e1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(22,21,19,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink, opacity: 0.75, marginTop: 1 },
});
