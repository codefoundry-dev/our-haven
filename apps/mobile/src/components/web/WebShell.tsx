/**
 * WebShell — desktop chrome for the supply-side web app (caregiver + clinical
 * Provider), ported from the Claude Design web project (web-primitives.jsx
 * SideRail / PageFrame / WebAppBar). Imported ONLY from `*.web.tsx` route files,
 * so it never reaches the native bundle.
 *
 * Layout: a light labelled left rail (brand · role-aware nav · CTA · status chip
 * · user) beside a cream, scrollable content area. Below WIDE the rail collapses
 * and a slim brand header shows so small browsers stay usable.
 *
 * Pages render their own `WebPageHeader` (greeting + actions) + body inside.
 */
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useRouter } from 'expo-router';

import { Icon, type IconName } from '@/components/Icon';
import { UserMenu } from '@/components/web/UserMenu';
import { WEB_WIDE_BREAKPOINT } from '@/lib/responsive';
import type { Role } from '@/lib/roles';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

/** Below this viewport width the rail collapses into a slim header. */
const WIDE = WEB_WIDE_BREAKPOINT;

interface NavItem {
  id: string;
  icon: IconName;
  label: string;
  route?: string;
  badge?: number;
}

interface RailConfig {
  kicker: string;
  items: NavItem[];
  cta?: { label: string; icon: IconName; route?: string };
  chip?: { icon: IconName; title: string; sub: string };
  user: { initials: string; name: string; role: string };
}

const CAREGIVER_RAIL: RailConfig = {
  kicker: 'Caregiver',
  items: [
    { id: 'home', icon: 'house', label: 'Dashboard', route: '/home' },
    { id: 'opportunities', icon: 'briefcase', label: 'Opportunities', route: '/opportunities' },
    { id: 'schedule', icon: 'calendar', label: 'Schedule', route: '/schedule' },
    { id: 'messages', icon: 'message', label: 'Messages', route: '/messages', badge: 3 },
    { id: 'verification', icon: 'shield', label: 'Verification', route: '/verification' },
    { id: 'account', icon: 'person', label: 'Account', route: '/account' },
  ],
  cta: { label: 'Find a Job', icon: 'briefcase', route: '/opportunities' },
  chip: { icon: 'check-circle', title: 'Verified Caregiver', sub: 'Tutor · $32/hr' },
  user: { initials: 'MO', name: 'Maya Okafor', role: 'Caregiver' },
};

const CLINICAL_RAIL: RailConfig = {
  kicker: 'Provider · Clinical',
  items: [
    { id: 'schedule', icon: 'calendar', label: 'Schedule', route: '/schedule' },
    { id: 'availability', icon: 'clock', label: 'Availability', route: '/availability' },
    { id: 'bookings', icon: 'bookmark', label: 'Bookings', route: '/bookings', badge: 2 },
    { id: 'messages', icon: 'message', label: 'Messages', route: '/messages', badge: 1 },
    { id: 'verification', icon: 'shield', label: 'Verification', route: '/verification' },
    { id: 'account', icon: 'person', label: 'Account', route: '/account' },
  ],
  cta: { label: 'Edit availability', icon: 'clock', route: '/availability' },
  chip: { icon: 'sparkle', title: 'Subscription active', sub: 'Renews Jun 14' },
  user: { initials: 'CR', name: 'Dr. Camille Ramos', role: 'Provider · OT' },
};

