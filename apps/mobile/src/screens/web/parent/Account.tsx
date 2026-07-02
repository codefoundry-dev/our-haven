/**
 * ParentAccountWeb — the Parent account settings on desktop web. Content-only:
 * the dispatcher wraps this in <ParentWebShell active="account">.
 *
 * Ported from the Claude Design web project (parent-web/pw-account.jsx) and the
 * native Account: a profile header card, a subscription card, notification
 * preference toggles, and grouped settings link rows. RN primitives only.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { WebPageHeader } from '@/components/web/ParentWebShell';
import { SignOutConfirmModal, useSignOutFlow } from '@/components/web/SignOutConfirm';
import { Icon, type IconName } from '@/components/Icon';
import { Toggle } from '@/components/ui/Toggle';
import { registerForPush } from '@/lib/notifications';
import { useNotificationPrefs } from '@/lib/notificationPrefs';
import { useParentGate } from '@/lib/paywallGate';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

interface LinkRow {
  icon: IconName;
  title: string;
  sub: string;
  route?: string;
}

const SETTINGS: LinkRow[] = [
  { icon: 'dollar', title: 'Payment methods', sub: 'Cards used for Bookings and your subscription.' },
  { icon: 'users', title: 'Children & consent', sub: 'Ages and Safety Behaviors shared on Offers.', route: '/children' },
  { icon: 'lock', title: 'Privacy & data', sub: 'Download or delete your data; manage disclosures.', route: '/consent' },
  { icon: 'shield', title: 'Security & login', sub: 'Password, devices, and step-up verification.' },
  { icon: 'help', title: 'Help & support', sub: 'Trust & Safety, disputes, and contact.' },
];

export function ParentAccountWeb() {
  const router = useRouter();
  const go = (route?: string) => route && router.push(route as never);
  const { openPaywall, entitled } = useParentGate();
  const signOutFlow = useSignOutFlow();
  const [sms, setSms] = useState(true);
  const [email, setEmail] = useState(true);
  const [push, setPush] = useState(false);
  // Marketing opt-in (OH-223) — the one PERSISTED preference here; a separate
  // consent from transactional (CONTEXT § Notifications).
  const prefs = useNotificationPrefs();

  return (
    <View>
      <WebPageHeader greet="Your account" title="Account" actions={['bell']} />

      <View style={styles.body}>
        <View style={styles.column}>
          {/* Profile card */}
          <View style={styles.profile}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>AD</Text>
            </View>
            <View style={styles.flexMin}>
              <Text style={styles.name}>Adjei Asare</Text>
              <Text style={styles.email}>adjeiasarejesse@gmail.com</Text>
              <View style={styles.roleChip}>
                <Icon name="person" size={13} color={colors.ink} />
                <Text style={styles.roleText}>Parent · Beverly Hills, CA</Text>
              </View>
            </View>
            <Pressable style={({ pressed }) => [styles.editBtn, { opacity: pressed ? 0.9 : 1 }]}>
              <Icon name="edit" size={15} color={colors.ink} />
              <Text style={styles.editText}>Edit profile</Text>
            </Pressable>
          </View>

          {/* Subscription */}
          <Text style={styles.sectionLabel}>Subscription</Text>
          <View style={styles.subCard}>
            <View style={styles.subIcon}>
              <Icon name="sparkle" size={20} color={colors.brand} />
            </View>
            <View style={styles.flexMin}>
              <Text style={styles.subTitle}>
                {entitled ? 'Our Haven membership · active' : 'No active membership'}
              </Text>
              <Text style={styles.subSub}>
                {entitled ? '$14.99 / month · manage via Stripe' : 'Subscribe to message, book, and post Jobs.'}
              </Text>
            </View>
            <Pressable
              onPress={() => openPaywall()}
              style={({ pressed }) => [styles.manageBtn, { opacity: pressed ? 0.9 : 1 }]}
            >
              <Text style={styles.manageText}>{entitled ? 'Manage' : 'Subscribe'}</Text>
            </Pressable>
          </View>

          {/* Notifications */}
          <Text style={styles.sectionLabel}>Notifications</Text>
          <View style={styles.card}>
            <ToggleRow label="SMS alerts" sub="Cancellations and new-device sign-ins (mandatory channel)." on={sms} onPress={() => setSms((v) => !v)} />
            <View style={styles.divider} />
            <ToggleRow label="Email updates" sub="Booking confirmations, receipts, and weekly digests." on={email} onPress={() => setEmail((v) => !v)} />
            <View style={styles.divider} />
            <ToggleRow
              label="Push notifications"
              sub="Real-time messages and Offer activity."
              on={push}
              onPress={() => {
                // Turning ON from this click (a user gesture) runs the real
                // browser permission prompt + web-push subscribe (OH-223).
                if (!push) registerForPush({ interactive: true }).catch(() => {});
                setPush((v) => !v);
              }}
            />
            <View style={styles.divider} />
            <ToggleRow
              label="Marketing emails"
              sub="News, tips and offers — separate from booking alerts."
              on={prefs.marketingOptIn}
              onPress={() => {
                if (!prefs.loading && !prefs.saving) prefs.setMarketingOptIn(!prefs.marketingOptIn);
              }}
            />
          </View>
          {prefs.error ? <Text style={styles.prefsError}>{prefs.error}</Text> : null}

          {/* Settings */}
          <Text style={styles.sectionLabel}>Settings</Text>
          <View style={styles.card}>
            {SETTINGS.map((s, i) => (
              <View key={s.title}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <Pressable
                  onPress={() => go(s.route)}
                  style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.85 : 1 }]}
                >
                  <View style={styles.linkIcon}>
                    <Icon name={s.icon} size={18} color={colors.brand} />
                  </View>
                  <View style={styles.flexMin}>
                    <Text style={styles.linkTitle}>{s.title}</Text>
                    <Text style={styles.linkSub}>{s.sub}</Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={colors.ink3} />
                </Pressable>
              </View>
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={signOutFlow.request}
            style={({ pressed }) => [styles.signOut, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Icon name="logout" size={18} color={colors.danger} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
          <Text style={styles.note}>Our Haven · US-region · SOC 2 controls active</Text>
        </View>
      </View>

      <SignOutConfirmModal flow={signOutFlow} />
    </View>
  );
}

