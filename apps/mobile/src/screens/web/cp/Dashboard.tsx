/**
 * CaregiverDashboardWeb — caregiver desktop dashboard (web only).
 *
 * Faithful port of the Claude Design web project (web-screens/provider-dashboard.jsx):
 * a weekly calendar of accepted Bookings (Mon–Thu, 7am–1pm) beside a right rail of
 * Week earnings (enriched with the net-earnings trend from web-screens/provider-earnings.jsx),
 * Action required, and Verification. Content-only — the route dispatcher wraps this
 * in <WebShell>. React Native primitives only (renders via react-native-web).
 */
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { AvatarGroup } from '@/components/ui/Avatar';
import { CATEGORY_TONE, type Category } from '@/components/ui/CategoryChip';
import { WebPageHeader } from '@/components/web/WebShell';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

// 1 minute = 1.5px; the grid runs 7am → 1pm (6 hours).
const px = (mins: number) => mins * 1.5;
const startOf = (h: number, m: number) => (h - 7) * 60 + m;
const GRID_H = px(360);

const COLS = ['Mon · 11', 'Tue · 12', 'Wed · 13', 'Thu · 14'];

interface EventCard {
  col: number;
  h: number;
  m: number;
  dur: number;
  cat: Category;
  title: string;
  who: string;
  tag: string;
  members: { label: string; tone: ColorToken }[];
}

const CARDS: EventCard[] = [
  { col: 0, h: 7, m: 0, dur: 60, cat: 'Tutor', title: 'Math review · Anika P.', who: 'Booked by Adjei O.', tag: '07:00–08:00', members: [{ label: 'AP', tone: 'catTutor' }] },
  { col: 0, h: 9, m: 0, dur: 60, cat: 'Nanny', title: 'School pickup · Theo & Mia', who: 'Booked by Park family', tag: '09:00–10:00', members: [{ label: 'TP', tone: 'catNanny' }, { label: 'MP', tone: 'catNanny' }] },
  { col: 0, h: 11, m: 0, dur: 60, cat: 'Babysitter', title: 'After-school sitter · Anika P.', who: 'Booked by Adjei O.', tag: '11:00–12:00', members: [{ label: 'AP', tone: 'catBaby' }] },
  { col: 1, h: 8, m: 0, dur: 60, cat: 'Babysitter', title: 'After-school sitter · Mateo D.', who: 'Booked by Delgado family', tag: '08:00–09:00', members: [{ label: 'MD', tone: 'catBaby' }] },
  { col: 1, h: 10, m: 0, dur: 60, cat: 'Tutor', title: 'Spanish · Luca C.', who: 'Booked by Chen family', tag: '10:00–11:00', members: [{ label: 'LC', tone: 'catTutor' }] },
  { col: 2, h: 7, m: 0, dur: 60, cat: 'Nanny', title: 'Morning · Theo & Mia', who: 'Recurring · Park family', tag: '07:00–08:00', members: [{ label: 'TP', tone: 'catNanny' }, { label: 'MP', tone: 'catNanny' }] },
  { col: 2, h: 9, m: 0, dur: 90, cat: 'Tutor', title: 'Reading group · Ava + 2', who: 'Booked by Ramos family', tag: '09:00–10:30', members: [{ label: 'AR', tone: 'catTutor' }, { label: 'BR', tone: 'catTutor' }, { label: 'CR', tone: 'catTutor' }] },
  { col: 3, h: 8, m: 0, dur: 60, cat: 'Nanny', title: 'School pickup · Mia P.', who: 'Booked by Park family', tag: '08:00–09:00', members: [{ label: 'MP', tone: 'catNanny' }] },
  { col: 3, h: 10, m: 0, dur: 90, cat: 'Babysitter', title: 'Date-night sitter · Anika + Theo', who: 'Booked by Adjei O.', tag: '10:00–11:30', members: [{ label: 'AP', tone: 'catBaby' }, { label: 'TP', tone: 'catBaby' }] },
];

const TREND_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May'];
const TREND_VALUES = [820, 1140, 1280, 1450, 1184];
const TREND_MAX = Math.max(...TREND_VALUES) * 1.2;

const ACTIONS: { num: string; tone: ColorToken; title: string; desc: string }[] = [
  { num: '03', tone: 'catBaby', title: 'Booking requests', desc: 'Respond within 24h' },
  { num: '02', tone: 'catTutor', title: 'Confirm session hours', desc: 'Auto-confirm in 18h' },
  { num: '01', tone: 'catSpec', title: 'License renewal due', desc: 'Upload before May 28' },
  { num: '01', tone: 'catNanny', title: 'New 5-star review', desc: 'From Delgado family' },
];

