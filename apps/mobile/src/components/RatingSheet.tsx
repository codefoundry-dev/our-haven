/**
 * RatingSheet (OH-214, CONTEXT § Rating) — the two-way rating capture. After a
 * Booking completes, either party may leave a 1–5 star rating (+ optional text)
 * within 14 days; the submission is BLIND (the mutual reveal happens once both
 * sides submit or the window closes). Posts to `POST /v1/bookings/{id}/rating` —
 * the direction (Parent→supply / supply→Parent) is derived server-side from the
 * caller. Shared native + web (RN Modal), mirroring DisputeSheet / NoShowSheet.
 */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { StarInput } from '@/components/ui/StarRating';
import { ApiError, submitBookingRating, type RatingStatus } from '@/api/client';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export interface RatingSheetProps {
  visible: boolean;
  bookingId: string | null;
  /** Who the caller is rating (the counterparty's display name), for the heading. */
  subjectName?: string | null;
  /** 'supply' when a Parent rates a Caregiver/Provider; 'parent' when a supply
   *  member rates the family. Drives the copy + the review-text hint. */
  target: 'supply' | 'parent';
  onClose: () => void;
  onRated: (status: RatingStatus) => void;
}

export function RatingSheet({ visible, bookingId, subjectName, target, onClose, onRated }: RatingSheetProps) {
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const who = subjectName ?? (target === 'supply' ? 'this caregiver' : 'this family');

  const submit = async () => {
    if (!bookingId || stars < 1 || submitting) return;
    const body = { stars, text: text.trim() ? text.trim() : undefined };
    setSubmitting(true);
    setError(null);
    try {
      onRated(await submitBookingRating(bookingId, body));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError('This booking can’t be rated right now — you may have already rated it, or the window has closed.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not submit your rating.');
      }
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.sheet}>
        <View style={styles.handleRow}>
          <Text style={styles.heading}>Leave a rating</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close} hitSlop={8}>
            <Icon name="x" size={20} color={colors.ink2} />
          </Pressable>
        </View>

        <View style={styles.body}>
          <Text style={styles.lead}>How was your experience with {who}?</Text>
          <Text style={styles.note}>
            Ratings are private until you both submit or the 14-day window closes.
          </Text>

          <View style={styles.starsWrap}>
            <StarInput value={stars} onChange={setStars} />
          </View>

          <Text style={styles.label}>Add a review (optional)</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={
              target === 'supply' ? 'What stood out about their care?' : 'How was working with this family?'
            }
            placeholderTextColor={colors.ink3}
            multiline
            maxLength={1000}
            style={styles.input}
          />

          {error ? <Text style={styles.err}>{error}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={submitting || stars < 1}
            style={[styles.submit, (submitting || stars < 1) && styles.submitDisabled]}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color={colors.inkInv} />
            ) : (
              <Text style={styles.submitText}>Submit rating</Text>
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
  lead: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  note: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: colors.ink2 },
  starsWrap: { alignItems: 'center', paddingVertical: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, marginTop: 4 },
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
