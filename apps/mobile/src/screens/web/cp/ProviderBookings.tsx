/**
 * ProviderBookingsWeb — the clinical Provider's consultation schedule on desktop
 * web (OH-203). Content-only: the route dispatcher wraps this in <WebShell>.
 *
 * A Parent books one of the Provider's open slots (slot-pick) → a null-payment
 * Booking born `accepted` (no request/accept phase). This renders the live
 * `ConsultationSchedule` (Upcoming / Past, inline cancel) — the same Bookings the
 * Parent sees on their side. RN primitives only (renders via RN-web).
 */
import { StyleSheet, View } from 'react-native';

import { ConsultationSchedule } from '@/components/ConsultationSchedule';
import { WebPageHeader } from '@/components/web/WebShell';

export function ProviderBookingsWeb() {
  return (
    <View>
      <WebPageHeader greet="Your schedule" title="Consultations" actions={['calendar', 'bell']} />
      <View style={styles.body}>
        <ConsultationSchedule viewerRole="provider" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 720 },
});
