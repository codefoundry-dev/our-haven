/**
 * MessageThreadWeb — one open 1:1 conversation on desktop web (OH-205), shared by
 * Parent and supply roles. Content-only: the route dispatcher wraps this in the
 * role-aware shell (<ParentWebShell active="messages"> for parents,
 * <WebShell role={role} active="messages"> for caregiver/provider).
 *
 * A comfortable thread column (header + collapsible redaction / Trust & Safety
 * banner — NO encryption claim, CONTEXT § Message — + transcript + composer)
 * beside a right rail with the counterpart card + a stay-on-platform safety note.
 * Wired to `useMessageThread` (live via Supabase Realtime). RN primitives only.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { OfferBubble } from '@/components/offers/OfferBubble';
import { OfferComposer } from '@/components/offers/OfferComposer';
import { OfferCounterSheet } from '@/components/offers/OfferCounterSheet';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { WebPageHeader } from '@/components/web/WebShell';
import type { ChatMessage, Offer } from '@/api/client';
import {
  MESSAGING_DISCLOSURE_BODY,
  MESSAGING_DISCLOSURE_TITLE,
  MESSAGING_REDACTED_HINT,
} from '@/lib/messagingCopy';
import { useMessageThread } from '@/lib/useMessageThread';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export function MessageThreadWeb() {
  const router = useRouter();
  const go = (r: string) => router.push(r as never);
  const { session, role } = useAuth();
  const myUid = session?.user?.id ?? null;
  const { id, threadId, name } = useLocalSearchParams<{ id?: string; threadId?: string; name?: string }>();

  const {
    thread,
    timeline,
    loading,
    error,
    sending,
    send,
    composeOffer,
    acceptOffer,
    declineOffer,
    withdrawOffer,
    counterOffer,
  } = useMessageThread({ providerId: id, threadId });
  const counterpart =
    (name && name.trim().length > 0 ? name.trim() : null) ?? thread?.counterpartyName ?? 'Conversation';
  const roleLabel = thread?.counterpartyRole === 'caregiver' ? 'Caregiver' : thread?.counterpartyRole === 'parent' ? 'Parent' : null;
  const iAmParent = role === 'parent';
  const providerId = id ?? thread?.providerId ?? null;

  const [bannerOpen, setBannerOpen] = useState(true);
  const [draft, setDraft] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [countering, setCountering] = useState<Offer | null>(null);
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [timeline.length]);

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

  const runOffer = async (offerId: string, action: () => Promise<unknown>) => {
    setBusyOfferId(offerId);
    try {
      await action();
    } catch {
      // surfaced by the hook; the bubble stays in its prior state
    } finally {
      setBusyOfferId(null);
    }
  };

  return (
    <View>
      <WebPageHeader greet="Messages" title="Conversation" actions={['bell']} />

      <View style={styles.body}>
        <View style={styles.layout}>
          {/* ── left · the open thread ──────────────────────────── */}
          <View style={styles.mainCol}>
            <Card radius={28} padding={0} style={styles.threadCard}>
              {/* header */}
              <View style={styles.threadHead}>
                <Pressable onPress={() => go('/messages')} style={styles.backBtn} accessibilityLabel="Back to messages">
                  <Icon name="chevron-left" size={18} color={colors.ink} />
                </Pressable>
                <Avatar label={counterpart} tone="catTutor" size="lg" />
                <View style={styles.flexMin}>
                  <Text style={styles.headName} numberOfLines={1}>
                    {counterpart}
                  </Text>
                  {roleLabel ? <Text style={styles.headSub}>{roleLabel}</Text> : null}
                </View>
              </View>

              {/* collapsible redaction / Trust & Safety banner (no encryption claim) */}
              <Pressable onPress={() => setBannerOpen((v) => !v)} accessibilityRole="button" style={styles.banner}>
                <Icon name="shield" size={16} color={colors.brand} />
                <View style={styles.flexMin}>
                  <Text style={styles.bannerTitle}>{MESSAGING_DISCLOSURE_TITLE}</Text>
                  {bannerOpen ? <Text style={styles.bannerSub}>{MESSAGING_DISCLOSURE_BODY}</Text> : null}
                </View>
                <Icon name={bannerOpen ? 'chevron-down' : 'chevron-right'} size={16} color={colors.ink3} />
              </Pressable>

              {/* transcript */}
              {loading ? (
                <View style={styles.transcriptState}>
                  <ActivityIndicator color={colors.brand} />
                </View>
              ) : error ? (
                <View style={styles.transcriptState}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : (
                <ScrollView ref={scrollRef} style={styles.transcript} contentContainerStyle={styles.transcriptContent} showsVerticalScrollIndicator={false}>
                  {timeline.length === 0 ? (
                    <Text style={styles.emptyHint}>Say hello. Keep your conversation on Our Haven.</Text>
                  ) : (
                    timeline.map((item) =>
                      item.kind === 'message' ? (
                        <Bubble key={`m-${item.id}`} message={item.message} mine={item.message.senderUid === myUid} />
                      ) : (
                        <OfferBubble
                          key={`o-${item.id}`}
                          offer={item.offer}
                          mine={item.offer.senderUid === myUid}
                          busy={busyOfferId === item.offer.id}
                          onAccept={() => runOffer(item.offer.id, () => acceptOffer(item.offer.id))}
                          onDecline={() => runOffer(item.offer.id, () => declineOffer(item.offer.id))}
                          onWithdraw={() => runOffer(item.offer.id, () => withdrawOffer(item.offer.id))}
                          onCounter={() => setCountering(item.offer)}
                        />
                      ),
                    )
                  )}
                </ScrollView>
              )}

              {/* composer */}
              <View style={styles.composer}>
                {iAmParent && providerId ? (
                  <Pressable
                    style={styles.bookBtn}
                    accessibilityLabel="Send a booking request"
                    onPress={() => setComposerOpen(true)}
                  >
                    <Icon name="calendar" size={18} color={colors.brand} />
                  </Pressable>
                ) : null}
                <View style={styles.inputPill}>
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    placeholder={`Message ${counterpart.split(' ')[0]}…`}
                    placeholderTextColor={colors.ink3}
                    style={styles.input}
                    onSubmitEditing={onSend}
                    editable={!loading && !error}
                  />
                </View>
                <Pressable
                  style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendDisabled]}
                  accessibilityLabel="Send"
                  onPress={onSend}
                >
                  <Icon name="send" size={18} color={colors.inkInv} />
                </Pressable>
              </View>
            </Card>
          </View>

          {/* ── right · context rail ────────────────────────────── */}
          <View style={styles.sideCol}>
            {/* counterpart quick-card */}
            <View>
              <Text style={styles.railLabel}>{roleLabel ?? 'Conversation'}</Text>
              <Card radius={radii.xl} padding={18} style={styles.railCard}>
                <View style={styles.provRow}>
                  <Avatar label={counterpart} tone="catTutor" size="md" />
                  <View style={styles.flexMin}>
                    <Text style={styles.provName} numberOfLines={1}>
                      {counterpart}
                    </Text>
                  </View>
                </View>
                {thread?.counterpartyRole === 'caregiver' && thread.providerId ? (
                  <Pressable onPress={() => go(`/provider-detail?id=${thread.providerId}`)} style={styles.profileBtn}>
                    <Text style={styles.profileBtnText}>View full profile</Text>
                  </Pressable>
                ) : null}
              </Card>
            </View>

            {/* safety note */}
            <View style={styles.safety}>
              <Icon name="shield" size={18} color={colors.success} />
              <Text style={styles.safetyText}>
                Keep it on Our Haven. Off-platform contact removes your booking &amp; payment protection — and contact
                details shared in chat are automatically redacted.
              </Text>
            </View>
          </View>
        </View>
      </View>

      {iAmParent && providerId ? (
        <OfferComposer
          visible={composerOpen}
          providerId={providerId}
          counterpartName={counterpart}
          onClose={() => setComposerOpen(false)}
          onSubmit={async (body) => {
            await composeOffer(body);
          }}
        />
      ) : null}

      <OfferCounterSheet
        visible={countering != null}
        offer={countering}
        onClose={() => setCountering(null)}
        onSubmit={async (body) => {
          if (countering) await counterOffer(countering.id, body);
        }}
      />
    </View>
  );
}

function Bubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  return (
    <View style={[styles.bubbleWrap, mine ? styles.wrapMe : styles.wrapThem]}>
      <View style={[styles.bubble, mine ? styles.me : styles.them]}>
        <Text style={mine ? styles.meText : styles.themText}>{message.body}</Text>
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

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  mainCol: { flexGrow: 1.6, flexBasis: 520, minWidth: 360, maxWidth: 760 },
  sideCol: { flexGrow: 1, flexBasis: 300, minWidth: 280, gap: 16 },

  // thread card
  threadCard: { overflow: 'hidden' },
  threadHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 22,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headName: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  headSub: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2, marginTop: 2 },

  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginHorizontal: 22, marginTop: 18, padding: 13, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  bannerTitle: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  bannerSub: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink2, marginTop: 3 },

  transcript: { maxHeight: 520 },
  transcriptState: { height: 240, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontFamily: fonts.regular, fontSize: 14, color: colors.danger },
  transcriptContent: { gap: 12, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 18 },
  emptyHint: { alignSelf: 'center', textAlign: 'center', fontFamily: fonts.regular, fontSize: 13, color: colors.ink3, marginTop: 40 },

  bubbleWrap: { maxWidth: '78%' },
  wrapMe: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  wrapThem: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { paddingVertical: 11, paddingHorizontal: 15 },
  me: {
    backgroundColor: colors.brand,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: 8,
  },
  them: {
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: radii.xl,
  },
  meText: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 21, color: colors.inkInv },
  themText: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 22, color: colors.ink },
  redactRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, paddingHorizontal: 4 },
  redactHint: { fontFamily: fonts.medium, fontSize: 10.5, color: colors.ink3 },

  composer: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: colors.hairline },
  inputPill: { flex: 1, height: 46, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, paddingHorizontal: 18, justifyContent: 'center' },
  input: { fontFamily: fonts.regular, fontSize: 14.5, color: colors.ink, padding: 0 },
  sendBtn: { width: 46, height: 46, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  bookBtn: { width: 46, height: 46, borderRadius: radii.pill, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.4 },

  // right rail
  railLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 10 },
  railCard: { ...shadow.e1 },
  provRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  provName: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.ink },
  profileBtn: {
    height: 42,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  profileBtnText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },

  safety: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  safetyText: { flex: 1, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink2 },
});
