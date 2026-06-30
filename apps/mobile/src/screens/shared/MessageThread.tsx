/**
 * Message thread (shared) — one live 1:1 conversation (OH-205). Header with the
 * other party, a collapsible redaction + Trust & Safety disclosure banner (NO
 * encryption claim — CONTEXT § Message), the transcript (sent = brand teal right,
 * received = surface left; redacted bodies arrive already masked), and a composer.
 *
 * Wired to `useMessageThread`: a Parent arrives with `id` (the Caregiver's
 * providerId → get-or-create the thread); a Caregiver / inbox arrival uses
 * `threadId`. Delivery is live via Supabase Realtime.
 *
 * This is the native + narrow-web body. The bespoke desktop layout lives in
 * `@/screens/web/shared/MessageThread` and is chosen by `message-thread.web.tsx`.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import type { ChatMessage } from '@/api/client';
import {
  MESSAGING_DISCLOSURE_BODY,
  MESSAGING_DISCLOSURE_TITLE,
  MESSAGING_REDACTED_HINT,
} from '@/lib/messagingCopy';
import { useMessageThread } from '@/lib/useMessageThread';
import { colors, fonts, maxContentWidth, radii, shadow } from '@/theme/tokens';

export default function MessageThreadScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const myUid = session?.user?.id ?? null;
  const { id, threadId, name } = useLocalSearchParams<{ id?: string; threadId?: string; name?: string }>();

  const { thread, messages, loading, error, sending, send } = useMessageThread({
    providerId: id,
    threadId,
  });

  const counterpart =
    (name && name.trim().length > 0 ? name.trim() : null) ?? thread?.counterpartyName ?? 'Conversation';
  const firstName = counterpart.split(' ')[0];

  const [bannerOpen, setBannerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    // Keep the newest message in view as the transcript grows.
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
      setDraft(text); // restore the draft so the user can retry
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.center}>
          {/* Header */}
          <View style={styles.header}>
            <IconButton name="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
            <Avatar label={counterpart} tone="catTutor" size="sm" />
            <View style={styles.headerName}>
              <Text style={styles.name} numberOfLines={1}>
                {counterpart}
              </Text>
              {thread?.counterpartyRole ? (
                <Text style={styles.sub} numberOfLines={1}>
                  {thread.counterpartyRole === 'caregiver' ? 'Caregiver' : 'Parent'}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Collapsible redaction / Trust & Safety banner (no encryption claim) */}
          <Pressable
            onPress={() => setBannerOpen((v) => !v)}
            accessibilityRole="button"
            style={styles.banner}
          >
            <Icon name="shield" size={16} color={colors.brand} />
            <View style={styles.bannerBody}>
              <Text style={styles.bannerTitle}>{MESSAGING_DISCLOSURE_TITLE}</Text>
              {bannerOpen ? <Text style={styles.bannerSub}>{MESSAGING_DISCLOSURE_BODY}</Text> : null}
            </View>
            <Icon name={bannerOpen ? 'chevron-down' : 'chevron-right'} size={16} color={colors.ink3} />
          </Pressable>

          {/* Transcript */}
          {loading ? (
            <View style={styles.fillCenter}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : error ? (
            <View style={styles.fillCenter}>
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : (
            <ScrollView
              ref={scrollRef}
              style={styles.flex}
              contentContainerStyle={styles.thread}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {messages.length === 0 ? (
                <Text style={styles.emptyHint}>
                  Say hello to {firstName}. Keep your conversation on Our Haven.
                </Text>
              ) : (
                messages.map((m) => <Bubble key={m.id} message={m} mine={m.senderUid === myUid} />)
              )}
            </ScrollView>
          )}

          {/* Composer */}
          <View style={styles.composer}>
            <View style={styles.inputPill}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={`Message ${firstName}…`}
                placeholderTextColor={colors.ink3}
                style={styles.input}
                multiline
                onSubmitEditing={onSend}
                editable={!loading && !error}
              />
            </View>
            <IconButton
              name="send"
              dark
              accessibilityLabel="Send"
              onPress={onSend}
              style={!draft.trim() || sending ? styles.sendDisabled : undefined}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  safe: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1, width: '100%' },
  center: { flex: 1, width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingHorizontal: 24 },
  fillCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  error: { fontFamily: fonts.regular, fontSize: 14, color: colors.danger, textAlign: 'center' },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  headerName: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  sub: { fontFamily: fonts.medium, fontSize: 11, color: colors.ink2, marginTop: 1 },

  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12, padding: 12, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  bannerBody: { flex: 1, minWidth: 0 },
  bannerTitle: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  bannerSub: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 3 },

  thread: { gap: 10, paddingTop: 16, paddingBottom: 16 },
  emptyHint: { alignSelf: 'center', textAlign: 'center', fontFamily: fonts.regular, fontSize: 13, color: colors.ink3, marginTop: 40, maxWidth: 280 },

  bubbleWrap: { maxWidth: '82%' },
  wrapMe: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  wrapThem: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { paddingVertical: 10, paddingHorizontal: 14 },
  me: {
    backgroundColor: colors.brand,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: 8,
  },
  them: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: radii.xl,
    ...shadow.e1,
  },
  meText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, color: colors.inkInv },
  themText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink },
  redactRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, paddingHorizontal: 4 },
  redactHint: { fontFamily: fonts.medium, fontSize: 10, color: colors.ink3 },

  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.hairline },
  inputPill: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: radii.lg, backgroundColor: colors.surface, paddingHorizontal: 16, justifyContent: 'center' },
  input: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink, padding: 0, paddingVertical: 12 },
  sendDisabled: { opacity: 0.4 },
});
