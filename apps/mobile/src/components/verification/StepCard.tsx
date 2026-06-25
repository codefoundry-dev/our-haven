/**
 * StepCard — one verification checklist row (OH-184). Renders a status glyph,
 * label + hint, and an optional action slot (the ID-upload / phone-verify UI for
 * the two applicant-driven steps). Presentational only.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import type { StepStatus, VerificationStep } from '@/lib/verification';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const STATUS_GLYPH: Record<StepStatus, { icon: IconName | null; fg: string; bg: string }> = {
  done: { icon: 'check', fg: colors.inkInv, bg: colors.success },
  'in-progress': { icon: 'clock', fg: colors.warning, bg: 'rgba(201,122,42,0.14)' },
  blocked: { icon: 'lock', fg: colors.ink3, bg: colors.surfaceAlt },
  todo: { icon: null, fg: colors.ink3, bg: 'transparent' },
};

export function StepCard({ step, children }: { step: VerificationStep; children?: ReactNode }) {
  const g = STATUS_GLYPH[step.status];
  const isDone = step.status === 'done';
  return (
    <View style={[styles.card, isDone ? styles.cardDone : shadow.e1]}>
      <View style={styles.row}>
        <View style={[styles.badge, { backgroundColor: g.bg, borderColor: g.icon ? 'transparent' : colors.monoGray }]}>
          {g.icon ? <Icon name={g.icon} size={15} color={g.fg} strokeWidth={2} /> : null}
        </View>
        <View style={styles.text}>
          <Text style={[styles.label, isDone && styles.labelDone]}>{step.label}</Text>
          {step.hint ? <Text style={styles.hint}>{step.hint}</Text> : null}
        </View>
      </View>
      {children ? <View style={styles.action}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: 16 },
  cardDone: { backgroundColor: colors.surfaceAlt },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  badge: {
    width: 26,
    height: 26,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  text: { flex: 1, minWidth: 0 },
  label: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: -0.2, color: colors.ink },
  labelDone: { color: colors.ink2 },
  hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink3, marginTop: 3 },
  action: { marginTop: 14 },
});
