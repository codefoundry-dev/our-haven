/**
 * Job detail (Caregiver view) — one open Job a Caregiver can apply to. Synthesised
 * from the design's open-Job card (screens/provider-opps.jsx) + the Job info banner
 * (screens/jobs.jsx ScreenJobDetail): family summary, concrete schedule, budget,
 * disclosed Safety Behaviors, child details, location/distance, and a sticky Apply
 * CTA → /job-apply. Reached from the Opportunities feed / Home rail. Mock data.
 *
 * This is the native (and narrow-web) body; the desktop layout lives in
 * `@/screens/web/cp/JobDetail` and is chosen by `job-detail.web.tsx`.
 */
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { Chip } from '@/components/ui/Chip';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { RatingValue } from '@/components/ui/StarRating';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const JOB = {
  category: 'Tutor' as const,
  title: '5th-grade math support, twice weekly after school',
  when: 'Tue & Thu · 3:30–5:00 PM',
  recurring: 'Recurring through Jul 2 · 12 sessions',
  distance: 'Eastside · 1.8 mi away',
  applied: 'Open · 7/15 applied',
  budget: '$30–40 / hr',
  perSession: '≈ $48–60 per 1.5h session',
  child: '1 child · age 10',
  behaviors: ['Food allergy · EpiPen', 'ADHD'],
  description:
    'Our 5th-grader needs help shoring up fractions, ratios, and word problems before middle-school placement testing. Looking for someone patient, structured, and comfortable with a curious-but-restless learner.',
  parent: { name: 'Priya N.', meta: 'Parent · Eastside · 90210', rating: 4.9, reviews: 18 },
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function JobDetailScreen() {
  const router = useRouter();

  return (
    <Screen edges={['top']}>
      <AppBar onBack={() => router.back()} title="Job detail" actions={[{ icon: 'bookmark', label: 'Save' }]} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Info banner */}
        <View style={styles.banner}>
          <View style={styles.bannerTop}>
            <CategoryChip category={JOB.category} />
            <Chip label={JOB.applied} tone="info" />
          </View>
          <Text style={styles.title}>{JOB.title}</Text>
          <View style={styles.metaRow}>
            <Icon name="pin" size={14} color={colors.ink3} />
            <Text style={styles.metaText}>{JOB.distance}</Text>
          </View>
        </View>

        {/* Family summary */}
        <Pressable style={styles.familyCard}>
          <Avatar label={JOB.parent.name} size="md" tone="catNanny" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.familyName}>{JOB.parent.name}</Text>
            <Text style={styles.familyMeta}>{JOB.parent.meta}</Text>
          </View>
          <RatingValue value={JOB.parent.rating} count={JOB.parent.reviews} />
        </Pressable>

        {/* Schedule */}
        <Text style={styles.sectionLabel}>Schedule</Text>
        <View style={styles.card}>
          <Row label="When" value={JOB.when} />
          <View style={styles.divider} />
          <Row label="Recurrence" value={JOB.recurring} />
        </View>

        {/* Pay */}
        <Text style={styles.sectionLabel}>Pay</Text>
        <View style={styles.payCard}>
          <Text style={styles.payHint}>Budget hint</Text>
          <Text style={styles.payAmount}>{JOB.budget}</Text>
          <Text style={styles.paySub}>{JOB.perSession}</Text>
        </View>

        {/* Child details */}
        <Text style={styles.sectionLabel}>Child</Text>
        <Chip label={JOB.child} tone="child" icon="users" />

        {/* Safety behaviours */}
        <Text style={styles.sectionLabel}>Disclosed Safety Behaviors</Text>
        <View style={styles.chipWrap}>
          {JOB.behaviors.map((b) => (
            <Chip key={b} label={b} tone="safety" icon="shield" />
          ))}
        </View>

        {/* Description */}
        <Text style={styles.sectionLabel}>About this Job</Text>
        <Text style={styles.description}>{JOB.description}</Text>
        <Text style={styles.posted}>Posted Monday · expires in 12 days</Text>
      </ScrollView>

      {/* Sticky Apply CTA */}
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Message family"
          style={({ pressed }) => [styles.ghostBtn, { opacity: pressed ? 0.85 : 1 }]}
          onPress={() => router.push('/message-thread')}
        >
          <Icon name="message" size={18} color={colors.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <PrimaryButton icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />} onPress={() => router.push('/job-apply')}>
            Apply to this Job
          </PrimaryButton>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, marginHorizontal: -24 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },

  banner: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 20, ...shadow.e1 },
  bannerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4, color: colors.ink, marginTop: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  metaText: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },

  familyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 14, marginTop: 12, ...shadow.e1 },
  familyName: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  familyMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },

  sectionLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginTop: 24, marginBottom: 10 },

  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  rowLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  rowValue: { flex: 1, fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, textAlign: 'right' },
  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: 12 },

  payCard: { backgroundColor: colors.surfaceAlt, borderRadius: radii.lg, padding: 16 },
  payHint: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  payAmount: { fontFamily: fonts.bold, fontSize: 28, letterSpacing: -0.8, color: colors.ink, marginTop: 4, fontVariant: ['tabular-nums'] },
  paySub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 4 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  description: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, color: colors.ink },
  posted: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3, marginTop: 8 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: -24,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 16,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    ...shadow.e2,
  },
  ghostBtn: { width: 56, height: 56, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});
