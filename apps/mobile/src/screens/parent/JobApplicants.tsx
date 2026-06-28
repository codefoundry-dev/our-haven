/**
 * Job applicants (Parent) — review the Caregivers who applied to one of your
 * posted Jobs and extend an offer. Built from the Claude design project
 * (screens/jobs.jsx ScreenJobDetail + screens/offer.jsx) as the Parent-side
 * applicant-review surface. UI-only skeleton with mock data.
 */
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, Pressable } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, type BadgeKind } from '@/components/ui/Badge';
import { CategoryChip, type Category } from '@/components/ui/CategoryChip';
import { RatingValue } from '@/components/ui/StarRating';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

interface Applicant {
  id: string;
  name: string;
  category: Category;
  tone: ColorToken;
  rating: number;
  reviews: number;
  badges: BadgeKind[];
  rate: number;
  hours: number;
  total: number;
  proposal: string;
}

const APPLICANTS: Applicant[] = [
  {
    id: '1',
    name: 'Maya Okafor',
    category: 'Tutor',
    tone: 'catTutor',
    rating: 4.9,
    reviews: 32,
    badges: ['verified', 'toprated'],
    rate: 32,
    hours: 2,
    total: 64,
    proposal: "I've tutored 3rd–6th grade math for 4 years. I'd start with a diagnostic and send weekly progress notes.",
  },
  {
    id: '2',
    name: 'Daniel Reyes',
    category: 'Tutor',
    tone: 'catNanny',
    rating: 4.8,
    reviews: 21,
    badges: ['verified'],
    rate: 38,
    hours: 2,
    total: 76,
    proposal: 'Math teacher at Sunset Elementary, 9 years experience. I can do Tue/Thu reliably and align with the school curriculum.',
  },
  {
    id: '3',
    name: 'Priya Nair',
    category: 'Tutor',
    tone: 'catBaby',
    rating: 5.0,
    reviews: 14,
    badges: ['verified', 'tax'],
    rate: 30,
    hours: 2,
    total: 60,
    proposal: 'Tutoring 4th–6th since 2021, building intuition with manipulatives before drilling. Happy to send a learning plan.',
  },
];

export default function JobApplicantsScreen() {
  const router = useRouter();

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar title="Applicants" onBack={() => router.back()} actions={[{ icon: 'dots', label: 'Job options' }]} />

      {/* Job summary */}
      <View style={styles.summary}>
        <View style={styles.summaryTop}>
          <CategoryChip category="Tutor" />
          <View style={styles.statusPill}>
            <Text style={styles.statusText}>Open · 7/15 applied</Text>
          </View>
        </View>
        <Text style={styles.jobTitle}>5th-grade math support, twice weekly after school</Text>
        <Text style={styles.jobMeta}>Tue & Thu · 3:30–5:00 PM · Recurring through Jul 2 · 1.4 mi away</Text>
      </View>

      {/* Section header */}
      <View style={styles.listHead}>
        <Text style={styles.listHeadTitle}>{APPLICANTS.length} Applications</Text>
        <View style={styles.sort}>
          <Text style={styles.sortText}>Newest first</Text>
          <Icon name="chevron-down" size={12} color={colors.ink} />
        </View>
      </View>

      <View style={styles.list}>
        {APPLICANTS.map((a) => (
          <View key={a.id} style={styles.card}>
            <View style={styles.cardHead}>
              <Avatar label={a.name} tone={a.tone} size="md" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {a.name}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={styles.category}>{a.category}</Text>
                  <Text style={styles.dot}>·</Text>
                  <RatingValue value={a.rating} count={a.reviews} size={13} />
                </View>
              </View>
            </View>

            <View style={styles.badges}>
              {a.badges.map((b) => (
                <Badge key={b} kind={b} />
              ))}
            </View>

            <View style={styles.priceBox}>
              <Text style={styles.priceTotal}>${a.total} total</Text>
              <Text style={styles.priceSub}>
                ${a.rate}/hr × {a.hours}h, 1 child
              </Text>
            </View>

            <Text style={styles.proposal}>{a.proposal}</Text>

            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/message-thread')}
                style={({ pressed }) => [styles.btn, styles.btnGhost, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Icon name="message" size={15} color={colors.ink} />
                <Text style={styles.btnGhostText}>Message</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/booking-compose')}
                style={({ pressed }) => [styles.btn, styles.btnPrimary, { opacity: pressed ? 0.9 : 1 }]}
              >
                <Icon name="dollar" size={15} color={colors.inkInv} />
                <Text style={styles.btnPrimaryText}>Make offer</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },

  summary: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 18, marginTop: 8, ...shadow.e1 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusPill: { height: 24, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: 'rgba(58,111,168,0.12)', alignItems: 'center', justifyContent: 'center' },
  statusText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.info },
  jobTitle: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, letterSpacing: -0.3, color: colors.ink, marginTop: 12 },
  jobMeta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink2, marginTop: 6 },

  listHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 26, marginBottom: 12 },
  listHeadTitle: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.4, color: colors.ink },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  sortText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },

  list: { gap: 12 },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 16, ...shadow.e1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  category: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  dot: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },

  priceBox: { marginTop: 12, backgroundColor: colors.surfaceAlt, borderRadius: radii.sm, paddingVertical: 10, paddingHorizontal: 14 },
  priceTotal: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.3, color: colors.ink, fontVariant: ['tabular-nums'] },
  priceSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },

  proposal: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink2, marginTop: 12 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, height: 44, borderRadius: radii.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnGhost: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.ink },
  btnGhostText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  btnPrimary: { backgroundColor: colors.brand },
  btnPrimaryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },
});
