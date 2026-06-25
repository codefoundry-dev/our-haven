/**
 * Verification — the supply member's verification flow + status tracker (OH-184).
 * Reads the server-computed state (GET /v1/providers/me/verification), renders the
 * per-role checklist, and embeds the two applicant-driven actions (government-ID
 * upload, phone OTP) on their steps. A hidden (app) route reached from Account.
 *
 * Satisfies OH-184: email/phone verification (phone is the hard activation gate),
 * ID upload via signed URL, and per-step status surfaced to the applicant.
 */
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, getVerification, type Verification } from '@/api/client';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
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

const TONE: Record<StateTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surfaceAlt, fg: colors.ink2 },
  progress: { bg: colors.brandSoft, fg: colors.brand },
  success: { bg: 'rgba(47,122,77,0.14)', fg: colors.success },
  warn: { bg: 'rgba(201,122,42,0.14)', fg: colors.warning },
  error: { bg: 'rgba(178,58,47,0.12)', fg: colors.danger },
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

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Icon name="chevron-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={styles.topTitle}>Verification</Text>
        <Pressable onPress={load} hitSlop={10} accessibilityLabel="Refresh">
          <Icon name="clock" size={20} color={colors.ink2} />
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
          <Text style={styles.title}>Get verified</Text>
          <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
            <Text style={[styles.statusText, { color: tone.fg }]}>{copy.label}</Text>
          </View>
          <Text style={styles.blurb}>{copy.blurb}</Text>

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
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 4, paddingBottom: 36 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44 },
  topTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64, gap: 16 },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, color: colors.ink, marginTop: 12 },
  statusPill: { alignSelf: 'flex-start', borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6, marginTop: 12 },
  statusText: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.2 },
  blurb: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, marginTop: 10 },
  progressCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: 16, marginTop: 20, ...shadow.e1 },
  progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  progressLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
  track: { height: 6, borderRadius: radii.pill, backgroundColor: colors.hairline, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radii.pill },
  steps: { gap: 12, marginTop: 20 },
  error: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.danger, textAlign: 'center' },
  errorInline: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 16 },
  retry: { backgroundColor: colors.brand, borderRadius: radii.pill, paddingHorizontal: 24, paddingVertical: 14 },
  retryText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
});
