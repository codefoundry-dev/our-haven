/**
 * Badge — verification / trust signals on Provider cards and profile headers
 * (design: primitives.jsx Badge + CredBadge, DESIGN.md §3.8 / §3.x credentials).
 *
 * `Badge` = the marketplace trust pills (Verified, Tax-credit, FCCH, License…).
 * `CredBadge` = a person-level credential row with a verified/pending sub-stamp.
 */
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { colors, fonts, radii } from '@/theme/tokens';

export type BadgeKind = 'verified' | 'tax' | 'cert' | 'fcch' | 'license' | 'toprated';

const MAP: Record<BadgeKind, { bg: string; fg: string; icon: IconName; text: string; outline?: boolean }> = {
  verified: { bg: 'rgba(47,122,77,0.12)', fg: colors.success, icon: 'check-circle', text: 'Verified' },
  tax: { bg: colors.highlight, fg: colors.ink, icon: 'receipt', text: 'Tax-credit friendly' },
  cert: { bg: 'rgba(58,111,168,0.12)', fg: colors.info, icon: 'check-circle', text: 'CPR Certified' },
  fcch: { bg: colors.surface, fg: colors.success, icon: 'house', text: 'Home childcare licensed', outline: true },
  license: { bg: 'rgba(58,111,168,0.12)', fg: colors.info, icon: 'shield', text: 'Licensed' },
  toprated: { bg: colors.brand, fg: colors.inkInv, icon: 'star', text: 'Top rated' },
};

export function Badge({ kind = 'verified', label, style }: { kind?: BadgeKind; label?: string; style?: ViewStyle }) {
  const m = MAP[kind];
  return (
    <View style={[styles.badge, { backgroundColor: m.bg }, m.outline ? { borderWidth: 1, borderColor: colors.success } : null, style]}>
      <Icon name={m.icon} size={14} color={m.fg} />
      <Text style={[styles.text, { color: m.fg }]}>{label ?? m.text}</Text>
    </View>
  );
}

/** Person-level credential pill — ADR-0015 §6. status: 'verified' | 'pending'. */
export function CredBadge({
  label,
  status = 'verified',
  icon = 'shield',
  style,
}: {
  label: string;
  status?: 'verified' | 'pending';
  icon?: IconName;
  style?: ViewStyle;
}) {
  const pending = status === 'pending';
  return (
    <View
      style={[
        styles.cred,
        { backgroundColor: pending ? colors.surfaceAlt : colors.surface, borderColor: pending ? colors.hairline : 'rgba(47,122,77,0.3)' },
        style,
      ]}
    >
      <Icon name={pending ? 'clock' : icon} size={14} color={pending ? colors.warning : colors.success} />
      <Text style={styles.credLabel}>{label}</Text>
      <View style={[styles.credStamp, { backgroundColor: pending ? colors.highlight : 'rgba(47,122,77,0.14)' }]}>
        <Text style={[styles.credStampText, { color: pending ? colors.ink : colors.success }]}>{pending ? 'Pending' : 'Verified'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    height: 28,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
  },
  text: { fontFamily: fonts.semibold, fontSize: 13 },
  cred: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    height: 30,
    paddingLeft: 11,
    paddingRight: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  credLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  credStamp: { height: 18, paddingHorizontal: 7, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  credStampText: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.2, textTransform: 'uppercase' },
});
