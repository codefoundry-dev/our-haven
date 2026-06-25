/** RolePill — "Signing up as a {Role}" chip carried from role-pick (design: signup.jsx). */
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { ROLE_CARDS, ROLE_PILL_TONE, type Role } from '@/lib/roles';
import { colors, fonts, radii } from '@/theme/tokens';

export function RolePill({ role }: { role: Role }) {
  const toneToken = ROLE_PILL_TONE[role];
  const onDark = toneToken === 'ink';
  const bg = colors[toneToken];
  const fg = onDark ? colors.inkInv : colors.ink;
  const label = role.charAt(0).toUpperCase() + role.slice(1);

  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Icon name={ROLE_CARDS[role].icon} size={14} color={fg} />
      <Text style={[styles.text, { color: fg }]}>Signing up as a {label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
  },
  text: { fontFamily: fonts.semibold, fontSize: 12 },
});
