/**
 * CancelSheet (OH-211, PRD story 34) — the Parent's "see exactly what I'll be
 * charged" cancellation step. On open it fetches the M2.5 preview
 * (`GET /v1/bookings/{id}/cancel-preview`) and shows the charge/refund split for
 * the tier the Parent is in (free ≥24h / 50% <24h / 100% <2h-or-after), then
 * `POST …/cancel` executes it. Shared native + web (RN Modal renders on RN-web).
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import {
  ApiError,
  cancelBooking,
  getBookingCancelPreview,
  type BookingCancelPreview,
  type BookingCancelResult,
} from '@/api/client';
import { formatMoney } from '@/lib/offerCopy';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export interface CancelSheetProps {
  visible: boolean;
  bookingId: string | null;
  /** When false (a Provider consultation), the fee copy is suppressed. */
  caregiver?: boolean;
  onClose: () => void;
  onCancelled: (result: BookingCancelResult) => void;
}

const TIER_COPY: Record<BookingCancelPreview['tier'], string> = {
  free: 'Free cancellation — you won’t be charged.',
  half: 'Less than 24 hours before start — 50% of the estimated total applies.',
  full: 'Less than 2 hours before start (or after it began) — the full amount applies.',
};

export function CancelSheet({ visible, bookingId, caregiver = true, onClose, onCancelled }: CancelSheetProps) {
  const [preview, setPreview] = useState<BookingCancelPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !bookingId) return;
    let live = true;
    setLoading(true);
    setError(null);
    setPreview(null);
    getBookingCancelPreview(bookingId)
      .then((p) => {
        if (live) setPreview(p);
      })
      .catch((e) => {
        if (live) setError(e instanceof ApiError ? e.message : 'Could not load the cancellation details.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [visible, bookingId]);

  const submit = async () => {
    if (!bookingId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await cancelBooking(bookingId);
      onCancelled(result);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('This booking can no longer be cancelled.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not cancel the booking.');
      }
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.sheet}>
        <View style={styles.handleRow}>
          <Text style={styles.heading}>Cancel booking</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close} hitSlop={8}>
            <Icon name="x" size={20} color={colors.ink2} />
          </Pressable>
        </View>

        <View style={styles.body}>
          {loading ? (
            <ActivityIndicator color={colors.brand} style={styles.loader} />
          ) : preview ? (
            <>
              {caregiver ? (
                <>
                  <View style={styles.splitCard}>
                    <View style={styles.splitRow}>
                      <Text style={styles.splitLabel}>You’re charged</Text>
                      <Text style={styles.splitCharge}>{formatMoney(preview.chargeCents)}</Text>
                    </View>
                    <View style={styles.divider} />
                    <View style={styles.splitRow}>
                      <Text style={styles.splitLabel}>Refunded / released</Text>
                      <Text style={styles.splitRefund}>{formatMoney(preview.refundCents)}</Text>
                    </View>
                  </View>
                  <Text style={styles.tierNote}>{TIER_COPY[preview.tier]}</Text>
                </>
              ) : (
                <Text style={styles.tierNote}>Cancelling releases the slot back to the provider. No charge applies.</Text>
              )}
            </>
          ) : null}

          {error ? <Text style={styles.err}>{error}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={submitting || loading || !!error && !preview}
            style={[styles.submit, (submitting || loading) && styles.submitDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.inkInv} />
            ) : (
              <Text style={styles.submitText}>Cancel this booking</Text>
            )}
          </Pressable>
          <Pressable onPress={onClose} style={styles.keep} disabled={submitting}>
            <Text style={styles.keepText}>Keep booking</Text>
          </Pressable>
        </View>
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
  body: { padding: 20, gap: 14 },
  loader: { marginVertical: 32 },

  splitCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1 },
  splitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  splitLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
  splitCharge: { fontFamily: fonts.bold, fontSize: 22, color: colors.ink, fontVariant: ['tabular-nums'] },
  splitRefund: { fontFamily: fonts.bold, fontSize: 18, color: colors.success, fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: 12 },
  tierNote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },

  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, textAlign: 'center' },
  submit: {
    backgroundColor: colors.danger,
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
