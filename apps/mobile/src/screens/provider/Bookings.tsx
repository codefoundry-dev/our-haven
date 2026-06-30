/**
 * Provider (clinical) Bookings — the consultation schedule (OH-203; ADR-0011).
 *
 * Providers take CONSULTATION bookings (no Jobs feed). A Parent books one of the
 * Provider's open slots (slot-pick), creating a null-payment Booking born
 * `accepted` (no request/accept phase). This screen renders the live schedule via
 * the shared `ConsultationSchedule` — Upcoming (accepted) / Past (completed,
 * cancelled), with inline cancel — so the same Booking shows on the Parent's
 * schedule too.
 */
import { AppBar } from '@/components/AppBar';
import { ConsultationSchedule } from '@/components/ConsultationSchedule';
import { Screen } from '@/components/Screen';
import { StyleSheet } from 'react-native';

export function ProviderBookings() {
  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar large title="Bookings" actions={[{ icon: 'bell', badge: true, label: 'Notifications' }]} />
      <ConsultationSchedule viewerRole="provider" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },
});
