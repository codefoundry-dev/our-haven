/** Account — identity + sign out (satisfies OH-176 "auth client logs in/out"). */
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { ROLE_CARDS } from '@/lib/roles';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export default function AccountScreen() {
  const { session, role, signOut } = useAuth();
  const meta = (session?.user?.user_metadata ?? {}) as { first_name?: string; last_name?: string };
  const first = meta.first_name ?? '';
  const last = meta.last_name ?? '';
  const email = session?.user?.email ?? '';
  const name = [first, last].filter(Boolean).join(' ') || 'Your account';
  const initials = `${(first[0] ?? email[0] ?? '?').toUpperCase()}${(last[0] ?? '').toUpperCase()}`;
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : '';

  return (
    <Screen edges={['top']} contentStyle={styles.content}>
      <View style={styles.appBar}>
        <Text style={styles.heading}>Account</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.initials}>{initials}</Text>
        </View>
        <View style={styles.identity}>
          <Text style={styles.name}>{name}</Text>
          {email ? <Text style={styles.email}>{email}</Text> : null}
          {role ? (
            <View style={styles.roleChip}>
              <Icon name={ROLE_CARDS[role].icon} size={13} color={colors.ink} />
              <Text style={styles.roleText}>{roleLabel}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.spacer} />

      <PrimaryButton onPress={signOut}>Sign out</PrimaryButton>
      <Text style={styles.note}>More account settings coming soon.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingBottom: 20 },
  appBar: { paddingTop: 8, paddingBottom: 16 },
  heading: { fontFamily: fonts.bold, fontSize: 26, letterSpacing: -0.6, color: colors.ink },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1 },
  avatar: { width: 56, height: 56, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: fonts.bold, fontSize: 20, color: colors.inkInv },
  identity: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  email: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 2 },
  roleChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
  },
  roleText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },
  spacer: { flex: 1 },
  note: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3, textAlign: 'center', marginTop: 12 },
});
