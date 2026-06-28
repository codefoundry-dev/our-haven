/**
 * CaregiverScheduleWeb — the caregiver's week timeline (web only).
 *
 * Faithful port of the Claude Design web project (web-screens/provider-bookings.jsx,
 * with the request-row look from cp-web/cp-booking-requests.jsx): the timeline of
 * everything already agreed (or in motion) — upcoming sessions (left), and the
 * in-session / time-change / awaiting-hours rail (right). Content-only — the route
 * dispatcher wraps this in <WebShell>. React Native primitives only (RN-web).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { CategoryChip, type Category } from '@/components/ui/CategoryChip';
import { StatusPill, type BookingState } from '@/components/ui/StatusPill';
import { WebPageHeader } from '@/components/web/WebShell';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

const TABS = ['Upcoming · 12', 'In session · 1', 'Awaiting hours · 2', 'Past'];

interface Upcoming {
  day: string;
  date: string;
  parent: string;
  child: string;
  cat: Category;
  tint: ColorToken;
  time: string;
  loc: string;
  status: BookingState;
  payout: string;
  flag?: string;
}

const UPCOMING: Upcoming[] = [
  { day: 'Tue', date: '13', parent: 'Chen family', child: 'Liu · age 8', cat: 'Tutor', tint: 'catTutor', time: '4:00–5:00 PM', loc: 'Family home · Coral Gables', status: 'accepted', payout: '$35.00' },
  { day: 'Wed', date: '14', parent: 'Adjei Owusu', child: 'Anika · age 9', cat: 'Tutor', tint: 'catTutor', time: '9:15–9:45 AM', loc: 'Family home · Brickell', status: 'accepted', payout: '$17.50' },
  { day: 'Thu', date: '15', parent: 'Camille Ramos', child: 'Mateo · age 6', cat: 'Specialist', tint: 'catSpec', time: '4:00–5:00 PM', loc: 'Family home · Wynwood', status: 'accepted', payout: '$102.00', flag: 'Special-needs notes available' },
  { day: 'Sat', date: '17', parent: 'Park family', child: 'Theo · 5 · Mia · 8', cat: 'Nanny', tint: 'catNanny', time: '8:00 AM–1:00 PM', loc: 'Family home · Coconut Grove', status: 'accepted', payout: '$132.00' },
];

const IN_SESSION = {
  parent: 'Park family',
  child: 'Theo · age 5',
  cat: 'Nanny',
  started: '08:00 AM',
  elapsed: '3h 47m',
  endsBy: '1:00 PM',
};

interface Awaiting {
  parent: string;
  when: string;
  tint: ColorToken;
  proposed: string;
  autoConfirm: string;
  payout: string;
}

const AWAITING: Awaiting[] = [
  { parent: 'Adjei Owusu', when: 'Wed May 14 · 9:15–9:48 AM', tint: 'catTutor', proposed: '0h 33m', autoConfirm: '21h', payout: '$17.50' },
  { parent: 'Delgado family', when: 'Tue May 13 · 4:00–5:00 PM', tint: 'catSpec', proposed: 'Per-session', autoConfirm: '4h', payout: '$102.00' },
];

function StatTile({ label, value, tint = colors.surfaceAlt, fg = colors.ink }: { label: string; value: string; tint?: string; fg?: string }) {
  return (
    <View style={[styles.statTile, { backgroundColor: tint }]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color: fg }]}>{value}</Text>
    </View>
  );
}

export function CaregiverScheduleWeb() {
  const router = useRouter();
  const go = (r: string) => router.push(r as never);
  const [tab, setTab] = useState(0);

  return (
    <View>
      <WebPageHeader greet="Schedule" title="Your week" actions={['bell', 'message']} />

      <View style={styles.body}>
        {/* tabs + search/filter */}
        <View style={styles.tabsRow}>
          <View style={styles.segment}>
            {TABS.map((t, i) => {
              const on = i === tab;
              return (
                <Pressable key={t} onPress={() => setTab(i)} style={[styles.segItem, on ? styles.segItemOn : null]}>
                  <Text style={[styles.segText, { color: on ? colors.inkInv : colors.ink2 }]}>{t}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.searchCluster}>
            <View style={styles.searchPill}>
              <Icon name="search" size={16} color={colors.ink2} />
              <Text style={styles.searchPlaceholder}>Search parent or child…</Text>
            </View>
            <Pressable style={styles.iconBtn} onPress={() => go('/schedule')}>
              <Icon name="sliders" size={18} color={colors.ink} />
            </Pressable>
          </View>
        </View>

        <View style={styles.layout}>
          {/* ── left · upcoming timeline ──────────────────────── */}
          <View style={styles.mainCol}>
            <Text style={styles.colKicker}>This week · 4 of 12 sessions</Text>
            {UPCOMING.map((b, i) => (
              <Card key={i} radius={radii.lg} padding={18} style={styles.upCard} onPress={() => go('/booking-detail')}>
                <View style={[styles.dateStamp, { backgroundColor: colors[b.tint] }]}>
                  <Text style={styles.dsDow}>{b.day}</Text>
                  <Text style={styles.dsDate}>{b.date}</Text>
                  <Text style={styles.dsMonth}>May</Text>
                </View>
                <View style={styles.flexMin}>
                  <View style={styles.upPills}>
                    <CategoryChip category={b.cat} />
                    <StatusPill state={b.status} />
                  </View>
                  <Text style={styles.upName}>
                    {b.parent} · {b.child}
                  </Text>
                  <Text style={styles.upMeta}>
                    {b.time} · {b.loc}
                  </Text>
                  {b.flag ? (
                    <View style={styles.flagChip}>
                      <Icon name="info" size={12} color={colors.ink2} />
                      <Text style={styles.flagText}>{b.flag}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.upRight}>
                  <Text style={styles.upPayout}>{b.payout}</Text>
                  <Text style={styles.upPayoutLabel}>payout</Text>
                  <Pressable style={styles.msgBtn} onPress={() => go('/messages')}>
                    <Icon name="message" size={12} color={colors.ink} />
                    <Text style={styles.msgBtnText}>Message</Text>
                  </Pressable>
                </View>
              </Card>
            ))}
          </View>

          {/* ── right · in-session + time-change + awaiting hours ─ */}
          <View style={styles.sideCol}>
            {/* in session now (dark) */}
            <View style={[styles.darkCard, shadow.e2]}>
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>Live</Text>
              </View>
              <Text style={styles.darkKicker}>In session now</Text>
              <Text style={styles.darkName}>{IN_SESSION.parent}</Text>
              <Text style={styles.darkSub}>
                {IN_SESSION.child} · {IN_SESSION.cat}
              </Text>
              <View style={styles.timerBlock}>
                <View>
                  <Text style={styles.timerLabel}>Elapsed</Text>
                  <Text style={styles.timerValue}>{IN_SESSION.elapsed}</Text>
                </View>
                <View style={styles.timerDivider} />
                <View style={styles.flexMin}>
                  <Text style={styles.timerLabel}>Started · ends by</Text>
                  <Text style={styles.timerWhen}>
                    {IN_SESSION.started} · {IN_SESSION.endsBy}
                  </Text>
                </View>
              </View>
              <Pressable style={styles.endBtn} onPress={() => go('/booking-detail')}>
                <Text style={styles.endBtnText}>End session & propose hours</Text>
                <Icon name="arrow-right" size={16} color={colors.inkInv} />
              </Pressable>
              <Text style={styles.darkFootnote}>Or do it from your phone — Schedule tab in the app</Text>
            </View>

            {/* time-change request (dark) */}
            <View style={[styles.darkCard, shadow.e2]}>
              <View style={styles.timeChangeBadge}>
                <Icon name="clock" size={12} color={colors.highlight} />
                <Text style={styles.timeChangeBadgeText}>Time-change request</Text>
              </View>
              <Text style={styles.timeChangeTitle}>Adjei wants to shorten Sat, May 17</Text>
              <View style={styles.wasProposedRow}>
                <View style={styles.wasBlock}>
                  <Text style={styles.wasLabel}>Was</Text>
                  <Text style={styles.wasValue}>5h · $132</Text>
                </View>
                <Icon name="arrow-right" size={16} color={colors.highlight} />
                <View style={styles.proposedBlock}>
                  <Text style={[styles.wasLabel, { color: colors.highlight }]}>Proposed</Text>
                  <Text style={styles.wasValue}>4h · $106</Text>
                </View>
              </View>
              <Text style={styles.darkBody}>
                Until you approve, the session keeps its original 5h · $132. Declining leaves it unchanged.
              </Text>
              <View style={styles.tcActions}>
                <Pressable style={styles.tcDecline}>
                  <Text style={styles.tcDeclineText}>Decline</Text>
                </Pressable>
                <Pressable style={styles.tcApprove}>
                  <Text style={styles.tcApproveText}>Approve · new pay $106</Text>
                </Pressable>
              </View>
            </View>

            {/* awaiting hours */}
            <Card radius={radii.lg} padding={18} style={styles.sideCard}>
              <View style={styles.awaitHead}>
                <View style={styles.flexMin}>
                  <Text style={styles.awaitTitle}>Awaiting hours</Text>
                  <Text style={styles.awaitSub}>auto-confirms if parent doesn&apos;t respond</Text>
                </View>
                <View style={styles.pendingPill}>
                  <Text style={styles.pendingText}>2 pending</Text>
                </View>
              </View>
              <View style={styles.awaitList}>
                {AWAITING.map((a, i) => (
                  <View key={i} style={styles.awaitRow}>
                    <Avatar label={a.parent} size="md" tone={a.tint} />
                    <View style={styles.flexMin}>
                      <Text style={styles.awaitName}>{a.parent}</Text>
                      <Text style={styles.awaitWhen}>{a.when}</Text>
                      <View style={styles.awaitStats}>
                        <StatTile label="Proposed" value={a.proposed} />
                        <StatTile label="Auto in" value={a.autoConfirm} tint="rgba(201,122,42,0.14)" fg={colors.warning} />
                        <StatTile label="Payout" value={a.payout} />
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </Card>
          </View>
        </View>
      </View>
    </View>
  );
}

const DARK_FILL = 'rgba(251,247,239,0.08)';

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flexMin: { flex: 1, minWidth: 0 },

  // tabs row
  tabsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 },
  segment: { flexDirection: 'row', backgroundColor: colors.surface, padding: 4, borderRadius: radii.pill, ...shadow.e1 },
  segItem: { height: 38, paddingHorizontal: 18, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  segItemOn: { backgroundColor: colors.ink },
  segText: { fontFamily: fonts.semibold, fontSize: 13 },
  searchCluster: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchPill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 16, borderRadius: radii.pill, backgroundColor: colors.surface, ...shadow.e1 },
  searchPlaceholder: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink3 },
  iconBtn: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.e1 },

  // layout
  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' },
  mainCol: { flexGrow: 1, flexBasis: 520, minWidth: 360, gap: 12 },
  sideCol: { flexGrow: 1, flexBasis: 320, minWidth: 300, gap: 16 },
  colKicker: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink2, textTransform: 'uppercase', letterSpacing: 0.6, paddingLeft: 4 },

  // upcoming card
  upCard: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
  dateStamp: { width: 64, borderRadius: radii.md, paddingVertical: 12, alignItems: 'center' },
  dsDow: { fontFamily: fonts.bold, fontSize: 11, color: colors.ink, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.7 },
  dsDate: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 28, color: colors.ink, marginTop: 2, fontVariant: ['tabular-nums'] },
  dsMonth: { fontFamily: fonts.semibold, fontSize: 10, color: colors.ink, opacity: 0.7, marginTop: 4 },
  upPills: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 },
  upName: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink, marginBottom: 2 },
  upMeta: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginBottom: 10 },
  flagChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  flagText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.ink2 },
  upRight: { alignItems: 'flex-end', gap: 6 },
  upPayout: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'], letterSpacing: -0.4 },
  upPayoutLabel: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3 },
  msgBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, height: 32, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.surface },
  msgBtnText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },

  // dark cards
  darkCard: { backgroundColor: colors.ink, borderRadius: radii.lg, padding: 22, overflow: 'hidden' },
  liveBadge: { position: 'absolute', top: 18, right: 18, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: 'rgba(58,111,168,0.22)' },
  liveDot: { width: 6, height: 6, borderRadius: radii.pill, backgroundColor: colors.catSpec },
  liveText: { fontFamily: fonts.bold, fontSize: 10, color: colors.catSpec, textTransform: 'uppercase', letterSpacing: 0.5 },
  darkKicker: { fontFamily: fonts.bold, fontSize: 11, color: colors.inkInv, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.6 },
  darkName: { fontFamily: fonts.bold, fontSize: 22, color: colors.inkInv, marginTop: 4 },
  darkSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.inkInv, opacity: 0.75, marginTop: 2 },
  timerBlock: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16, paddingVertical: 14, paddingHorizontal: 16, borderRadius: radii.md, backgroundColor: DARK_FILL },
  timerLabel: { fontFamily: fonts.bold, fontSize: 10, color: colors.inkInv, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 },
  timerValue: { fontFamily: fonts.mono, fontSize: 24, color: colors.inkInv, fontVariant: ['tabular-nums'] },
  timerDivider: { width: 1, height: 36, backgroundColor: 'rgba(251,247,239,0.15)' },
  timerWhen: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv, marginTop: 2 },
  endBtn: { marginTop: 14, height: 48, borderRadius: radii.pill, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  endBtnText: { fontFamily: fonts.bold, fontSize: 14, color: colors.inkInv },
  darkFootnote: { fontFamily: fonts.regular, fontSize: 11, color: colors.inkInv, opacity: 0.6, textAlign: 'center', marginTop: 10 },

  // time-change card
  timeChangeBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: 24, paddingHorizontal: 11, borderRadius: radii.pill, backgroundColor: 'rgba(255,216,77,0.22)' },
  timeChangeBadgeText: { fontFamily: fonts.bold, fontSize: 10.5, color: colors.highlight, letterSpacing: 0.3, textTransform: 'uppercase' },
  timeChangeTitle: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, color: colors.inkInv, marginTop: 12 },
  wasProposedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  wasBlock: { flex: 1, backgroundColor: DARK_FILL, borderRadius: radii.sm, paddingVertical: 11, paddingHorizontal: 13 },
  proposedBlock: { flex: 1, backgroundColor: 'rgba(255,216,77,0.16)', borderRadius: radii.sm, paddingVertical: 11, paddingHorizontal: 13 },
  wasLabel: { fontFamily: fonts.bold, fontSize: 10, color: colors.inkInv, opacity: 0.7, letterSpacing: 0.4, textTransform: 'uppercase' },
  wasValue: { fontFamily: fonts.bold, fontSize: 15, color: colors.inkInv, marginTop: 3, fontVariant: ['tabular-nums'] },
  darkBody: { fontFamily: fonts.regular, fontSize: 12, color: colors.inkInv, opacity: 0.65, marginTop: 12, lineHeight: 17 },
  tcActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  tcDecline: { flex: 1, height: 44, borderRadius: radii.pill, borderWidth: 1.5, borderColor: 'rgba(251,247,239,0.3)', alignItems: 'center', justifyContent: 'center' },
  tcDeclineText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.inkInv },
  tcApprove: { flex: 1.3, height: 44, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  tcApproveText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.inkInv },

  // awaiting hours
  sideCard: { ...shadow.e1 },
  awaitHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  awaitTitle: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink2, textTransform: 'uppercase', letterSpacing: 0.5 },
  awaitSub: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3, marginTop: 2 },
  pendingPill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: 'rgba(201,122,42,0.14)' },
  pendingText: { fontFamily: fonts.bold, fontSize: 11, color: colors.warning },
  awaitList: { gap: 10 },
  awaitRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  awaitName: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  awaitWhen: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink2, marginTop: 1 },
  awaitStats: { flexDirection: 'row', gap: 6, marginTop: 8 },
  statTile: { flex: 1, borderRadius: radii.sm, paddingVertical: 10, paddingHorizontal: 12 },
  statLabel: { fontFamily: fonts.bold, fontSize: 10, color: colors.ink2, textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { fontFamily: fonts.bold, fontSize: 14, marginTop: 2, fontVariant: ['tabular-nums'] },
});
