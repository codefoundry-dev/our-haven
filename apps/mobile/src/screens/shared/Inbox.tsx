/**
 * Inbox — shared conversation list for all three roles (the Messages tab).
 * Ported from the Claude design project (screens/inbox.jsx). The conversation
 * surface is identical across roles; only the empty-state copy adapts to the
 * signed-in role. Rows open the message thread.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { TabStrip } from '@/components/ui/TabStrip';
import { colors, fonts, radii, type ColorToken } from '@/theme/tokens';

type Role = 'parent' | 'caregiver' | 'provider';
type Tab = 'All' | 'Unread';

interface Convo {
  id: string;
  initial: string;
  tone: ColorToken;
  name: string;
  preview: string;
  time: string;
  unread?: number;
  redacted?: boolean;
}

const CONVOS: Convo[] = [
  { id: '1', initial: 'M', tone: 'catTutor', name: 'Maya Okafor · Tutor', preview: 'Great — see you Saturday morning.', time: '2m', unread: 2 },
  { id: '2', initial: 'D', tone: 'catTutor', name: 'Diego Mejia · Tutor', preview: "I can do an extra hour if you'd like.", time: '1h', unread: 1 },
  { id: '3', initial: 'R', tone: 'catNanny', name: 'Rosario Vega · Nanny', preview: "█ phone hidden — let's chat in-app instead.", time: 'Yesterday', redacted: true },
  { id: '4', initial: 'N', tone: 'catNanny', name: 'Naomi Brooks · Nanny', preview: 'Happy to start next Monday — sent my availability.', time: 'Mon' },
  { id: '5', initial: 'S', tone: 'catBaby', name: 'Sofia Castillo · Babysitter', preview: 'Confirmed for Friday evening.', time: 'May 4' },
  { id: '6', initial: 'O', tone: 'catTutor', name: 'Our Haven Trust & Safety', preview: "We've reviewed your dispute — see details.", time: 'Apr 30' },
];

const EMPTY_COPY: Record<Role, string> = {
  parent: 'When you message a Caregiver, your conversations show up here.',
  caregiver: 'When a Parent reaches out about a Job, your conversations show up here.',
  provider: 'When a Parent books a consultation, your conversations show up here.',
};

export function Inbox({ role }: { role: Role }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('All');
  const unreadCount = CONVOS.reduce((n, c) => n + (c.unread ? 1 : 0), 0);
  const rows = tab === 'Unread' ? CONVOS.filter((c) => c.unread) : CONVOS;

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar large title="Messages" actions={[{ icon: 'bell', badge: true, label: 'Notifications' }]} />

      <View style={styles.tabsRow}>
        <TabStrip<Tab> tabs={['All', 'Unread'] as const} value={tab} onChange={setTab} />
        {unreadCount > 0 ? <Text style={styles.unreadHint}>{unreadCount} unread</Text> : null}
      </View>

      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No messages yet</Text>
          <Text style={styles.emptySub}>{EMPTY_COPY[role]}</Text>
        </View>
      ) : (
        rows.map((c) => <Row key={c.id} convo={c} onPress={() => router.push('/message-thread')} />)
      )}
    </Screen>
  );
}

function Row({ convo, onPress }: { convo: Convo; onPress: () => void }) {
  const unread = !!convo.unread;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={styles.avatarWrap}>
        <Avatar label={convo.initial} tone={convo.tone} size="lg" />
        {unread ? (
          <View style={styles.unreadDot}>
            <Text style={styles.unreadDotText}>{convo.unread}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
            {convo.name}
          </Text>
          <Text style={styles.time}>{convo.time}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
            {convo.preview}
          </Text>
          {convo.redacted ? <Text style={styles.redacted}>Redacted</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },
  tabsRow: { marginTop: 8, marginBottom: 4 },
  unreadHint: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2, textAlign: 'right', marginTop: 8 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  avatarWrap: { width: 56, height: 56 },
  unreadDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.canvas,
  },
  unreadDotText: { fontFamily: fonts.bold, fontSize: 11, color: colors.inkInv },

  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  nameUnread: { fontFamily: fonts.bold },
  time: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  preview: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  previewUnread: { fontFamily: fonts.medium, color: colors.ink },
  redacted: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },

  empty: { alignItems: 'center', paddingTop: 64, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, textAlign: 'center', maxWidth: 280 },
});
