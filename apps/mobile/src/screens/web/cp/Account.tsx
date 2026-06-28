/**
 * AccountWeb — Caregiver / Provider account settings (web only).
 *
 * Faithful port of the Claude Design web project cp-web/cp-account.jsx
 * (CPAccount): the settings home for a payment-rail Caregiver — Listing
 * (profile, rates, negotiation, credentials, availability), Trust & payouts
 * (verification, Stripe Connect, statements, tips), and Settings, alongside a
 * right column of profile hero · preview · earnings · this-week. Content-only:
 * the route dispatcher wraps this in <WebShell>. RN primitives only (RN-web).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon, type IconName } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { Card } from '@/components/ui/Card';
import { WebPageHeader } from '@/components/web/WebShell';
import { SignOutConfirmModal, useSignOutFlow } from '@/components/web/SignOutConfirm';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

interface RowDef {
  icon: IconName;
  label: string;
  sub?: string;
  status?: string;
  value?: string;
  danger?: boolean;
  route?: string;
  /** Sentinel actions handled in-component rather than via navigation. */
  action?: 'signout';
}

const LISTING: RowDef[] = [
  { icon: 'person', label: 'Public profile', sub: 'Photo, bio, ages & comfort, languages', route: '/account' },
  { icon: 'dollar', label: 'Published Rates', sub: 'Tutor $35/hr · Babysitter $28/hr (+$5 per extra child)', value: 'Edit', route: '/account' },
  { icon: 'sparkle', label: 'Allow negotiation', sub: 'Parents can Counter your rate · off = fixed price', status: 'On', route: '/account' },
  { icon: 'shield', label: 'Credentials', sub: 'CPR · CDA active · Water Safety pending', status: '3 active', route: '/verification' },
  { icon: 'pin', label: 'Availability', sub: 'Mon–Fri · afternoons & evenings', route: '/availability' },
];

const TRUST: RowDef[] = [
  { icon: 'shield', label: 'Verification documents', sub: 'ID + Checkr background check', status: 'Cleared', route: '/verification' },
  { icon: 'briefcase', label: 'Bank details (Stripe Connect)', sub: 'Wells Fargo ····6community · same-day ACH', status: 'Linked', route: '/account' },
  { icon: 'receipt', label: 'Payouts & statements', sub: 'View transactions and tax documents', route: '/account' },
  { icon: 'dollar', label: 'Accept tips', sub: 'Parents can add a gratuity after a session · 100% yours, no fee', status: 'On', route: '/account' },
];

const SETTINGS: RowDef[] = [
  { icon: 'pin', label: 'Default address', sub: '1490 NE 2nd Ave · Brickell · shared with families after you accept', route: '/account' },
  { icon: 'bell', label: 'Notifications', route: '/account' },
  { icon: 'lock', label: 'Privacy & data', route: '/account' },
  { icon: 'info', label: 'Help & support', route: '/account' },
  { icon: 'logout', label: 'Sign out', danger: true, action: 'signout' },
];

const WEEK_STATS: [string, string][] = [
  ['Sessions', '7'],
  ['Hours', '11.5'],
  ['Earned', '$368'],
];

