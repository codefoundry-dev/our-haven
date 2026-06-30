/**
 * OfferCounterSheet (OH-206) — the lighter form for countering an Offer (story
 * 105): it revises only the rate, schedule, and note; the child detail, category,
 * disclosure, and address are INHERITED from the superseded Offer (the server
 * carries them forward). Pre-filled from the Offer being countered. Either party
 * may counter — but only when the Caregiver is negotiable (the Counter affordance
 * is hidden otherwise, ADR-0017, so this sheet never opens for a fixed-price one).
 */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import type { CounterOfferBody, Offer } from '@/api/client';
import { formatMoney, formatTimeOfDay } from '@/lib/offerCopy';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

interface SlotDraft {
  date: string;
  start: string;
  end: string;
}

export interface OfferCounterSheetProps {
  visible: boolean;
  offer: Offer | null;
  onClose: () => void;
  onSubmit: (body: CounterOfferBody) => Promise<void>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseClock(input: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])\s*$/.exec(input);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const pm = m[3]!.toLowerCase() === 'pm';
  if (h < 1 || h > 12 || min < 0 || min > 59) return null;
  if (h === 12) h = 0;
  if (pm) h += 12;
  return h * 60 + min;
}

function slotsFromOffer(offer: Offer | null): SlotDraft[] {
  if (!offer || offer.slots.length === 0) return [{ date: '', start: '', end: '' }];
  return offer.slots.map((s) => ({ date: s.date, start: formatTimeOfDay(s.startMin), end: formatTimeOfDay(s.endMin) }));
}

export function OfferCounterSheet({ visible, offer, onClose, onSubmit }: OfferCounterSheetProps) {
  const [rate, setRate] = useState('');
  const [slots, setSlots] = useState<SlotDraft[]>(slotsFromOffer(offer));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState<string | null>(null);

  // Re-seed from the Offer each time the sheet opens for a different Offer.
  if (visible && offer && hydrated !== offer.id) {
    setHydrated(offer.id);
    setRate(String(offer.proposedRateCents / 100));
    setSlots(slotsFromOffer(offer));
    setNote('');
    setError(null);
  }
  if (!visible && hydrated !== null) setHydrated(null);

  const rateCents = Math.round((Number(rate) || 0) * 100);
  const slotsValid =
    slots.length > 0 &&
    slots.every((s) => {
      const a = parseClock(s.start);
      const b = parseClock(s.end);
      return DATE_RE.test(s.date) && a != null && b != null && b > a;
    });
  const totalMinutes = slots.reduce((sum, s) => {
    const a = parseClock(s.start);
    const b = parseClock(s.end);
    return a != null && b != null && b > a ? sum + (b - a) : sum;
  }, 0);
  const previewTotal = Math.round((rateCents * totalMinutes) / 60);
  const canSubmit = !submitting && rateCents > 0 && slotsValid;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const parsed = slots.map((s) => ({ date: s.date, startMin: parseClock(s.start)!, endMin: parseClock(s.end)! }));
      const schedule: CounterOfferBody['schedule'] =
        parsed.length === 1 ? { kind: 'one-off', slot: parsed[0]! } : { kind: 'multi-day', slots: parsed };
      const body: CounterOfferBody = { proposedRateCents: rateCents, schedule };
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
          <Text style={styles.lead}>Revise the rate or time. The children and address stay the same.</Text>

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

          <Text style={styles.label}>{slots.length > 1 ? 'Dates' : 'Date & time'}</Text>
          {slots.map((s, i) => (
            <View key={i} style={styles.slotCard}>
              <TextInput
                placeholder="Date (YYYY-MM-DD)"
                placeholderTextColor={colors.ink3}
                value={s.date}
                onChangeText={(v) => setSlots((p) => p.map((x, j) => (j === i ? { ...x, date: v } : x)))}
                style={styles.input}
              />
              <View style={styles.timeRow}>
                <TextInput
                  placeholder="Start (6:00 PM)"
                  placeholderTextColor={colors.ink3}
                  value={s.start}
                  onChangeText={(v) => setSlots((p) => p.map((x, j) => (j === i ? { ...x, start: v } : x)))}
                  style={[styles.input, styles.timeInput]}
                />
                <TextInput
                  placeholder="End (9:00 PM)"
                  placeholderTextColor={colors.ink3}
                  value={s.end}
                  onChangeText={(v) => setSlots((p) => p.map((x, j) => (j === i ? { ...x, end: v } : x)))}
                  style={[styles.input, styles.timeInput]}
                />
              </View>
            </View>
          ))}

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
            <Text style={styles.totalValue}>{formatMoney(previewTotal)}</Text>
          </View>
          {error ? <Text style={styles.err}>{error}</Text> : null}
          <Pressable onPress={submit} disabled={!canSubmit} style={[styles.submit, !canSubmit && styles.submitDisabled]}>
            {submitting ? <ActivityIndicator color={colors.inkInv} /> : <Text style={styles.submitText}>Send counter-offer</Text>}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.canvas },
  handleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  heading: { flex: 1, fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  close: { padding: 4 },
  body: { padding: 20, gap: 10, paddingBottom: 40 },
  lead: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, lineHeight: 20, marginBottom: 4 },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, marginTop: 8 },
  input: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 11 },
  slotCard: { backgroundColor: colors.surfaceAlt, borderRadius: radii.md, padding: 12, gap: 8 },
  timeRow: { flexDirection: 'row', gap: 8 },
  timeInput: { flex: 1 },
  note: { minHeight: 64, textAlignVertical: 'top' },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 4 },
  dollar: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink2 },
  rateInput: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: colors.ink, paddingVertical: 11 },
  perHr: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink3 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10 },
  totalLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink2 },
  totalValue: { fontFamily: fonts.bold, fontSize: 22, color: colors.brand },
  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
  submit: { backgroundColor: colors.brand, borderRadius: radii.lg, paddingVertical: 15, alignItems: 'center', marginTop: 6, ...shadow.e1 },
  submitDisabled: { opacity: 0.4 },
  submitText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
});
