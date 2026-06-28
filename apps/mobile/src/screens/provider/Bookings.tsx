/**
 * Provider (clinical) Bookings — the incoming-consultation queue (ADR-0011).
 * Providers take CONSULTATION bookings (no Jobs feed): a TabStrip splits new
 * Requests, Upcoming (accepted) and Past (completed). Requested rows expose
 * Accept / Decline inline; every card taps through to the booking detail.
 *
 * Design reference: Claude design project — screens/provider-dashboard.jsx
 * (request-row look) adapted to the consultation booking list.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { StatusPill, type BookingState } from '@/components/ui/StatusPill';
import { TabStrip } from '@/components/ui/TabStrip';
import { colors, fonts, radii } from '@/theme/tokens';

const TABS = ['Requests', 'Upcoming', 'Past'] as const;
type Tab = (typeof TABS)[number];

type Mode = 'Video' | 'In-person';

interface Booking {
  id: string;
  code: string;
  parent: string;
  child: string;
  topic: string;
  slot: string;
  mode: Mode;
  state: BookingState;
}

const REQUESTS: readonly Booking[] = [
  { id: 'r1', code: 'OH-C-5T81NV', parent: 'Priya N.', child: 'Amara (6)', topic: 'OT consultation', slot: 'Sat, May 24 · 2:00 PM', mode: 'Video', state: 'requested' },
  { id: 'r2', code: 'OH-C-7K22QP', parent: 'Devon W.', child: 'Mia (5)', topic: 'Feeding therapy intake', slot: 'Mon, May 26 · 10:30 AM', mode: 'In-person', state: 'requested' },
];

const UPCOMING: readonly Booking[] = [
  { id: 'u1', code: 'OH-C-4F92K3', parent: 'Marcus T.', child: 'Eli (4)', topic: 'Speech evaluation', slot: 'Thu, May 22 · 11:30 AM', mode: 'In-person', state: 'accepted' },
  { id: 'u2', code: 'OH-C-8B17LM', parent: 'Sarah K.', child: 'Noah (8)', topic: 'ABA follow-up', slot: 'Fri, May 23 · 2:00 PM', mode: 'Video', state: 'accepted' },
];

const PAST: readonly Booking[] = [
  { id: 'p1', code: 'OH-C-2A55RT', parent: 'Lena F.', child: 'Iris (7)', topic: 'OT consultation', slot: 'Tue, May 13 · 9:00 AM', mode: 'Video', state: 'completed' },
  { id: 'p2', code: 'OH-C-9C03WX', parent: 'Omar D.', child: 'Sami (3)', topic: 'Speech evaluation', slot: 'Mon, May 12 · 1:00 PM', mode: 'In-person', state: 'completed' },
];

export function ProviderBookings() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Requests');
  const [requests, setRequests] = useState<Booking[]>([...REQUESTS]);

  const resolve = (id: string) => setRequests((rs) => rs.filter((r) => r.id !== id));

  const rows = tab === 'Requests' ? requests : tab === 'Upcoming' ? UPCOMING : PAST;

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar large title="Bookings" actions={[{ icon: 'bell', badge: true, label: 'Notifications' }]} />

      <TabStrip tabs={TABS} value={tab} onChange={setTab} style={styles.tabs} />

      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="check-circle" size={26} color={colors.ink3} />
          <Text style={styles.emptyText}>You're all caught up.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {rows.map((b) => (
            <BookingCard key={b.id} booking={b} router={router} onResolve={resolve} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function BookingCard({
  booking,
  router,
  onResolve,
}: {
  booking: Booking;
  router: ReturnType<typeof useRouter>;
  onResolve: (id: string) => void;
}) {
  const isRequest = booking.state === 'requested';
  const pillLabel = isRequest ? 'New request' : undefined;
  const modeIcon: IconName = booking.mode === 'Video' ? 'video' : 'pin';

  return (
    <Card onPress={() => router.push('/booking-detail')} padding={16} radius={radii.lg} style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{booking.parent[0]}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.parent} numberOfLines={1}>
            {booking.parent}
          </Text>
          <Text style={styles.child} numberOfLines={1}>
            for {booking.child}
          </Text>
        </View>
        <StatusPill state={booking.state} label={pillLabel} />
      </View>

      <Text style={styles.topic} numberOfLines={1}>
        {booking.topic}
      </Text>

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Icon name="calendar" size={13} color={colors.ink2} />
          <Text style={styles.metaText}>{booking.slot}</Text>
        </View>
        <View style={styles.metaItem}>
          <Icon name={modeIcon} size={13} color={colors.ink2} />
          <Text style={styles.metaText}>{booking.mode}</Text>
        </View>
      </View>

      {isRequest ? (
        <View style={styles.actions}>
          <Pressable
            onPress={() => onResolve(booking.id)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.declineBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={styles.declineText}>Decline</Text>
          </Pressable>
          <Pressable
            onPress={() => onResolve(booking.id)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.acceptBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Icon name="check" size={15} color={colors.inkInv} />
            <Text style={styles.acceptText}>Accept</Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },
  tabs: { marginTop: 14, marginBottom: 16 },
  list: { gap: 12 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 64 },
  emptyText: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink2 },
  card: { gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.catSpec,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  headerText: { flex: 1, minWidth: 0 },
  parent: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  child: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },
  topic: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 2 },
  declineBtn: {
    flex: 1,
    height: 44,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  acceptBtn: {
    flex: 1,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  acceptText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkInv },
});
