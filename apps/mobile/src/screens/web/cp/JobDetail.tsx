/**
 * CaregiverJobDetailWeb — a Caregiver reading one open Parent Job in full on
 * desktop web. Content-only: the route dispatcher wraps this in
 * <WebShell role="caregiver" active="opportunities">.
 *
 * Faithful port of the Claude Design web project (cp-web/cp-opportunities.jsx →
 * CPJobDetailProvider): a two-column layout — the Job body on the left (banner ·
 * child & care needs · schedule · pay · description) and an "apply / at a glance"
 * rail on the right (About this Parent · facts · a dark Apply card). Content is the
 * native screen's source of truth (@/screens/caregiver/JobDetail); the right-rail
 * primary routes to /job-apply (Caregivers apply with an Offer — ADR-0011). RN
 * primitives only (renders via react-native-web).
 */
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { Chip } from '@/components/ui/Chip';
import { WebPageHeader } from '@/components/web/WebShell';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const JOB = {
  category: 'Tutor' as const,
  title: '5th-grade math support, twice weekly after school',
  when: 'Tue & Thu · 3:30–5:00 PM',
  recurring: 'Recurring through Jul 2 · 12 sessions',
  distance: 'Eastside · 1.8 mi away',
  applied: 'Open · 7/15 applied',
  applicants: '7 / 15 applied',
  budget: '$30–40 / hr',
  perSession: '≈ $48–60 per 1.5h session',
  child: '1 child · age 10',
  behaviors: ['Food allergy · EpiPen', 'ADHD'],
  topics: ['Fractions', 'Word problems', 'Placement prep', 'After-school', 'Recurring'],
  description:
    'Our 5th-grader needs help shoring up fractions, ratios, and word problems before middle-school placement testing. Looking for someone patient, structured, and comfortable with a curious-but-restless learner.',
  posted: 'Posted Monday · expires in 12 days',
  parent: { name: 'Priya N.', meta: 'Eastside · 90210', rating: 4.9, reviews: 18 },
  parentStats: [
    ['Member since', 'Aug 2024'],
    ['Jobs posted', '4'],
    ['Typically replies', 'within a day'],
  ] as const,
};

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

