/**
 * Provider Subscription (OH-222) — the clinical Provider's listing & billing hub.
 *
 * Reads GET /v1/providers/me/subscription and opens the two Stripe-hosted
 * linkouts (Checkout to start, Billing Portal to manage / cancel) in an in-app
 * browser via `useProviderSubscription`. Being `listed` (status active/trialing)
 * is the gate that lets a Provider publish bookable consultation slots and appear
 * in Search — so this is where a Provider goes live, and it drives the Schedule /
 * Availability pre-activation states.
 *
 * A hidden (app) route reached from Account; Provider-only server-side (403).
 */
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useProviderSubscription } from '@/lib/useProviderSubscription';
import type { ProviderSubscriptionStatus } from '@/api/client';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Tone = 'success' | 'warn' | 'neutral';

const STATUS_META: Record<NonNullable<ProviderSubscriptionStatus>, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'success' },
  trialing: { label: 'Trialing', tone: 'success' },
  past_due: { label: 'Past due', tone: 'warn' },
  unpaid: { label: 'Unpaid', tone: 'warn' },
  incomplete: { label: 'Incomplete', tone: 'warn' },
  incomplete_expired: { label: 'Expired', tone: 'neutral' },
  canceled: { label: 'Canceled', tone: 'neutral' },
  paused: { label: 'Paused', tone: 'neutral' },
};

const TONE: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: 'rgba(47,122,77,0.14)', fg: colors.success },
  warn: { bg: 'rgba(201,122,42,0.14)', fg: colors.warning },
  neutral: { bg: colors.surfaceAlt, fg: colors.ink2 },
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}, ${d.getFullYear()}`;
}

export default function SubscriptionScreen() {
  const router = useRouter();
  const { summary, listed, loading, error, phase, busy, actionError, refetch, startCheckout, recheck, openPortal } =
    useProviderSubscription();

  const statusMeta = summary?.status ? STATUS_META[summary.status] : { label: 'Not started', tone: 'neutral' as Tone };
  const statusTone = TONE[statusMeta.tone];
  const periodEnd = formatDate(summary?.currentPeriodEnd ?? null);
  const polling = phase === 'polling';

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Icon name="chevron-left" size={24} color={colors.ink} />
        </Pressable>
        <Text style={styles.topTitle}>Subscription</Text>
        <Pressable onPress={() => void refetch()} hitSlop={10} accessibilityLabel="Refresh">
          <Icon name="clock" size={20} color={colors.ink2} />
        </Pressable>
      </View>

      {loading && !summary ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : error && !summary ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={() => void refetch()} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : summary ? (
        <>
          <Text style={styles.title}>Your listing</Text>

          {/* Listing hero — live vs not-listed */}
          <View style={[styles.hero, { backgroundColor: listed ? 'rgba(47,122,77,0.10)' : colors.surface }]}>
            <View style={[styles.heroIcon, { backgroundColor: listed ? 'rgba(47,122,77,0.16)' : colors.surfaceAlt }]}>
              <Icon name={listed ? 'check-circle' : 'shield'} size={20} color={listed ? colors.success : colors.ink2} />
            </View>
            <Text style={styles.heroTitle}>{listed ? 'Your practice is live' : 'Not listed yet'}</Text>
            <Text style={styles.heroSub}>
              {listed
                ? 'Families can find you in Search and book consultations. Publish open slots from your Availability.'
                : 'Start your subscription to appear in Search, publish consultation slots, and take bookings.'}
            </Text>
          </View>

          {/* Status detail (once there's a subscription) */}
          {summary.hasSubscription ? (
            <View style={styles.detail}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Status</Text>
                <View style={[styles.statusPill, { backgroundColor: statusTone.bg }]}>
                  <Text style={[styles.statusText, { color: statusTone.fg }]}>{statusMeta.label}</Text>
                </View>
              </View>
              {periodEnd ? (
                <View style={[styles.detailRow, styles.detailRowBorder]}>
                  <Text style={styles.detailLabel}>{summary.cancelAtPeriodEnd ? 'Ends' : 'Renews'}</Text>
                  <Text style={styles.detailValue}>{periodEnd}</Text>
                </View>
              ) : null}
              {summary.cancelAtPeriodEnd ? (
                <Text style={styles.cancelNote}>
                  Your subscription is set to cancel — your listing stays live until then.
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Polling after returning from checkout */}
          {polling ? (
            <View style={styles.pollCard}>
              <ActivityIndicator color={colors.brand} />
              <Text style={styles.pollText}>Confirming your subscription…</Text>
            </View>
          ) : null}

          {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

          <View style={styles.spacer} />

          {/* Primary CTA — start vs manage */}
          {summary.hasSubscription ? (
            <PrimaryButton
              onPress={openPortal}
              loading={busy && !polling}
              icon={<Icon name="arrow-up-right" size={18} color={colors.inkInv} />}
            >
              Manage subscription
            </PrimaryButton>
          ) : (
            <PrimaryButton
              onPress={startCheckout}
              loading={busy}
              icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
            >
              Start subscription
            </PrimaryButton>
          )}

          {/* Manual re-check after a poll timeout */}
          {actionError && !busy ? (
            <Pressable onPress={recheck} accessibilityRole="button" style={styles.recheck}>
              <Text style={styles.recheckText}>I&apos;ve subscribed — check again</Text>
            </Pressable>
          ) : null}

          <Text style={styles.note}>
            Billed monthly via Stripe in a secure in-app browser. Cancel anytime — your listing stays live until the
            period ends.
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingTop: 4, paddingBottom: 28 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 44 },
  topTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64, gap: 16 },
  error: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.danger, textAlign: 'center' },
  retry: { backgroundColor: colors.brand, borderRadius: radii.pill, paddingHorizontal: 24, paddingVertical: 14 },
  retryText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },

  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, color: colors.ink, marginTop: 12 },

  hero: { borderRadius: radii.lg, padding: 20, marginTop: 16, ...shadow.e1 },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  heroTitle: { fontFamily: fonts.bold, fontSize: 19, letterSpacing: -0.4, color: colors.ink },
  heroSub: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 20, color: colors.ink2, marginTop: 6 },

  detail: { backgroundColor: colors.surface, borderRadius: radii.md, paddingHorizontal: 16, marginTop: 12, ...shadow.e1 },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  detailRowBorder: { borderTopWidth: 1, borderTopColor: colors.hairline },
  detailLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink2 },
  detailValue: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] },
  statusPill: { height: 26, paddingHorizontal: 10, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  statusText: { fontFamily: fonts.semibold, fontSize: 12.5 },
  cancelNote: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.warning, paddingBottom: 14 },

  pollCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.brandSoft,
    borderRadius: radii.md,
    padding: 16,
    marginTop: 12,
  },
  pollText: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  actionError: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, color: colors.danger, marginTop: 14 },

  spacer: { flex: 1, minHeight: 20 },
  recheck: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  recheckText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink3, textAlign: 'center', marginTop: 10 },
});
