/**
 * SignOutConfirm — the shared "Sign out?" dialog + the hook that performs the
 * actual sign-out for the web chrome (the rail user menu and the in-page Account
 * "Sign out" rows). Confirming clears the Supabase session and routes to the
 * sign-in page; since that lives under (auth), the auth gate (root _layout) then
 * leaves the now-anonymous user there instead of bouncing them to role-pick.
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export interface SignOutFlow {
  /** True while the confirmation dialog is open. */
  open: boolean;
  /** True while the sign-out call is in flight. */
  busy: boolean;
  /** Open the confirmation dialog. */
  request: () => void;
  /** Dismiss without signing out. */
  cancel: () => void;
  /** Sign out for real, then route to the sign-up page. */
  confirm: () => Promise<void>;
}

/** Owns the confirm-dialog state and the real sign-out + redirect. */
export function useSignOutFlow(): SignOutFlow {
  const { signOut } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return {
    open,
    busy,
    request: () => setOpen(true),
    cancel: () => {
      if (!busy) setOpen(false);
    },
    confirm: async () => {
      if (busy) return;
      setBusy(true);
      try {
        await signOut();
        setOpen(false);
        router.replace('/(auth)/sign-in' as Href);
      } finally {
        setBusy(false);
      }
    },
  };
}

/** Centered confirmation dialog driven by a {@link SignOutFlow}. */
export function SignOutConfirmModal({ flow }: { flow: SignOutFlow }) {
  return (
    <Modal visible={flow.open} transparent animationType="fade" onRequestClose={flow.cancel}>
      <Pressable style={styles.backdrop} onPress={flow.cancel}>
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.iconWrap}>
            <Icon name="logout" size={22} color={colors.danger} />
          </View>
          <Text style={styles.title}>Sign out?</Text>
          <Text style={styles.body}>You&apos;ll need to sign in again to get back to your account.</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={flow.cancel}
              disabled={flow.busy}
              style={({ pressed }) => [styles.btn, styles.btnGhost, { opacity: pressed ? 0.9 : 1 }]}
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={flow.confirm}
              disabled={flow.busy}
              style={({ pressed }) => [styles.btn, styles.btnDanger, { opacity: pressed || flow.busy ? 0.85 : 1 }]}
            >
              <Text style={styles.btnDangerText}>{flow.busy ? 'Signing out…' : 'Sign out'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(22,21,19,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 24, alignItems: 'center', ...shadow.e3 },
  iconWrap: { width: 52, height: 52, borderRadius: radii.pill, backgroundColor: 'rgba(178,58,47,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.4, color: colors.ink },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, textAlign: 'center', marginTop: 8 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 22, alignSelf: 'stretch' },
  btn: { flex: 1, height: 48, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { borderWidth: 1.5, borderColor: colors.hairline },
  btnGhostText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  btnDanger: { backgroundColor: colors.danger },
  btnDangerText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
});
