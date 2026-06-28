/**
 * Message thread (shared) — ported from the Claude design project
 * (screens/messages.jsx). A 1:1 conversation: header with the other party +
 * a video-call action, a collapsible "encrypted / contact info auto-redacted"
 * banner, message bubbles (sent = brand teal right, received = surface left),
 * a redaction example, and a composer.
 *
 * UI-only skeleton with mock data. The composer/CTAs are inert.
 *
 * This is the native + narrow-web body. The bespoke desktop layout lives in
 * `@/screens/web/shared/MessageThread` and is chosen by `message-thread.web.tsx`.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export default function MessageThreadScreen() {
  const router = useRouter();
  const [bannerOpen, setBannerOpen] = useState(true);
  const [draft, setDraft] = useState('');

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <IconButton name="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
        <Avatar label="Maya" tone="catTutor" size="sm" online />
        <View style={styles.headerName}>
          <Text style={styles.name} numberOfLines={1}>
            Maya Okafor
          </Text>
          <View style={styles.statusRow}>
            <View style={styles.onlineDot} />
            <Text style={styles.online}>Online</Text>
          </View>
        </View>
        <IconButton name="video" accessibilityLabel="Start video call" />
      </View>

      {/* Collapsible encryption / redaction banner */}
      <Pressable
        onPress={() => setBannerOpen((v) => !v)}
        accessibilityRole="button"
        style={styles.banner}
      >
        <Icon name="lock" size={16} color={colors.brand} />
        <View style={styles.bannerBody}>
          <Text style={styles.bannerTitle}>Encrypted & monitored</Text>
          {bannerOpen ? (
            <Text style={styles.bannerSub}>
              Messages are end-to-end encrypted. Sharing contact info — phone numbers and emails — is automatically redacted to keep you on-platform.
            </Text>
          ) : null}
        </View>
        <Icon name={bannerOpen ? 'chevron-down' : 'chevron-right'} size={16} color={colors.ink3} />
      </Pressable>

      {/* Transcript */}
      <View style={styles.thread}>
        <Text style={styles.dayMarker}>Today · earlier</Text>

        <Bubble from="them">Hi Adjei! I'm confirmed for Anika's Wednesday morning session. Want me to bring the workbook?</Bubble>

        <Bubble from="me">Yes please! Should I send the address again?</Bubble>

        {/* Received with an inline redaction pill */}
        <View style={[styles.bubble, styles.them]}>
          <Text style={styles.themText}>
            No need — already saved. If anything comes up text me at{' '}
            <Text style={styles.redactPill}> █ phone hidden </Text> — I'll bring everything.
          </Text>
        </View>

        <Bubble from="me">Perfect. See you Wednesday.</Bubble>
      </View>

      {/* Composer */}
      <View style={styles.composer}>
        <View style={styles.inputPill}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message Maya…"
            placeholderTextColor={colors.ink3}
            style={styles.input}
          />
        </View>
        <IconButton name="paperclip" accessibilityLabel="Attach" />
        <IconButton name="send" dark accessibilityLabel="Send" />
      </View>
    </Screen>
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
  content: { paddingBottom: 120 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  headerName: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  onlineDot: { width: 6, height: 6, borderRadius: radii.pill, backgroundColor: colors.success },
  online: { fontFamily: fonts.medium, fontSize: 11, color: colors.success },

  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12, padding: 12, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  bannerBody: { flex: 1, minWidth: 0 },
  bannerTitle: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  bannerSub: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 3 },

  thread: { gap: 10, paddingTop: 16, paddingBottom: 12 },
  dayMarker: { alignSelf: 'center', fontFamily: fonts.medium, fontSize: 11, color: colors.ink3 },
  bubble: { maxWidth: '82%', paddingVertical: 10, paddingHorizontal: 14 },
  me: {
    alignSelf: 'flex-end',
    backgroundColor: colors.brand,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: 8,
  },
  them: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: radii.xl,
    ...shadow.e1,
  },
  meText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, color: colors.inkInv },
  themText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink },
  redactPill: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink2, backgroundColor: colors.surfaceAlt },

  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.hairline },
  inputPill: { flex: 1, height: 44, borderRadius: radii.pill, backgroundColor: colors.surface, paddingHorizontal: 16, justifyContent: 'center' },
  input: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink, padding: 0 },
});
