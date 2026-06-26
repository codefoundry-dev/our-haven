/**
 * AuthWebShell — desktop chrome for the auth journey on the web.
 *
 * The unified RN/Expo app renders a phone-width column for auth on every
 * platform; on the web that reads as a stretched mobile screen. This shell gives
 * the web auth routes the split-screen treatment from the Claude Design web
 * project (web-screens/web-provider-signin → dark brand panel + cream form
 * column). It is imported only from `*.web.tsx` route files, so it never reaches
 * the native bundle.
 *
 * The shell owns the layout only; each route passes its value-prop `panel` copy
 * and renders its existing, stateful form as `children` in the right column.
 * Below WIDE the panes collapse to a single scrollable column with a compact
 * brand header so small browsers / mobile web stay usable.
 */
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { colors, fonts, radii } from '@/theme/tokens';

/** Below this viewport width the split panes stack into one column. */
const WIDE = 880;

/** Soft teal/mint glows over the ink panel (RN-web honors backgroundImage). */
const panelGlow: ViewStyle = {
  backgroundImage:
    'radial-gradient(circle at 22% 28%, rgba(30,122,134,0.45), transparent 55%), radial-gradient(circle at 82% 78%, rgba(197,230,205,0.22), transparent 55%)',
} as unknown as ViewStyle;

export interface AuthPanelCopy {
  /** Mono label under the wordmark, e.g. "caregiver sign-up". */
  kicker?: string;
  /** Small "Welcome back"-style pill above the headline. */
  eyebrow?: string;
  /** Big value-prop headline (use \n for line breaks). */
  title: string;
  subtitle?: string;
  /** Optional "web is the better tool for" grid. */
  featuresHead?: string;
  features?: { icon: IconName; label: string }[];
  /** Small bottom-left meta line. */
  footnote?: string;
}

export function AuthWebShell({ panel, children }: { panel: AuthPanelCopy; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;

  if (!wide) {
    return (
      <ScrollView
        style={styles.narrowScroll}
        contentContainerStyle={styles.narrowContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.narrowInner}>
          <View style={styles.brandRowLight}>
            <View style={styles.logoInk}>
              <Text style={styles.logoInkText}>oh</Text>
            </View>
            <Text style={styles.wordmarkInk}>Our Haven</Text>
          </View>
          {children}
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.root}>
      {/* ── left · brand / value panel ───────────────────────── */}
      <View style={[styles.left, panelGlow]}>
        <View style={styles.brandRow}>
          <View style={styles.logoSpec}>
            <Text style={styles.logoSpecText}>oh</Text>
          </View>
          <View>
            <Text style={styles.wordmark}>Our Haven</Text>
            {panel.kicker ? <Text style={styles.kicker}>{panel.kicker}</Text> : null}
          </View>
        </View>

        <View style={styles.leftBody}>
          {panel.eyebrow ? (
            <View style={styles.welcomePill}>
              <View style={styles.welcomeDot} />
              <Text style={styles.welcomePillText}>{panel.eyebrow}</Text>
            </View>
          ) : null}
          <Text style={styles.leftTitle}>{panel.title}</Text>
          {panel.subtitle ? <Text style={styles.leftSubtitle}>{panel.subtitle}</Text> : null}

          {panel.features && panel.features.length > 0 ? (
            <View style={styles.featureCard}>
              <Text style={styles.featureHead}>{panel.featuresHead ?? 'Web is the better tool for'}</Text>
              <View style={styles.featureGrid}>
                {panel.features.map((f) => (
                  <View key={f.label} style={styles.featureRow}>
                    <View style={styles.featureIcon}>
                      <Icon name={f.icon} size={14} color={colors.catSpec} />
                    </View>
                    <Text style={styles.featureLabel}>{f.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>

        <Text style={styles.footnote}>{panel.footnote ?? 'ourhaven.com · US-region · SOC 2 controls active'}</Text>
      </View>

      {/* ── right · form column ──────────────────────────────── */}
      <View style={styles.right}>
        <ScrollView
          style={styles.rightScroll}
          contentContainerStyle={styles.rightContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.rightInner}>{children}</View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.ink },

  // left panel
  left: {
    flex: 1.1,
    minWidth: 0,
    paddingVertical: 40,
    paddingHorizontal: 56,
    justifyContent: 'space-between',
    backgroundColor: colors.ink,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoSpec: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.catSpec, alignItems: 'center', justifyContent: 'center' },
  logoSpecText: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink, letterSpacing: -0.5 },
  wordmark: { fontFamily: fonts.bold, fontSize: 15, color: colors.inkInv, letterSpacing: -0.3 },
  kicker: { fontFamily: fonts.mono, fontSize: 11, color: colors.inkInv, opacity: 0.55, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2 },

  leftBody: { maxWidth: 520 },
  welcomePill: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 5, paddingHorizontal: 12, borderRadius: radii.pill,
    backgroundColor: 'rgba(251,247,239,0.08)', marginBottom: 18,
  },
  welcomeDot: { width: 7, height: 7, borderRadius: radii.pill, backgroundColor: colors.highlight },
  welcomePillText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.inkInv, textTransform: 'uppercase', letterSpacing: 0.5 },
  leftTitle: { fontFamily: fonts.bold, fontSize: 46, lineHeight: 52, letterSpacing: -1.6, color: colors.inkInv },
  leftSubtitle: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, color: colors.inkInv, opacity: 0.78, marginTop: 18 },

  featureCard: {
    marginTop: 28, padding: 18, borderRadius: radii.lg,
    borderWidth: 1, borderColor: 'rgba(251,247,239,0.12)', backgroundColor: 'rgba(0,0,0,0.18)',
  },
  featureHead: { fontFamily: fonts.bold, fontSize: 11, color: colors.inkInv, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
  featureGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  featureRow: { flexBasis: '50%', flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  featureIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(197,230,205,0.16)', alignItems: 'center', justifyContent: 'center' },
  featureLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.inkInv, opacity: 0.92 },

  footnote: { fontFamily: fonts.regular, fontSize: 11, color: colors.inkInv, opacity: 0.5 },

  // right column
  right: { width: 480, flexShrink: 0, backgroundColor: colors.canvas },
  rightScroll: { flex: 1 },
  rightContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 52 },
  rightInner: { width: '100%' },

  // narrow (stacked) fallback
  narrowScroll: { flex: 1, backgroundColor: colors.canvas },
  narrowContent: { flexGrow: 1, alignItems: 'center', paddingVertical: 32, paddingHorizontal: 22 },
  narrowInner: { width: '100%', maxWidth: 440 },
  brandRowLight: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 24 },
  logoInk: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  logoInkText: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkInv, letterSpacing: -0.5 },
  wordmarkInk: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, letterSpacing: -0.3 },
});
