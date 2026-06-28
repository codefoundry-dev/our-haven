/**
 * ParentMessagingWeb — the Parent inbox on desktop web. Content-only: the
 * dispatcher wraps this in <ParentWebShell active="messages">.
 *
 * Ported from the Claude Design web project (parent-web/pw-messaging.jsx) and the
 * native shared Inbox + message-thread: a two-pane desktop layout — left is the
 * conversation list (All/Unread), right is the open thread with the
 * encrypted/redaction banner, message bubbles, and a composer. RN primitives
 * only; each pane scrolls independently within a fixed-height frame.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { WebPageHeader } from '@/components/web/ParentWebShell';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { TabStrip } from '@/components/ui/TabStrip';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

type Filter = 'All' | 'Unread';

interface Convo {
  id: string;
  initial: string;
  tone: ColorToken;
  name: string;
  role: string;
  preview: string;
  time: string;
  unread?: number;
  redacted?: boolean;
}

const CONVOS: Convo[] = [
  { id: '1', initial: 'M', tone: 'catTutor', name: 'Maya Okafor', role: 'Tutor', preview: 'Great — see you Saturday morning.', time: '2m', unread: 2 },
  { id: '2', initial: 'D', tone: 'catTutor', name: 'Diego Mejia', role: 'Tutor', preview: "I can do an extra hour if you'd like.", time: '1h', unread: 1 },
  { id: '3', initial: 'R', tone: 'catNanny', name: 'Rosario Vega', role: 'Nanny', preview: "█ phone hidden — let's chat in-app instead.", time: 'Yesterday', redacted: true },
  { id: '4', initial: 'N', tone: 'catNanny', name: 'Naomi Brooks', role: 'Nanny', preview: 'Happy to start next Monday — sent my availability.', time: 'Mon' },
  { id: '5', initial: 'S', tone: 'catBaby', name: 'Sofia Castillo', role: 'Babysitter', preview: 'Confirmed for Friday evening.', time: 'May 4' },
  { id: '6', initial: 'O', tone: 'catTutor', name: 'Our Haven Trust & Safety', role: 'Support', preview: "We've reviewed your dispute — see details.", time: 'Apr 30' },
];

export function ParentMessagingWeb() {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const [filter, setFilter] = useState<Filter>('All');
  const [selected, setSelected] = useState<string>('1');
  const [draft, setDraft] = useState('');
  const [bannerOpen, setBannerOpen] = useState(true);

  const rows = filter === 'Unread' ? CONVOS.filter((c) => c.unread) : CONVOS;
  const active = CONVOS.find((c) => c.id === selected) ?? CONVOS[0];
  const paneHeight = Math.max(540, height - 210);

  return (
    <View>
      <WebPageHeader greet="Inbox" title="Messages" actions={['bell']} />

      <View style={styles.body}>
        <View style={[styles.frame, { height: paneHeight }]}>
          {/* ── left: conversation list ───────────────────── */}
          <View style={styles.listPane}>
            <View style={styles.listHead}>
              <TabStrip<Filter> tabs={['All', 'Unread'] as const} value={filter} onChange={setFilter} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
              {rows.map((c) => {
                const on = c.id === selected;
                const unread = !!c.unread;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setSelected(c.id)}
                    style={({ pressed }) => [styles.convo, on && styles.convoActive, { opacity: pressed ? 0.92 : 1 }]}
                  >
                    <View style={styles.convoAvatar}>
                      <Avatar label={c.initial} tone={c.tone} size="md" />
                      {unread ? (
                        <View style={styles.unreadDot}>
                          <Text style={styles.unreadDotText}>{c.unread}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.flexMin}>
                      <View style={styles.convoTop}>
                        <Text style={[styles.convoName, unread && styles.convoNameUnread]} numberOfLines={1}>
                          {c.name}
                        </Text>
                        <Text style={styles.convoTime}>{c.time}</Text>
                      </View>
                      <Text style={[styles.convoPreview, unread && styles.convoPreviewUnread]} numberOfLines={1}>
                        {c.preview}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* ── right: thread ─────────────────────────────── */}
          <View style={styles.threadPane}>
            <View style={styles.threadHead}>
              <Avatar label={active.name} tone={active.tone} size="sm" online />
              <View style={styles.flexMin}>
                <Text style={styles.threadName} numberOfLines={1}>
                  {active.name}
                </Text>
                <View style={styles.threadStatus}>
                  <View style={styles.onlineDot} />
                  <Text style={styles.online}>Online · {active.role}</Text>
                </View>
              </View>
              <Pressable onPress={() => router.push('/consult' as never)} style={styles.iconBtn}>
                <Icon name="video" size={18} color={colors.ink} />
              </Pressable>
            </View>

            <Pressable onPress={() => setBannerOpen((v) => !v)} style={styles.banner}>
              <Icon name="lock" size={16} color={colors.brand} />
              <View style={styles.flexMin}>
                <Text style={styles.bannerTitle}>Encrypted & monitored</Text>
                {bannerOpen ? (
                  <Text style={styles.bannerSub}>
                    Messages are end-to-end encrypted. Sharing contact info — phone numbers and emails — is automatically
                    redacted to keep you on-platform.
                  </Text>
                ) : null}
              </View>
              <Icon name={bannerOpen ? 'chevron-down' : 'chevron-right'} size={16} color={colors.ink3} />
            </Pressable>

            <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.dayMarker}>Today · earlier</Text>
              <Bubble from="them">Hi Adjei! I'm confirmed for Anika's Wednesday morning session. Want me to bring the workbook?</Bubble>
              <Bubble from="me">Yes please! Should I send the address again?</Bubble>
              <View style={[styles.bubble, styles.them]}>
                <Text style={styles.themText}>
                  No need — already saved. If anything comes up text me at{' '}
                  <Text style={styles.redactPill}> █ phone hidden </Text> — I'll bring everything.
                </Text>
              </View>
              <Bubble from="me">Perfect. See you Wednesday.</Bubble>
            </ScrollView>

            <View style={styles.composer}>
              <Pressable style={styles.composerIcon}>
                <Icon name="paperclip" size={20} color={colors.ink2} />
              </Pressable>
              <View style={styles.inputPill}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={`Message ${active.name.split(' ')[0]}…`}
                  placeholderTextColor={colors.ink3}
                  style={styles.input}
                />
              </View>
              <Pressable style={styles.sendBtn}>
                <Icon name="send" size={18} color={colors.inkInv} />
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function Bubble({ from, children }: { from: 'me' | 'them'; children: string }) {
  const me = from === 'me';
  return (
    <View style={[styles.bubble, me ? styles.me : styles.them]}>
      <Text style={me ? styles.meText : styles.themText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flexMin: { flex: 1, minWidth: 0 },

  frame: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 24, overflow: 'hidden', ...shadow.e1 },

  // list pane
  listPane: { width: 320, borderRightWidth: 1, borderRightColor: colors.hairline },
  listHead: { padding: 16, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  listContent: { padding: 10, gap: 4 },
  convo: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16 },
  convoActive: { backgroundColor: colors.brandSoft },
  convoAvatar: { width: 40, height: 40 },
  unreadDot: { position: 'absolute', bottom: -2, right: -2, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: radii.pill, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
  unreadDotText: { fontFamily: fonts.bold, fontSize: 10, color: colors.inkInv },
  convoTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  convoName: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  convoNameUnread: { fontFamily: fonts.bold },
  convoTime: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3 },
  convoPreview: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 3 },
  convoPreviewUnread: { fontFamily: fonts.medium, color: colors.ink },

  // thread pane
  threadPane: { flex: 1, minWidth: 0 },
  threadHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  threadName: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  threadStatus: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  onlineDot: { width: 6, height: 6, borderRadius: radii.pill, backgroundColor: colors.success },
  online: { fontFamily: fonts.medium, fontSize: 11, color: colors.success },
  iconBtn: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },

  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, margin: 16, padding: 12, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  bannerTitle: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  bannerSub: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 3 },

  transcript: { flex: 1 },
  transcriptContent: { gap: 10, paddingHorizontal: 20, paddingBottom: 16 },
  dayMarker: { alignSelf: 'center', fontFamily: fonts.medium, fontSize: 11, color: colors.ink3, marginVertical: 4 },
  bubble: { maxWidth: '74%', paddingVertical: 10, paddingHorizontal: 14 },
  me: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, borderBottomLeftRadius: radii.xl, borderBottomRightRadius: 8 },
  them: { alignSelf: 'flex-start', backgroundColor: colors.surfaceAlt, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, borderBottomLeftRadius: 8, borderBottomRightRadius: radii.xl },
  meText: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 20, color: colors.inkInv },
  themText: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 22, color: colors.ink },
  redactPill: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink2, backgroundColor: colors.surface },

  composer: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: colors.hairline },
  composerIcon: { width: 40, height: 40, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  inputPill: { flex: 1, height: 46, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, paddingHorizontal: 18, justifyContent: 'center' },
  input: { fontFamily: fonts.regular, fontSize: 14.5, color: colors.ink, padding: 0 },
  sendBtn: { width: 46, height: 46, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
