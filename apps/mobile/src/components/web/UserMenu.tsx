/**
 * UserMenu — the rail's bottom user chip turned into a button. Tapping it opens a
 * small popover anchored above the chip with two actions: Account (→ /account)
 * and Sign out (→ the shared confirmation dialog, which logs the user out and
 * routes them to the sign-up page). Used by both web shells (WebShell /
 * ParentWebShell), so the chrome's identity affordance behaves the same for every
 * role.
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { Icon, type IconName } from '@/components/Icon';
import { SignOutConfirmModal, useSignOutFlow } from '@/components/web/SignOutConfirm';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export interface RailUser {
  initials: string;
  name: string;
  role: string;
}

export function UserMenu({ user }: { user: RailUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const signOutFlow = useSignOutFlow();

  const goAccount = () => {
    setOpen(false);
    router.push('/account' as Href);
  };
  const askSignOut = () => {
    setOpen(false);
    signOutFlow.request();
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${user.name} — account menu`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.userRow, pressed && styles.userRowPressed]}
      >
        <View style={styles.userAvatar}>
          <Text style={styles.userInitials}>{user.initials}</Text>
        </View>
        <View style={styles.flexMin}>
          <Text style={styles.userName} numberOfLines={1}>
            {user.name}
          </Text>
          <Text style={styles.userRole} numberOfLines={1}>
            {user.role}
          </Text>
        </View>
        <Icon name="chevron-down" size={16} color={colors.ink2} />
      </Pressable>

      {/* popover, anchored above the chip at the bottom-left of the rail */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.menu} onPress={() => {}}>
            <MenuItem icon="person" label="Account" onPress={goAccount} />
            <View style={styles.menuDivider} />
            <MenuItem icon="logout" label="Sign out" danger onPress={askSignOut} />
          </Pressable>
        </Pressable>
      </Modal>

      <SignOutConfirmModal flow={signOutFlow} />
    </>
  );
}

function MenuItem({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
    >
      <Icon name={icon} size={18} color={danger ? colors.danger : colors.ink} />
      <Text style={[styles.menuItemText, danger ? { color: colors.danger } : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flexMin: { flex: 1, minWidth: 0 },

  userRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 6, borderRadius: 12 },
  userRowPressed: { backgroundColor: colors.surfaceAlt },
  userAvatar: { width: 36, height: 36, borderRadius: radii.pill, backgroundColor: colors.monoGray, alignItems: 'center', justifyContent: 'center' },
  userInitials: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  userName: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  userRole: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink2 },

  menuBackdrop: { flex: 1 },
  menu: { position: 'absolute', left: 16, bottom: 78, width: 212, backgroundColor: colors.surface, borderRadius: radii.md, padding: 6, ...shadow.e3 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, paddingHorizontal: 12, borderRadius: 10 },
  menuItemPressed: { backgroundColor: colors.surfaceAlt },
  menuItemText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  menuDivider: { height: 1, backgroundColor: colors.hairline, marginVertical: 4 },
});
