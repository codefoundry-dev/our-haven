/**
 * InboxWeb — two-pane messaging for caregiver + clinical Provider (web only).
 *
 * Faithful port of the Claude Design web project (web-screens/provider-messages.jsx):
 * a thread list (search · filter chips · conversation rows) beside the active
 * thread (header with call actions, the booking/consult anchor strip, message
 * bubbles, composer, and the off-platform redaction notice). `role` swaps the
 * dataset (families/bookings vs clinical consultations). Content-only — the route
 * dispatcher wraps this in <WebShell>. React Native primitives only (RN-web).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { WebPageHeader } from '@/components/web/WebShell';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

interface Thread {
  who: string;
  initials: string;
  cat: string;
  tone: ColorToken;
  last: string;
  when: string;
  unread: number;
  sub: string;
}

interface Msg {
  from: 'me' | 'them';
  t: string;
  at: string;
}

interface InboxData {
  threads: Thread[];
  filters: string[];
  anchorLabel: string;
  anchorDetail: string;
  dayLabel: string;
  msgs: Msg[];
}

const CAREGIVER: InboxData = {
  filters: ['All · 14', 'Unread · 3', 'Bookings · 9'],
  anchorLabel: 'Job-anchored thread · ',
  anchorDetail: 'Tutor · Math review · 30 min · $17.50 to Maya after fees',
  dayLabel: 'Tue · May 13',
  threads: [
    { who: 'Adjei Owusu', initials: 'AO', cat: 'Tutor', tone: 'catTutor', last: 'Anika finished the warm-up sheet — should we add fractions?', when: '08:42', unread: 2, sub: 'Parent · Anika P. · age 9 · Tutor booking · Wed May 14, 9:15 AM' },
    { who: 'Park family', initials: 'PF', cat: 'Nanny', tone: 'catNanny', last: 'Theo will be in the pickup line at 3:10, the badge name is "Theo P."', when: '08:12', unread: 0, sub: 'Parent · Theo P. · age 5 · Nanny booking' },
    { who: 'Camille Ramos', initials: 'CR', cat: 'Specialist', tone: 'catSpec', last: 'Offer accepted. See you Thursday at 4.', when: 'Yest', unread: 0, sub: 'Parent · Mateo · Specialist booking' },
    { who: 'Delgado family', initials: 'DF', cat: 'Specialist', tone: 'catSpec', last: 'Mateo loved the session — sending a 5★ shortly.', when: 'Mon', unread: 0, sub: 'Parent · Mateo D. · Specialist' },
    { who: 'Chen family', initials: 'CF', cat: 'Tutor', tone: 'catTutor', last: 'Could you bring the Spanish flashcards next time?', when: 'May 8', unread: 0, sub: 'Parent · Luca C. · Tutor' },
    { who: 'Ramos family', initials: 'RF', cat: 'Specialist', tone: 'catSpec', last: 'Job awarded — Mateo OT block confirmed.', when: 'May 6', unread: 0, sub: 'Parent · Mateo · Specialist' },
  ],
  msgs: [
    { from: 'them', t: 'Hi Maya — looking forward to Wednesday. Anika has been practicing fractions all week.', at: '08:28' },
    { from: 'me', t: "Wonderful. I'll prep the half-and-quarter cards she liked last time.", at: '08:31' },
    { from: 'them', t: 'Quick question — does the session count for the multi-week package or is it stand-alone?', at: '08:39' },
    { from: 'them', t: 'Anika finished the warm-up sheet — should we add fractions?', at: '08:42' },
  ],
};

const PROVIDER: InboxData = {
  filters: ['All · 8', 'Unread · 2', 'Consults · 5'],
  anchorLabel: 'Consultation thread · ',
  anchorDetail: 'Occupational therapy · Initial OT screen · 30 min · fee handled off-platform',
  dayLabel: 'Thu · May 15',
  threads: [
    { who: 'Sofia Reyes', initials: 'SR', cat: 'Provider', tone: 'catSpec', last: 'Thank you — see you Thursday at 4:30.', when: '2m', unread: 2, sub: 'Parent · Mateo R. · age 5 · OT screen · Thu May 15, 4:30 PM' },
    { who: 'Marcus Bell', initials: 'MB', cat: 'Provider', tone: 'catSpec', last: 'Should I bring her last IEP?', when: '1h', unread: 0, sub: 'Parent · Ivy B. · age 6 · Consultation' },
    { who: 'Priya Anand', initials: 'PA', cat: 'Provider', tone: 'catSpec', last: 'The home program worked really well.', when: '3h', unread: 0, sub: 'Parent · Rohan A. · age 3 · Follow-up' },
    { who: 'Aaron Klein', initials: 'AK', cat: 'Provider', tone: 'catSpec', last: 'Requested an in-person consult.', when: 'Yest', unread: 0, sub: 'Parent · Nora K. · age 7 · Consultation' },
  ],
  msgs: [
    { from: 'them', t: "Hi Dr. Ramos — looking forward to Mateo's screening on Thursday.", at: '9:02 AM' },
    { from: 'me', t: 'Likewise! Could you note any sounds he tends to swap before we meet?', at: '9:10 AM' },
    { from: 'them', t: 'He mixes up "r" and "w", and sometimes drops the end of words.', at: '9:14 AM' },
    { from: 'me', t: 'Perfect — that gives us a great starting point. The video link is in your booking.', at: '9:16 AM' },
    { from: 'them', t: 'Thank you — see you Thursday at 4:30.', at: '9:18 AM' },
  ],
};

export function InboxWeb({ role }: { role: 'caregiver' | 'provider' }) {
  const data = role === 'provider' ? PROVIDER : CAREGIVER;
  const [active, setActive] = useState(0);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const head = data.threads[active];

  return (
    <View>
      <WebPageHeader greet="Messages" title="Conversations" actions={['bell']} />

      <View style={styles.body}>
        <View style={styles.pane}>
          {/* ── thread list ───────────────────────────────────── */}
          <View style={styles.listCol}>
            <View style={styles.searchRow}>
              <Icon name="search" size={16} color={colors.ink2} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search conversations"
                placeholderTextColor={colors.ink3}
                style={styles.searchInput}
              />
            </View>

            <View style={styles.filters}>
              {data.filters.map((f, i) => {
                const on = i === 0;
                return (
                  <View key={f} style={[styles.filterChip, on ? { backgroundColor: colors.ink } : null]}>
                    <Text style={[styles.filterText, { color: on ? colors.inkInv : colors.ink2 }]}>{f}</Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.listScroll}>
              {data.threads.map((th, i) => {
                const on = i === active;
                return (
                  <Pressable key={th.who} onPress={() => setActive(i)} style={[styles.threadRow, on ? styles.threadRowOn : null]}>
                    <Avatar label={th.initials} size="md" tone={th.tone} />
                    <View style={styles.flexMin}>
                      <View style={styles.threadRowTop}>
                        <Text style={styles.threadWho} numberOfLines={1}>{th.who}</Text>
                        <Text style={styles.threadWhen}>{th.when}</Text>
                      </View>
                      <Text style={styles.threadLast} numberOfLines={2}>{th.last}</Text>
                      <View style={styles.threadMeta}>
                        <View style={[styles.catPill, { backgroundColor: colors[th.tone] }]}>
                          <Text style={styles.catPillText}>{th.cat}</Text>
                        </View>
                        {th.unread > 0 ? (
                          <View style={styles.unread}>
                            <Text style={styles.unreadText}>{th.unread}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* ── active thread ─────────────────────────────────── */}
          <View style={styles.threadCol}>
            {/* header */}
            <View style={styles.threadHead}>
              <View style={styles.threadWho2}>
                <Avatar label={head.initials} size="lg" tone={head.tone} />
                <View style={styles.flexMin}>
                  <Text style={styles.headName}>{head.who}</Text>
                  <Text style={styles.headSub} numberOfLines={1}>{head.sub}</Text>
                </View>
              </View>
              <View style={styles.headActions}>
                <Pressable style={styles.callBtn}>
                  <Icon name="video" size={14} color={colors.ink} />
                  <Text style={styles.callBtnText}>Video call</Text>
                </Pressable>
                <Pressable style={styles.viewBtn}>
                  <Text style={styles.viewBtnText}>View booking</Text>
                </Pressable>
              </View>
            </View>

            {/* booking / consult anchor */}
            <View style={styles.anchor}>
              <Icon name="briefcase" size={14} color={colors.ink2} />
              <Text style={styles.anchorLabel}>{data.anchorLabel}</Text>
              <Text style={styles.anchorDetail}>{data.anchorDetail}</Text>
            </View>

            {/* messages */}
            <View style={styles.messages}>
              <View style={styles.dayDivider}>
                <Text style={styles.dayDividerText}>{data.dayLabel}</Text>
              </View>
              {data.msgs.map((m, i) => {
                const me = m.from === 'me';
                return (
                  <View key={i} style={[styles.bubble, me ? styles.bubbleMe : styles.bubbleThem]}>
                    <Text style={[styles.bubbleText, me ? styles.bubbleTextMe : null]}>{m.t}</Text>
                    <Text style={[styles.bubbleTime, me ? styles.bubbleTimeMe : null]}>{m.at}</Text>
                  </View>
                );
              })}
              <View style={styles.typing}>
                <Text style={styles.typingText}>typing…</Text>
              </View>
            </View>

            {/* composer */}
            <View style={styles.composerWrap}>
              <View style={styles.composer}>
                <Icon name="paperclip" size={18} color={colors.ink2} />
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Write a message…"
                  placeholderTextColor={colors.ink3}
                  style={styles.composerInput}
                />
                <Pressable style={styles.sendBtn}>
                  <Icon name="send" size={14} color={colors.inkInv} />
                  <Text style={styles.sendBtnText}>Send</Text>
                </Pressable>
              </View>
              <View style={styles.redactRow}>
                <Icon name="shield" size={12} color={colors.ink3} />
                <Text style={styles.redactText}>
                  Messages are scanned for off-platform contact. Phone numbers, emails and payment links are automatically redacted.
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

  pane: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 28, overflow: 'hidden', ...shadow.e1 },

  // thread list
  listCol: { flexGrow: 1, flexBasis: 340, minWidth: 300, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.hairline, padding: 20 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, marginBottom: 12 },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.ink, padding: 0 },
  filters: { flexDirection: 'row', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  filterChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radii.pill },
  filterText: { fontFamily: fonts.semibold, fontSize: 11 },
  listScroll: { gap: 2 },
  threadRow: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: radii.md },
  threadRowOn: { backgroundColor: colors.surfaceAlt },
  threadRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  threadWho: { flex: 1, fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  threadWhen: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3 },
  threadLast: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.ink2 },
  threadMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  catPill: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: radii.pill },
  catPillText: { fontFamily: fonts.semibold, fontSize: 10, color: colors.ink },
  unread: { marginLeft: 'auto', minWidth: 18, height: 18, paddingHorizontal: 6, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  unreadText: { fontFamily: fonts.bold, fontSize: 10, color: colors.inkInv },

  // active thread
  threadCol: { flexGrow: 1, flexBasis: 480, minWidth: 360, backgroundColor: colors.surface },
  threadHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', paddingVertical: 18, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  threadWho2: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  headName: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  headSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 1 },
  headActions: { flexDirection: 'row', gap: 8 },
  callBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.surface },
  callBtnText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },
  viewBtn: { height: 36, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  viewBtnText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkInv },

  anchor: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingVertical: 12, paddingHorizontal: 24, backgroundColor: colors.surfaceAlt },
  anchorLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  anchorDetail: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },

  messages: { padding: 24, gap: 10 },
  dayDivider: { alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  dayDividerText: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3 },
  bubble: { maxWidth: '70%', paddingVertical: 10, paddingHorizontal: 14 },
  bubbleThem: { alignSelf: 'flex-start', backgroundColor: colors.surfaceAlt, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomRightRadius: 18, borderBottomLeftRadius: 4 },
  bubbleMe: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomRightRadius: 4, borderBottomLeftRadius: 18 },
  bubbleText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink },
  bubbleTextMe: { color: colors.inkInv },
  bubbleTime: { fontFamily: fonts.regular, fontSize: 10, color: colors.ink3, marginTop: 4, textAlign: 'right' },
  bubbleTimeMe: { color: colors.inkInv, opacity: 0.6 },
  typing: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, marginTop: 4 },
  typingText: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3 },

  composerWrap: { padding: 16, borderTopWidth: 1, borderTopColor: colors.hairline },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surfaceAlt, borderRadius: radii.pill, paddingVertical: 6, paddingLeft: 18, paddingRight: 6 },
  composerInput: { flex: 1, height: 40, fontFamily: fonts.regular, fontSize: 13, color: colors.ink, padding: 0 },
  sendBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 16, borderRadius: radii.pill, backgroundColor: colors.brand },
  sendBtnText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkInv },
  redactRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  redactText: { flex: 1, fontFamily: fonts.regular, fontSize: 11, color: colors.ink3, lineHeight: 15 },
});
