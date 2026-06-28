/**
 * ParentProviderWeb — Provider profile detail on desktop web. Content-only: the
 * dispatcher wraps this in <ParentWebShell>.
 *
 * Ported from the Claude Design web project (parent-web/pw-provider.jsx) and the
 * native provider-detail: a two-column desktop layout — left is the hero
 * Portrait, identity, badges, and an About/Availability/Reviews TabStrip; right
 * is a Book/Message action card with the rate and quick facts (the desktop
 * analogue of the native sticky CTA bar). RN primitives only.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { WebPageHeader } from '@/components/web/ParentWebShell';
import { Icon, type IconName } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, CredBadge } from '@/components/ui/Badge';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { Chip } from '@/components/ui/Chip';
import { Portrait } from '@/components/ui/PhotoPlaceholder';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { RatingValue } from '@/components/ui/StarRating';
import { TabStrip } from '@/components/ui/TabStrip';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const TABS = ['About', 'Availability', 'Reviews'] as const;
type Tab = (typeof TABS)[number];

const SPECIALTIES = ['Pre-algebra', 'Reading fluency', 'ESL bilingual', 'IEP-friendly', 'Test prep'];
const COMFORT = ['ADHD', 'Anxiety', 'Food allergies / EpiPen', 'Mild sensory needs', 'IEP-friendly'];
const RATES = [
  { cat: 'Tutor', tint: colors.catTutor, rate: '$35', note: 'Math · single-child sessions' },
  { cat: 'Babysitter', tint: colors.catBaby, rate: '$28', note: '+$5/hr per extra child' },
];
const AVAILABILITY = [
  { day: 'Mon – Fri', bands: 'Afternoons & evenings' },
  { day: 'Saturday', bands: 'Mornings' },
  { day: 'Sunday', bands: 'Unavailable' },
];
const REVIEWS = [
  { name: 'Dana R.', tone: 'catBaby' as const, value: 5.0, text: 'Amara actually asks to do math now. Maya explains the "why" so it sticks.' },
  { name: 'Tomas L.', tone: 'catNanny' as const, value: 4.8, text: 'Punctual, patient, and great notes after every session. Highly recommend.' },
];
const QUICK_FACTS: { icon: IconName; label: string; value: string }[] = [
  { icon: 'pin', label: 'Location', value: 'Eastside · 2.3 mi away' },
  { icon: 'clock', label: 'Replies', value: 'Usually within 1 hour' },
  { icon: 'check-circle', label: 'Repeat families', value: '78% rebook rate' },
];

export function ParentProviderWeb() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('About');
  const go = (route: string) => router.push(route as never);

  return (
    <View>
      <WebPageHeader greet="Provider profile" title="Maya Okafor" actions={['arrow-up-right', 'bookmark']} />

      <View style={styles.body}>
        <View style={styles.columns}>
          {/* ── left: profile ─────────────────────────────── */}
          <View style={styles.main}>
            <View style={styles.heroCard}>
              <View style={styles.heroPortrait}>
                <Portrait height={300} tint={colors.catTutor} label="provider portrait · 4:5" radius={radii.lg} />
              </View>
              <View style={styles.heroInfo}>
                <View style={styles.heroChips}>
                  <CategoryChip category="Tutor" />
                  <View style={styles.alsoPill}>
                    <Text style={styles.alsoText}>Also offers Babysitter</Text>
                  </View>
                </View>
                <Text style={styles.name}>Maya Okafor</Text>
                <Text style={styles.sub}>K–8 Math · Eastside · 2.3 mi away</Text>
                <View style={styles.ratingRow}>
                  <RatingValue value={4.9} size={16} />
                  <Text style={styles.ratingMeta}>· 87 reviews · replies in 1h</Text>
                </View>
                <View style={styles.badges}>
                  <Badge kind="verified" />
                  <Badge kind="tax" />
                  <Badge kind="toprated" />
                </View>
                <View style={styles.offerPill}>
                  <Icon name="sparkle" size={12} color={colors.brand} />
                  <Text style={styles.offerText}>Open to Offers</Text>
                </View>
              </View>
            </View>

            <TabStrip tabs={TABS} value={tab} onChange={setTab} style={styles.tabs} />

            {tab === 'About' ? (
              <View style={styles.tabBody}>
                <Text style={styles.paragraph}>
                  Eight years tutoring K–8 across the metro area. I focus on building number sense first, fluency second — your
                  kid will tell you why a problem works, not just the answer.
                </Text>

                <Text style={styles.eyebrow}>Specialties</Text>
                <View style={styles.wrapRow}>
                  {SPECIALTIES.map((s) => (
                    <View key={s} style={styles.outlineChip}>
                      <Text style={styles.outlineChipText}>{s}</Text>
                    </View>
                  ))}
                </View>

                <Text style={styles.eyebrow}>Languages</Text>
                <Text style={styles.value}>English · Spanish · Yoruba</Text>

                <Text style={styles.eyebrow}>Services & rates</Text>
                <View style={styles.rateList}>
                  {RATES.map((s) => (
                    <View key={s.cat} style={styles.rateItem}>
                      <View style={[styles.rateTag, { backgroundColor: s.tint }]}>
                        <Text style={styles.rateTagText}>{s.cat}</Text>
                      </View>
                      <Text style={styles.rateNote} numberOfLines={1}>
                        {s.note}
                      </Text>
                      <Text style={styles.rateItemRate}>
                        {s.rate}
                        <Text style={styles.rateItemUnit}>/hr</Text>
                      </Text>
                    </View>
                  ))}
                </View>

                <Text style={styles.eyebrow}>Ages & comfort</Text>
                <Text style={styles.value}>Works with ages 4–13 · comfortable supporting:</Text>
                <View style={styles.wrapRow}>
                  {COMFORT.map((c) => (
                    <Chip key={c} label={c} tone="comfort" />
                  ))}
                </View>

                <Text style={styles.eyebrow}>Credentials</Text>
                <View style={styles.wrapRow}>
                  <CredBadge label="CPR & First Aid" status="verified" icon="check-circle" />
                  <CredBadge label="Child Development Associate" status="verified" icon="check-circle" />
                  <CredBadge label="Water Safety Instructor" status="pending" />
                </View>
              </View>
            ) : null}

            {tab === 'Availability' ? (
              <View style={styles.tabBody}>
                <Text style={styles.paragraph}>Typical weekly availability. Send a message to confirm a specific slot.</Text>
                {AVAILABILITY.map((a) => (
                  <View key={a.day} style={styles.availRow}>
                    <Text style={styles.availDay}>{a.day}</Text>
                    <Text style={styles.availBands}>{a.bands}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {tab === 'Reviews' ? (
              <View style={styles.tabBody}>
                {REVIEWS.map((r) => (
                  <View key={r.name} style={styles.reviewCard}>
                    <View style={styles.reviewHead}>
                      <Avatar label={r.name} size="sm" tone={r.tone} />
                      <View style={styles.reviewWho}>
                        <Text style={styles.reviewName}>{r.name}</Text>
                        <RatingValue value={r.value} size={13} />
                      </View>
                    </View>
                    <Text style={styles.reviewText}>{r.text}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {/* ── right: booking action card ──────────────────── */}
          <View style={styles.aside}>
            <View style={styles.bookCard}>
              <View style={styles.rateBlock}>
                <Text style={styles.rateFrom}>FROM</Text>
                <Text style={styles.rateBig}>
                  $28
                  <Text style={styles.ratePer}> /hr</Text>
                </Text>
              </View>
              <PrimaryButton onPress={() => go('/booking-compose')} style={styles.bookBtn}>
                Book a slot
              </PrimaryButton>
              <Pressable
                onPress={() => go('/message-thread')}
                style={({ pressed }) => [styles.messageBtn, { opacity: pressed ? 0.9 : 1 }]}
              >
                <Icon name="message" size={18} color={colors.ink} />
                <Text style={styles.messageText}>Message</Text>
              </Pressable>

              <View style={styles.facts}>
                {QUICK_FACTS.map((f) => (
                  <View key={f.label} style={styles.factRow}>
                    <View style={styles.factIcon}>
                      <Icon name={f.icon} size={15} color={colors.brand} />
                    </View>
                    <View style={styles.flexMin}>
                      <Text style={styles.factLabel}>{f.label}</Text>
                      <Text style={styles.factValue}>{f.value}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.safeNote}>
                <Icon name="shield" size={14} color={colors.brand} />
                <Text style={styles.safeNoteText}>
                  Payments and messaging stay on-platform. Contact details are auto-redacted until a Job is awarded.
                </Text>
              </View>
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
  columns: { flexDirection: 'row', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' },
  main: { flex: 1, minWidth: 420 },
  aside: { width: 320 },

  heroCard: { flexDirection: 'row', gap: 20, backgroundColor: colors.surface, borderRadius: 24, padding: 16, ...shadow.e1 },
  heroPortrait: { width: 240, borderRadius: radii.lg, overflow: 'hidden' },
  heroInfo: { flex: 1, minWidth: 0, paddingVertical: 6 },
  heroChips: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alsoPill: { height: 28, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  alsoText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink2 },
  name: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 34, letterSpacing: -0.8, color: colors.ink, marginTop: 14 },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, marginTop: 6 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  ratingMeta: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  offerPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, height: 26, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: colors.brandSoft, marginTop: 14 },
  offerText: { fontFamily: fonts.bold, fontSize: 11.5, color: colors.brand },

  tabs: { marginTop: 24, maxWidth: 420 },
  tabBody: { marginTop: 22 },
  paragraph: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, color: colors.ink, maxWidth: 640 },
  eyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2, marginTop: 24 },
  value: { fontFamily: fonts.regular, fontSize: 15, color: colors.ink, marginTop: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, maxWidth: 640 },
  outlineChip: { height: 32, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  outlineChipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink },

  rateList: { gap: 8, marginTop: 10, maxWidth: 520 },
  rateItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radii.sm, padding: 12, borderWidth: 1, borderColor: colors.hairline },
  rateTag: { height: 26, paddingHorizontal: 11, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  rateTagText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink },
  rateNote: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2 },
  rateItemRate: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] },
  rateItemUnit: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },

  availRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.hairline, maxWidth: 520 },
  availDay: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  availBands: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2 },

  reviewCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, marginBottom: 12, maxWidth: 640, ...shadow.e1 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewWho: { gap: 2 },
  reviewName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  reviewText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink, marginTop: 10 },

  // booking card
  bookCard: { backgroundColor: colors.surface, borderRadius: 24, padding: 20, ...shadow.e2 },
  rateBlock: { marginBottom: 16 },
  rateFrom: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.3, color: colors.ink3 },
  rateBig: { fontFamily: fonts.bold, fontSize: 36, lineHeight: 38, letterSpacing: -1.2, color: colors.ink, fontVariant: ['tabular-nums'], marginTop: 2 },
  ratePer: { fontFamily: fonts.regular, fontSize: 15, letterSpacing: 0, color: colors.ink2 },
  bookBtn: { height: 52 },
  messageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.surface, marginTop: 10 },
  messageText: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: -0.2, color: colors.ink },

  facts: { marginTop: 18, gap: 14 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  factIcon: { width: 34, height: 34, borderRadius: radii.pill, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  factLabel: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.3, textTransform: 'uppercase', color: colors.ink3 },
  factValue: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.ink, marginTop: 1 },

  safeNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 18, padding: 12, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  safeNoteText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink },
});
