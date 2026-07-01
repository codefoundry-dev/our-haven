/**
 * DisputeSheet (OH-211, ADR-0013) — the "Dispute charge & billing" flow. A
 * reason chip (the shared DisputeReason set) + optional free-text, posted to
 * `POST /v1/bookings/{id}/dispute`. Inside the ~24h review window this holds the
 * payout and routes to admin; on `accepted` / `completed` it is an admin
 * escalation (no automatic money movement). Shared native + web (RN Modal).
 */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import {
  ApiError,
  disputeBooking,
  type BookingDisputeReason,
  type BookingDisputeResult,
} from '@/api/client';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export interface DisputeSheetProps {
  visible: boolean;
  bookingId: string | null;
  onClose: () => void;
  onDisputed: (result: BookingDisputeResult) => void;
}

const REASONS: { value: BookingDisputeReason; label: string }[] = [
  { value: 'overcharged', label: 'Overcharged' },
  { value: 'no-show', label: 'No-show' },
  { value: 'safety', label: 'Safety concern' },
  { value: 'quality', label: 'Quality' },
  { value: 'other', label: 'Other' },
];

export function DisputeSheet({ visible, bookingId, onClose, onDisputed }: DisputeSheetProps) {
  const [reason, setReason] = useState<BookingDisputeReason | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!bookingId || !reason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await disputeBooking(bookingId, {
        reason,
        details: details.trim() ? details.trim() : undefined,
      });
      onDisputed(result);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('This booking can’t be disputed right now.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not file the dispute.');
      }
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.sheet}>
        <View style={styles.handleRow}>
          <Text style={styles.heading}>Report an issue</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close} hitSlop={8}>
            <Icon name="x" size={20} color={colors.ink2} />
          </Pressable>
        </View>

        <View style={styles.body}>
          <Text style={styles.label}>What’s the problem?</Text>
          <View style={styles.chips}>
            {REASONS.map((r) => {
              const on = reason === r.value;
              return (
                <Pressable
                  key={r.value}
                  onPress={() => setReason(r.value)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{r.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Add details (optional)</Text>
          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder="Tell us what happened…"
            placeholderTextColor={colors.ink3}
            multiline
            maxLength={1000}
            style={styles.input}
          />

          {error ? <Text style={styles.err}>{error}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={submitting || !reason}
            style={[styles.submit, (submitting || !reason) && styles.submitDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.inkInv} />
            ) : (
              <Text style={styles.submitText}>Submit report</Text>
            )}
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
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  chipText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink2 },
  chipTextOn: { color: colors.brand },
  input: {
    minHeight: 96,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    padding: 14,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: 'top',
  },
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
});
