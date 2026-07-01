/**
 * ParentBookingDetailWeb — the Parent's single-booking detail on desktop web.
 * Content-only: the dispatcher wraps this in <ParentWebShell active="bookings">.
 *
 * OH-211 made this LIVE (was a static scaffold ported from parent-web/pw-bookings):
 * it reads `?bookingId=`, fetches `GET /v1/bookings/{id}` via the shared
 * `useBookingDetail` hook, and drives the two-column layout + the payment-aware
 * actions (Cancel with the M2.5 preview, Confirm hours, Report an issue) from the
 * real booking — the same behaviour as the native `@/screens/parent/BookingDetail`.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { WebPageHeader } from '@/components/web/ParentWebShell';
import { Card } from '@/components/ui/Card';
import { CategoryChip, type Category } from '@/components/ui/CategoryChip';
import { Portrait } from '@/components/ui/PhotoPlaceholder';
import { PricingSummary } from '@/components/ui/PricingSummary';
import { StatusPill } from '@/components/ui/StatusPill';
import { CancelSheet } from '@/components/parent/CancelSheet';
import { DisputeSheet } from '@/components/parent/DisputeSheet';
import { AdjustTimeSheet } from '@/components/parent/AdjustTimeSheet';
import { ApiError, confirmBookingHours, rescindReduceRequest } from '@/api/client';
import { formatMoney } from '@/lib/offerCopy';
import {
  bookingActionsFor,
  durationHours,
  formatBookingDate,
  formatTimeRange,
  paymentLabel,
  useBookingDetail,
} from '@/lib/bookingView';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const CATEGORY_LABEL: Record<string, Category> = { babysitter: 'Babysitter', tutor: 'Tutor', nanny: 'Nanny' };

export function ParentBookingDetailWeb() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bookingId?: string }>();
  const bookingId = typeof params.bookingId === 'string' ? params.bookingId : null;
  const { booking, loading, error, reload } = useBookingDetail(bookingId);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const confirmHours = async () => {
    if (!bookingId || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await confirmBookingHours(bookingId);
      await reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not confirm the hours.');
    } finally {
      setBusy(false);
    }
  };

  const rescindShorten = async () => {
    if (!bookingId || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await rescindReduceRequest(bookingId);
      await reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not withdraw the request.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (error || !booking) {
    return (
      <View>
        <WebPageHeader greet="Family · Bookings" title="Booking detail" actions={['bell']} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>{error ?? 'Booking not found.'}</Text>
        </View>
      </View>
    );
  }

  const actions = bookingActionsFor(booking);
  const hours = durationHours(booking.startMin, booking.endMin);
  const rateCents = booking.agreedRateCents ?? 0;
  const totalCents = booking.computedTotalCents ?? booking.authorizedAmountCents ?? 0;
  const catLabel = booking.category ? CATEGORY_LABEL[booking.category] : null;
  const title = booking.counterpartyName
    ? `${catLabel ?? 'Care'} with ${booking.counterpartyName}`
    : (catLabel ?? 'Booking');
  const surcharge = totalCents - rateCents * hours;

  return (
    <View>
      <WebPageHeader greet="Family · Bookings" title={title} actions={['calendar', 'bell']} />

      <View style={styles.body}>
        <View style={styles.layout}>
          {/* ── left · the booking ─────────────────────────────────── */}
          <View style={styles.mainCol}>
            <Card radius={radii.xl} padding={26} style={styles.bookingCard}>
              <View style={styles.idRow}>
                <Text style={styles.bookingId}>{`OH-B-${booking.id.slice(0, 6).toUpperCase()}`}</Text>
                <StatusPill state={booking.state} />
              </View>

              <View style={styles.hero}>
                <Portrait height={200} tint={colors.catTutor} label={booking.counterpartyName ?? 'caregiver'} radius={radii.xl} />
                {catLabel ? <CategoryChip category={catLabel} style={styles.heroChip} /> : null}
              </View>

              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>
                {formatBookingDate(booking.scheduledDate)} · {formatTimeRange(booking.startMin, booking.endMin)}
              </Text>

              {/* date / time band */}
              <View style={styles.band}>
                <View style={[styles.bandCard, { backgroundColor: colors.catNanny }]}>
                  <View style={styles.bandHead}>
                    <Text style={styles.bandHeadText}>Date</Text>
                    <Icon name="calendar" size={16} color={colors.ink} />
                  </View>
                  <Text style={styles.bandValue}>{formatBookingDate(booking.scheduledDate)}</Text>
                </View>
                <View style={[styles.bandCard, { backgroundColor: colors.highlight }]}>
                  <View style={styles.bandHead}>
                    <Text style={styles.bandHeadText}>Time</Text>
                    <Icon name="clock" size={16} color={colors.ink} />
                  </View>
                  <Text style={[styles.bandValue, styles.bandNum]}>{formatTimeRange(booking.startMin, booking.endMin)}</Text>
                  <Text style={styles.bandMeta}>{hours}h</Text>
                </View>
                {booking.childCount != null ? (
                  <View style={[styles.bandCard, styles.bandCardSurface]}>
                    <Text style={styles.bandEyebrow}>Children</Text>
                    <Text style={styles.childText}>
                      {booking.childCount} {booking.childCount === 1 ? 'child' : 'children'}
                      {booking.childAges.length ? ` · ages ${booking.childAges.join(', ')}` : ''}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* pricing */}
              <View style={styles.priceCard}>
                <Text style={styles.priceEyebrow}>Pricing</Text>
                <PricingSummary
                  lines={[
                    { label: `Rate · ${hours}h`, value: formatMoney(rateCents * hours || 0), muted: true },
                    ...(surcharge > 0
                      ? [{ label: 'Per-child surcharge', value: formatMoney(surcharge), muted: true }]
                      : []),
                  ]}
                  total={{ label: 'Total', value: formatMoney(totalCents) }}
                />
              </View>

              {actionError ? <Text style={styles.err}>{actionError}</Text> : null}

              {/* actions */}
              <View style={styles.actions}>
                <Pressable
                  onPress={() => router.push('/message-thread' as never)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.9 : 1 }]}
                >
                  <Icon name="message" size={17} color={colors.ink} />
                  <Text style={styles.secondaryText}>Message</Text>
                </Pressable>
                {actions.canConfirm ? (
                  <Pressable
                    onPress={confirmHours}
                    disabled={busy}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || busy ? 0.92 : 1 }]}
                  >
                    <Icon name="check" size={16} color={colors.inkInv} />
                    <Text style={styles.primaryText}>{busy ? 'Confirming…' : 'Confirm hours'}</Text>
                  </Pressable>
                ) : actions.canCancel ? (
                  <Pressable
                    onPress={() => setCancelOpen(true)}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.9 : 1 }]}
                  >
                    <Text style={styles.cancelText}>Cancel booking</Text>
                  </Pressable>
                ) : null}
              </View>
            </Card>
          </View>

          {/* ── right · payment + manage ───────────────────────────── */}
          <View style={styles.sideCol}>
            <Card radius={radii.xl} padding={22} style={styles.sideCard}>
              <Text style={styles.secHead}>Payment</Text>
              <Text style={styles.payLabel}>{paymentLabel(booking.paymentStatus)}</Text>
              <Text style={styles.payNote}>
                {booking.paymentStatus === 'captured'
                  ? 'Charged after the session completed.'
                  : 'You’re charged only after the session completes.'}
              </Text>
            </Card>

            {actions.hasPendingTimeChange && booking.pendingTimeChange ? (
              <Card radius={radii.xl} padding={20} style={styles.pendingCard}>
                <View style={styles.pendingHead}>
                  <Icon name="clock" size={16} color={colors.ink} />
                  <Text style={styles.pendingTitle}>Shorten request pending</Text>
                </View>
                <Text style={styles.pendingText}>
                  You asked to change this to {booking.pendingTimeChange.proposedDurationHours}h. Waiting for the
                  caregiver to approve — nothing changes until they do.
                </Text>
                <Pressable
                  onPress={rescindShorten}
                  disabled={busy}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.pendingBtn, { opacity: pressed || busy ? 0.85 : 1 }]}
                >
                  <Text style={styles.pendingBtnText}>{busy ? 'Withdrawing…' : 'Withdraw request'}</Text>
                </Pressable>
              </Card>
            ) : null}

            {actions.canAdjustTime ? (
              <Card radius={radii.xl} padding={6} style={styles.sideCard}>
                <Pressable
                  onPress={() => setAdjustOpen(true)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.manageRow, { opacity: pressed ? 0.85 : 1 }]}
                >
                  <View style={styles.manageIcon}>
                    <Icon name="clock" size={17} color={colors.ink} />
                  </View>
                  <View style={styles.manageText}>
                    <Text style={styles.manageLabel}>Adjust time</Text>
                    <Text style={styles.manageSub}>Add hours now, or request a shorter session</Text>
                  </View>
                  <Icon name="chevron-right" size={16} color={colors.ink3} />
                </Pressable>
              </Card>
            ) : null}

            {actions.canDispute ? (
              <Card radius={radii.xl} padding={6} style={styles.sideCard}>
                <Pressable
                  onPress={() => setDisputeOpen(true)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.manageRow, { opacity: pressed ? 0.85 : 1 }]}
                >
                  <View style={styles.manageIcon}>
                    <Icon name="shield" size={17} color={colors.ink} />
                  </View>
                  <View style={styles.manageText}>
                    <Text style={styles.manageLabel}>Report an issue</Text>
                    <Text style={styles.manageSub}>Dispute a charge or flag a problem</Text>
                  </View>
                  <Icon name="chevron-right" size={16} color={colors.ink3} />
                </Pressable>
              </Card>
            ) : null}

            <View style={styles.note}>
              <Icon name="info" size={18} color={colors.brand} />
              <Text style={styles.noteText}>
                Confirming releases the agreed amount to the caregiver. If no dispute is filed within ~24 hours of the
                session, it auto-confirms.
              </Text>
            </View>
          </View>
        </View>
      </View>

      <CancelSheet
        visible={cancelOpen}
        bookingId={bookingId}
        caregiver={booking.kind === 'caregiver'}
        onClose={() => setCancelOpen(false)}
        onCancelled={() => {
          setCancelOpen(false);
          void reload();
        }}
      />
      <DisputeSheet
        visible={disputeOpen}
        bookingId={bookingId}
        onClose={() => setDisputeOpen(false)}
        onDisputed={() => {
          setDisputeOpen(false);
          void reload();
        }}
      />
      <AdjustTimeSheet
        visible={adjustOpen}
        booking={booking}
        onClose={() => setAdjustOpen(false)}
        onAdjusted={() => {
          setAdjustOpen(false);
          void reload();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  center: { minHeight: 320, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { fontFamily: fonts.regular, fontSize: 15, color: colors.ink2, textAlign: 'center' },

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  mainCol: { flexGrow: 1.6, flexBasis: 560, minWidth: 360 },
  sideCol: { flexGrow: 1, flexBasis: 320, minWidth: 280, gap: 16 },

  bookingCard: { ...shadow.e1 },
  idRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 },
  bookingId: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink3 },

  hero: { borderRadius: radii.xl, overflow: 'hidden' },
  heroChip: { position: 'absolute', top: 14, left: 14 },
  title: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.6, color: colors.ink, marginTop: 20 },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, marginTop: 6 },

  band: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 22 },
  bandCard: { flexGrow: 1, flexBasis: 150, minWidth: 140, borderRadius: radii.lg, padding: 16 },
  bandCardSurface: { backgroundColor: colors.surfaceAlt },
  bandHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bandHeadText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  bandValue: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, marginTop: 14 },
  bandNum: { fontSize: 16, fontVariant: ['tabular-nums'] },
  bandMeta: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink, opacity: 0.7, marginTop: 6 },
  bandEyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  childText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink, marginTop: 12 },

  priceCard: { marginTop: 18, backgroundColor: colors.surfaceAlt, borderRadius: radii.lg, padding: 20, maxWidth: 440 },
  priceEyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 12 },

  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 14 },

  actions: { flexDirection: 'row', gap: 12, marginTop: 22, maxWidth: 480 },
  secondaryBtn: { flexGrow: 1, flexBasis: 160, height: 52, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  primaryBtn: { flexGrow: 1.3, flexBasis: 180, height: 52, borderRadius: radii.pill, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
  cancelBtn: { flexGrow: 1.3, flexBasis: 180, height: 52, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.danger, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.danger },

  sideCard: { ...shadow.e1 },
  secHead: { fontFamily: fonts.bold, fontSize: 11.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 12 },
  payLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  payNote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2, marginTop: 4 },

  pendingCard: { backgroundColor: colors.highlight, gap: 8, ...shadow.e1 },
  pendingHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendingTitle: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink },
  pendingText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },
  pendingBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  pendingBtnText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },

  manageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12 },
  manageIcon: { width: 36, height: 36, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  manageText: { flex: 1, minWidth: 0 },
  manageLabel: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink },
  manageSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 1 },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },
});
