/**
 * ProviderScheduleWeb — clinical Provider consultation schedule (web only).
 *
 * Faithful port of the Claude Design web project cp-web/cp-clinical.jsx
 * (CPClinicalSchedule), with the "today's sessions / Join" live view folded in
 * from cp-web/cp-session.jsx (the dark live-session card). Consultation-centric:
 * no session timer, no hours to propose — clinical payment is collected
 * off-platform. Content-only: the route dispatcher wraps this in <WebShell>.
 * RN primitives only (renders via RN-web).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { Card } from '@/components/ui/Card';
import { WebPageHeader } from '@/components/web/WebShell';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const TABS = ['Today', 'Upcoming', 'Past'] as const;
type Tab = (typeof TABS)[number];

interface Consult {
  time: string;
  ampm: string;
  who: string;
  spec: string;
  status: string;
  tone: 'accepted' | 'awaiting';
}

const CONSULTS: Consult[] = [
  { time: '9:00', ampm: 'AM', who: 'Delgado family', spec: 'OT consultation · 45 min · video', status: 'Accepted', tone: 'accepted' },
  { time: '1:00', ampm: 'PM', who: 'Park family', spec: 'OT consultation · 45 min · video', status: 'Accepted', tone: 'accepted' },
  { time: '3:30', ampm: 'PM', who: 'Chen family', spec: 'Initial screen · 30 min · video', status: 'Awaiting', tone: 'awaiting' },
];

const WEEK_STATS: [string, string][] = [
  ['Consults', '9'],
  ['Open slots', '14'],
  ['New', '2'],
];

export function ProviderScheduleWeb() {
  const router = useRouter();
  const go = (r: string) => router.push(r as never);
  const [tab, setTab] = useState<Tab>('Today');

  return (
    <View>
      <WebPageHeader greet="Provider · Dr. Camille Ramos" title="Schedule" actions={['bell', 'message']} />

      <View style={styles.body}>
        {/* tabs */}
        <View style={styles.tabRow}>
          <View style={styles.tabBar}>
            {TABS.map((t) => {
              const on = t === tab;
              return (
                <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, on ? styles.tabOn : null]}>
                  <Text style={[styles.tabText, { color: on ? colors.inkInv : colors.ink2 }]}>{t}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.flex} />
          <Text style={styles.tabMeta}>Tue, May 19 · 2 consultations</Text>
        </View>

        <View style={styles.layout}>
          {/* ── left · today's consultations ──────────────────────── */}
          <View style={styles.mainCol}>
            {/* live now — folded in from the session detail */}
            <View style={styles.liveCard}>
              <View style={styles.liveDecor} />
              <View style={styles.liveTop}>
                <View style={styles.liveDotRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveKicker}>In session</Text>
                </View>
                <Text style={styles.liveWhen}>Now · 9:00 AM</Text>
              </View>
              <Text style={styles.liveTitle}>Consultation · Delgado family</Text>
              <Text style={styles.liveSub}>
                Goes live automatically at the scheduled time — no session timer to start. Join the video room when you&rsquo;re ready.
              </Text>
              <View style={styles.liveMetaRow}>
                <Icon name="clock" size={16} color={colors.inkInv} />
                <Text style={styles.liveMetaText}>OT consultation · 45 min · video</Text>
              </View>
              <Pressable onPress={() => go('/consult')} style={styles.liveJoin}>
                <Icon name="video" size={16} color={colors.inkInv} />
                <Text style={styles.liveJoinText}>Join consultation</Text>
              </Pressable>
            </View>

            <Text style={styles.secHead}>Today · Tue, May 19</Text>
            {CONSULTS.map((c, i) => (
              <Card key={c.who + i} radius={radii.lg} padding={18} style={styles.consult}>
                <View style={styles.timeBox}>
                  <Text style={styles.timeNum}>{c.time}</Text>
                  <Text style={styles.timeAmpm}>{c.ampm}</Text>
                </View>
                <View style={styles.flexMin}>
                  <Text style={styles.consultWho}>{c.who}</Text>
                  <Text style={styles.consultSpec}>{c.spec}</Text>
                </View>
                <View style={[styles.statusPill, c.tone === 'accepted' ? styles.statusAccepted : styles.statusAwaiting]}>
                  <Text style={[styles.statusText, { color: c.tone === 'accepted' ? colors.success : colors.warning }]}>{c.status}</Text>
                </View>
                <Pressable onPress={() => go('/consult')} style={styles.joinBtn}>
                  <Icon name="video" size={15} color={colors.ink} />
                  <Text style={styles.joinText}>Join</Text>
                </Pressable>
              </Card>
            ))}
          </View>

          {/* ── right · this week + note ───────────────────────────── */}
          <View style={styles.sideCol}>
            <Card radius={radii.xl} padding={22} style={styles.sideCard}>
              <Text style={[styles.secHead, styles.secHeadCard]}>This week</Text>
              <View style={styles.statRow}>
                {WEEK_STATS.map(([l, v]) => (
                  <View key={l} style={styles.statTile}>
                    <Text style={styles.statValue}>{v}</Text>
                    <Text style={styles.statLabel}>{l}</Text>
                  </View>
                ))}
              </View>
            </Card>

            <View style={styles.note}>
              <Icon name="info" size={18} color={colors.brand} />
              <Text style={styles.noteText}>
                Consultations auto-complete after the slot time. No session timer, no hours to propose — clinical payment is collected off-platform.
              </Text>
            </View>

            <Pressable onPress={() => go('/availability')} style={styles.slotBtn}>
              <Icon name="clock" size={16} color={colors.inkInv} />
              <Text style={styles.slotBtnText}>Edit consultation slots</Text>
            </Pressable>
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

  // tabs
  tabRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  tabBar: { flexDirection: 'row', backgroundColor: colors.surface, padding: 4, borderRadius: radii.pill, ...shadow.e1 },
  tab: { height: 38, paddingHorizontal: 20, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.ink },
  tabText: { fontFamily: fonts.semibold, fontSize: 13.5 },
  tabMeta: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  mainCol: { flexGrow: 1.6, flexBasis: 560, minWidth: 360 },
  sideCol: { flexGrow: 1, flexBasis: 320, minWidth: 280, gap: 16 },

  secHead: { fontFamily: fonts.bold, fontSize: 11.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 12, marginLeft: 4 },
  secHeadCard: { marginLeft: 0, marginBottom: 14 },

  // live session card (folded in from cp-session)
  liveCard: { backgroundColor: colors.ink, borderRadius: radii.xl, padding: 22, marginBottom: 18, overflow: 'hidden' },
  liveDecor: { position: 'absolute', top: -40, right: -40, width: 150, height: 150, borderRadius: radii.pill, backgroundColor: 'rgba(197,230,205,0.12)' },
  liveTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveDotRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: radii.pill, backgroundColor: colors.info },
  liveKicker: { fontFamily: fonts.bold, fontSize: 11, color: colors.inkInv, opacity: 0.7, letterSpacing: 0.6, textTransform: 'uppercase' },
  liveWhen: { fontFamily: fonts.semibold, fontSize: 11, color: colors.inkInv, opacity: 0.7, letterSpacing: 0.4, textTransform: 'uppercase' },
  liveTitle: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.inkInv, marginTop: 14 },
  liveSub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.inkInv, opacity: 0.65, marginTop: 6 },
  liveMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, paddingVertical: 14, paddingHorizontal: 16, borderRadius: radii.md, backgroundColor: 'rgba(251,247,239,0.08)' },
  liveMetaText: { fontFamily: fonts.regular, fontSize: 13, color: colors.inkInv, opacity: 0.85 },
  liveJoin: { marginTop: 16, height: 50, borderRadius: radii.pill, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  liveJoinText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },

  // consult row
  consult: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 12 },
  timeBox: { width: 76, height: 76, borderRadius: radii.md, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  timeNum: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.brand, fontVariant: ['tabular-nums'] },
  timeAmpm: { fontFamily: fonts.semibold, fontSize: 11, color: colors.brand },
  consultWho: { fontFamily: fonts.bold, fontSize: 16.5, color: colors.ink },
  consultSpec: { fontFamily: fonts.regular, fontSize: 13.5, color: colors.ink2, marginTop: 2 },
  statusPill: { height: 28, paddingHorizontal: 12, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  statusAccepted: { backgroundColor: 'rgba(47,122,77,0.12)' },
  statusAwaiting: { backgroundColor: 'rgba(201,122,42,0.12)' },
  statusText: { fontFamily: fonts.semibold, fontSize: 12.5 },
  joinBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 40, paddingHorizontal: 16, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.surface },
  joinText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  // right column
  sideCard: { ...shadow.e1 },
  statRow: { flexDirection: 'row', gap: 12 },
  statTile: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radii.sm, paddingVertical: 14, paddingHorizontal: 12 },
  statValue: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink2, marginTop: 2 },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },

  slotBtn: { height: 46, borderRadius: 13, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  slotBtnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkInv },
});
