/**
 * ParentBookingDetailWeb — the Parent's single-booking detail on desktop web.
 * Content-only: the dispatcher wraps this in <ParentWebShell active="bookings">.
 *
 * Ported from the Claude Design web project (parent-web/pw-bookings.jsx — the
 * PWBookings accepted-detail layout) over the native Parent BookingDetail
 * (`@/screens/parent/BookingDetail`), which stays the source of truth for the
 * booking status, date/time, pricing breakdown, children-on-booking, the state
 * timeline, and the manage actions (adjust time / report issue). Two columns:
 * the booking hero + date band + pricing + actions on the left; the progress
 * timeline + "Manage this session" list on the right. RN primitives only
 * (renders via RN-web) — multi-column via flexDirection:'row' + gap + flexWrap.
 */
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { WebPageHeader } from '@/components/web/ParentWebShell';
import { AvatarGroup } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { Portrait } from '@/components/ui/PhotoPlaceholder';
import { PricingSummary } from '@/components/ui/PricingSummary';
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

function primaryFor(state: BookingState): string {
  switch (state) {
    case 'requested':
      return 'Cancel request';
    case 'accepted':
    case 'awaiting-confirmation':
      return 'Confirm hours';
    case 'completed':
      return 'Leave a review';
    default:
      return 'View receipt';
  }
}

export function ParentBookingDetailWeb() {
  const router = useRouter();
  const go = (r: string) => router.push(r as never);
  const currentIndex = STATE_ORDER.indexOf(STATE);
  const primary = primaryFor(STATE);

  return (
    <View>
      <WebPageHeader greet="Family · Bookings" title="Math tutoring with Maya" actions={['calendar', 'bell']} />

      <View style={styles.body}>
        <View style={styles.layout}>
          {/* ── left · the booking ─────────────────────────────────── */}
          <View style={styles.mainCol}>
            <Card radius={radii.xl} padding={26} style={styles.bookingCard}>
              <View style={styles.idRow}>
                <Text style={styles.bookingId}>OH-B-4F92K3</Text>
                <StatusPill state={STATE} label="Accepted" />
              </View>

              {/* hero */}
              <View style={styles.hero}>
                <Portrait height={200} tint={colors.catTutor} label="provider · maya okafor" radius={radii.xl} />
                <CategoryChip category="Tutor" style={styles.heroChip} />
              </View>

              <Text style={styles.title}>Math tutoring with Maya</Text>
              <Text style={styles.subtitle}>Wed, May 10 · 9:00–9:30 AM · For Anika (9)</Text>

              {/* date / time / children band */}
              <View style={styles.band}>
                <View style={[styles.bandCard, { backgroundColor: colors.catNanny }]}>
                  <View style={styles.bandHead}>
                    <Text style={styles.bandHeadText}>Date</Text>
                    <Icon name="calendar" size={16} color={colors.ink} />
                  </View>
                  <Text style={styles.bandValue}>Wed, May 10</Text>
                  <Text style={styles.bandMeta}>Week 19 · 2026</Text>
                </View>
                <View style={[styles.bandCard, { backgroundColor: colors.highlight }]}>
                  <View style={styles.bandHead}>
                    <Text style={styles.bandHeadText}>Time</Text>
                    <Icon name="clock" size={16} color={colors.ink} />
                  </View>
                  <Text style={[styles.bandValue, styles.bandNum]}>9:00–9:30 AM</Text>
                  <Text style={styles.bandMeta}>30 min</Text>
                </View>
                <View style={[styles.bandCard, styles.bandCardSurface]}>
                  <Text style={styles.bandEyebrow}>Children on booking</Text>
                  <View style={styles.childRow}>
                    <AvatarGroup items={[{ label: 'A', tone: 'catTutor' }]} size={28} />
                    <Text style={styles.childText}>1 child · age 9</Text>
                  </View>
                </View>
              </View>

              {/* pricing */}
              <View style={styles.priceCard}>
                <Text style={styles.priceEyebrow}>Pricing</Text>
                <PricingSummary
                  lines={[
                    { label: 'Tutor rate · 0.5h', value: '$17.50', muted: true },
                    { label: 'Service fee', value: '$2.10', muted: true },
                    { label: 'Tax', value: '$1.40', muted: true },
                  ]}
                  total={{ label: 'Total', value: '$21.00' }}
                />
              </View>

              {/* actions */}
              <View style={styles.actions}>
                <Pressable
                  onPress={() => go('/message-thread')}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.9 : 1 }]}
                >
                  <Icon name="message" size={17} color={colors.ink} />
                  <Text style={styles.secondaryText}>Message</Text>
                </Pressable>
                <Pressable
                  onPress={() => {}}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.primaryBtn, { opacity: pressed ? 0.92 : 1 }]}
                >
                  <Icon name="check" size={16} color={colors.inkInv} />
                  <Text style={styles.primaryText}>{primary}</Text>
                </Pressable>
              </View>
            </Card>
          </View>

          {/* ── right · progress + manage ──────────────────────────── */}
          <View style={styles.sideCol}>
            <Card radius={radii.xl} padding={22} style={styles.sideCard}>
              <Text style={styles.secHead}>Progress</Text>
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
            </Card>

            <Card radius={radii.xl} padding={6} style={styles.sideCard}>
              <Text style={[styles.secHead, styles.manageHead]}>Manage this session</Text>
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
            </Card>

            <View style={styles.note}>
              <Icon name="info" size={18} color={colors.brand} />
              <Text style={styles.noteText}>
                Confirming releases the agreed amount to Maya. You can still report an issue and dispute a charge,
                even after the window closes.
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  mainCol: { flexGrow: 1.6, flexBasis: 560, minWidth: 360 },
  sideCol: { flexGrow: 1, flexBasis: 320, minWidth: 280, gap: 16 },

  // booking card
  bookingCard: { ...shadow.e1 },
  idRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 },
  bookingId: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink3 },

  hero: { borderRadius: radii.xl, overflow: 'hidden' },
  heroChip: { position: 'absolute', top: 14, left: 14 },
  title: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.6, color: colors.ink, marginTop: 20 },
  subtitle: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, marginTop: 6 },

  // date / time / children band
  band: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 22 },
  bandCard: { flexGrow: 1, flexBasis: 150, minWidth: 140, borderRadius: radii.lg, padding: 16 },
  bandCardSurface: { backgroundColor: colors.surfaceAlt },
  bandHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bandHeadText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  bandValue: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, marginTop: 14 },
  bandNum: { fontSize: 16, fontVariant: ['tabular-nums'] },
  bandMeta: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink, opacity: 0.7, marginTop: 6 },
  bandEyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  childRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  childText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  // pricing
  priceCard: { marginTop: 18, backgroundColor: colors.surfaceAlt, borderRadius: radii.lg, padding: 20, maxWidth: 440 },
  priceEyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 12 },

  // actions
  actions: { flexDirection: 'row', gap: 12, marginTop: 22, maxWidth: 480 },
  secondaryBtn: { flexGrow: 1, flexBasis: 160, height: 52, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  primaryBtn: { flexGrow: 1.3, flexBasis: 180, height: 52, borderRadius: radii.pill, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },

  // right column
  sideCard: { ...shadow.e1 },
  secHead: { fontFamily: fonts.bold, fontSize: 11.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 16 },
  manageHead: { marginLeft: 16, marginTop: 16, marginBottom: 4 },

  // timeline
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

  // manage rows
  manageRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12 },
  manageDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  manageIcon: { width: 36, height: 36, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  manageText: { flex: 1, minWidth: 0 },
  manageLabel: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink },
  manageSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 1 },

  // note
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },
});