export function WebShell({ role, active, children }: { role: Role; active: string; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const router = useRouter();
  const cfg = role === 'provider' ? CLINICAL_RAIL : CAREGIVER_RAIL;

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

        <Text style={styles.kicker}>{cfg.kicker}</Text>

        <View style={styles.nav}>
          {cfg.items.map((it) => {
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

        {cfg.cta ? (
          <Pressable onPress={() => cfg.cta?.route && router.push(cfg.cta.route as never)} style={styles.cta}>
            <Icon name={cfg.cta.icon} size={16} color={colors.inkInv} />
            <Text style={styles.ctaText}>{cfg.cta.label}</Text>
          </Pressable>
        ) : null}

        <View style={styles.flex} />

        {cfg.chip ? (
          <View style={styles.statusChip}>
            <View style={styles.statusIcon}>
              <Icon name={cfg.chip.icon} size={16} color={colors.ink} />
            </View>
            <View style={styles.flexMin}>
              <Text style={styles.statusTitle} numberOfLines={1}>
                {cfg.chip.title}
              </Text>
              <Text style={styles.statusSub} numberOfLines={1}>
                {cfg.chip.sub}
              </Text>
            </View>
          </View>
        ) : null}

        <UserMenu user={cfg.user} />
      </View>

      {/* ── content ───────────────────────────────────────────── */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </View>
  );
}

/** WebAppBar — greeting eyebrow + big name + trailing actions / primary CTA. */
export function WebPageHeader({
  greet,
  title,
  actions = [],
  primary,
  onPrimary,
  style,
}: {
  greet?: string;
  title: string;
  actions?: IconName[];
  primary?: string;
  onPrimary?: () => void;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.header, style]}>
      <View style={styles.flexMin}>
        {greet ? <Text style={styles.headerGreet}>{greet}</Text> : null}
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      <View style={styles.headerActions}>
        {primary ? (
          <Pressable onPress={onPrimary} style={styles.headerPrimary}>
            <Icon name="plus" size={16} color={colors.inkInv} />
            <Text style={styles.headerPrimaryText}>{primary}</Text>
          </Pressable>
        ) : null}
        {actions.map((a, i) => (
          <View key={`${a}-${i}`} style={[styles.headerAction, shadow.e1]}>
            <Icon name={a} size={20} color={colors.ink} />
            {a === 'bell' ? <View style={styles.headerDot} /> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

/** RingChart — segmented half-ring KPI (web-primitives.jsx RingChart). */
export function RingChart({ pct = 77, label = 'Near complete' }: { pct?: number; label?: string }) {
  const seg = 14;
  const segColors = [colors.catNanny, colors.catTutor, colors.catSpec, colors.highlight, colors.hairline, colors.catSpec, colors.catBaby];
  const paths: { d: string; fill: string }[] = [];
  for (let i = 0; i < seg; i++) {
    const a0 = Math.PI * (1 - i / seg);
    const a1 = Math.PI * (1 - (i + 0.86) / seg);
    const r1 = 90;
    const r2 = 65;
    const x0 = 100 + r1 * Math.cos(a0);
    const y0 = 100 - r1 * Math.sin(a0);
    const x1 = 100 + r1 * Math.cos(a1);
    const y1 = 100 - r1 * Math.sin(a1);
    const x2 = 100 + r2 * Math.cos(a1);
    const y2 = 100 - r2 * Math.sin(a1);
    const x3 = 100 + r2 * Math.cos(a0);
    const y3 = 100 - r2 * Math.sin(a0);
    const filled = (i / seg) * 100 < pct;
    paths.push({ d: `M${x0} ${y0} A${r1} ${r1} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${r2} ${r2} 0 0 0 ${x3} ${y3} Z`, fill: filled ? segColors[i % segColors.length] : colors.surfaceAlt });
  }
  return (
    <View style={styles.ring}>
      <Svg viewBox="0 0 200 100" width="100%" height="100%">
        {paths.map((p, i) => (
          <Path key={i} d={p.d} fill={p.fill} />
        ))}
      </Svg>
      <View style={styles.ringLabel}>
        <Text style={styles.ringPct}>{pct}%</Text>
        <Text style={styles.ringSub}>{label}</Text>
      </View>
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

  // content + header
  content: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, paddingHorizontal: 36, paddingTop: 32, paddingBottom: 24 },
  headerGreet: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  headerTitle: { fontFamily: fonts.bold, fontSize: 38, lineHeight: 44, letterSpacing: -1.4, color: colors.ink },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerPrimary: { height: 44, paddingHorizontal: 18, borderRadius: radii.pill, backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerPrimaryText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkInv },
  headerAction: { width: 44, height: 44, borderRadius: radii.pill, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerDot: { position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.danger, borderWidth: 2, borderColor: colors.surface },

  // ring
  ring: { width: '100%', aspectRatio: 2, alignItems: 'center', justifyContent: 'center' },
  ringLabel: { position: 'absolute', bottom: 4, left: 0, right: 0, alignItems: 'center' },
  ringPct: { fontFamily: fonts.bold, fontSize: 32, color: colors.ink, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  ringSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },

  // narrow
  narrowRoot: { flex: 1, backgroundColor: colors.canvas },
  narrowHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  narrowContent: { paddingBottom: 60 },
});
