/**
 * MessagingTwoPaneWeb (OH-205) — the desktop two-pane Messages surface shared by
 * the Parent inbox and the Caregiver/Provider inbox: a conversation list on the
 * left, the selected live thread on the right. Wired to `GET /v1/threads`
 * (useInbox) + `useMessageThread` (Supabase Realtime). Content-only — the route
 * dispatcher wraps it in the role-aware shell.
 *
 * Replaces the role-specific mock inboxes (pw-messaging / provider-messages); the
 * redaction + Trust & Safety disclosure carries NO encryption claim
 * (CONTEXT § Message). v1 has no read-receipts, so there is no unread state.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { WebPageHeader } from '@/components/web/WebShell';
import type { ChatMessage, MessageThreadSummary } from '@/api/client';
import {
  MESSAGING_DISCLOSURE_BODY,
  MESSAGING_DISCLOSURE_TITLE,
  MESSAGING_REDACTED_HINT,
} from '@/lib/messagingCopy';
import { useInbox } from '@/lib/useInbox';
import { useMessageThread } from '@/lib/useMessageThread';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

type Role = 'parent' | 'caregiver' | 'provider';

const EMPTY_COPY: Record<Role, string> = {
  parent: 'When you message a Caregiver, your conversations show up here.',
  caregiver: 'When a Parent reaches out about a Job, your conversations show up here.',
  provider: 'When a Parent books a consultation, your conversations show up here.',
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function roleLabelOf(role: MessageThreadSummary['counterpartyRole']): string {
  return role === 'caregiver' ? 'Caregiver' : role === 'provider' ? 'Provider' : 'Parent';
}

export function MessagingTwoPaneWeb({ role }: { role: Role }) {
  const { session } = useAuth();
  const myUid = session?.user?.id ?? null;
  const { data, loading, error } = useInbox();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!selectedId && data.length > 0) setSelectedId(data[0].id);
  }, [data, selectedId]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? data.filter((t) => (t.counterpartyName ?? '').toLowerCase().includes(q))
    : data;
  const selected = data.find((t) => t.id === selectedId) ?? null;

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

            <View style={styles.listScroll}>
              {loading ? (
                <View style={styles.listState}>
                  <ActivityIndicator color={colors.brand} />
                </View>
              ) : error ? (
                <Text style={styles.listStateText}>{error}</Text>
              ) : filtered.length === 0 ? (
                <Text style={styles.listStateText}>{data.length === 0 ? EMPTY_COPY[role] : 'No matches.'}</Text>
              ) : (
                filtered.map((th) => {
                  const on = th.id === selectedId;
                  const name = th.counterpartyName ?? 'Conversation';
                  return (
                    <Pressable key={th.id} onPress={() => setSelectedId(th.id)} style={[styles.threadRow, on ? styles.threadRowOn : null]}>
                      <Avatar label={name} size="md" tone="catTutor" />
                      <View style={styles.flexMin}>
                        <View style={styles.threadRowTop}>
                          <Text style={styles.threadWho} numberOfLines={1}>{name}</Text>
                          <Text style={styles.threadWhen}>{relativeTime(th.lastMessageAt)}</Text>
                        </View>
                        <Text style={styles.threadLast} numberOfLines={2}>
                          {th.lastMessagePreview ?? 'No messages yet'}
                        </Text>
                        {th.lastMessageRedacted ? (
                          <View style={styles.threadMeta}>
                            <Icon name="shield" size={10} color={colors.ink3} />
                            <Text style={styles.redactPillText}>{MESSAGING_REDACTED_HINT}</Text>
                          </View>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>
          </View>

          {/* ── active thread ─────────────────────────────────── */}
          <View style={styles.threadCol}>
            {selected ? (
              <ThreadPaneWeb key={selected.id} thread={selected} myUid={myUid} />
            ) : (
              <View style={styles.threadEmpty}>
                <Text style={styles.threadEmptyText}>
                  {loading ? '' : 'Select a conversation to start messaging.'}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

function ThreadPaneWeb({ thread, myUid }: { thread: MessageThreadSummary; myUid: string | null }) {
  const { messages, loading, error, sending, send } = useMessageThread({ threadId: thread.id });
  const [draft, setDraft] = useState('');
  const [bannerOpen, setBannerOpen] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  const name = thread.counterpartyName ?? 'Conversation';

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length]);

  const onSend = async () => {
    const text = draft;
    if (!text.trim() || sending) return;
    setDraft('');
    try {
      await send(text);
    } catch {
      setDraft(text);
    }
  };

  return (
    <View style={styles.threadInner}>
      {/* header */}
      <View style={styles.threadHead}>
        <Avatar label={name} size="lg" tone="catTutor" />
        <View style={styles.flexMin}>
          <Text style={styles.headName} numberOfLines={1}>{name}</Text>
          <Text style={styles.headSub} numberOfLines={1}>{roleLabelOf(thread.counterpartyRole)}</Text>
        </View>
      </View>

      {/* redaction / Trust & Safety banner (no encryption claim) */}
      <Pressable onPress={() => setBannerOpen((v) => !v)} accessibilityRole="button" style={styles.banner}>
        <Icon name="shield" size={16} color={colors.brand} />
        <View style={styles.flexMin}>
          <Text style={styles.bannerTitle}>{MESSAGING_DISCLOSURE_TITLE}</Text>
          {bannerOpen ? <Text style={styles.bannerSub}>{MESSAGING_DISCLOSURE_BODY}</Text> : null}
        </View>
        <Icon name={bannerOpen ? 'chevron-down' : 'chevron-right'} size={16} color={colors.ink3} />
      </Pressable>

      {/* messages */}
      {loading ? (
        <View style={styles.messagesState}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : error ? (
        <View style={styles.messagesState}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent} showsVerticalScrollIndicator={false}>
          {messages.length === 0 ? (
            <Text style={styles.emptyHint}>Say hello. Keep your conversation on Our Haven.</Text>
          ) : (
            messages.map((m) => <Bubble key={m.id} message={m} mine={m.senderUid === myUid} />)
          )}
        </ScrollView>
      )}

      {/* composer */}
      <View style={styles.composerWrap}>
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a message…"
            placeholderTextColor={colors.ink3}
            style={styles.composerInput}
            onSubmitEditing={onSend}
            editable={!loading && !error}
          />
          <Pressable style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendDisabled]} onPress={onSend} accessibilityLabel="Send">
            <Icon name="send" size={14} color={colors.inkInv} />
            <Text style={styles.sendBtnText}>Send</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Bubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  return (
    <View style={[styles.bubbleWrap, mine ? styles.wrapMe : styles.wrapThem]}>
      <View style={[styles.bubble, mine ? styles.bubbleMe : styles.bubbleThem]}>
        <Text style={[styles.bubbleText, mine ? styles.bubbleTextMe : null]}>{message.body}</Text>
      </View>
      {message.redacted ? (
        <View style={styles.redactRow}>
          <Icon name="shield" size={11} color={colors.ink3} />
          <Text style={styles.redactHint}>{MESSAGING_REDACTED_HINT}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flexMin: { flex: 1, minWidth: 0 },

  pane: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 28, overflow: 'hidden', backgroundColor: colors.surface, ...shadow.e1 },

  // thread list
  listCol: { flexGrow: 1, flexBasis: 340, minWidth: 300, borderRightWidth: 1, borderRightColor: colors.hairline, padding: 20 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, marginBottom: 12 },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.ink, padding: 0 },
  listScroll: { gap: 2 },
  listState: { paddingVertical: 40, alignItems: 'center' },
  listStateText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2, paddingVertical: 24, paddingHorizontal: 6 },
  threadRow: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: radii.md },
  threadRowOn: { backgroundColor: colors.surfaceAlt },
  threadRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  threadWho: { flex: 1, fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  threadWhen: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3 },
  threadLast: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.ink2 },
  threadMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  redactPillText: { fontFamily: fonts.semibold, fontSize: 10, color: colors.ink3 },

  // active thread
  threadCol: { flexGrow: 1, flexBasis: 480, minWidth: 360 },
  threadInner: {},
  threadEmpty: { padding: 48, alignItems: 'center', justifyContent: 'center', minHeight: 240 },
  threadEmptyText: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink3 },
  threadHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 18, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  headName: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  headSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 1 },

  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginHorizontal: 24, marginTop: 16, padding: 13, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  bannerTitle: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  bannerSub: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink2, marginTop: 3 },

  messages: { maxHeight: 460 },
  messagesState: { height: 220, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
  messagesContent: { padding: 24, gap: 12 },
  emptyHint: { alignSelf: 'center', textAlign: 'center', fontFamily: fonts.regular, fontSize: 13, color: colors.ink3, marginTop: 32 },

  bubbleWrap: { maxWidth: '74%' },
  wrapMe: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  wrapThem: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { paddingVertical: 10, paddingHorizontal: 14 },
  bubbleThem: { backgroundColor: colors.surfaceAlt, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomRightRadius: 18, borderBottomLeftRadius: 4 },
  bubbleMe: { backgroundColor: colors.brand, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomRightRadius: 4, borderBottomLeftRadius: 18 },
  bubbleText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink },
  bubbleTextMe: { color: colors.inkInv },
  redactRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, paddingHorizontal: 2 },
  redactHint: { fontFamily: fonts.medium, fontSize: 10.5, color: colors.ink3 },

  composerWrap: { padding: 16, borderTopWidth: 1, borderTopColor: colors.hairline },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surfaceAlt, borderRadius: radii.pill, paddingVertical: 6, paddingLeft: 18, paddingRight: 6 },
  composerInput: { flex: 1, height: 40, fontFamily: fonts.regular, fontSize: 13, color: colors.ink, padding: 0 },
  sendBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 16, borderRadius: radii.pill, backgroundColor: colors.brand },
  sendBtnText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkInv },
  sendDisabled: { opacity: 0.4 },
});
