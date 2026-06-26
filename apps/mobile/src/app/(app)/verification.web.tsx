/**
 * Verification (WEB) — two-pane desktop layout (Claude Design cp-web CPOnboardHub
 * treatment): a brand/value panel on the left and the real, server-driven
 * checklist on the right. Same data path as the native screen (getVerification +
 * verificationSteps) and the same embedded actions (IdDocUpload, PhoneVerify);
 * only the layout differs. Metro resolves this over verification.tsx on web.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import { ApiError, getVerification, type Verification } from '@/api/client';
import { Icon, type IconName } from '@/components/Icon';
import { IdDocUpload } from '@/components/verification/IdDocUpload';
import { PhoneVerify } from '@/components/verification/PhoneVerify';
import { StepCard } from '@/components/verification/StepCard';
import {
  VERIFICATION_STATE_COPY,
  verificationProgress,
  verificationSteps,
  type StateTone,
} from '@/lib/verification';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const WIDE = 920;

const TONE: Record<StateTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surfaceAlt, fg: colors.ink2 },
  progress: { bg: colors.brandSoft, fg: colors.brand },
  success: { bg: 'rgba(47,122,77,0.14)', fg: colors.success },
  warn: { bg: 'rgba(201,122,42,0.14)', fg: colors.warning },
  error: { bg: 'rgba(178,58,47,0.12)', fg: colors.danger },
};

const brandGradient: ViewStyle = {
  backgroundImage: `linear-gradient(165deg, ${colors.catSpec} 0%, ${colors.catBaby} 100%)`,
} as unknown as ViewStyle;

const BULLETS: Record<'caregiver' | 'provider', { icon: IconName; label: string }[]> = {
  caregiver: [
    { icon: 'shield', label: 'Bank-grade identity + background checks' },
    { icon: 'dollar', label: 'Same-day payouts once verified' },
    { icon: 'lock', label: 'Your documents are never shown to Parents' },
  ],
  provider: [
    { icon: 'shield', label: 'License + insurance verified by our team' },
    { icon: 'briefcase', label: 'Consultation booking once you’re live' },
    { icon: 'lock', label: 'Your credentials are never shown to Parents' },
  ],
};

function humanize(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'Set EXPO_PUBLIC_API_URL in apps/mobile/.env to reach the backend.';
    if (e.status === 404) return 'Finish choosing your role before verifying.';
    return e.message;
  }
  return 'Could not load your verification status.';
}

export default function VerificationScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;

  const [data, setData] = useState<Verification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getVerification());
    } catch (e) {
      setError(humanize(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const steps = data ? verificationSteps(data) : [];
  const progress = verificationProgress(steps);
  const copy = data ? VERIFICATION_STATE_COPY[data.state] : null;
  const tone = copy ? TONE[copy.tone] : TONE.neutral;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const role = data?.role === 'provider' ? 'provider' : 'caregiver';

  return (
    <View style={styles.root}>
      {wide ? (
        <View style={[styles.brandPanel, brandGradient]}>
          <View style={styles.brandRow}>
            <View style={styles.logoMark}>
              <Text style={styles.logoMarkText}>oh</Text>
            </View>
            <Text style={styles.wordmark}>Our Haven</Text>
          </View>

          <View style={styles.brandBody}>
            <View style={styles.eyebrowChip}>
              <Text style={styles.eyebrowChipText}>{role === 'provider' ? 'Provider verification' : 'Caregiver verification'}</Text>
            </View>
            <Text style={styles.brandTitle}>Let’s get you verified.</Text>
            <Text style={styles.brandSubtitle}>
              Heavy verification lives on the web — ID, documents and background checks work best in a browser. Your
              progress saves as you go.
            </Text>

            <View style={styles.bullets}>
              {BULLETS[role].map((b) => (
                <View key={b.label} style={styles.bulletRow}>
                  <View style={styles.bulletIcon}>
                    <Icon name={b.icon} size={17} color={colors.ink} />
                  </View>
                  <Text style={styles.bulletLabel}>{b.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <Text style={styles.brandFootnote}>Reviewed by Trust &amp; Safety · encrypted at rest</Text>
        </View>
      ) : null}

      <ScrollView
        style={styles.rightScroll}
        contentContainerStyle={[styles.rightContent, !wide && styles.rightContentNarrow]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.rightInner}>
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back" style={styles.backRow}>
              <Icon name="chevron-left" size={20} color={colors.ink2} />
              <Text style={styles.backText}>Account</Text>
            </Pressable>
            <Pressable onPress={load} hitSlop={10} accessibilityLabel="Refresh" style={styles.refreshRow}>
              <Icon name="clock" size={18} color={colors.ink2} />
              <Text style={styles.refreshText}>Refresh</Text>
            </Pressable>
          </View>

          {loading && !data ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : error && !data ? (
            <View style={styles.center}>
              <Text style={styles.error}>{error}</Text>
              <Pressable onPress={load} style={styles.retry}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : data && copy ? (
            <>
              <View style={styles.headRow}>
                <View style={styles.headCopy}>
                  <Text style={styles.title}>Get verified</Text>
                  <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
                    <Text style={[styles.statusText, { color: tone.fg }]}>{copy.label}</Text>
                  </View>
                  <Text style={styles.blurb}>{copy.blurb}</Text>
                </View>
                <View style={styles.pctCircle}>
                  <Text style={styles.pctText}>{pct}%</Text>
                </View>
              </View>

              <View style={styles.progressCard}>
                <View style={styles.progressHead}>
                  <Text style={styles.progressLabel}>
                    {progress.done} of {progress.total} steps
                  </Text>
                  {data.state === 'activated' ? <Icon name="check-circle" size={18} color={colors.success} /> : null}
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${pct}%`, backgroundColor: tone.fg }]} />
                </View>
              </View>

              <View style={styles.steps}>
                {steps.map((s) => {
                  const showId = s.action === 'id-doc' && s.status !== 'done';
                  const showPhone = s.action === 'phone' && s.status !== 'done';
                  return (
                    <StepCard key={s.key} step={s}>
                      {showId ? <IdDocUpload onUploaded={setData} /> : null}
                      {showPhone ? <PhoneVerify onVerified={setData} /> : null}
                    </StepCard>
                  );
                })}
              </View>

              {error ? <Text style={styles.errorInline}>{error}</Text> : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.canvas },

  // left brand panel
  brandPanel: { width: 420, flexShrink: 0, paddingVertical: 48, paddingHorizontal: 44, justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  logoMark: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  logoMarkText: { fontFamily: fonts.bold, fontSize: 17, color: colors.inkInv, letterSpacing: -0.5 },
  wordmark: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  brandBody: { flex: 1, justifyContent: 'center' },
  eyebrowChip: {
    alignSelf: 'flex-start', height: 34, paddingHorizontal: 14, borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.6)', justifyContent: 'center', marginBottom: 22,
  },
  eyebrowChipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  brandTitle: { fontFamily: fonts.bold, fontSize: 38, lineHeight: 43, letterSpacing: -1.4, color: colors.ink, maxWidth: 320 },
  brandSubtitle: { fontFamily: fonts.regular, fontSize: 15.5, lineHeight: 23, color: colors.ink, opacity: 0.78, marginTop: 16, maxWidth: 320 },
  bullets: { marginTop: 28, gap: 14 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bulletIcon: { width: 34, height: 34, borderRadius: radii.pill, backgroundColor: 'rgba(255,255,255,0.55)', alignItems: 'center', justifyContent: 'center' },
  bulletLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 14.5, color: colors.ink },
  brandFootnote: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink, opacity: 0.6 },

  // right column
  rightScroll: { flex: 1 },
  rightContent: { paddingVertical: 44, paddingHorizontal: 56, alignItems: 'center' },
  rightContentNarrow: { paddingVertical: 28, paddingHorizontal: 20 },
  rightInner: { width: '100%', maxWidth: 620 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
  refreshRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  refreshText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },

  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 16 },

  headRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  headCopy: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.bold, fontSize: 32, lineHeight: 38, letterSpacing: -0.9, color: colors.ink },
  statusPill: { alignSelf: 'flex-start', borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6, marginTop: 12 },
  statusText: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.2 },
  blurb: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 21, color: colors.ink2, marginTop: 10, maxWidth: 460 },
  pctCircle: {
    width: 68, height: 68, borderRadius: radii.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', ...shadow.e1,
  },
  pctText: { fontFamily: fonts.bold, fontSize: 19, color: colors.ink },

  progressCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: 16, marginTop: 24, ...shadow.e1 },
  progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  progressLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
  track: { height: 6, borderRadius: radii.pill, backgroundColor: colors.hairline, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radii.pill },

  steps: { gap: 12, marginTop: 22 },
  error: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.danger, textAlign: 'center' },
  errorInline: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 16 },
  retry: { backgroundColor: colors.brand, borderRadius: radii.pill, paddingHorizontal: 24, paddingVertical: 14 },
  retryText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
});
