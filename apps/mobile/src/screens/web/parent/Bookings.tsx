/**
 * ParentBookingsWeb — the Parent's bookings on desktop web (OH-203). Content-only:
 * the dispatcher wraps this in <ParentWebShell active="bookings">.
 *
 * In v1 the only persisted Booking type is the Provider consultation (slot-pick,
 * null payment), so this renders the live `ConsultationSchedule` (Upcoming / Past,
 * inline cancel) — the same Bookings the Provider sees. The richer two-pane
 * Series + pricing layout returns when OH-179 persists Caregiver Job/Offer →
 * Booking. RN primitives only.
 */
import { StyleSheet, View } from 'react-native';

import { WebPageHeader } from '@/components/web/ParentWebShell';
import { ConsultationSchedule } from '@/components/ConsultationSchedule';

export function ParentBookingsWeb() {
  return (
    <View>
      <WebPageHeader greet="Your schedule" title="Bookings" actions={['calendar', 'bell']} />
      <View style={styles.body}>
        <ConsultationSchedule viewerRole="parent" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 720 },
});
