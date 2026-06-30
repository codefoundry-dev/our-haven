/**
 * Inbox — shared conversation list for all three roles (the Messages tab, OH-205).
 * The surface is identical across roles; only the empty-state copy adapts. Rows
 * open the live message thread.
 *
 * Wired to `GET /v1/threads` (useInbox). A Parent row reopens the thread by the
 * Caregiver's providerId (idempotent); a Caregiver row opens it by threadId.
 * v1 has no read-receipts, so there is no unread state (the mock's unread tab /
 * badges were placeholders).
 */
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/ui/Avatar';
import type { MessageThreadSummary } from '@/api/client';
import { MESSAGING_REDACTED_HINT } from '@/lib/messagingCopy';
import { useInbox } from '@/lib/useInbox';
import { colors, fonts, radii } from '@/theme/tokens';

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

export function Inbox({ role }: { role: Role }) {
  const router = useRouter();
  const { data, loading, error } = useInbox();

  const open = (t: MessageThreadSummary) => {
    const name = t.counterpartyName ?? '';
    // A Parent reopens by the Caregiver's providerId (get-or-create is idempotent);
    // a Caregiver opens the existing thread by id.
    const params = role === 'parent' ? { id: t.providerId, name } : { threadId: t.id, name };
    router.push({ pathname: '/message-thread', params });
  };

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar large title="Messages" />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : error ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Couldn’t load messages</Text>
          <Text style={styles.emptySub}>{error}</Text>
        </View>
      ) : data.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No messages yet</Text>
          <Text style={styles.emptySub}>{EMPTY_COPY[role]}</Text>
        </View>
      ) : (
        data.map((t) => <Row key={t.id} thread={t} onPress={() => open(t)} />)
      )}
    </Screen>
  );
}

function Row({ thread, onPress }: { thread: MessageThreadSummary; onPress: () => void }) {
  const name = thread.counterpartyName ?? 'Conversation';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
      <Avatar label={name} tone="catTutor" size="lg" />

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.time}>{relativeTime(thread.lastMessageAt)}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={styles.preview} numberOfLines={1}>
            {thread.lastMessagePreview ?? 'No messages yet'}
          </Text>
          {thread.lastMessageRedacted ? (
            <View style={styles.redactPill}>
              <Icon name="shield" size={10} color={colors.ink2} />
              <Text style={styles.redacted}>{MESSAGING_REDACTED_HINT}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },
  center: { paddingTop: 64, alignItems: 'center' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  time: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  preview: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  redactPill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  redacted: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.3, color: colors.ink2 },

  empty: { alignItems: 'center', paddingTop: 64, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, textAlign: 'center', maxWidth: 280 },
});