export function AccountWeb() {
  const router = useRouter();
  const go = (r: string) => router.push(r as never);
  const signOutFlow = useSignOutFlow();

  const Row = ({ row }: { row: RowDef }) => (
    <Pressable
      onPress={() => (row.action === 'signout' ? signOutFlow.request() : row.route && go(row.route))}
      style={styles.row}
    >
      <View style={styles.rowIcon}>
        <Icon name={row.icon} size={18} color={row.danger ? colors.danger : colors.ink} />
      </View>
      <View style={styles.flexMin}>
        <Text style={[styles.rowLabel, row.danger ? { color: colors.danger } : null]}>{row.label}</Text>
        {row.sub ? <Text style={styles.rowSub}>{row.sub}</Text> : null}
      </View>
      {row.status ? (
        <View style={styles.rowStatus}>
          <Text style={styles.rowStatusText}>{row.status}</Text>
        </View>
      ) : null}
      {row.value ? (
        <Text style={styles.rowValue}>{row.value}</Text>
      ) : (
        <Icon name="chevron-right" size={18} color={colors.ink3} />
      )}
    </Pressable>
  );

  return (
    <View>
      <WebPageHeader greet="Account" title="Maya Okafor" actions={['bell']} />

      <View style={styles.body}>
        <View style={styles.layout}>
          {/* ── left column ────────────────────────────────────── */}
          <View style={styles.mainCol}>
            <View style={styles.section}>
              <Text style={styles.secHead}>Listing</Text>
              <View style={styles.rowGroup}>
                {LISTING.map((r) => <Row key={r.label} row={r} />)}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.secHead}>Trust & payouts</Text>
              <View style={styles.rowGroup}>
                {TRUST.map((r) => <Row key={r.label} row={r} />)}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.secHead}>Settings</Text>
              <View style={styles.rowGroup}>
                {SETTINGS.map((r) => <Row key={r.label} row={r} />)}
              </View>
            </View>
          </View>

          {/* ── right column ───────────────────────────────────── */}
          <View style={styles.sideCol}>
            {/* profile hero */}
            <Card radius={radii.xl} padding={22} style={styles.heroCard}>
              <Avatar label="Maya Okafor" size="xl" tone="catTutor" />
              <View style={styles.flexMin}>
                <Text style={styles.heroName}>Maya Okafor</Text>
                <View style={styles.heroChips}>
                  <CategoryChip category="Tutor" />
                  <CategoryChip category="Babysitter" />
                  <View style={styles.verifiedPill}>
                    <Icon name="check-circle" size={11} color={colors.success} />
                    <Text style={styles.verifiedText}>Verified</Text>
                  </View>
                </View>
              </View>
            </Card>

            {/* preview profile */}
            <Pressable onPress={() => go('/account')} style={styles.previewBtn}>
              <View style={styles.previewIcon}>
                <Icon name="person" size={18} color={colors.inkInv} />
              </View>
              <View style={styles.flexMin}>
                <Text style={styles.previewTitle}>Preview my profile</Text>
                <Text style={styles.previewSub}>See exactly what Parents see</Text>
              </View>
              <Icon name="arrow-up-right" size={16} color={colors.inkInv} />
            </Pressable>

            {/* earnings glance */}
            <View style={styles.earnCard}>
              <Text style={styles.earnLabel}>Available to withdraw</Text>
              <Text style={styles.earnValue}>$1,284.50</Text>
              <View style={styles.earnFoot}>
                <Text style={styles.earnNext}>Next payout · Fri, May 23</Text>
                <Pressable onPress={() => go('/account')} style={styles.withdrawBtn}>
                  <Text style={styles.withdrawText}>Withdraw</Text>
                  <Icon name="arrow-up-right" size={14} color={colors.ink} />
                </Pressable>
              </View>
            </View>

            {/* this week glance */}
            <Card radius={radii.xl} padding={22} style={styles.weekCard}>
              <Text style={[styles.secHead, styles.secHeadCard]}>This week</Text>
              <View style={styles.statRow}>
                {WEEK_STATS.map(([l, v]) => (
                  <View key={l} style={styles.statTile}>
                    <Text style={styles.statValue}>{v}</Text>
                    <Text style={styles.statLabel}>{l}</Text>
                  </View>
                ))}
              </View>
            </Card>
          </View>
        </View>
      </View>

      <SignOutConfirmModal flow={signOutFlow} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flexMin: { flex: 1, minWidth: 0 },

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  mainCol: { flexGrow: 1.5, flexBasis: 540, minWidth: 360, gap: 22 },
  sideCol: { flexGrow: 1, flexBasis: 320, minWidth: 280, gap: 16 },

  section: {},
  secHead: { fontFamily: fonts.bold, fontSize: 11.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 12 },
  secHeadCard: { marginBottom: 14 },
  rowGroup: { gap: 10 },

  // link row (each is its own card)
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radii.md, paddingVertical: 16, paddingHorizontal: 18, ...shadow.e1 },
  rowIcon: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink },
  rowSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 2 },
  rowStatus: { height: 24, paddingHorizontal: 11, borderRadius: radii.pill, backgroundColor: 'rgba(47,122,77,0.12)', alignItems: 'center', justifyContent: 'center' },
  rowStatusText: { fontFamily: fonts.semibold, fontSize: 11.5, color: colors.success },
  rowValue: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },

  // profile hero
  heroCard: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroName: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 },
  verifiedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 22, paddingHorizontal: 9, borderRadius: radii.pill, backgroundColor: 'rgba(47,122,77,0.12)' },
  verifiedText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.success },

  // preview
  previewBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.ink, borderRadius: radii.md, paddingVertical: 16, paddingHorizontal: 18 },
  previewIcon: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: 'rgba(251,247,239,0.12)', alignItems: 'center', justifyContent: 'center' },
  previewTitle: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.inkInv },
  previewSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.inkInv, opacity: 0.6, marginTop: 2 },

  // earnings
  earnCard: { backgroundColor: colors.ink, borderRadius: radii.xl, padding: 22 },
  earnLabel: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.inkInv, opacity: 0.6 },
  earnValue: { fontFamily: fonts.bold, fontSize: 36, lineHeight: 40, letterSpacing: -1.2, color: colors.inkInv, marginTop: 4, fontVariant: ['tabular-nums'] },
  earnFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  earnNext: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.inkInv, opacity: 0.65 },
  withdrawBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 38, paddingHorizontal: 16, borderRadius: radii.pill, backgroundColor: colors.highlight },
  withdrawText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  // this week
  weekCard: { ...shadow.e1 },
  statRow: { flexDirection: 'row', gap: 12 },
  statTile: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radii.sm, paddingVertical: 14, paddingHorizontal: 12 },
  statValue: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink2, marginTop: 2 },
});
