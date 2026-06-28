/**
 * ParentBookingComposeWeb — the Parent's "compose a booking request / Offer to a
 * Caregiver" flow on desktop web. Content-only: the route dispatcher wraps this in
 * <ParentWebShell active="bookings">.
 *
 * This is the CAREGIVER Offer composer (per the native booking-compose screen):
 * the Parent picks a date · time · session length · scope (which child) and writes
 * an opening note, and a sticky right-rail summary card shows the computed total
 * ($rate × hours) with the "Send booking request" CTA. Caregivers DO use Stripe /
 * Offers / commission, so a card IS charged here (unlike the off-platform Provider
 * consultation flow). Tutor bookings stay single-child, mirroring native.
 *
 * Ported from the Claude Design web project: the date-rail / open-slot idiom of
 * parent-web/pw-consult.jsx + the pricing-summary card idiom of pw-bookings.jsx.
 * RN primitives only; two columns via flexDirection:'row' + gap + flexWrap.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { Card } from '@/components/ui/Card';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { PricingSummary } from '@/components/ui/PricingSummary';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { WebPageHeader } from '@/components/web/ParentWebShell';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

interface DateOption {
  id: string;
  dow: string;
  date: number;
  full: string;
}

const DATES: readonly DateOption[] = [
  { id: 'thu', dow: 'THU', date: 22, full: 'Thu, May 22' },
  { id: 'fri', dow: 'FRI', date: 23, full: 'Fri, May 23' },
  { id: 'sat', dow: 'SAT', date: 24, full: 'Sat, May 24' },
  { id: 'sun', dow: 'SUN', date: 25, full: 'Sun, May 25' },
  { id: 'mon', dow: 'MON', date: 26, full: 'Mon, May 26' },
  { id: 'tue', dow: 'TUE', date: 27, full: 'Tue, May 27' },
  { id: 'wed', dow: 'WED', date: 28, full: 'Wed, May 28' },
];

const TIMES: readonly string[] = ['9:00 AM', '10:30 AM', '12:00 PM', '1:30 PM', '3:00 PM', '4:30 PM'];

const HOURS = [1, 1.5, 2, 3] as const;

const RATE = 35; // Maya Okafor · Tutor · $35/hr (matches native Offer)

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

const money = (n: number) => `$${n.toFixed(2)}`;
const fmtHours = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;

export function ParentBookingComposeWeb() {
  const router = useRouter();

  const [dateId, setDateId] = useState('sat');
  const [time, setTime] = useState('10:30 AM');
  const [hours, setHours] = useState<number>(2);
  const [selected, setSelected] = useState('amara');
  const [note, setNote] = useState('');

  const date = DATES.find((d) => d.id === dateId) ?? DATES[2];
  const subtotal = RATE * hours;
  const total = subtotal; // sales tax computed by Stripe Tax (shown as $0.00 here)

  return (
    <View>
      <WebPageHeader greet="Family · New booking" title="Send a booking request" actions={['bell', 'message']} />

      <View style={styles.body}>
        <View style={styles.layout}>
          {/* ── left · the compose form ───────────────────────────── */}
          <View style={styles.mainCol}>
            {/* provider */}
            <Card radius={radii.xl} padding={22} style={styles.card}>
              <View style={styles.providerRow}>
                <View style={styles.providerAvatar}>
                  <Text style={styles.providerInitials}>MO</Text>
                </View>
                <View style={styles.flexMin}>
                  <View style={styles.providerNameRow}>
                    <Text style={styles.providerName}>Maya Okafor</Text>
                    <CategoryChip category="Tutor" style={styles.providerChip} />
                  </View>
                  <Text style={styles.providerMeta}>K–8 math · builds number sense first · 1.4 mi</Text>
                </View>
                <View style={styles.rateTag}>
                  <Text style={styles.rateValue}>${RATE}</Text>
                  <Text style={styles.rateUnit}>/hr</Text>
                </View>
              </View>
            </Card>

            {/* schedule */}
            <Card radius={radii.xl} padding={28} style={styles.card}>
              <Text style={styles.headline}>When works for you?</Text>
              <Text style={styles.sub}>
                Pick a date, a start time and how long you&rsquo;d like. This becomes the opening Offer — you can
                still negotiate with Maya in chat before she accepts.
              </Text>

              {/* date pills */}
              <Text style={styles.fieldLabel}>Date</Text>
              <View style={styles.dateRow}>
                {DATES.map((d) => {
                  const active = d.id === dateId;
                  return (
                    <Pressable
                      key={d.id}
                      onPress={() => setDateId(d.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[styles.datePill, active ? styles.datePillActive : null]}
                    >
                      <Text style={[styles.dateDow, active && { color: colors.inkInv }]}>{d.dow}</Text>
                      <Text style={[styles.dateNum, active && { color: colors.inkInv }]}>{d.date}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* time slots */}
              <Text style={styles.fieldLabel}>Start time</Text>
              <View style={styles.grid}>
                {TIMES.map((t) => {
                  const on = t === time;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setTime(t)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={[styles.slot, on ? styles.slotOn : styles.slotOff]}
                    >
                      {on ? <Icon name="check" size={15} color={colors.brand} /> : null}
                      <Text style={[styles.slotText, on && { color: colors.ink }]}>{t}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* session length */}
              <Text style={styles.fieldLabel}>Session length</Text>
              <View style={styles.durationRow}>
                {HOURS.map((h) => {
                  const active = h === hours;
                  return (
                    <Pressable
                      key={h}
                      onPress={() => setHours(h)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      style={[styles.durationPill, active ? styles.durationPillActive : styles.durationPillIdle]}
                    >
                      <Text style={[styles.durationText, active && { color: colors.inkInv }]}>{fmtHours(h)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>

            {/* scope · which child */}
            <Card radius={radii.xl} padding={28} style={styles.card}>
              <Text style={styles.headline}>Who&rsquo;s this for?</Text>
              <Text style={styles.sub}>Tutor bookings are single-child only.</Text>
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
                      <View style={styles.flexMin}>
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
            </Card>

            {/* note */}
            <Card radius={radii.xl} padding={28} style={styles.card}>
              <Text style={styles.headline}>Add a note for Maya</Text>
              <Text style={styles.sub}>Optional — share goals, the topic, or anything she should know.</Text>
              <View style={styles.noteBox}>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder="e.g. Amara is prepping for a fractions quiz — wants to build confidence."
                  placeholderTextColor={colors.ink3}
                  multiline
                  style={styles.noteInput}
                />
              </View>
            </Card>
          </View>

          {/* ── right · summary + submit ──────────────────────────── */}
          <View style={styles.sideCol}>
            <Card radius={radii.xl} padding={22} style={styles.summaryCard}>
              <Text style={styles.secHead}>Booking summary</Text>

              {/* date + time band cards */}
              <View style={styles.bandRow}>
                <View style={[styles.band, { backgroundColor: colors.catNanny }]}>
                  <View style={styles.bandTop}>
                    <Text style={styles.bandLabel}>DATE</Text>
                    <Icon name="calendar" size={15} color={colors.ink} />
                  </View>
                  <Text style={styles.bandValue}>{date.full}</Text>
                  <Text style={styles.bandHint}>Week 21 · 2026</Text>
                </View>
                <View style={[styles.band, { backgroundColor: colors.highlight }]}>
                  <View style={styles.bandTop}>
                    <Text style={styles.bandLabel}>TIME</Text>
                    <Icon name="clock" size={15} color={colors.ink} />
                  </View>
                  <Text style={styles.bandValue}>{time}</Text>
                  <Text style={styles.bandHint}>{fmtHours(hours)} · Tutor</Text>
                </View>
              </View>

              {/* pricing */}
              <PricingSummary
                style={styles.pricing}
                lines={[
                  { label: `$${RATE} / hr × ${fmtHours(hours)}`, value: money(subtotal) },
                  { label: 'Per-child surcharge', value: '—', muted: true },
                  { label: 'Subtotal', value: money(subtotal) },
                  { label: 'Sales tax', value: '$0.00', helper: 'Computed by Stripe Tax' },
                ]}
                total={{ label: 'Total', value: money(total) }}
              />

              <Text style={styles.negotiation}>
                This is the starting Offer. You can negotiate with Maya in chat before she accepts.
              </Text>

              {/* payment */}
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.payment, { opacity: pressed ? 0.94 : 1 }]}
              >
                <View style={styles.cardBrand}>
                  <Text style={styles.cardBrandText}>VISA</Text>
                </View>
                <View style={styles.flexMin}>
                  <Text style={styles.paymentName}>Visa · 4242</Text>
                  <Text style={styles.paymentMeta}>Default · charged at session end</Text>
                </View>
                <Icon name="chevron-right" size={18} color={colors.ink2} />
              </Pressable>

              <PrimaryButton
                style={styles.cta}
                onPress={() => router.push('/bookings' as never)}
                icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
              >
                Send request · {money(total)}
              </PrimaryButton>
            </Card>

            {/* cancellation policy */}
            <View style={styles.policy}>
              <Icon name="shield" size={18} color={colors.ink} />
              <Text style={styles.policyText}>
                <Text style={styles.policyStrong}>Cancellation policy. </Text>
                Free more than 24h before start. 50% inside 24h. 100% inside 2h or after start.
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
  flexMin: { flex: 1, minWidth: 0 },

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  mainCol: { flexGrow: 1.6, flexBasis: 560, minWidth: 360, gap: 18 },
  sideCol: { flexGrow: 1, flexBasis: 320, minWidth: 280, gap: 16 },

  card: { ...shadow.e1 },

  // provider
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  providerAvatar: { width: 52, height: 52, borderRadius: radii.pill, backgroundColor: colors.catTutor, alignItems: 'center', justifyContent: 'center' },
  providerInitials: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  providerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  providerName: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  providerChip: { height: 24, paddingHorizontal: 10 },
  providerMeta: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 4 },
  rateTag: { flexDirection: 'row', alignItems: 'baseline', gap: 1 },
  rateValue: { fontFamily: fonts.bold, fontSize: 20, color: colors.ink, fontVariant: ['tabular-nums'] },
  rateUnit: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },

  // schedule
  headline: { fontFamily: fonts.bold, fontSize: 21, letterSpacing: -0.5, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.ink2, marginTop: 8, maxWidth: 560 },

  fieldLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink2,
    marginTop: 24,
    marginBottom: 12,
  },

  dateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  datePill: {
    width: 60,
    height: 72,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  datePillActive: { backgroundColor: colors.ink },
  dateDow: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.4, color: colors.ink3 },
  dateNum: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  slot: {
    flexGrow: 1,
    flexBasis: '28%',
    minWidth: 130,
    height: 50,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
  },
  slotOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  slotOff: { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline },
  slotText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink2, fontVariant: ['tabular-nums'] },

  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  durationPill: {
    flexGrow: 1,
    flexBasis: 100,
    height: 46,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  durationPillActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  durationPillIdle: { backgroundColor: colors.surface, borderColor: colors.hairline },
  durationText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  // children
  childList: { gap: 10, marginTop: 18 },
  childCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radii.lg },
  childCardOn: { backgroundColor: colors.surfaceAlt, borderWidth: 2, borderColor: colors.ink },
  childCardOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  childAvatar: { width: 44, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  childInitial: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  childName: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  childNotes: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },
  childCheck: { width: 24, height: 24, borderRadius: radii.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },

  // note
  noteBox: {
    marginTop: 18,
    minHeight: 110,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  noteInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 21, color: colors.ink, minHeight: 82 },

  // right · summary card
  summaryCard: { ...shadow.e2 },
  secHead: { fontFamily: fonts.bold, fontSize: 11.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 14 },
  bandRow: { flexDirection: 'row', gap: 10 },
  band: { flex: 1, borderRadius: radii.lg, padding: 14 },
  bandTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bandLabel: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.6, color: colors.ink },
  bandValue: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink, marginTop: 12, fontVariant: ['tabular-nums'] },
  bandHint: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink, opacity: 0.65, marginTop: 5 },

  pricing: { marginTop: 18 },
  negotiation: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.ink2, marginTop: 12 },

  payment: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, backgroundColor: colors.surfaceAlt, borderRadius: radii.md, padding: 12 },
  cardBrand: { width: 44, height: 30, borderRadius: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  cardBrandText: { fontFamily: fonts.mono, fontSize: 10, color: colors.ink2 },
  paymentName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  paymentMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },

  cta: { marginTop: 18 },

  // cancellation policy
  policy: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.surfaceAlt, borderRadius: radii.lg, padding: 16 },
  policyText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.ink },
  policyStrong: { fontFamily: fonts.semibold },
});
