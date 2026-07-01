/**
 * Booking detail (Parent — native + narrow web). OH-211 made this LIVE: it reads
 * `?bookingId=` from the route, fetches `GET /v1/bookings/{id}`, and renders the
 * real payment lifecycle + schedule + (reveal-at-accept) address, with
 * state-dependent actions — Cancel (M2.5 preview via CancelSheet), Confirm hours
 * (capture + payout inside the ~24h review window), and Report an issue (dispute).
 *
 * The desktop layout lives in `@/screens/web/parent/BookingDetail`
 * (`ParentBookingDetailWeb`) and is chosen by `booking-detail.web.tsx` on wide web.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { AppBar } from '@/components/AppBar';
import { Screen } from '@/components/Screen';
import { CategoryChip, type Category } from '@/components/ui/CategoryChip';
import { Portrait } from '@/components/ui/PhotoPlaceholder';
import { PricingSummary } from '@/components/ui/PricingSummary';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { StatusPill } from '@/components/ui/StatusPill';
import { CancelSheet } from '@/components/parent/CancelSheet';
import { DisputeSheet } from '@/components/parent/DisputeSheet';
import { NoShowSheet } from '@/components/parent/NoShowSheet';
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

export default function BookingDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bookingId?: string }>();
  const bookingId = typeof params.bookingId === 'string' ? params.bookingId : null;
  const { booking, loading, error, reload } = useBookingDetail(bookingId);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [noShowOpen, setNoShowOpen] = useState(false);
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
      <Screen edges={['top']} contentStyle={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </Screen>
    );
  }
  if (error || !booking) {
    return (
      <Screen edges={['top']} contentStyle={styles.content}>
        <AppBar title="Booking detail" onBack={() => router.back()} style={styles.appBar} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>{error ?? 'Booking not found.'}</Text>
        </View>
      </Screen>
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

  return (
    <Screen edges={['top']} contentStyle={styles.content}>
      <AppBar title="Booking detail" onBack={() => router.back()} style={styles.appBar} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Portrait height={180} tint={colors.catTutor} label={booking.counterpartyName ?? 'caregiver'} radius={28} />
          {catLabel ? <CategoryChip category={catLabel} style={styles.heroChip} /> : null}
        </View>

        <Text style={styles.title}>{title}</Text>

        <View style={styles.card}>
          <View style={styles.idRow}>
            <Text style={styles.bookingId}>{`OH-B-${booking.id.slice(0, 6).toUpperCase()}`}</Text>
            <StatusPill state={booking.state} />
          </View>

          <View style={styles.dayRow}>
            <View style={[styles.dayCard, { backgroundColor: colors.catNanny }]}>
              <View style={styles.dayHead}>
                <Text style={styles.dayHeadText}>Date</Text>
                <Icon name="calendar" size={16} color={colors.ink} />
              </View>
              <Text style={styles.dayDate}>{formatBookingDate(booking.scheduledDate)}</Text>
            </View>
            <View style={[styles.dayCard, { backgroundColor: colors.highlight }]}>
              <View style={styles.dayHead}>
                <Text style={styles.dayHeadText}>Time</Text>
                <Icon name="clock" size={16} color={colors.ink} />
              </View>
              <Text style={styles.dayTime}>{formatTimeRange(booking.startMin, booking.endMin)}</Text>
              <Text style={styles.dayMetaText}>{hours}h</Text>
            </View>
          </View>

          {booking.childCount != null ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.eyebrow}>Children on booking</Text>
              <Text style={styles.childText}>
                {booking.childCount} {booking.childCount === 1 ? 'child' : 'children'}
                {booking.childAges.length ? ` · ages ${booking.childAges.join(', ')}` : ''}
              </Text>
            </>
          ) : null}

          {booking.serviceAddress?.line1 ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.eyebrow}>Address</Text>
              <Text style={styles.childText}>
                {[booking.serviceAddress.line1, booking.serviceAddress.city, booking.serviceAddress.state]
                  .filter(Boolean)
                  .join(', ')}
              </Text>
            </>
          ) : null}

          <View style={styles.divider} />
          <PricingSummary
            lines={[
              { label: `Rate · ${hours}h`, value: formatMoney(rateCents * hours || 0), muted: true },
              ...(totalCents - rateCents * hours > 0
                ? [{ label: 'Per-child surcharge', value: formatMoney(totalCents - rateCents * hours), muted: true }]
                : []),
            ]}
            total={{ label: 'Total', value: formatMoney(totalCents) }}
          />
        </View>

        {/* Payment status */}
        <View style={styles.payCard}>
          <View style={styles.payIcon}>
            <Icon name="dollar" size={16} color={colors.ink} />
          </View>
          <View style={styles.flexMin}>
            <Text style={styles.payLabel}>{paymentLabel(booking.paymentStatus)}</Text>
            <Text style={styles.payNote}>
              {booking.paymentStatus === 'captured'
                ? 'Charged after the session completed.'
                : booking.paymentStatus === 'requires_action'
                  ? 'Your card needs confirmation to complete the hold.'
                  : 'You’re charged only after the session completes.'}
            </Text>
          </View>
        </View>

        {actions.hasPendingTimeChange && booking.pendingTimeChange ? (
          <View style={styles.pendingCard}>
            <View style={styles.pendingHead}>
              <Icon name="clock" size={16} color={colors.ink} />
              <Text style={styles.pendingTitle}>Shorten request pending</Text>
            </View>
            <Text style={styles.pendingText}>
              You asked to change this to {booking.pendingTimeChange.proposedDurationHours}h. Waiting for the
              caregiver to approve — nothing changes until they do.
            </Text>
            <Pressable onPress={rescindShorten} disabled={busy} accessibilityRole="button" style={styles.pendingBtn}>
              <Text style={styles.pendingBtnText}>{busy ? 'Withdrawing…' : 'Withdraw request'}</Text>
            </Pressable>
          </View>
        ) : null}

        {actions.canAdjustTime ? (
          <Pressable style={styles.manageRow} onPress={() => setAdjustOpen(true)} accessibilityRole="button">
            <View style={styles.manageIcon}>
              <Icon name="clock" size={17} color={colors.ink} />
            </View>
            <View style={styles.manageText}>
              <Text style={styles.manageLabel}>Adjust time</Text>
              <Text style={styles.manageSub}>Add hours now, or request a shorter session</Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.ink3} />
          </Pressable>
        ) : null}

        {actionError ? <Text style={styles.err}>{actionError}</Text> : null}

        {actions.canReportNoShow ? (
          <Pressable style={styles.manageRow} onPress={() => setNoShowOpen(true)} accessibilityRole="button">
            <View style={styles.manageIcon}>
              <Icon name="flag" size={17} color={colors.ink} />
            </View>
            <View style={styles.manageText}>
              <Text style={styles.manageLabel}>Report a no-show</Text>
              <Text style={styles.manageSub}>
                {booking.kind === 'caregiver' ? 'Get a full refund if they didn’t turn up' : 'Flag that they didn’t turn up'}
              </Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.ink3} />
          </Pressable>
        ) : null}

        {actions.canDispute ? (
          <Pressable style={styles.manageRow} onPress={() => setDisputeOpen(true)} accessibilityRole="button">
            <View style={styles.manageIcon}>
              <Icon name="shield" size={17} color={colors.ink} />
            </View>
            <View style={styles.manageText}>
              <Text style={styles.manageLabel}>Report an issue</Text>
              <Text style={styles.manageSub}>Dispute a charge or flag a problem</Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.ink3} />
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={() => router.push('/message-thread')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.9 : 1 }]}
        >
          <Text style={styles.secondaryText}>Message</Text>
        </Pressable>
        {actions.canConfirm ? (
          <PrimaryButton onPress={confirmHours} style={styles.primaryBtn} disabled={busy}>
            {busy ? 'Confirming…' : 'Confirm hours'}
          </PrimaryButton>
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
        hideNoShowReason={actions.canReportNoShow}
        onClose={() => setDisputeOpen(false)}
        onDisputed={() => {
          setDisputeOpen(false);
          void reload();
        }}
      />
      <NoShowSheet
        visible={noShowOpen}
        bookingId={bookingId}
        caregiver={booking.kind === 'caregiver'}
        counterpartyName={booking.counterpartyName}
        onClose={() => setNoShowOpen(false)}
        onReported={() => {
          setNoShowOpen(false);
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { fontFamily: fonts.regular, fontSize: 15, color: colors.ink2, textAlign: 'center' },
  appBar: { paddingHorizontal: 24 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 28 },
  flexMin: { flex: 1, minWidth: 0 },

  hero: { borderRadius: 28, overflow: 'hidden' },
  heroChip: { position: 'absolute', top: 12, left: 12 },
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, color: colors.ink, marginTop: 20, marginBottom: 12 },

  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, marginBottom: 12, ...shadow.e1 },
  idRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  bookingId: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink3 },

  dayRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  dayCard: { flex: 1, borderRadius: radii.lg, padding: 14 },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayHeadText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  dayDate: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, marginTop: 14 },
  dayTime: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink, marginTop: 14, fontVariant: ['tabular-nums'] },
  dayMetaText: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink, opacity: 0.7, marginTop: 8 },

  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: 16 },
  eyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  childText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink, marginTop: 8 },

  payCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 14,
    marginBottom: 12,
    ...shadow.e1,
  },
  payIcon: { width: 36, height: 36, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  payLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  payNote: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, color: colors.ink2, marginTop: 2 },

  pendingCard: {
    backgroundColor: colors.highlight,
    borderRadius: radii.lg,
    padding: 16,
    marginBottom: 12,
    gap: 8,
  },
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

  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 14,
    ...shadow.e1,
  },
  manageIcon: { width: 36, height: 36, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  manageText: { flex: 1, minWidth: 0 },
  manageLabel: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink },
  manageSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 1 },

  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, textAlign: 'center', marginVertical: 8 },

  footer: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: colors.surface,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 24,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    ...shadow.e2,
  },
  secondaryBtn: { flex: 1, height: 56, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: -0.2, color: colors.ink },
  primaryBtn: { flex: 1 },
  cancelBtn: { flex: 1, height: 56, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.danger, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.danger },
});
