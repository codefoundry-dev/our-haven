/**
 * Provider detail (design: screens/provider-detail.jsx + screens/provider.jsx).
 *
 * Full-bleed hero Portrait over the category pastel with overlay back/share/
 * bookmark buttons, an overlapping info block (CategoryChip + badges + name +
 * RatingValue + rate as a big number), an About/Availability/Reviews TabStrip
 * with simple content per tab, and a sticky Message + Book-a-slot CTA bar.
 * UI scaffold — inline sample data.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, CredBadge } from '@/components/ui/Badge';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
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

export default function ProviderDetailScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('About');

  return (
    <Screen edges={['top']} contentStyle={styles.content}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <Portrait height={300} tint={colors.catTutor} label="provider portrait · 4:5" />
          <View style={styles.heroBar}>
            <IconButton name="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
            <View style={styles.heroActions}>
              <IconButton name="bookmark" accessibilityLabel="Save" />
              <IconButton name="arrow-up-right" accessibilityLabel="Share" />
            </View>
          </View>
          <View style={styles.heroFoot}>
            <CategoryChip category="Tutor" />
            <View style={styles.alsoPill}>
              <Text style={styles.alsoText}>Also offers Babysitter</Text>
            </View>
          </View>
        </View>

        {/* Info block */}
        <View style={styles.body}>
          <View style={styles.infoRow}>
            <View style={styles.infoLeft}>
              <Text style={styles.name}>Maya Okafor</Text>
              <Text style={styles.sub}>K–8 Math · Eastside · 2.3 mi away</Text>
              <View style={styles.ratingRow}>
                <RatingValue value={4.9} size={16} />
                <Text style={styles.ratingMeta}>· 87 reviews · replies in 1h</Text>
              </View>
            </View>
            <View style={styles.rateCol}>
              <Text style={styles.rateFrom}>FROM</Text>
              <Text style={styles.rateBig}>$28</Text>
              <Text style={styles.ratePer}>per hour</Text>
            </View>
          </View>

          <View style={styles.offerRow}>
            <View style={styles.offerPill}>
              <Icon name="sparkle" size={12} color={colors.brand} />
              <Text style={styles.offerText}>Open to Offers</Text>
            </View>
          </View>

          {/* Badges */}
          <View style={styles.badges}>
            <Badge kind="verified" />
            <Badge kind="tax" />
            <Badge kind="toprated" />
          </View>

          {/* Tabs */}
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
      </ScrollView>

      {/* Sticky CTA */}
      <View style={styles.footer}>
        <Pressable
          onPress={() => router.push('/message-thread')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.9 : 1 }]}
        >
          <Icon name="message" size={18} color={colors.ink} />
          <Text style={styles.secondaryText}>Message</Text>
        </Pressable>
        <PrimaryButton onPress={() => router.push('/booking-compose')} style={styles.primaryBtn}>
          Book a slot
        </PrimaryButton>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: 0 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  hero: { height: 300 },
  heroBar: { position: 'absolute', top: 12, left: 24, right: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroActions: { flexDirection: 'row', gap: 8 },
  heroFoot: { position: 'absolute', bottom: 44, left: 24, flexDirection: 'row', alignItems: 'center', gap: 8 },
  alsoPill: { height: 28, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: 'rgba(22,21,19,0.55)', alignItems: 'center', justifyContent: 'center' },
  alsoText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.inkInv },

  body: { marginTop: -28, backgroundColor: colors.canvas, borderTopLeftRadius: 36, borderTopRightRadius: 36, paddingTop: 24, paddingHorizontal: 24 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  infoLeft: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 32, letterSpacing: -0.6, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, marginTop: 6 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  ratingMeta: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  rateCol: { alignItems: 'flex-end' },
  rateFrom: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.3, color: colors.ink3 },
  rateBig: { fontFamily: fonts.bold, fontSize: 40, lineHeight: 40, letterSpacing: -1.2, color: colors.ink, fontVariant: ['tabular-nums'] },
  ratePer: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 4 },

  offerRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  offerPill: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: colors.brandSoft },
  offerText: { fontFamily: fonts.bold, fontSize: 11.5, color: colors.brand },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  tabs: { marginTop: 24 },
  tabBody: { marginTop: 20 },
  paragraph: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, color: colors.ink },
  eyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2, marginTop: 24 },
  value: { fontFamily: fonts.regular, fontSize: 15, color: colors.ink, marginTop: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  outlineChip: { height: 32, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  outlineChipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink },

  rateList: { gap: 8, marginTop: 10 },
  rateItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radii.sm, padding: 12, borderWidth: 1, borderColor: colors.hairline },
  rateTag: { height: 26, paddingHorizontal: 11, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  rateTagText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink },
  rateNote: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2 },
  rateItemRate: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] },
  rateItemUnit: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },

  availRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  availDay: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  availBands: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2 },

  reviewCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, marginBottom: 12, ...shadow.e1 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewWho: { gap: 2 },
  reviewName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  reviewText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink, marginTop: 10 },

  footer: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: colors.surface,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 24,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    ...shadow.e2,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  secondaryText: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: -0.2, color: colors.ink },
  primaryBtn: { flex: 1 },
});
