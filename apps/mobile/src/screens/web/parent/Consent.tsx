/**
 * ParentConsentWeb — the Parent sensitive-information consent on desktop web.
 * Content-only: the dispatcher wraps this in <ParentWebShell active="account">.
 *
 * A focused, full-attention page (PRD §5.1.7): a centered single column with the
 * Safety-Behaviors consent statement in a Card, the two required checkboxes, a
 * reassurance note, and a footer "Agree & continue" gated on both boxes. Ported
 * from the Claude Design project (screens/consent.jsx) and the native Parent
 * Consent body — same copy + the two-checkbox gate. RN primitives only.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { Card } from '@/components/ui/Card';
import { WebPageHeader } from '@/components/web/ParentWebShell';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export function ParentConsentWeb() {
  const router = useRouter();
  const [understand, setUnderstand] = useState(false);
  const [consent, setConsent] = useState(false);
  const ready = understand && consent;

  return (
    <View>
      <WebPageHeader greet="Family · Privacy" title="One quick consent" actions={['bell']} />

      <View style={styles.body}>
        <View style={styles.center}>
          {/* lede */}
          <View style={styles.pill}>
            <Icon name="shield" size={14} color={colors.success} />
            <Text style={styles.pillText}>Sensitive information</Text>
          </View>
          <Text style={styles.h1}>About your child&rsquo;s information.</Text>
          <Text style={styles.lede}>
            Before we store your Safety Behaviors checklist, here&rsquo;s exactly what that means and who can see it.
          </Text>

          {/* the consent statement */}
          <Card radius={radii.xl} padding={32} style={styles.statementCard}>
            <Text style={styles.para}>
              Your <Text style={styles.strong}>Safety Behaviors</Text> checklist holds sensitive information about
              your child — things like aggression, self-injurious behaviour, or wandering. Because that&rsquo;s
              sensitive, we need your explicit say-so before storing any of it.
            </Text>
            <Text style={styles.para}>
              Only Caregivers you engage — by applying to your Job, or once you message them — ever see your Parent
              profile. Clinical Providers don&rsquo;t see it at all.
            </Text>
            <Text style={styles.paraLast}>
              You can withdraw this consent any time from <Text style={styles.strong}>Account → Privacy</Text>. When
              you do, every Safety Behavior and the consent timestamp is permanently deleted — your Bio and
              Preferences stay.
            </Text>

            <View style={styles.divider} />

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
          </Card>

          {/* reassurance note */}
          <View style={styles.note}>
            <Icon name="lock" size={18} color={colors.brand} />
            <Text style={styles.noteText}>
              Stored encrypted and never sold. Withdraw any time — it&rsquo;s your call, and nothing here is required
              to keep using Our Haven.
            </Text>
          </View>

          {/* footer action bar */}
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready }}
              disabled={!ready}
              onPress={() => router.back()}
              style={[styles.primary, ready ? styles.primaryOn : styles.primaryOff]}
            >
              <Icon name="check" size={16} color={ready ? colors.inkInv : colors.ink3} />
              <Text style={[styles.primaryText, { color: ready ? colors.inkInv : colors.ink3 }]}>
                Agree &amp; continue
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondary}>
              <Text style={styles.secondaryText}>I&rsquo;ll decide later</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
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
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  center: { width: '100%', maxWidth: 720, alignSelf: 'center' },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    height: 28,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(47,122,77,0.12)',
  },
  pillText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.success },

  h1: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8, color: colors.ink, marginTop: 16 },
  lede: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, color: colors.ink2, marginTop: 10, maxWidth: 600 },

  statementCard: { marginTop: 24, ...shadow.e1 },
  para: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, color: colors.ink, marginBottom: 16 },
  paraLast: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, color: colors.ink },
  strong: { fontFamily: fonts.semibold, color: colors.ink },

  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: 22 },

  checks: { gap: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: 16, borderRadius: radii.lg },
  checkRowOn: { backgroundColor: colors.surfaceAlt, borderWidth: 1.5, borderColor: colors.ink },
  checkRowOff: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.hairline },
  box: { width: 24, height: 24, borderRadius: 8, marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.ink },
  boxOff: { borderWidth: 1.5, borderColor: colors.ink },
  checkLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink },

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: radii.md,
    backgroundColor: colors.brandSoft,
    marginTop: 16,
  },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },

  footer: {
    marginTop: 20,
    padding: 18,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    gap: 8,
    ...shadow.e2,
  },
  primary: {
    height: 52,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryOn: { backgroundColor: colors.brand },
  primaryOff: { backgroundColor: colors.monoGray },
  primaryText: { fontFamily: fonts.semibold, fontSize: 15 },
  secondary: { height: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
});
