/**
 * NoShowSheet (OH-213, CONTEXT § No-show) — the "Report a no-show" confirm. A
 * Caregiver no-show → the Booking is cancelled, the hold is released in full, and
 * the Caregiver is auto-flagged; a Provider consultation no-show is a flag only
 * (no money). Posts to `POST /v1/bookings/{id}/report-no-show`. Shared native +
 * web (RN Modal), mirroring CancelSheet / DisputeSheet.
 */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { ApiError, reportNoShow, type BookingReportNoShowResult } from '@/api/client';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export interface NoShowSheetProps {
  visible: boolean;
  bookingId: string | null;
  /** true for a Caregiver Booking (full refund); false for a Provider consultation (flag only). */
  caregiver: boolean;
  counterpartyName?: string | null;
  onClose: () => void;
  onReported: (result: BookingReportNoShowResult) => void;
}

export function NoShowSheet({
  visible,
  bookingId,
  caregiver,
  counterpartyName,
  onClose,
  onReported,
}: NoShowSheetProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const who = counterpartyName ?? (caregiver ? 'the caregiver' : 'the provider');

  const submit = async () => {
    if (!bookingId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      onReported(await reportNoShow(bookingId));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('This booking can’t be reported as a no-show right now.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not report the no-show.');
      }
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.sheet}>
        <View style={styles.handleRow}>
          <Text style={styles.heading}>Report a no-show</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close} hitSlop={8}>
            <Icon name="x" size={20} color={colors.ink2} />
          </Pressable>
        </View>

        <View style={styles.body}>
          <Text style={styles.lead}>Did {who} not show up?</Text>
          <Text style={styles.note}>
            {caregiver
              ? 'You’ll be refunded in full and the caregiver will be flagged for review. This cancels the booking.'
              : 'The provider will be flagged for review. This cancels the booking.'}
          </Text>

          {error ? <Text style={styles.err}>{error}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={submitting}
            style={[styles.submit, submitting && styles.submitDisabled]}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color={colors.inkInv} />
            ) : (
              <Text style={styles.submitText}>Report no-show</Text>
            )}
          </Pressable>
          <Pressable onPress={onClose} disabled={submitting} style={styles.cancel} accessibilityRole="button">
            <Text style={styles.cancelText}>Never mind</Text>
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
  body: { padding: 20, gap: 12 },
  lead: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2 },
  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, textAlign: 'center' },
  submit: {
    backgroundColor: colors.danger,
    borderRadius: radii.lg,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
    ...shadow.e1,
  },
  submitDisabled: { opacity: 0.5 },
  submitText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
  cancel: { alignItems: 'center', paddingVertical: 12 },
  cancelText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
});
