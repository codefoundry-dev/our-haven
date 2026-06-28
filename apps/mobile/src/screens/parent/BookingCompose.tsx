/**
 * Booking compose (design: screens/booking-compose.jsx).
 *
 * Slot summary card, selectable child cards (Tutor = single-child), a
 * PricingSummary breakdown, a payment row, a cancellation-policy block, and a
 * sticky "Send booking request — $total" CTA. UI scaffold — inline sample data.
 *
 * This is the native + narrow-web body. The bespoke desktop layout lives in
 * `@/screens/web/parent/BookingCompose` and is chosen by `booking-compose.web.tsx`.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { AppBar } from '@/components/AppBar';
import { Screen } from '@/components/Screen';
import { PricingSummary } from '@/components/ui/PricingSummary';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

interface Child {
  id: string;
  initial: string;
  name: string;
  age: string;
  tone: ColorToken;
  notes: string;
}

const CHILDREN: Child[] = [
  { id: 'amara', initial: 'A', name: 'Amara', age: '7', tone: 'catTutor', notes: 'Notes on file' },
  { id: 'kojo', initial: 'K', name: 'Kojo', age: '5', tone: 'catNanny', notes: 'No notes' },
];

const TOTAL = '$70.00';

export default function BookingComposeScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState('amara');

  return (
    <Screen edges={['top']} contentStyle={styles.content}>
      <AppBar title="New booking" onBack={() => router.back()} style={styles.appBar} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Confirm your booking</Text>

        {/* Slot summary */}
        <View style={styles.card}>
          <View style={styles.providerRow}>
            <View style={styles.providerAvatar}>
              <Text style={styles.providerInitials}>MO</Text>
            </View>
            <View style={styles.providerText}>
              <Text style={styles.providerName}>Maya Okafor · Tutor</Text>
              <Text style={styles.providerMeta}>Saturday, May 24 · morning · ~2h</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.slotRow}>
            <View style={[styles.slotCard, { backgroundColor: colors.catNanny }]}>
              <Text style={styles.slotLabel}>SAT</Text>
              <Text style={styles.slotValue}>May 24</Text>
              <Text style={styles.slotHint}>Week 21 · 2026</Text>
            </View>
            <View style={[styles.slotCard, { backgroundColor: colors.highlight }]}>
              <Text style={styles.slotLabel}>DURATION</Text>
              <Text style={styles.slotValue}>2 h</Text>
              <Text style={styles.slotHint}>Single child · Tutor</Text>
            </View>
          </View>
        </View>

        {/* Children */}
        <Text style={styles.eyebrow}>Who's this for?</Text>
        <Text style={styles.eyebrowSub}>Tutor bookings are single-child only.</Text>
        <View style={styles.childList}>
          {CHILDREN.map((c) => {
            const on = c.id === selected;
            return (
              <Pressable
                key={c.id}
                onPress={() => setSelected(c.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={[styles.childCard, on ? styles.childCardOn : styles.childCardOff]}
              >
                <View style={[styles.childAvatar, { backgroundColor: colors[c.tone] }]}>
                  <Text style={styles.childInitial}>{c.initial}</Text>
                </View>
                <View style={styles.childText}>
                  <Text style={styles.childName}>
                    {c.name} · {c.age}
                  </Text>
                  <Text style={styles.childNotes}>{c.notes}</Text>
                </View>
                {on ? (
                  <View style={styles.childCheck}>
                    <Icon name="check" size={14} color={colors.inkInv} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {/* Pricing */}
        <Text style={styles.eyebrow}>Pricing</Text>
        <View style={styles.pricingCard}>
          <PricingSummary
            lines={[
              { label: '$35 / hr × 2 h', value: '$70.00' },
              { label: 'Per-child surcharge', value: '—', muted: true },
              { label: 'Subtotal', value: '$70.00' },
              { label: 'Sales tax', value: '$0.00', helper: 'Computed by Stripe Tax' },
            ]}
            total={{ label: 'Total', value: TOTAL }}
          />
        </View>
        <Text style={styles.negotiation}>
          This is the starting Offer. You can negotiate with Maya in chat before she accepts.
        </Text>

        {/* Payment */}
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.payment, { opacity: pressed ? 0.94 : 1 }]}
        >
          <View style={styles.cardBrand}>
            <Text style={styles.cardBrandText}>VISA</Text>
          </View>
          <View style={styles.paymentText}>
            <Text style={styles.paymentName}>Visa · 4242</Text>
            <Text style={styles.paymentMeta}>Default · charged at session end</Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.ink2} />
        </Pressable>

        {/* Cancellation policy */}
        <View style={styles.policy}>
          <Icon name="shield" size={18} color={colors.ink} />
          <Text style={styles.policyText}>
            <Text style={styles.policyStrong}>Cancellation policy. </Text>
            Free more than 24h before start. 50% inside 24h. 100% inside 2h or after start.
          </Text>
        </View>
      </ScrollView>

      {/* Sticky CTA */}
      <View style={styles.footer}>
        <PrimaryButton
          onPress={() => router.push('/bookings')}
          icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
        >
          Send booking request · {TOTAL}
        </PrimaryButton>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: 0 },
  appBar: { paddingHorizontal: 24 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 28 },
  title: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.6, color: colors.ink },

  card: { marginTop: 20, backgroundColor: colors.surface, borderRadius: 24, padding: 18, ...shadow.e1 },
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  providerAvatar: { width: 48, height: 48, borderRadius: radii.pill, backgroundColor: colors.catTutor, alignItems: 'center', justifyContent: 'center' },
  providerInitials: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  providerText: { flex: 1, minWidth: 0 },
  providerName: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  providerMeta: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: 14 },
  slotRow: { flexDirection: 'row', gap: 8 },
  slotCard: { flex: 1, borderRadius: radii.lg, padding: 14 },
  slotLabel: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6, color: colors.ink },
  slotValue: { fontFamily: fonts.bold, fontSize: 20, color: colors.ink, marginTop: 4 },
  slotHint: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink, opacity: 0.6, marginTop: 4 },

  eyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2, marginTop: 24 },
  eyebrowSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 6 },
  childList: { gap: 8, marginTop: 12 },
  childCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radii.lg },
  childCardOn: { backgroundColor: colors.surfaceAlt, borderWidth: 2, borderColor: colors.ink },
  childCardOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  childAvatar: { width: 44, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  childInitial: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  childText: { flex: 1, minWidth: 0 },
  childName: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  childNotes: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },
  childCheck: { width: 24, height: 24, borderRadius: radii.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },

  pricingCard: { marginTop: 12, backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: 18, paddingVertical: 8 },
  negotiation: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.ink2, marginTop: 8, paddingHorizontal: 4 },

  payment: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 14 },
  cardBrand: { width: 44, height: 30, borderRadius: 6, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  cardBrandText: { fontFamily: fonts.mono, fontSize: 10, color: colors.ink2 },
  paymentText: { flex: 1, minWidth: 0 },
  paymentName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  paymentMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },

  policy: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 16, backgroundColor: colors.surfaceAlt, borderRadius: radii.lg, padding: 16 },
  policyText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.ink },
  policyStrong: { fontFamily: fonts.semibold },

  footer: { backgroundColor: colors.surface, paddingHorizontal: 24, paddingTop: 14, paddingBottom: 24, borderTopLeftRadius: 28, borderTopRightRadius: 28, ...shadow.e2 },
});
