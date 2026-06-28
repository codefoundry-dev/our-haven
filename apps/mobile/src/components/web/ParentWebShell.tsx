/**
 * ParentWebShell — desktop chrome for the demand-side (Parent) web app, the
 * marketplace counterpart to WebShell. Ported from the Claude Design web project
 * (parent-web/parent-web-primitives.jsx PWSidebar / PageFrame). Imported ONLY
 * from `*.web.tsx` route files, so it never reaches the native bundle.
 *
 * Layout: a light labelled left rail (brand · marketplace nav · "Post a Job" CTA
 * · subscription chip · user) beside a cream, scrollable content area. Below WIDE
 * the rail collapses into a slim brand header so small browsers stay usable.
 *
 * Pages render their own header (`WebPageHeader`, re-exported here) + body inside.
 */
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon, type IconName } from '@/components/Icon';
import { UserMenu } from '@/components/web/UserMenu';
import { WEB_WIDE_BREAKPOINT } from '@/lib/responsive';
import { colors, fonts, radii } from '@/theme/tokens';

// Re-export the shared page header so Parent pages import it from one place.
export { WebPageHeader } from '@/components/web/WebShell';

/** Below this viewport width the rail collapses into a slim header. */
const WIDE = WEB_WIDE_BREAKPOINT;

interface NavItem {
  id: string;
  icon: IconName;
  label: string;
  route?: string;
  badge?: number;
}

const NAV: NavItem[] = [
  { id: 'home', icon: 'house', label: 'Home', route: '/home' },
  { id: 'search', icon: 'search', label: 'Find care', route: '/search' },
  { id: 'bookings', icon: 'bookmark', label: 'Bookings', route: '/bookings', badge: 2 },
  { id: 'messages', icon: 'message', label: 'Messages', route: '/messages', badge: 3 },
  { id: 'account', icon: 'person', label: 'Account', route: '/account' },
];

export function ParentWebShell({ active, children }: { active: string; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const router = useRouter();

  if (!wide) {
    return (
      <View style={styles.narrowRoot}>
        <View style={styles.narrowHeader}>
          <View style={styles.logoInk}>
            <Text style={styles.logoInkText}>oh</Text>
          </View>
          <Text style={styles.wordmarkInk}>Our Haven</Text>
        </View>
        <ScrollView style={styles.fill} contentContainerStyle={styles.narrowContent} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* ── left rail ─────────────────────────────────────────── */}
      <View style={styles.rail}>
        <View style={styles.brandRow}>
          <View style={styles.logoInk}>
            <Text style={styles.logoInkText}>oh</Text>
          </View>
          <Text style={styles.wordmarkInk}>Our Haven</Text>
        </View>

        <Text style={styles.kicker}>Family</Text>

        <View style={styles.nav}>
          {NAV.map((it) => {
            const on = it.id === active;
            return (
              <Pressable
                key={it.id}
                onPress={() => it.route && router.push(it.route as never)}
                style={[styles.navItem, on ? styles.navItemActive : null]}
              >
                <Icon name={it.icon} size={20} color={on ? colors.brand : colors.ink2} />
                <Text style={[styles.navLabel, { color: on ? colors.brand : colors.ink, fontFamily: on ? fonts.bold : fonts.medium }]}>
                  {it.label}
                </Text>
                {it.badge ? (
                  <View style={styles.navBadge}>
                    <Text style={styles.navBadgeText}>{it.badge}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <Pressable onPress={() => router.push('/post-job' as never)} style={styles.cta}>
          <Icon name="briefcase" size={16} color={colors.inkInv} />
          <Text style={styles.ctaText}>Post a Job</Text>
        </Pressable>

        <View style={styles.flex} />

        <Pressable onPress={() => router.push('/paywall' as never)} style={styles.statusChip}>
          <View style={styles.statusIcon}>
            <Icon name="sparkle" size={16} color={colors.ink} />
          </View>
          <View style={styles.flexMin}>
            <Text style={styles.statusTitle} numberOfLines={1}>
              Subscription active
            </Text>
            <Text style={styles.statusSub} numberOfLines={1}>
              $14.99/mo · renews Jul 14
            </Text>
          </View>
        </Pressable>

        <UserMenu user={{ initials: 'AD', name: 'Adjei Asare', role: 'Parent · Beverly Hills' }} />
      </View>

      {/* ── content ───────────────────────────────────────────── */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.canvas },
  fill: { flex: 1 },
  flex: { flex: 1 },
  flexMin: { flex: 1, minWidth: 0 },

  // rail
  rail: { width: 244, flexShrink: 0, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.hairline, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 18 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 8, marginBottom: 26 },
  logoInk: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  logoInkText: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkInv, letterSpacing: -0.5 },
  wordmarkInk: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, letterSpacing: -0.3 },
  kicker: { fontFamily: fonts.bold, fontSize: 11, color: colors.ink2, letterSpacing: 0.5, textTransform: 'uppercase', paddingHorizontal: 8, marginBottom: 14 },
  nav: { gap: 3 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, paddingHorizontal: 12, borderRadius: 12 },
  navItemActive: { backgroundColor: colors.brandSoft },
  navLabel: { flex: 1, fontSize: 14.5 },
  navBadge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: radii.pill, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  navBadgeText: { fontFamily: fonts.bold, fontSize: 11, color: colors.inkInv },
  cta: { marginTop: 18, height: 46, borderRadius: 12, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ctaText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkInv },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceAlt, marginBottom: 10 },
  statusIcon: { width: 30, height: 30, borderRadius: radii.pill, backgroundColor: colors.highlight, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink },
  statusSub: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink2 },

  // content
  content: { flex: 1 },

  // narrow
  narrowRoot: { flex: 1, backgroundColor: colors.canvas },
  narrowHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  narrowContent: { paddingBottom: 60 },
});
