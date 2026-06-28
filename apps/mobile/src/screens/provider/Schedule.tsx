/**
 * Provider (clinical) Schedule — the licensed-clinician landing tab (ADR-0011).
 * A day selector + that day's CONSULTATION sessions as time cards (parent + child,
 * time, video vs in-person, and a Join / Details action). A small "Set availability"
 * link jumps to the consultation-availability editor.
 *
 * Design reference: Claude design project — screens/provider-schedule.jsx
 * (adapted from the caregiver/tutor day view to the consultation-centric Provider).
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

type Mode = 'video' | 'in-person';

interface Day {
  id: string;
  dow: string;
  date: number;
  label: string;
}

interface Session {
  id: string;
  time: string;
  meridiem: string;
  parent: string;
  child: string;
  topic: string;
  mode: Mode;
  live?: boolean;
}

const DAYS: readonly Day[] = [
  { id: 'mon', dow: 'MON', date: 19, label: 'Monday, May 19' },
  { id: 'tue', dow: 'TUE', date: 20, label: 'Tuesday, May 20' },
  { id: 'wed', dow: 'WED', date: 21, label: 'Wednesday, May 21' },
  { id: 'thu', dow: 'THU', date: 22, label: 'Thursday, May 22' },
  { id: 'fri', dow: 'FRI', date: 23, label: 'Friday, May 23' },
  { id: 'sat', dow: 'SAT', date: 24, label: 'Saturday, May 24' },
  { id: 'sun', dow: 'SUN', date: 25, label: 'Sunday, May 25' },
];

const SESSIONS: readonly Session[] = [
  { id: '1', time: '9:00', meridiem: 'AM', parent: 'Priya N.', child: 'Amara (6)', topic: 'OT consultation', mode: 'video', live: true },
  { id: '2', time: '11:30', meridiem: 'AM', parent: 'Marcus T.', child: 'Eli (4)', topic: 'Speech evaluation', mode: 'in-person' },
  { id: '3', time: '2:00', meridiem: 'PM', parent: 'Sarah K.', child: 'Noah (8)', topic: 'ABA follow-up', mode: 'video' },
];

export function ProviderSchedule() {
  const router = useRouter();
  const [selected, setSelected] = useState(2); // Wednesday
  const day = DAYS[selected];

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar large title="Schedule" actions={[{ icon: 'bell', badge: true, label: 'Notifications' }]} />

      {/* Day selector — horizontal week rail */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.rail}
        contentContainerStyle={styles.railContent}
      >
        {DAYS.map((d, i) => {
          const active = i === selected;
          return (
            <Pressable
              key={d.id}
              onPress={() => setSelected(i)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[styles.dayPill, active ? styles.dayPillActive : null]}
            >
              <Text style={[styles.dayDow, active && { color: colors.inkInv }]}>{d.dow}</Text>
              <Text style={[styles.dayNum, active && { color: colors.inkInv }]}>{d.date}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <SectionHeader
        title={day.label}
        action="Set availability"
        onAction={() => router.push('/availability')}
        size="md"
        style={styles.section}
      />

      <View style={styles.list}>
        {SESSIONS.map((s) => (
          <SessionCard key={s.id} session={s} router={router} />
        ))}
      </View>
    </Screen>
  );
}

function SessionCard({ session, router }: { session: Session; router: ReturnType<typeof useRouter> }) {
  const modeIcon: IconName = session.mode === 'video' ? 'video' : 'pin';
  const modeLabel = session.mode === 'video' ? 'Video' : 'In-person';
  const isVideo = session.mode === 'video';

  return (
    <Card onPress={() => router.push('/booking-detail')} padding={14} radius={radii.lg} style={styles.card}>
      <View style={styles.timeBlock}>
        <Text style={styles.timeNum}>{session.time}</Text>
        <Text style={styles.timeMeridiem}>{session.meridiem}</Text>
      </View>

      <View style={styles.cardBody}>
        {session.live ? (
          <View style={styles.liveRow}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live now</Text>
          </View>
        ) : null}
        <Text style={styles.cardTitle} numberOfLines={1}>
          {session.parent} · {session.topic}
        </Text>
        <Text style={styles.cardSub} numberOfLines={1}>
          for {session.child}
        </Text>
        <View style={styles.modeRow}>
          <Icon name={modeIcon} size={13} color={colors.ink2} />
          <Text style={styles.modeText}>{modeLabel}</Text>
        </View>
      </View>

      {isVideo ? (
        <Pressable
          onPress={() => router.push('/consult')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.joinBtn, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={styles.joinText}>Join</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => router.push('/booking-detail')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.detailsBtn, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={styles.detailsText}>Details</Text>
        </Pressable>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },
  rail: { marginHorizontal: -24, marginTop: 14 },
  railContent: { paddingHorizontal: 24, gap: 8 },
  dayPill: {
    width: 52,
    height: 64,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    ...shadow.e1,
  },
  dayPillActive: { backgroundColor: colors.ink },
  dayDow: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.4, color: colors.ink3 },
  dayNum: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, fontVariant: ['tabular-nums'] },
  section: { marginTop: 22, marginBottom: 12 },
  list: { gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeBlock: {
    width: 56,
    paddingVertical: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
  },
  timeNum: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
  timeMeridiem: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.5, color: colors.ink2, marginTop: 1 },
  cardBody: { flex: 1, minWidth: 0 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  liveDot: { width: 7, height: 7, borderRadius: radii.pill, backgroundColor: colors.info },
  liveText: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.info },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  cardSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  modeText: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2 },
  joinBtn: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },
  detailsBtn: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
});