function ToggleRow({ label, sub, on, onPress }: { label: string; sub: string; on: boolean; onPress: () => void }) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.flexMin}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleSub}>{sub}</Text>
      </View>
      <Toggle on={on} onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  column: { width: '100%', maxWidth: 760 },
  flexMin: { flex: 1, minWidth: 0 },

  profile: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: colors.surface, borderRadius: 24, padding: 20, ...shadow.e1 },
  avatar: { width: 64, height: 64, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.bold, fontSize: 22, color: colors.inkInv },
  name: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink },
  email: { fontFamily: fonts.regular, fontSize: 13.5, color: colors.ink2, marginTop: 3 },
  roleChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, height: 28, paddingHorizontal: 11, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  roleText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 40, paddingHorizontal: 16, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink },
  editText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },

  sectionLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2, marginTop: 28, marginBottom: 12 },

  subCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 18, ...shadow.e1 },
  subIcon: { width: 46, height: 46, borderRadius: radii.pill, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  subTitle: { fontFamily: fonts.semibold, fontSize: 15.5, color: colors.ink },
  subSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 3 },
  manageBtn: { height: 40, paddingHorizontal: 18, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  manageText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },

  card: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: 18, ...shadow.e1 },
  divider: { height: 1, backgroundColor: colors.hairline },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 16 },
  toggleLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  toggleSub: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, color: colors.ink2, marginTop: 2 },

  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  linkIcon: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  linkTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  linkSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 2 },

  prefsError: { fontFamily: fonts.regular, fontSize: 12, color: colors.danger, marginTop: 8 },

  signOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.danger, marginTop: 28 },
  signOutText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.danger },
  note: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink3, textAlign: 'center', marginTop: 16 },
});
