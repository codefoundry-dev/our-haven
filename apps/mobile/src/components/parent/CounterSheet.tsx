/**
 * CounterSheet (OH-210) — the Parent's counter-Offer on an Application (PRD story
 * 89). A posted-Job counter negotiates the RATE (and an optional note) only; the
 * schedule is the Parent-set Job schedule and stays fixed (unlike the Direct-
 * Message counter, which may reschedule). Only opens for a negotiable Caregiver
 * (the Counter affordance is hidden otherwise, ADR-0017).
 *
 * Shared by native + web (RN Modal works on RN-web).
 */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import type { ApplicationOffer, CounterApplicationBody } from '@/api/client';
import { formatMoney } from '@/lib/offerCopy';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export interface CounterSheetProps {
  visible: boolean;
  offer: ApplicationOffer | null;
  onClose: () => void;
  onSubmit: (body: CounterApplicationBody) => Promise<void>;
}

export function CounterSheet({ visible, offer, onClose, onSubmit }: CounterSheetProps) {
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState<string | null>(null);

  // Re-seed from the Offer each time the sheet opens for a different Offer.
  if (visible && offer && hydrated !== offer.id) {
    setHydrated(offer.id);
    setRate(String(offer.proposedRateCents / 100));
    setNote('');
    setError(null);
  }
  if (!visible && hydrated !== null) setHydrated(null);

  const rateCents = Math.round((Number(rate) || 0) * 100);
  const hours = offer ? offer.scopeMinutes / 60 : 0;
  const previewBase = Math.round(rateCents * hours);
  const canSubmit = !submitting && rateCents > 0 && offer != null;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: CounterApplicationBody = { proposedRateCents: rateCents };
      if (note.trim()) body.scopeNote = note.trim();
      await onSubmit(body);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your counter-offer.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.sheet}>
        <View style={styles.handleRow}>
          <Text style={styles.heading}>Counter-offer</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close} hitSlop={8}>
            <Icon name="x" size={20} color={colors.ink2} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.lead}>
            Propose a different rate. The dates, children, and address stay the same.
          </Text>

          <Text style={styles.label}>Rate</Text>
          <View style={styles.rateRow}>
            <Text style={styles.dollar}>$</Text>
            <TextInput
              value={rate}
              onChangeText={(v) => setRate(v.replace(/[^\d.]/g, ''))}
              keyboardType="decimal-pad"
              style={styles.rateInput}
              placeholder="0"
              placeholderTextColor={colors.ink3}
            />
            <Text style={styles.perHr}>/ hour</Text>
          </View>

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput
            placeholder="Add a short note…"
            placeholderTextColor={colors.ink3}
            value={note}
            onChangeText={setNote}
            style={[styles.input, styles.note]}
            multiline
            maxLength={280}
          />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Estimated total</Text>
            <Text style={styles.totalValue}>{formatMoney(previewBase)}</Text>
          </View>
          <Text style={styles.finePrint}>Final total (incl. any per-child surcharge) is confirmed on send.</Text>

          {error ? <Text style={styles.err}>{error}</Text> : null}
          <Pressable onPress={submit} disabled={!canSubmit} style={[styles.submit, !canSubmit && styles.submitDisabled]}>
            {submitting ? (
              <ActivityIndicator color={colors.inkInv} />
            ) : (
              <Text style={styles.submitText}>Send counter-offer</Text>
            )}
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
  body: { padding: 20, gap: 10, paddingBottom: 40 },
  lead: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, lineHeight: 20, marginBottom: 4 },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, marginTop: 8 },
  input: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  note: { minHeight: 64, textAlignVertical: 'top' },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  dollar: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink2 },
  rateInput: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: colors.ink, paddingVertical: 11 },
  perHr: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink3 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10 },
  totalLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink2 },
  totalValue: { fontFamily: fonts.bold, fontSize: 22, color: colors.brand },
  finePrint: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink3 },
  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
  submit: {
    backgroundColor: colors.brand,
    borderRadius: radii.lg,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 6,
    ...shadow.e1,
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
});
