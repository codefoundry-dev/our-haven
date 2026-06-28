/**
 * Sensitive-information consent (Parent) — ported from the Claude design project
 * (screens/consent.jsx). A focused, full-attention screen explaining how Safety
 * Behaviors are stored, with two required checkboxes gating "Continue".
 * UI-only skeleton.
 *
 * The desktop web layout lives in `@/screens/web/parent/Consent` and is chosen
 * by `consent.web.tsx`; this native body also renders at phone-width web.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { colors, fonts, radii } from '@/theme/tokens';

export default function ConsentScreen() {
  const router = useRouter();
  const [understand, setUnderstand] = useState(false);
  const [consent, setConsent] = useState(false);
  const ready = understand && consent;

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar onBack={() => router.back()} />

      <View style={styles.pill}>
        <Icon name="shield" size={14} color={colors.success} />
        <Text style={styles.pillText}>One quick consent</Text>
      </View>

      <Text style={styles.h1}>About your child's information.</Text>

      <Text style={styles.para}>
        Your Safety Behaviors checklist holds sensitive information about your child — things like aggression,
        self-injurious behaviour, or wandering. Because that's sensitive, we need your explicit say-so before storing any of it.
      </Text>
      <Text style={styles.para}>
        Only Caregivers you engage — by applying to your Job, or once you message them — ever see your Parent profile.
        Clinical Providers don't see it at all.
      </Text>
      <Text style={styles.para}>
        You can withdraw this consent any time from Account → Privacy. When you do, every Safety Behavior and the
        consent timestamp is permanently deleted — your Bio and Preferences stay.
      </Text>

      <View style={styles.checks}>
        <Checkbox
          checked={understand}
          onPress={() => setUnderstand((v) => !v)}
          label="I understand that Safety Behaviors are sensitive information about my child and how Our Haven uses them."
        />
        <Checkbox
          checked={consent}
          onPress={() => setConsent((v) => !v)}
          label="I consent to Our Haven storing the Safety Behaviors checklist on my Parent profile."
        />
      </View>

      <PrimaryButton style={styles.cta} disabled={!ready} onPress={() => router.back()}>
        Continue
      </PrimaryButton>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondary}>
        <Text style={styles.secondaryText}>I'll decide later</Text>
      </Pressable>
    </Screen>
  );
}

function Checkbox({ checked, onPress, label }: { checked: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={[styles.checkRow, checked ? styles.checkRowOn : styles.checkRowOff]}
    >
      <View style={[styles.box, checked ? styles.boxOn : styles.boxOff]}>
        {checked ? <Icon name="check" size={14} color={colors.inkInv} /> : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', height: 28, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: 'rgba(47,122,77,0.12)', marginTop: 8 },
  pillText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.success },

  h1: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 38, letterSpacing: -0.8, color: colors.ink, marginTop: 16, marginBottom: 20 },
  para: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, color: colors.ink, marginBottom: 16 },

  checks: { gap: 10, marginTop: 4 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: 14, borderRadius: radii.lg },
  checkRowOn: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.ink },
  checkRowOff: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.hairline },
  box: { width: 24, height: 24, borderRadius: 8, marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.ink },
  boxOff: { borderWidth: 1.5, borderColor: colors.ink },
  checkLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink },

  cta: { marginTop: 24 },
  secondary: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  secondaryText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
});
