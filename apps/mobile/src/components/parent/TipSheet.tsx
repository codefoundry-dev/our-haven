/**
 * TipSheet (OH-215, ADR-0018; CONTEXT § Tip) — the Parent's post-session
 * gratuity on a completed Caregiver Booking. Offered right after rating (the
 * natural "how did it go?" moment) and reachable again from the Booking detail
 * (`Add a tip` / `Edit tip`). 100% goes to the Caregiver — no Commission, no
 * fees. The tip stays editable for ~24h after the last change (a card hold);
 * "Remove tip" files `amountCents: 0`, which clears it. If Stripe raises a 3DS
 * challenge the client completes it via the Stripe SDK before surfacing success.
 * Shared native + web (RN Modal), mirroring AdjustTimeSheet / RatingSheet.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { ApiError, setBookingTip, type BookingDetail } from '@/api/client';
import { formatMoney } from '@/lib/offerCopy';
import { usePaymentAuthenticator } from '@/lib/stripeClient';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export interface TipSheetProps {
  visible: boolean;
  booking: BookingDetail | null;
  onClose: () => void;
  /** Fired after the tip is set / edited / removed (the caller reloads the detail). */
  onSaved: () => void;
}

const PRESETS_CENTS = [500, 1000, 1500, 2000];
const STEP_CENTS = 100;
const MIN_CENTS = 100;
const MAX_CENTS = 50_000;

export function TipSheet({ visible, booking, onClose, onSaved }: TipSheetProps) {
  const { authenticate } = usePaymentAuthenticator();
  const existing = booking?.tip ?? null;
  const [amount, setAmount] = useState(existing?.amountCents ?? PRESETS_CENTS[1]!);
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the live tip each time the sheet opens.
  useEffect(() => {
    if (visible) {
      setAmount(booking?.tip?.amountCents ?? PRESETS_CENTS[1]!);
      setError(null);
      setSubmitting(false);
      setRemoving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, booking?.id]);

  if (!booking) return null;

  const editing = existing != null;
  const who = booking.counterpartyName ?? 'your caregiver';
  const busy = submitting || removing;

  const dec = () => setAmount((a) => Math.max(MIN_CENTS, a - STEP_CENTS));
  const inc = () => setAmount((a) => Math.min(MAX_CENTS, a + STEP_CENTS));

  const mapError = (e: unknown): string => {
    if (e instanceof ApiError && e.code === 'caregiver_payout_unavailable') {
      return 'This caregiver hasn’t finished setting up payouts, so tips can’t be sent right now.';
    }
    if (e instanceof ApiError && e.code === 'payment_method_required') {
      return 'Add a payment method to your account before tipping.';
    }
    if (e instanceof ApiError && e.code === 'tip_settled') {
      return 'This tip has already been paid out and can no longer be changed.';
    }
    if (e instanceof ApiError && e.status === 402) {
      return 'Your card was declined. Update your payment method and try again.';
    }
    return e instanceof ApiError ? e.message : 'Could not update the tip.';
  };

  const save = async (amountCents: number, markBusy: (b: boolean) => void) => {
    if (busy) return;
    markBusy(true);
    setError(null);
    try {
      const result = await setBookingTip(booking.id, { amountCents });
      // Opportunistic 3DS on the tip hold (same as Award / extend).
      if (result.tip?.status === 'requires_action' && result.clientSecret) {
        const auth = await authenticate(result.clientSecret);
        if (!auth.ok) {
          setError(auth.error ?? 'We couldn’t confirm your card. Please try again.');
          markBusy(false);
          return;
        }
      }
      onSaved();
    } catch (e) {
      setError(mapError(e));
      markBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.sheet}>
        <View style={styles.handleRow}>
          <Text style={styles.heading}>{editing ? 'Edit tip' : 'Add a tip'}</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close} hitSlop={8}>
            <Icon name="x" size={20} color={colors.ink2} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.lead}>
            {editing ? `Change your tip for ${who}.` : `Say thanks with a tip for ${who}.`}
          </Text>
          <Text style={styles.note}>100% goes to {who} — Our Haven takes nothing.</Text>

          {/* Custom $1 stepper */}
          <View style={styles.stepperCard}>
            <Pressable
              onPress={dec}
              disabled={amount <= MIN_CENTS}
              accessibilityLabel="Less"
              style={[styles.stepBtn, amount <= MIN_CENTS && styles.stepBtnDisabled]}
            >
              <Icon name="minus" size={20} color={colors.ink} />
            </Pressable>
            <View style={styles.stepValue}>
              <Text style={styles.stepAmount}>{formatMoney(amount)}</Text>
            </View>
            <Pressable
              onPress={inc}
              disabled={amount >= MAX_CENTS}
              accessibilityLabel="More"
              style={[styles.stepBtn, amount >= MAX_CENTS && styles.stepBtnDisabled]}
            >
              <Icon name="plus" size={20} color={colors.ink} />
            </Pressable>
          </View>

          {/* Amount presets */}
          <View style={styles.presetRow}>
            {PRESETS_CENTS.map((cents) => {
              const active = amount === cents;
              return (
                <Pressable
                  key={cents}
                  onPress={() => setAmount(cents)}
                  accessibilityRole="button"
                  style={[styles.preset, active && styles.presetActive]}
                >
                  <Text style={[styles.presetText, active && styles.presetTextActive]}>
                    {formatMoney(cents)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.note}>
            You can edit or remove the tip for about 24 hours after setting it; then it’s paid out in
            full. Tipping is always optional.
          </Text>

          {error ? <Text style={styles.err}>{error}</Text> : null}

          <Pressable
            onPress={() => void save(amount, setSubmitting)}
            disabled={busy}
            style={[styles.submit, busy && styles.submitDisabled]}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color={colors.inkInv} />
            ) : (
              <Text style={styles.submitText}>
                {editing ? `Update tip to ${formatMoney(amount)}` : `Tip ${formatMoney(amount)}`}
              </Text>
            )}
          </Pressable>

          {editing ? (
            <Pressable
              onPress={() => void save(0, setRemoving)}
              disabled={busy}
              style={styles.remove}
              accessibilityRole="button"
            >
              <Text style={styles.removeText}>{removing ? 'Removing…' : 'Remove tip'}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={onClose} style={styles.remove} disabled={busy}>
              <Text style={styles.skipText}>Not this time</Text>
            </Pressable>
          )}
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
  lead: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, color: colors.ink },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },

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
  stepAmount: { fontFamily: fonts.bold, fontSize: 30, color: colors.ink, fontVariant: ['tabular-nums'] },

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
  remove: { paddingVertical: 12, alignItems: 'center' },
  removeText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.danger },
  skipText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink2 },
});
