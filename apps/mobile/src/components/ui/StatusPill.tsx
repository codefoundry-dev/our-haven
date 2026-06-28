/**
 * StatusPill — Booking lifecycle state pill (DESIGN.md §3.29). Maps the
 * PRD/state-machine states to their fill + label.
 */
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, fonts, radii } from '@/theme/tokens';

export type BookingState =
  | 'requested'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'in-progress'
  | 'awaiting-confirmation'
  | 'completed'
  | 'disputed'
  | 'cancelled';

const MAP: Record<BookingState, { bg: string; fg: string; label: string }> = {
  requested: { bg: 'rgba(255,216,77,0.4)', fg: colors.ink, label: 'Awaiting Provider' },
  accepted: { bg: 'rgba(47,122,77,0.12)', fg: colors.success, label: 'Accepted' },
  declined: { bg: 'rgba(178,58,47,0.12)', fg: colors.danger, label: 'Declined' },
  expired: { bg: colors.surfaceAlt, fg: colors.ink2, label: 'Expired' },
  'in-progress': { bg: 'rgba(58,111,168,0.12)', fg: colors.info, label: 'In session' },
  'awaiting-confirmation': { bg: 'rgba(201,122,42,0.12)', fg: colors.warning, label: 'Confirm hours' },
  completed: { bg: 'rgba(47,122,77,0.12)', fg: colors.success, label: 'Completed' },
  disputed: { bg: 'rgba(178,58,47,0.12)', fg: colors.danger, label: 'Disputed' },
  cancelled: { bg: colors.surfaceAlt, fg: colors.ink2, label: 'Cancelled' },
};

export function StatusPill({ state, label, style }: { state: BookingState; label?: string; style?: ViewStyle }) {
  const m = MAP[state];
  return (
    <View style={[styles.pill, { backgroundColor: m.bg }, style]}>
      <Text style={[styles.text, { color: m.fg }]}>{label ?? m.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', height: 28, paddingHorizontal: 12, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  text: { fontFamily: fonts.semibold, fontSize: 13 },
});
