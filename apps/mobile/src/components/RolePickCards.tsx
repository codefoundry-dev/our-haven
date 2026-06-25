/** RolePickCards — the three role cards (design: screens/role-pick.jsx). */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { ROLES, ROLE_CARDS, type Role } from '@/lib/roles';
import { colors, fonts, radii } from '@/theme/tokens';

export function RolePickCards({ onPick }: { onPick: (role: Role) => void }) {
  return (
    <View>
      {ROLES.map((role, i) => {
        const card = ROLE_CARDS[role];
        return (
          <Pressable
            key={role}
            accessibilityRole="button"
            accessibilityLabel={card.title}
            onPress={() => onPick(role)}
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: colors[card.tone], opacity: pressed ? 0.92 : 1 },
              i < ROLES.length - 1 && styles.gap,
            ]}
          >
            <View style={styles.iconWrap}>
              <Icon name={card.icon} size={22} color={colors.ink} />
            </View>
            <View style={styles.copy}>
              <Text style={styles.title}>{card.title}</Text>
              <Text style={styles.body}>{card.body}</Text>
            </View>
            <View style={styles.chev}>
              <Icon name="chevron-right" size={14} color={colors.ink} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderRadius: radii.xl },
  gap: { marginBottom: 14 },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2, color: colors.ink },
  body: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 4, color: 'rgba(22,21,19,0.72)' },
  chev: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
