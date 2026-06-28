/**
 * Booking detail (Parent — native + narrow web). Design: screens/booking-detail.jsx.
 *
 * Hero band + an info card (mono Booking id, StatusPill, date cards,
 * AvatarGroup of children, rate breakdown), a state timeline, "manage this
 * session" rows, and state-dependent action buttons. UI scaffold — inline data.
 *
 * The desktop layout lives in `@/screens/web/parent/BookingDetail`
 * (`ParentBookingDetailWeb`) and is chosen by `booking-detail.web.tsx` on wide web.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon, type IconName } from '@/components/Icon';
import { AppBar } from '@/components/AppBar';
import { Screen } from '@/components/Screen';
import { AvatarGroup } from '@/components/ui/Avatar';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { Portrait } from '@/components/ui/PhotoPlaceholder';
import { PricingSummary } from '@/components/ui/PricingSummary';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { StatusPill, type BookingState } from '@/components/ui/StatusPill';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const STATE: BookingState = 'accepted';
const STATE_ORDER: BookingState[] = ['requested', 'accepted', 'in-progress', 'completed'];

const TIMELINE: { state: BookingState; label: string; meta: string }[] = [
  { state: 'requested', label: 'Request sent', meta: 'Mon, May 8 · 2:14 PM' },
  { state: 'accepted', label: 'Accepted by Maya', meta: 'Mon, May 8 · 4:02 PM' },
  { state: 'in-progress', label: 'Session', meta: 'Wed, May 10 · 9:00 AM' },
  { state: 'completed', label: 'Completed & charged', meta: 'Pending' },
];

const MANAGE: { icon: IconName; label: string; sub: string }[] = [
  { icon: 'clock', label: 'Adjust session time', sub: 'Extend now, or request a shorter time' },
  { icon: 'shield', label: 'Report an issue', sub: 'Dispute a charge, even after the window' },
];

function actionsFor(state: BookingState): { primary: string } {
  switch (state) {
    case 'requested':
      return { primary: 'Cancel request' };
    case 'accepted':
    case 'awaiting-confirmation':
      return { primary: 'Confirm hours' };
    case 'completed':
      return { primary: 'Leave a review' };
    default:
      return { primary: 'View receipt' };
  }
}

export default function BookingDetailScreen() {
  const router = useRouter();
  const currentIndex = STATE_ORDER.indexOf(STATE);
  const actions = actionsFor(STATE);

  return (
    <Screen edges={['top']} contentStyle={styles.content}>
      <AppBar
        title="Booking detail"
        onBack={() => router.back()}
        actions={[{ icon: 'dots', label: 'More' }]}
        style={styles.appBar}
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero band */}
        <View style={styles.hero}>
          <Portrait height={180} tint={colors.catTutor} label="provider · maya okafor" radius={28} />
          <CategoryChip category="Tutor" style={styles.heroChip} />
        </View>

        <Text style={styles.title}>Math tutoring with Maya</Text>

        {/* Info card */}
        <View style={styles.card}>
          <View style={styles.idRow}>
            <Text style={styles.bookingId}>OH-B-4F92K3</Text>
            <StatusPill state={STATE} label="Accepted" />
          </View>

          <View style={styles.dayRow}>
            <View style={[styles.dayCard, { backgroundColor: colors.catNanny }]}>
              <View style={styles.dayHead}>
                <Text style={styles.dayHeadText}>Today</Text>
                <Icon name="calendar" size={16} color={colors.ink} />
              </View>
              <Text style={styles.dayDate}>Wed, May 10</Text>
              <View style={styles.dayMeta}>
                <Text style={styles.dayMetaText}>Week 19</Text>
                <Text style={styles.dayMetaText}>2026</Text>
              </View>
            </View>
            <View style={[styles.dayCard, { backgroundColor: colors.highlight }]}>
              <View style={styles.dayHead}>
                <Text style={styles.dayHeadText}>Session</Text>
                <Icon name="check-circle" size={16} color={colors.ink} />
              </View>
              <Text style={styles.dayTime}>9:00–9:30 AM</Text>
              <Text style={styles.dayMetaText}>30 min</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <Text style={styles.eyebrow}>Children on booking</Text>
          <View style={styles.childRow}>
            <AvatarGroup items={[{ label: 'A', tone: 'catTutor' }]} size={28} />
            <Text style={styles.childText}>1 child · age 9</Text>
          </View>

          <View style={styles.divider} />

          <PricingSummary
            lines={[
              { label: 'Tutor rate · 0.5h', value: '$17.50', muted: true },
              { label: 'Service fee', value: '$2.10', muted: true },
              { label: 'Tax', value: '$1.40', muted: true },
            ]}
            total={{ label: 'Total', value: '$21.00' }}
          />
        </View>

        {/* State timeline */}
        <Text style={[styles.eyebrow, styles.sectionEyebrow]}>Progress</Text>
        <View style={styles.card}>
          {TIMELINE.map((step, i) => {
            const done = i <= currentIndex;
            const isLast = i === TIMELINE.length - 1;
            return (
              <View key={step.state} style={styles.tlRow}>
                <View style={styles.tlRail}>
                  <View style={[styles.tlDot, done ? styles.tlDotOn : styles.tlDotOff]}>
                    {done ? <Icon name="check" size={11} color={colors.inkInv} /> : null}
                  </View>
                  {!isLast ? <View style={[styles.tlLine, i < currentIndex ? styles.tlLineOn : styles.tlLineOff]} /> : null}
                </View>
                <View style={styles.tlText}>
                  <Text style={[styles.tlLabel, !done && styles.tlLabelOff]}>{step.label}</Text>
                  <Text style={styles.tlMeta}>{step.meta}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Manage this session */}
        <Text style={[styles.eyebrow, styles.sectionEyebrow]}>Manage this session</Text>
        <View style={styles.card}>
          {MANAGE.map((r, i) => (
            <Pressable
              key={r.label}
              accessibilityRole="button"
              style={({ pressed }) => [styles.manageRow, i > 0 && styles.manageDivider, { opacity: pressed ? 0.85 : 1 }]}
            >
              <View style={styles.manageIcon}>
                <Icon name={r.icon} size={17} color={colors.ink} />
              </View>
              <View style={styles.manageText}>
                <Text style={styles.manageLabel}>{r.label}</Text>
                <Text style={styles.manageSub}>{r.sub}</Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.ink3} />
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* State-dependent actions */}
      <View style={styles.footer}>
        <Pressable
          onPress={() => router.push('/message-thread')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.9 : 1 }]}
        >
          <Text style={styles.secondaryText}>Message</Text>
        </Pressable>
        <PrimaryButton onPress={() => {}} style={styles.primaryBtn}>
          {actions.primary}
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
  dayMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  dayMetaText: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink, opacity: 0.7, marginTop: 8 },

  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: 16 },
  eyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  sectionEyebrow: { marginBottom: 10 },
  childRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  childText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  tlRow: { flexDirection: 'row', gap: 12 },
  tlRail: { alignItems: 'center', width: 22 },
  tlDot: { width: 22, height: 22, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  tlDotOn: { backgroundColor: colors.brand },
  tlDotOff: { backgroundColor: colors.surfaceAlt, borderWidth: 1.5, borderColor: colors.hairline },
  tlLine: { width: 2, flex: 1, marginVertical: 2 },
  tlLineOn: { backgroundColor: colors.brand },
  tlLineOff: { backgroundColor: colors.hairline },
  tlText: { flex: 1, paddingBottom: 18 },
  tlLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  tlLabelOff: { color: colors.ink3 },
  tlMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },

  manageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  manageDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  manageIcon: { width: 36, height: 36, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  manageText: { flex: 1, minWidth: 0 },
  manageLabel: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink },
  manageSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 1 },

  footer: { flexDirection: 'row', gap: 10, backgroundColor: colors.surface, paddingHorizontal: 24, paddingTop: 14, paddingBottom: 24, borderTopLeftRadius: 28, borderTopRightRadius: 28, ...shadow.e2 },
  secondaryBtn: { flex: 1, height: 56, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: -0.2, color: colors.ink },
  primaryBtn: { flex: 1 },
});
