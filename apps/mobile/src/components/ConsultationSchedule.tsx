/**
 * ConsultationSchedule (OH-203) — the live Provider-consultation schedule, shared
 * by the Parent and Provider Bookings screens so a booked / cancelled
 * consultation shows on BOTH sides (the AC's "appears on both schedules").
 *
 * Fetches `GET /v1/bookings` (the caller sees their own side) via `useBookings`,
 * splits them Upcoming / Past, and renders one card per consultation with the
 * counterparty, the slot window, and the lifecycle StatusPill. A Parent or
 * Provider may cancel a still-`accepted` consultation (releasing the slot) inline.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { StatusPill } from '@/components/ui/StatusPill';
import { TabStrip } from '@/components/ui/TabStrip';
import { ApiError, cancelBooking, type BookingSummary } from '@/api/client';
import { useBookings } from '@/lib/useBookings';
import { bookingWhen, isCancellable, isUpcomingBooking, sessionRate, specialtyLabel } from '@/lib/consultation';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const TABS = ['Upcoming', 'Past'] as const;
type Tab = (typeof TABS)[number];

export function ConsultationSchedule({ viewerRole }: { viewerRole: 'parent' | 'provider' }) {
  const { data, loading, error, refetch } = useBookings();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Upcoming');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const onCancel = async (id: string) => {
    setBusyId(id);
    setCancelError(null);
    try {
      await cancelBooking(id);
      refetch();
    } catch (e) {
      setCancelError(e instanceof ApiError ? e.message : 'Could not cancel that booking.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.state}>
        <Text style={styles.stateText}>{error}</Text>
        <Pressable onPress={refetch} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const rows = data.filter((b) => (tab === 'Upcoming' ? isUpcomingBooking(b) : !isUpcomingBooking(b)));

  return (
    <View>
      <TabStrip tabs={TABS} value={tab} onChange={setTab} style={styles.tabs} />
      {cancelError ? <Text style={styles.cancelError}>{cancelError}</Text> : null}

      {rows.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Icon name="calendar" size={24} color={colors.brand} />
          </View>
          <Text style={styles.emptyTitle}>{tab === 'Upcoming' ? 'No upcoming consultations' : 'No past consultations'}</Text>
          <Text style={styles.emptySub}>
            {viewerRole === 'parent'
              ? tab === 'Upcoming'
                ? 'Book a consultation from a provider’s profile and it will show up here.'
                : 'Completed consultations will appear here.'
              : tab === 'Upcoming'
                ? 'When a family books one of your open slots, it appears here.'
                : 'Completed consultations will appear here.'}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {rows.map((b) => (
            <ConsultationCard
              key={b.id}
              booking={b}
              viewerRole={viewerRole}
              busy={busyId === b.id}
              onCancel={() => onCancel(b.id)}
              onOpen={
                viewerRole === 'parent'
                  ? () => router.push({ pathname: '/booking-detail', params: { bookingId: b.id } })
                  : undefined
              }
            />
          ))}
        </View>
      )}
    </View>
  );
}

function ConsultationCard({
  booking,
  viewerRole,
  busy,
  onCancel,
  onOpen,
}: {
  booking: BookingSummary;
  viewerRole: 'parent' | 'provider';
  busy: boolean;
  onCancel: () => void;
  /** Parent taps a card to open the full Booking detail (payment + actions). */
  onOpen?: () => void;
}) {
  const name = booking.counterpartyName ?? (viewerRole === 'parent' ? 'Provider' : 'Family');
  const sub =
    viewerRole === 'parent'
      ? specialtyLabel(booking.counterpartySpecialty) ?? 'Consultation'
      : 'Consultation';
  const rate = sessionRate(booking.rateCents);
  // A Caregiver Booking is cancelled from its detail (the M2.5 fee preview lives in
  // CancelSheet). Only NULL-payment Provider consultations offer an inline cancel.
  const showInlineCancel = booking.kind === 'provider' && isCancellable(booking);

  return (
    <View style={styles.card}>
      <Pressable
        onPress={onOpen}
        disabled={!onOpen}
        accessibilityRole={onOpen ? 'button' : undefined}
        style={({ pressed }) => ({ opacity: pressed && onOpen ? 0.9 : 1, gap: 12 })}
      >
        <View style={styles.cardHead}>
          <Avatar label={name} size="sm" tone="catSpec" />
          <View style={styles.cardWho}>
            <Text style={styles.cardName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.cardSub} numberOfLines={1}>
              {sub}
            </Text>
          </View>
          <StatusPill state={booking.state} />
        </View>

        <View style={styles.metaRow}>
          <Icon name="calendar" size={14} color={colors.ink2} />
          <Text style={styles.metaText}>{bookingWhen(booking)}</Text>
          {rate ? <Text style={styles.metaRate}>{rate}</Text> : null}
        </View>
      </Pressable>

      {showInlineCancel ? (
        <Pressable
          onPress={onCancel}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cancelBtn, { opacity: pressed || busy ? 0.7 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator color={colors.ink} size="small" />
          ) : (
            <Text style={styles.cancelText}>Cancel consultation</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { marginTop: 8, marginBottom: 8 },
  state: { alignItems: 'center', gap: 12, paddingVertical: 48 },
  stateText: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, textAlign: 'center' },
  retry: { height: 40, paddingHorizontal: 18, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },
  cancelError: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginBottom: 8 },

  list: { gap: 12, marginTop: 8 },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, gap: 12, ...shadow.e1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardWho: { flex: 1, minWidth: 0 },
  cardName: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  cardSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },
  metaRate: { marginLeft: 'auto', fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  cancelBtn: {
    height: 44,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  empty: { alignItems: 'center', gap: 8, paddingTop: 56, paddingHorizontal: 24 },
  emptyIcon: { width: 60, height: 60, borderRadius: radii.lg, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.3, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, textAlign: 'center', maxWidth: 280, lineHeight: 19 },
});
