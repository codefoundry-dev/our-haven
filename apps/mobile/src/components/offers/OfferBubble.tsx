/**
 * OfferBubble (OH-206) — a structured Offer / Book-request rendered inline in a
 * message thread. Shared across native + web (RN primitives → RN-web). Shows the
 * schedule (a one-off date+window, or a multi-day BUNDLED card "N dates · Xh · $Y"),
 * the child detail, the parent-disclosed Safety-Behaviors subset, the area
 * (exact street address is withheld from the Caregiver until accept — the DTO
 * already projects it), the rate + total, a status chip, and the action pills:
 *   - counterparty + pending → Decline / Counter / Accept (Counter HIDDEN when the
 *     Caregiver is non-negotiable, ADR-0017)
 *   - sender + pending → Edit / Withdraw / Delete (OH-208 — edit + hard-delete are
 *     pre-engagement only; delete removes the bubble entirely)
 *   - sender + accepted → Withdraw (its one exit; cascade-cancels the Booking(s))
 * Driven by `useMessageThread`'s offer actions; presentational only.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import type { Offer } from '@/api/client';
import { SAFETY_BEHAVIOR_OPTIONS } from '@/lib/parent-profile';
import {
  bundledSummary,
  formatHours,
  formatMoney,
  formatOfferDate,
  formatWindow,
  OFFER_COUNTER_TITLE,
  OFFER_STATUS_LABEL,
  OFFER_TITLE,
} from '@/lib/offerCopy';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const BEHAVIOR_LABEL = new Map<string, string>(SAFETY_BEHAVIOR_OPTIONS.map((o) => [o.value, o.label]));

const STATUS_TONE: Record<Offer['status'], string> = {
  pending: colors.brand,
  accepted: colors.success,
  declined: colors.danger,
  countered: colors.warning,
  expired: colors.ink3,
  withdrawn: colors.ink3,
};

const CATEGORY_LABEL: Record<Offer['category'], string> = {
  babysitter: 'Babysitter',
  tutor: 'Tutor',
  nanny: 'Nanny',
};

export interface OfferBubbleProps {
  offer: Offer;
  /** The viewer is the Offer's sender. */
  mine: boolean;
  busy?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  onCounter?: () => void;
  onWithdraw?: () => void;
  /** Sender + pending only: revise the request in place (OH-208). */
  onEdit?: () => void;
  /** Sender + pending only: hard-delete the request (OH-208). */
  onDelete?: () => void;
}

