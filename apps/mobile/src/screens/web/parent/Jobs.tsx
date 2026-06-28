/**
 * ParentJobsWeb — the Parent's posted Jobs + applicants on desktop web.
 * Content-only: the dispatcher wraps this in <ParentWebShell>.
 *
 * Ported from the Claude Design web project (parent-web/pw-jobs.jsx) and the
 * native Parent Home open-Jobs rail + job-applicants screen: a two-pane desktop
 * layout — left is the selectable list of the parent's open Jobs; right is the
 * selected Job's summary and its applicant cards with Message / Make-offer
 * actions. RN primitives only.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { WebPageHeader } from '@/components/web/ParentWebShell';
import { Icon } from '@/components/Icon';
import { Avatar, AvatarGroup } from '@/components/ui/Avatar';
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

const MAYA: Applicant = { id: 'a1', name: 'Maya Okafor', category: 'Tutor', tone: 'catTutor', rating: 4.9, reviews: 32, badges: ['verified', 'toprated'], rate: 32, hours: 2, total: 64, proposal: "I've tutored 3rd–6th grade math for 4 years. I'd start with a diagnostic and send weekly progress notes." };
const DANIEL: Applicant = { id: 'a2', name: 'Daniel Reyes', category: 'Tutor', tone: 'catNanny', rating: 4.8, reviews: 21, badges: ['verified'], rate: 38, hours: 2, total: 76, proposal: 'Math teacher at Sunset Elementary, 9 years experience. I can do Tue/Thu reliably and align with the school curriculum.' };
const PRIYA: Applicant = { id: 'a3', name: 'Priya Nair', category: 'Tutor', tone: 'catBaby', rating: 5.0, reviews: 14, badges: ['verified', 'tax'], rate: 30, hours: 2, total: 60, proposal: 'Tutoring 4th–6th since 2021, building intuition with manipulatives before drilling. Happy to send a learning plan.' };

interface Job {
  id: string;
  cat: Category;
  tone: ColorToken;
  title: string;
  schedule: string;
  applied: number;
  days: string;
  applicants: Applicant[];
}

const JOBS: Job[] = [
  { id: 'tutor', cat: 'Tutor', tone: 'catTutor', title: '5th-grade math support, twice weekly after school', schedule: 'Tue & Thu · 3:30–5:00 PM · Recurring through Jul 2 · 1.4 mi', applied: 7, days: '6 days left', applicants: [MAYA, DANIEL, PRIYA] },
  { id: 'sitter', cat: 'Babysitter', tone: 'catBaby', title: 'Saturday evening sitter for 2 kids', schedule: 'Sat · 6:00–10:00 PM · one-off · 0.8 mi', applied: 4, days: '2 days left', applicants: [PRIYA, MAYA] },
  { id: 'nanny', cat: 'Nanny', tone: 'catNanny', title: 'After-school nanny for two kids, ages 4–6', schedule: 'Mon–Fri · 3:00–6:00 PM · Recurring · 2.0 mi', applied: 2, days: '11 days left', applicants: [DANIEL] },
];

const APP_TONES: ColorToken[] = ['catTutor', 'catBaby', 'catNanny'];

export function ParentJobsWeb() {
  const router = useRouter();
  const go = (route: string) => router.push(route as never);
  const [selected, setSelected] = useState<string>('tutor');
  const active = JOBS.find((j) => j.id === selected) ?? JOBS[0];

  return (
    <View>
      <WebPageHeader greet="Your postings" title="Jobs" primary="Post a Job" onPrimary={() => go('/post-job')} />

      <View style={styles.body}>
        <View style={styles.columns}>
          {/* ── left: posted jobs ───────────────────────── */}
          <View style={styles.list}>
            <Text style={styles.listLabel}>Open Jobs · {JOBS.length}</Text>
            {JOBS.map((j) => {
              const on = j.id === selected;
              return (
                <Pressable
                  key={j.id}
                  onPress={() => setSelected(j.id)}
                  style={({ pressed }) => [styles.jobRow, on && styles.jobRowActive, { opacity: pressed ? 0.96 : 1 }]}
                >
                  <View style={styles.jobTop}>
                    <CategoryChip category={j.cat} />
                    <View style={styles.openPill}>
                      <Text style={styles.openText}>Open · {j.applied}/15</Text>
                    </View>
                  </View>
                  <Text style={styles.jobTitle} numberOfLines={2}>
                    {j.title}
                  </Text>
                  <View style={styles.jobBottom}>
                    <AvatarGroup items={Array.from({ length: j.applied }, (_, k) => ({ tone: APP_TONES[k % APP_TONES.length] }))} />
                    <Text style={styles.jobDays}>{j.days}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* ── right: applicants ───────────────────────── */}
          <View style={styles.detail}>
            <View style={styles.summary}>
              <View style={styles.summaryTop}>
                <CategoryChip category={active.cat} />
                <View style={styles.statusPill}>
                  <Text style={styles.statusText}>Open · {active.applied}/15 applied</Text>
                </View>
              </View>
              <Text style={styles.summaryTitle}>{active.title}</Text>
              <Text style={styles.summaryMeta}>{active.schedule}</Text>
            </View>

            <View style={styles.listHead}>
              <Text style={styles.listHeadTitle}>{active.applicants.length} Applications</Text>
              <View style={styles.sort}>
                <Text style={styles.sortText}>Newest first</Text>
                <Icon name="chevron-down" size={12} color={colors.ink} />
              </View>
            </View>

            <View style={styles.applicants}>
              {active.applicants.map((a) => (
                <View key={a.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Avatar label={a.name} tone={a.tone} size="md" />
                    <View style={styles.flexMin}>
                      <Text style={styles.name} numberOfLines={1}>
                        {a.name}
                      </Text>
                      <View style={styles.metaRow}>
                        <Text style={styles.category}>{a.category}</Text>
                        <Text style={styles.dot}>·</Text>
                        <RatingValue value={a.rating} count={a.reviews} size={13} />
                      </View>
                    </View>
                    <View style={styles.priceBox}>
                      <Text style={styles.priceTotal}>${a.total}</Text>
                      <Text style={styles.priceSub}>
                        ${a.rate}/hr × {a.hours}h
                      </Text>
                    </View>
                  </View>

                  <View style={styles.badges}>
                    {a.badges.map((b) => (
                      <Badge key={b} kind={b} />
                    ))}
                  </View>

                  <Text style={styles.proposal}>{a.proposal}</Text>

                  <View style={styles.actions}>
                    <Pressable
                      onPress={() => go('/message-thread')}
                      style={({ pressed }) => [styles.btn, styles.btnGhost, { opacity: pressed ? 0.85 : 1 }]}
                    >
                      <Icon name="message" size={15} color={colors.ink} />
                      <Text style={styles.btnGhostText}>Message</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => go('/booking-compose')}
                      style={({ pressed }) => [styles.btn, styles.btnPrimary, { opacity: pressed ? 0.9 : 1 }]}
                    >
                      <Icon name="dollar" size={15} color={colors.inkInv} />
                      <Text style={styles.btnPrimaryText}>Make offer</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
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

  list: { width: 320, gap: 12 },
  listLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 2 },
  jobRow: { backgroundColor: colors.surface, borderRadius: 20, padding: 16, gap: 12, borderWidth: 1.5, borderColor: 'transparent', ...shadow.e1 },
  jobRowActive: { borderColor: colors.brand },
  jobTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  openPill: { height: 24, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: 'rgba(58,111,168,0.12)', alignItems: 'center', justifyContent: 'center' },
  openText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.info },
  jobTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.ink },
  jobBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobDays: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink3 },

  detail: { flex: 1, minWidth: 420 },
  summary: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 20, ...shadow.e1 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusPill: { height: 24, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: 'rgba(58,111,168,0.12)', alignItems: 'center', justifyContent: 'center' },
  statusText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.info },
  summaryTitle: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: colors.ink, marginTop: 14 },
  summaryMeta: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: colors.ink2, marginTop: 6 },

  listHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 26, marginBottom: 14 },
  listHeadTitle: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.4, color: colors.ink },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  sortText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },

  applicants: { gap: 14 },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 18, ...shadow.e1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  category: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2 },
  dot: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },
  priceBox: { alignItems: 'flex-end' },
  priceTotal: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink, fontVariant: ['tabular-nums'] },
  priceSub: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink2, marginTop: 1 },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  proposal: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: colors.ink2, marginTop: 12 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 16, maxWidth: 360 },
  btn: { flex: 1, height: 44, borderRadius: radii.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnGhost: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.ink },
  btnGhostText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  btnPrimary: { backgroundColor: colors.brand },
  btnPrimaryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },
});
