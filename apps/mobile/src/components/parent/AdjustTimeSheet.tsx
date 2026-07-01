/**
 * AdjustTimeSheet (OH-212, PRD stories 129/130; ADR-0014 §A3) — the Parent's
 * "change the booked time" step on an `accepted` Caregiver Booking. Offers hour
 * presets + a custom half-hour stepper, then dispatches the asymmetric mechanic:
 *
 *   - **Extend** (target > current): applies immediately — the server grows the
 *     duration and re-authorizes the larger total. If Stripe raises a 3DS
 *     challenge (`requires_action`), the client completes it via the Stripe SDK
 *     before surfacing success.
 *   - **Shorten** (target < current): cuts hours the Caregiver agreed to, so it
 *     does NOT apply now — it files a request the Caregiver must approve. The
 *     Booking keeps its original duration/pay until then; the Parent can rescind.
 *
 * Shared native + web (RN Modal renders on RN-web), mirroring CancelSheet/AwardSheet.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import {
  ApiError,
  extendBooking,
  requestReduceBooking,
  type BookingDetail,
} from '@/api/client';
import { durationHours, formatTimeRange } from '@/lib/bookingView';
import { formatMoney } from '@/lib/offerCopy';
import { usePaymentAuthenticator } from '@/lib/stripeClient';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export interface AdjustTimeSheetProps {
  visible: boolean;
  booking: BookingDetail | null;
  onClose: () => void;
  onAdjusted: () => void;
}

const HOUR_PRESETS = [1, 2, 3, 4, 6, 8];
const STEP = 0.5;
const MIN_HOURS = 0.5;
const MAX_HOURS = 12;

const fmtHours = (h: number) => `${h}h`;

export function AdjustTimeSheet({ visible, booking, onClose, onAdjusted }: AdjustTimeSheetProps) {
  const { authenticate } = usePaymentAuthenticator();
  const current = booking ? durationHours(booking.startMin, booking.endMin) : 0;
  const [target, setTarget] = useState(current);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the picker to the booking's current duration each time it opens.
  useEffect(() => {
    if (visible) {
      setTarget(current);
      setError(null);
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, booking?.id]);

  const rateCents = useMemo(() => {
    if (!booking) return 0;
    if (booking.agreedRateCents != null) return booking.agreedRateCents;
    return current > 0 ? Math.round((booking.computedTotalCents ?? 0) / current) : 0;
  }, [booking, current]);

  if (!booking) return null;

  const mode: 'extend' | 'shorten' | 'same' =
    target > current ? 'extend' : target < current ? 'shorten' : 'same';
  const estTotalCents = Math.round(rateCents * target);
  const newEndMin = booking.startMin + Math.round(target * 60);
  const deltaHours = Math.round((target - current) * 10) / 10;

  const dec = () => setTarget((t) => Math.max(MIN_HOURS, Math.round((t - STEP) * 2) / 2));
  const inc = () => setTarget((t) => Math.min(MAX_HOURS, Math.round((t + STEP) * 2) / 2));

  const submit = async () => {
    if (submitting || mode === 'same') return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'extend') {
        const result = await extendBooking(booking.id, { newDurationHours: target });
        // Opportunistic 3DS on the re-authorization (same as Award).
        if (result.paymentStatus === 'requires_action' && result.clientSecret) {
          const auth = await authenticate(result.clientSecret);
          if (!auth.ok) {
            setError(auth.error ?? 'We couldn’t confirm your card. Please try again.');
            setSubmitting(false);
            return;
          }
        }
      } else {
        await requestReduceBooking(booking.id, { newDurationHours: target });
      }
      onAdjusted();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === 'caregiver_payout_unavailable') {
        setError('This caregiver hasn’t finished setting up payouts, so time can’t be added right now.');
      } else if (e instanceof ApiError && e.status === 409 && e.code === 'payment_method_required') {
        setError('Add a payment method to your account before extending.');
      } else if (e instanceof ApiError && e.status === 402) {
        setError('Your card was declined. Update your payment method and try again.');
      } else if (e instanceof ApiError && e.status === 409) {
        setError('This booking can no longer be adjusted.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not adjust the time.');
      }
      setSubmitting(false);
    }
  };

  const cta =
    mode === 'extend' ? 'Add time & re-authorize' : mode === 'shorten' ? 'Request shorter time' : 'Choose a new length';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.sheet}>
        <View style={styles.handleRow}>
          <Text style={styles.heading}>Adjust time</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close} hitSlop={8}>
            <Icon name="x" size={20} color={colors.ink2} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.lead}>
            Currently <Text style={styles.strong}>{fmtHours(current)}</Text> ·{' '}
            {formatTimeRange(booking.startMin, booking.endMin)}
          </Text>

          {/* Custom half-hour stepper */}
          <View style={styles.stepperCard}>
            <Pressable
              onPress={dec}
              disabled={target <= MIN_HOURS}
              accessibilityLabel="Less time"
              style={[styles.stepBtn, target <= MIN_HOURS && styles.stepBtnDisabled]}
            >
              <Icon name="minus" size={20} color={colors.ink} />
            </Pressable>
            <View style={styles.stepValue}>
              <Text style={styles.stepHours}>{fmtHours(target)}</Text>
              <Text style={styles.stepEnd}>{formatTimeRange(booking.startMin, newEndMin)}</Text>
            </View>
            <Pressable
              onPress={inc}
              disabled={target >= MAX_HOURS}
              accessibilityLabel="More time"
              style={[styles.stepBtn, target >= MAX_HOURS && styles.stepBtnDisabled]}
            >
              <Icon name="plus" size={20} color={colors.ink} />
            </Pressable>
          </View>

          {/* Hour presets */}
          <View style={styles.presetRow}>
            {HOUR_PRESETS.map((h) => {
              const active = target === h;
              return (
                <Pressable
                  key={h}
                  onPress={() => setTarget(h)}
                  accessibilityRole="button"
                  style={[styles.preset, active && styles.presetActive]}
                >
                  <Text style={[styles.presetText, active && styles.presetTextActive]}>{h}h</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Delta + estimate */}
          {mode !== 'same' ? (
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{mode === 'extend' ? 'Adding' : 'Removing'}</Text>
                <Text style={styles.summaryValue}>{fmtHours(Math.abs(deltaHours))}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>New estimated total</Text>
                <Text style={styles.summaryTotal}>{formatMoney(estTotalCents)}</Text>
              </View>
            </View>
          ) : null}

          <Text style={styles.note}>
            {mode === 'extend'
              ? 'Extending applies right away. We release the current hold and re-authorize the new total on your card.'
              : mode === 'shorten'
                ? 'Shortening removes hours the caregiver agreed to, so it’s sent to them to approve. Nothing changes until they accept — you can withdraw the request anytime.'
                : 'Add or remove time using the stepper or a preset.'}
          </Text>

          {error ? <Text style={styles.err}>{error}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={submitting || mode === 'same'}
            style={[styles.submit, (submitting || mode === 'same') && styles.submitDisabled]}
          >
            {submitting ? <ActivityIndicator color={colors.inkInv} /> : <Text style={styles.submitText}>{cta}</Text>}
          </Pressable>
          <Pressable onPress={onClose} style={styles.keep} disabled={submitting}>
            <Text style={styles.keepText}>Keep as is</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.canvas },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  heading: { flex: 1, fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  close: { padding: 4 },
  body: { padding: 20, gap: 14, paddingBottom: 40 },
  lead: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2 },
  strong: { fontFamily: fonts.semibold, color: colors.ink },

  stepperCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 14,
    ...shadow.e1,
  },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: { opacity: 0.3 },
  stepValue: { alignItems: 'center', minWidth: 0, flex: 1 },
  stepHours: { fontFamily: fonts.bold, fontSize: 30, color: colors.ink, fontVariant: ['tabular-nums'] },
  stepEnd: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },

  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  presetActive: { borderColor: colors.brand, backgroundColor: colors.brand },
  presetText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  presetTextActive: { color: colors.inkInv },

  summaryCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
  summaryValue: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
  summaryTotal: { fontFamily: fonts.bold, fontSize: 22, color: colors.brand, fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: 12 },

  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },
  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, textAlign: 'center' },

  submit: {
    backgroundColor: colors.brand,
    borderRadius: radii.lg,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
    ...shadow.e1,
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
  keep: { paddingVertical: 12, alignItems: 'center' },
  keepText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink2 },
});