export function OfferBubble({ offer, mine, busy, onAccept, onDecline, onCounter, onWithdraw, onEdit, onDelete }: OfferBubbleProps) {
  const isCounter = offer.supersedesOfferId != null;
  const isMultiDay = offer.scheduleKind === 'multi-day';
  const childLabel =
    offer.childCount === 1
      ? `1 child${offer.childAges[0] != null ? ` · age ${offer.childAges[0]}` : ''}`
      : `${offer.childCount} children · ages ${offer.childAges.join(', ')}`;

  const addr = offer.serviceAddress;
  const area = addr ? [addr.city, addr.state].filter(Boolean).join(', ') : null;
  const exactHidden = addr != null && addr.line1 == null && offer.status !== 'accepted';

  const showCounterparty = offer.status === 'pending' && !mine;
  // Sender-side controls split by state: a pending request is editable + removable
  // (edit / withdraw / delete); an accepted one has only its withdraw exit (OH-208).
  const showSenderPending = offer.status === 'pending' && mine;
  const showSenderAccepted = offer.status === 'accepted' && mine;

  return (
    <View style={[styles.wrap, mine ? styles.wrapMe : styles.wrapThem]}>
      <View style={styles.card}>
        {/* Header */}
        <View style={styles.head}>
          <Icon name="calendar" size={15} color={colors.brand} />
          <Text style={styles.title}>{isCounter ? OFFER_COUNTER_TITLE : OFFER_TITLE}</Text>
          <View style={styles.spacer} />
          <View style={[styles.statusChip, { backgroundColor: `${STATUS_TONE[offer.status]}1A` }]}>
            <Text style={[styles.statusText, { color: STATUS_TONE[offer.status] }]}>
              {OFFER_STATUS_LABEL[offer.status]}
            </Text>
          </View>
        </View>

        {/* Schedule */}
        {isMultiDay ? (
          <View style={styles.block}>
            <Text style={styles.bundle}>
              {bundledSummary(offer.slots.length, offer.scopeMinutes, offer.computedTotalCents)}
            </Text>
            {offer.slots.map((s, i) => (
              <Text key={`${s.date}-${i}`} style={styles.slotLine}>
                {formatOfferDate(s.date)} · {formatWindow(s.startMin, s.endMin)}
              </Text>
            ))}
          </View>
        ) : (
          <View style={styles.block}>
            {offer.slots[0] ? (
              <>
                <Text style={styles.dateLine}>{formatOfferDate(offer.slots[0].date)}</Text>
                <Text style={styles.windowLine}>{formatWindow(offer.slots[0].startMin, offer.slots[0].endMin)}</Text>
              </>
            ) : null}
          </View>
        )}

        {/* Rate + total */}
        <View style={styles.moneyRow}>
          <Text style={styles.rate}>
            {CATEGORY_LABEL[offer.category]} · {formatMoney(offer.proposedRateCents)}/hr
            {offer.negotiable ? '' : ' · fixed'}
          </Text>
          <Text style={styles.total}>{formatMoney(offer.computedTotalCents)}</Text>
        </View>
        {!isMultiDay ? (
          <Text style={styles.totalNote}>{formatHours(offer.scopeMinutes)} total</Text>
        ) : null}

        {/* Child detail */}
        <View style={styles.metaRow}>
          <Icon name="users" size={13} color={colors.ink3} />
          <Text style={styles.meta}>{childLabel}</Text>
        </View>

        {/* Disclosed safety behaviours */}
        <View style={styles.metaRow}>
          <Icon name="shield" size={13} color={colors.ink3} />
          {offer.safetyBehaviors.length > 0 ? (
            <Text style={styles.meta}>
              {offer.safetyBehaviors.map((b) => BEHAVIOR_LABEL.get(b) ?? b).join(', ')}
            </Text>
          ) : (
            <Text style={styles.metaMuted}>No safety behaviours disclosed</Text>
          )}
        </View>

        {/* Service area */}
        {area ? (
          <View style={styles.metaRow}>
            <Icon name="pin" size={13} color={colors.ink3} />
            <Text style={styles.meta}>
              {addr?.line1 ? addr.line1 : area}
              {exactHidden ? ' · exact address shared after you accept' : ''}
            </Text>
          </View>
        ) : null}

        {offer.scopeNote ? <Text style={styles.note}>“{offer.scopeNote}”</Text> : null}

        {/* Actions */}
        {showCounterparty ? (
          <View style={styles.actions}>
            <Pressable
              onPress={onDecline}
              disabled={busy}
              style={({ pressed }) => [styles.pill, styles.pillGhost, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.pillGhostText}>Decline</Text>
            </Pressable>
            {offer.negotiable ? (
              <Pressable
                onPress={onCounter}
                disabled={busy}
                style={({ pressed }) => [styles.pill, styles.pillOutline, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.pillOutlineText}>Counter</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onAccept}
              disabled={busy}
              style={({ pressed }) => [styles.pill, styles.pillFill, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.pillFillText}>Accept</Text>
            </Pressable>
          </View>
        ) : showSenderPending ? (
          <View style={styles.actions}>
            <Pressable
              onPress={onDelete}
              disabled={busy}
              style={({ pressed }) => [styles.pill, styles.pillGhost, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.pillDangerText}>Delete</Text>
            </Pressable>
            <Pressable
              onPress={onWithdraw}
              disabled={busy}
              style={({ pressed }) => [styles.pill, styles.pillGhost, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.pillGhostText}>Withdraw</Text>
            </Pressable>
            <Pressable
              onPress={onEdit}
              disabled={busy}
              style={({ pressed }) => [styles.pill, styles.pillOutline, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.pillOutlineText}>Edit</Text>
            </Pressable>
          </View>
        ) : showSenderAccepted ? (
          <View style={styles.actions}>
            <Pressable
              onPress={onWithdraw}
              disabled={busy}
              style={({ pressed }) => [styles.pill, styles.pillGhost, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.pillGhostText}>Withdraw</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { maxWidth: '92%' },
  wrapMe: { alignSelf: 'flex-end' },
  wrapThem: { alignSelf: 'flex-start' },
  card: {
    minWidth: 240,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.brandSoft,
    padding: 14,
    gap: 8,
    ...shadow.e1,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, letterSpacing: 0.2 },
  spacer: { flex: 1 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill },
  statusText: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.3 },

  block: { gap: 2 },
  bundle: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  slotLine: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  dateLine: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  windowLine: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },

  moneyRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  rate: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2, flex: 1 },
  total: { fontFamily: fonts.bold, fontSize: 18, color: colors.brand },
  totalNote: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3, textAlign: 'right', marginTop: -4 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, flex: 1 },
  metaMuted: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3, flex: 1 },
  note: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, fontStyle: 'italic', marginTop: 2 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  pillFill: { backgroundColor: colors.brand },
  pillFillText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },
  pillOutline: { borderWidth: 1, borderColor: colors.brand },
  pillOutlineText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brand },
  pillGhost: { backgroundColor: colors.surfaceAlt },
  pillGhostText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },
  pillDangerText: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
});
