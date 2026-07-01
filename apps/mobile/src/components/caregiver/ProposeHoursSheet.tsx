/**
 * ProposeHoursSheet (OH-220) — the "End session" half-sheet (design §5.11.3.4,
 * amended per ADR-0014). The Caregiver ends an in-progress session and PROPOSES
 * the hours worked; that opens the Parent's ~24h confirm window (ADR-0013), after
 * which the held card is captured for the confirmed amount (or auto-captures on
 * lapse). Hours default to the booked window and can be shortened if the session
 * ran short — the charge can never exceed the amount authorized at booking.
 *
 * Same Modal + SafeAreaView pattern as AwardSheet (works on RN-web). `onProposed`
 * fires after a successful propose so the Schedule can refetch + surface success.
 */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { ApiError, proposeCaregiverHours, type CaregiverBooking } from '@/api/client';
import { formatMoney } from '@/lib/offerCopy';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export interface ProposeHoursSheetProps {
  booking: CaregiverBooking | null;
  onClose: () => void;
  onProposed: () => void;
}

const STEP = 0.5;

function fmtHours(h: number): string {
  return Number.isInteger(h) ? `${h}h` : `${h}h`;
}

export function ProposeHoursSheet({ booking, onClose, onProposed }: ProposeHoursSheetProps) {
  const bookedHours = booking ? Math.max(STEP, (booking.endMin - booking.startMin) / 60) : STEP;
  const [hours, setHours] = useState(bookedHours);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the stepper to the booked window whenever a different Booking opens.
  const [seenId, setSeenId] = useState<string | null>(null);
  if (booking && booking.id !== seenId) {
    setSeenId(booking.id);
    setHours(bookedHours);
    setNote('');
    setError(null);
  }

  const bookedTotal = booking?.computedTotalCents ?? 0;
  const estimate = bookedHours > 0 ? Math.round((bookedTotal * hours) / bookedHours) : bookedTotal;

  const dec = () => setHours((h) => Math.max(STEP, Math.round((h - STEP) * 2) / 2));
  const inc = () => setHours((h) => Math.min(bookedHours, Math.round((h + STEP) * 2) / 2));

  const submit = async () => {
    if (!booking || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await proposeCaregiverHours(booking.id, { hours, note: note.trim() || undefined });
      onProposed();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('This session can no longer be ended — it may already be awaiting confirmation.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not end the session. Please try again.');
      }
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={booking != null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.handleRow}>
            <Text style={styles.heading}>End session</Text>
            <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close} hitSlop={8}>
              <Icon name="x" size={20} color={colors.ink2} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {/* Proposed payout — updates with the hours stepper. */}
            <View style={styles.payoutCard}>
              <Text style={styles.payoutLabel}>Proposed payout</Text>
              <Text style={styles.payoutValue}>{formatMoney(estimate)}</Text>
              <Text style={styles.payoutSub}>{fmtHours(hours)} · confirmed by the family</Text>
            </View>

            {/* Hours stepper */}
            <Text style={styles.sectionLabel}>Hours worked</Text>
            <View style={styles.stepper}>
              <Pressable
                onPress={dec}
                disabled={hours <= STEP}
                accessibilityLabel="Decrease hours"
                style={[styles.stepBtn, hours <= STEP && styles.stepBtnDisabled]}
              >
                <Icon name="minus" size={18} color={hours <= STEP ? colors.ink3 : colors.ink} />
              </Pressable>
              <View style={styles.stepValue}>
                <Text style={styles.stepValueText}>{fmtHours(hours)}</Text>
                <Text style={styles.stepValueSub}>of {fmtHours(bookedHours)} booked</Text>
              </View>
              <Pressable
                onPress={inc}
                disabled={hours >= bookedHours}
                accessibilityLabel="Increase hours"
                style={[styles.stepBtn, hours >= bookedHours && styles.stepBtnDisabled]}
              >
                <Icon name="plus" size={18} color={hours >= bookedHours ? colors.ink3 : colors.ink} />
              </Pressable>
            </View>

            <View style={styles.infoRow}>
              <Icon name="info" size={14} color={colors.ink3} />
              <Text style={styles.infoText}>
                You&apos;re paid for the hours the family confirms, up to the amount held at booking.
              </Text>
            </View>

            {/* Optional note */}
            <Text style={styles.sectionLabel}>Note for the family (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="How did the session go?"
              placeholderTextColor={colors.ink3}
              multiline
              maxLength={1000}
              style={styles.note}
            />

            {error ? <Text style={styles.err}>{error}</Text> : null}

            <Pressable
              onPress={submit}
              disabled={submitting || !booking}
              style={[styles.submit, (submitting || !booking) && styles.submitDisabled]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.inkInv} />
              ) : (
                <Text style={styles.submitText}>Complete session · {formatMoney(estimate)}</Text>
              )}
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(22,21,19,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
  },
  handle: { width: 40, height: 4, borderRadius: radii.pill, backgroundColor: colors.ink3, alignSelf: 'center', marginTop: 10 },
  handleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  heading: { flex: 1, fontFamily: fonts.bold, fontSize: 20, color: colors.ink },
  close: { padding: 4 },
  body: { padding: 20, paddingTop: 4, gap: 12, paddingBottom: 28 },

  payoutCard: { backgroundColor: colors.ink, borderRadius: radii.lg, padding: 20, alignItems: 'center' },
  payoutLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.inkInv,
    opacity: 0.6,
  },
  payoutValue: { fontFamily: fonts.bold, fontSize: 40, color: colors.inkInv, fontVariant: ['tabular-nums'], marginTop: 4 },
  payoutSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.inkInv, opacity: 0.6, marginTop: 6 },

  sectionLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.ink2,
    marginTop: 6,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: { opacity: 0.5 },
  stepValue: { flex: 1, alignItems: 'center' },
  stepValueText: { fontFamily: fonts.bold, fontSize: 22, color: colors.ink, fontVariant: ['tabular-nums'] },
  stepValueSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },

  infoRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  infoText: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink2 },

  note: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: 14,
    minHeight: 72,
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