const VERIFICATION: { l: string; v: string; ok: boolean }[] = [
  { l: 'Florida Level 2 background', v: 'Cleared · Apr 14', ok: true },
  { l: 'License · FL OT board', v: 'Verified · Apr 22', ok: true },
  { l: 'Liability insurance', v: 'Expires May 28', ok: false },
];

function EventBlock({ c }: { c: EventCard }) {
  const top = px(startOf(c.h, c.m));
  const height = px(c.dur) - 8;
  return (
    <View style={[styles.event, { top, height, backgroundColor: colors[CATEGORY_TONE[c.cat]] }]}>
      <View style={styles.eventTop}>
        <View style={styles.eventCat}>
          <Text style={styles.eventCatText}>{c.cat}</Text>
        </View>
        <Text style={styles.eventTag}>{c.tag}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.eventTitle} numberOfLines={2}>{c.title}</Text>
        <Text style={styles.eventWho} numberOfLines={1}>{c.who}</Text>
      </View>
      <AvatarGroup items={c.members} size={26} max={3} />
    </View>
  );
}

export function CaregiverDashboardWeb() {
  const router = useRouter();
  const go = (r: string) => router.push(r as never);

  return (
    <View>
      <WebPageHeader
        greet="Dashboard"
        title="Good morning, Maya"
        actions={['bell', 'message']}
        primary="Block time"
        onPrimary={() => go('/availability')}
      />

      <View style={styles.body}>
        <View style={styles.layout}>
          {/* ── weekly calendar ───────────────────────────────── */}
          <View style={styles.calCol}>
            {/* date scope */}
            <View style={styles.scopeRow}>
              <View style={styles.scopePill}>
                <Text style={styles.scopeText}>May 11 – 16</Text>
                <Icon name="chevron-down" size={16} color={colors.inkInv} />
              </View>
              <View style={styles.scopeNav}>
                <View style={styles.scopeNavBtn}>
                  <Icon name="chevron-left" size={14} color={colors.ink} />
                </View>
                <View style={styles.scopeNavBtn}>
                  <Icon name="chevron-right" size={14} color={colors.ink} />
                </View>
              </View>
            </View>

            {/* column headers */}
            <View style={styles.gridHeader}>
              <View style={styles.hourRailSpacer} />
              {COLS.map((c) => (
                <Text key={c} style={styles.colLabel}>{c}</Text>
              ))}
            </View>

            {/* hour rail + day columns */}
            <View style={styles.gridBody}>
              <View style={styles.hourRail}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <Text key={i} style={[styles.hourLabel, { top: px(i * 60) - 8 }]}>
                    {String(7 + i).padStart(2, '0')}:00
                  </Text>
                ))}
              </View>
              {COLS.map((_, ci) => (
                <View key={ci} style={[styles.dayCol, ci % 2 ? { backgroundColor: colors.surfaceAlt } : null]}>
                  {Array.from({ length: 6 }).map((_, hi) => (
                    <View key={hi} style={[styles.gridLine, { top: px(hi * 60) }]} />
                  ))}
                  {CARDS.filter((c) => c.col === ci).map((c, i) => (
                    <EventBlock key={i} c={c} />
                  ))}
                </View>
              ))}
            </View>
          </View>

          {/* ── right rail ────────────────────────────────────── */}
          <View style={styles.railCol}>
            {/* week earnings + net trend */}
            <View style={[styles.railCard, shadow.e1]}>
              <View style={styles.railHead}>
                <Text style={styles.railTitle}>Week earnings</Text>
                <Icon name="chevron-down" size={16} color={colors.ink2} />
              </View>
              <Text style={styles.earnBig}>$1,184</Text>
              <Text style={styles.earnSub}>
                18 sessions · 27h · next payout <Text style={styles.earnStrong}>Fri, May 23</Text>
              </Text>
              <View style={styles.earnPills}>
                <View style={styles.earnPill}>
                  <Text style={styles.earnPillText}>Tutor · $812</Text>
                </View>
                <View style={styles.earnPill}>
                  <Text style={styles.earnPillText}>Sitter · $372</Text>
                </View>
              </View>
              <View style={styles.trendRow}>
                {TREND_VALUES.map((v, i) => {
                  const last = i === TREND_VALUES.length - 1;
                  return (
                    <View key={i} style={styles.trendCol}>
                      <View style={styles.trendTrack}>
                        <View style={[styles.trendBar, { height: `${(v / TREND_MAX) * 100}%`, backgroundColor: last ? colors.ink : colors.catTutor }]} />
                      </View>
                      <Text style={styles.trendLabel}>{TREND_MONTHS[i]}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* action required */}
            <View style={[styles.railCard, shadow.e1]}>
              <View style={styles.railHead}>
                <Text style={styles.railTitle}>Action required</Text>
                <Text style={styles.railLink}>View all</Text>
              </View>
              {ACTIONS.map((it, i) => (
                <View key={it.title} style={[styles.actionRow, i === 0 ? null : styles.rowDivider]}>
                  <View style={[styles.actionNum, { backgroundColor: colors[it.tone] }]}>
                    <Text style={styles.actionNumText}>{it.num}</Text>
                  </View>
                  <View style={styles.flexMin}>
                    <Text style={styles.actionTitle}>{it.title}</Text>
                    <Text style={styles.actionDesc}>{it.desc}</Text>
                  </View>
                  <Icon name="chevron-right" size={14} color={colors.ink3} />
                </View>
              ))}
            </View>

            {/* verification */}
            <View style={[styles.railCard, shadow.e1]}>
              <View style={styles.verifyHead}>
                <Icon name="shield" size={18} color={colors.success} />
                <Text style={styles.railTitle}>Verification</Text>
              </View>
              {VERIFICATION.map((r) => (
                <View key={r.l} style={styles.verifyRow}>
                  <Text style={styles.verifyLabel}>{r.l}</Text>
                  <Text style={[styles.verifyValue, { color: r.ok ? colors.success : colors.warning }]}>{r.v}</Text>
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
  flex: { flex: 1 },
  flexMin: { flex: 1, minWidth: 0 },

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' },

  // calendar
  calCol: { flexGrow: 1, flexBasis: 560, minWidth: 440, backgroundColor: colors.surface, borderRadius: 28, padding: 24, ...shadow.e1 },
  scopeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  scopePill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 16, borderRadius: radii.pill, backgroundColor: colors.ink },
  scopeText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },
  scopeNav: { flexDirection: 'row', gap: 6 },
  scopeNavBtn: { width: 32, height: 32, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },

  gridHeader: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  hourRailSpacer: { width: 40 },
  colLabel: { flex: 1, fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2, paddingLeft: 6 },

  gridBody: { flexDirection: 'row', gap: 8 },
  hourRail: { width: 40, height: GRID_H, position: 'relative' },
  hourLabel: { position: 'absolute', left: 0, fontFamily: fonts.semibold, fontSize: 11, color: colors.ink3, fontVariant: ['tabular-nums'] },
  dayCol: { flex: 1, height: GRID_H, position: 'relative', borderRadius: 18 },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.hairline, opacity: 0.6 },

  event: { position: 'absolute', left: 0, right: 8, borderRadius: radii.lg, padding: 14, justifyContent: 'space-between', overflow: 'hidden', ...shadow.e1 },
  eventTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  eventCat: { height: 22, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: 'rgba(22,21,19,0.85)', alignItems: 'center', justifyContent: 'center' },
  eventCatText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.inkInv },
  eventTag: { fontFamily: fonts.semibold, fontSize: 10, color: colors.ink, opacity: 0.7, fontVariant: ['tabular-nums'] },
  eventTitle: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, lineHeight: 17, marginTop: 6 },
  eventWho: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink, opacity: 0.7, marginTop: 2 },

  // right rail
  railCol: { flexGrow: 1, flexBasis: 320, minWidth: 300, gap: 16 },
  railCard: { backgroundColor: colors.surface, borderRadius: 28, padding: 20 },
  railHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  railTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  railLink: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },

  // week earnings
  earnBig: { fontFamily: fonts.mono, fontSize: 46, lineHeight: 50, color: colors.ink, fontVariant: ['tabular-nums'], letterSpacing: -1.5, marginTop: 10 },
  earnSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 6 },
  earnStrong: { fontFamily: fonts.semibold, color: colors.ink },
  earnPills: { flexDirection: 'row', gap: 8, marginTop: 16 },
  earnPill: { height: 28, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  earnPillText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink },
  trendRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 84, marginTop: 18, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.hairline },
  trendCol: { flex: 1, alignItems: 'center', gap: 6 },
  trendTrack: { width: '100%', height: 56, justifyContent: 'flex-end' },
  trendBar: { width: '100%', borderRadius: 8, minHeight: 6 },
  trendLabel: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink2 },

  // action required
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  actionNum: { width: 36, height: 36, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  actionNumText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink, fontVariant: ['tabular-nums'] },
  actionTitle: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  actionDesc: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },

  // verification
  verifyHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  verifyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  verifyLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink },
  verifyValue: { fontFamily: fonts.semibold, fontSize: 12 },
});
