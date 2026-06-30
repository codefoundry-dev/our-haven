/**
 * Parent Bookings — the parent's schedule across all Providers (OH-203).
 *
 * In v1 the only persisted Booking type is the Provider consultation (slot-pick,
 * null payment), so this renders the live `ConsultationSchedule` (Upcoming /
 * Past, with inline cancel) — the same Bookings the Provider sees on their side.
 * The recurring Caregiver Booking-Series + one-off rails return when OH-179
 * persists Job/Offer → Booking.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ConsultationSchedule } from '@/components/ConsultationSchedule';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/Screen';
import { colors, fonts } from '@/theme/tokens';

export function ParentBookings() {
  const router = useRouter();

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      <View style={styles.topBar}>
        <Text style={styles.title}>Bookings</Text>
        <View style={styles.cluster}>
          <IconButton name="search" onPress={() => router.push('/search')} accessibilityLabel="Search" />
          <IconButton name="plus" dark onPress={() => router.push('/search')} accessibilityLabel="New booking" />
        </View>
      </View>

      <ConsultationSchedule viewerRole="parent" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  title: { fontFamily: fonts.bold, fontSize: 26, letterSpacing: -0.6, color: colors.ink },
  cluster: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