export function CaregiverJobDetailWeb() {
  const router = useRouter();
  const go = (r: string) => router.push(r as never);

  return (
    <View>
      <WebPageHeader greet="Opportunities · Open Job" title="5th-grade math support" actions={['bell', 'message']} />

      <View style={styles.body}>
        <View style={styles.layout}>
          {/* ── left · the Job in full ──────────────────────────────── */}
          <View style={styles.mainCol}>
            {/* banner */}
            <Card radius={radii.xl} padding={24} style={styles.card}>
              <View style={styles.bannerTop}>
                <CategoryChip category={JOB.category} />
                <Chip label={JOB.applied} tone="info" />
                <View style={styles.flex} />
                <Text style={styles.posted}>{JOB.posted}</Text>
              </View>
              <Text style={styles.title}>{JOB.title}</Text>
              <View style={styles.metaRow}>
                <Icon name="pin" size={14} color={colors.ink3} />
                <Text style={styles.metaText}>{JOB.distance}</Text>
                <Text style={styles.metaDot}>·</Text>
                <Icon name="calendar" size={14} color={colors.ink3} />
                <Text style={styles.metaText}>{JOB.when}</Text>
              </View>
            </Card>

            {/* child & care needs */}
            <Card radius={radii.xl} padding={24} style={styles.card}>
              <Text style={styles.secHead}>Child &amp; care needs</Text>
              <View style={styles.chipWrap}>
                <Chip label={JOB.child} tone="child" icon="users" />
              </View>
              <Text style={styles.shareNote}>
                This family chose to share the following Safety Behaviors so you can decide if it&rsquo;s a good fit:
              </Text>
              <View style={styles.chipWrap}>
                {JOB.behaviors.map((b) => (
                  <Chip key={b} label={b} tone="safety" icon="shield" />
                ))}
              </View>
              <View style={styles.matchNote}>
                <Icon name="check-circle" size={18} color={colors.success} />
                <Text style={styles.matchText}>
                  <Text style={styles.matchBold}>Matches your comfort settings.</Text> You&rsquo;ve marked both as supported.
                </Text>
              </View>
            </Card>

            {/* schedule */}
            <Card radius={radii.xl} padding={24} style={styles.card}>
              <Text style={styles.secHead}>Schedule</Text>
              <FactRow label="When" value={JOB.when} />
              <View style={styles.divider} />
              <FactRow label="Recurrence" value={JOB.recurring} />
            </Card>

            {/* description */}
            <Card radius={radii.xl} padding={24} style={styles.card}>
              <Text style={styles.secHead}>About this Job</Text>
              <Text style={styles.description}>{JOB.description}</Text>
              <View style={styles.topicWrap}>
                {JOB.topics.map((t) => (
                  <View key={t} style={styles.topic}>
                    <Text style={styles.topicText}>{t}</Text>
                  </View>
                ))}
              </View>
            </Card>

            {/* pay */}
            <Card radius={radii.xl} padding={20} style={StyleSheet.flatten([styles.card, styles.payCard])}>
              <View style={styles.payIcon}>
                <Icon name="dollar" size={18} color={colors.ink} />
              </View>
              <View style={styles.flexMin}>
                <Text style={styles.payTitle}>Budget hint · {JOB.budget}</Text>
                <Text style={styles.paySub}>{JOB.perSession} · open to Offers — your Offer sets the price.</Text>
              </View>
            </Card>
          </View>

          {/* ── right · apply / at a glance rail ────────────────────── */}
          <View style={styles.sideCol}>
            {/* about this Parent */}
            <Card radius={radii.xl} padding={22} style={styles.card}>
              <Text style={styles.secHead}>About this Parent</Text>
              <View style={styles.parentRow}>
                <Avatar label={JOB.parent.name} size="lg" tone="catNanny" />
                <View style={styles.flexMin}>
                  <Text style={styles.parentName}>{JOB.parent.name}</Text>
                  <View style={styles.parentRating}>
                    <Icon name="star" size={13} color={colors.highlight} />
                    <Text style={styles.parentRatingText}>
                      {JOB.parent.rating.toFixed(1)} · {JOB.parent.reviews} ratings · {JOB.parent.meta}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={styles.parentStats}>
                {JOB.parentStats.map(([l, v]) => (
                  <FactRow key={l} label={l} value={v} />
                ))}
              </View>
            </Card>

            {/* at a glance */}
            <Card radius={radii.xl} padding={22} style={styles.card}>
              <Text style={styles.secHead}>At a glance</Text>
              <FactRow label="Schedule" value={JOB.when} />
              <View style={styles.divider} />
              <FactRow label="Recurrence" value={JOB.recurring} />
              <View style={styles.divider} />
              <FactRow label="Distance" value={JOB.distance} />
              <View style={styles.divider} />
              <FactRow label="Applicants" value={JOB.applicants} />
            </Card>

            {/* dark apply card */}
            <View style={styles.applyCard}>
              <Text style={styles.applyKicker}>Open to Offers</Text>
              <Text style={styles.applyAmount}>{JOB.budget}</Text>
              <Text style={styles.applySub}>Budget hint · your Offer sets the actual price.</Text>

              <Pressable onPress={() => go('/job-apply')} style={styles.applyBtn}>
                <Text style={styles.applyBtnText}>Apply with an Offer</Text>
                <Icon name="arrow-right" size={16} color={colors.inkInv} />
              </Pressable>

              <Pressable onPress={() => go('/message-thread')} style={styles.ghostBtn}>
                <Icon name="message" size={15} color={colors.inkInv} />
                <Text style={styles.ghostText}>Message family</Text>
              </Pressable>

              <Pressable style={styles.saveRow}>
                <Icon name="bookmark" size={15} color={colors.inkInv} />
                <Text style={styles.saveText}>Save for later</Text>
              </Pressable>

              <Text style={styles.quotaNote}>12 / 30 applications used this month · resets May 1</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flex: { flex: 1 },
  flexMin: { flex: 1, minWidth: 0 },

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  mainCol: { flexGrow: 1.6, flexBasis: 560, minWidth: 360, gap: 16 },
  sideCol: { flexGrow: 1, flexBasis: 320, minWidth: 280, gap: 16 },

  card: { ...shadow.e1 },
  secHead: { fontFamily: fonts.bold, fontSize: 11.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 14 },

  // banner
  bannerTop: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  posted: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.5, color: colors.ink, marginTop: 14 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10, flexWrap: 'wrap' },
  metaText: { fontFamily: fonts.regular, fontSize: 13.5, color: colors.ink2 },
  metaDot: { fontFamily: fonts.regular, fontSize: 13.5, color: colors.ink3 },

  // child & care needs
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  shareNote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2, marginTop: 14, marginBottom: 8 },
  matchNote: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, padding: 14, borderRadius: radii.md, backgroundColor: 'rgba(47,122,77,0.08)' },
  matchText: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: colors.ink },
  matchBold: { fontFamily: fonts.semibold, color: colors.ink },

  // fact rows (schedule / at a glance / parent stats)
  factRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  factLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  factValue: { flex: 1, fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, textAlign: 'right' },
  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: 12 },

  // description
  description: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, color: colors.ink },
  topicWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  topic: { height: 30, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  topicText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink2 },

  // pay band
  payCard: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  payIcon: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  payTitle: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink },
  paySub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink3, marginTop: 2 },

  // about this Parent
  parentRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  parentName: { fontFamily: fonts.semibold, fontSize: 15.5, color: colors.ink },
  parentRating: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  parentRatingText: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2 },
  parentStats: { marginTop: 16, gap: 8 },

  // dark apply card
  applyCard: { backgroundColor: colors.ink, borderRadius: radii.xl, padding: 22 },
  applyKicker: { fontFamily: fonts.semibold, fontSize: 11.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.inkInv, opacity: 0.6 },
  applyAmount: { fontFamily: fonts.bold, fontSize: 30, letterSpacing: -1, color: colors.inkInv, marginTop: 6, fontVariant: ['tabular-nums'] },
  applySub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.inkInv, opacity: 0.7, marginTop: 2 },
  applyBtn: { marginTop: 18, height: 50, borderRadius: radii.pill, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  applyBtnText: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.inkInv },
  ghostBtn: { marginTop: 10, height: 44, borderRadius: radii.pill, borderWidth: 1.5, borderColor: 'rgba(251,247,239,0.25)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  ghostText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.inkInv },
  saveRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  saveText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv, opacity: 0.85 },
  quotaNote: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.inkInv, opacity: 0.55, marginTop: 14, textAlign: 'center' },
});
