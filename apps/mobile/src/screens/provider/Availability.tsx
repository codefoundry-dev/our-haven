/**
 * Consultation availability editor — where the Provider sets the windows Parents
 * can book (ADR-0011: Providers are consultation-centric). Pick a date, choose a
 * session length, then toggle the time slots you're open for. A sticky
 * "Save availability" CTA commits. UI-only scaffold — no backend wiring.
 *
 * Design reference: Claude design project — screens/provider-availability-tab.jsx
 * (read-only profile summary) reframed as the editable slot picker.
 *
 * This is the native (and narrow-web) body; the desktop layout lives in
 * `@/screens/web/cp/Availability` and is chosen by `availability.web.tsx`.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

interface DateOption {
  id: string;
  dow: string;
  date: number;
}

const DATES: readonly DateOption[] = [
  { id: 'mon', dow: 'MON', date: 19 },
  { id: 'tue', dow: 'TUE', date: 20 },
  { id: 'wed', dow: 'WED', date: 21 },
  { id: 'thu', dow: 'THU', date: 22 },
  { id: 'fri', dow: 'FRI', date: 23 },
  { id: 'sat', dow: 'SAT', date: 24 },
  { id: 'sun', dow: 'SUN', date: 25 },
];

const DURATIONS = [30, 45, 60] as const;

const TIMES: readonly string[] = [
  '9:00 AM',
  '9:45 AM',
  '10:30 AM',
  '11:15 AM',
  '1:00 PM',
  '1:45 PM',
  '2:30 PM',
  '3:30 PM',
  '4:15 PM',
];

// Seeded selection per date id → the slots currently marked open.
const INITIAL: Record<string, string[]> = {
  tue: ['9:00 AM', '10:30 AM', '1:00 PM'],
  wed: ['1:45 PM', '2:30 PM'],
};

export default function AvailabilityScreen() {
  const router = useRouter();
  const [dateId, setDateId] = useState('tue');
  const [duration, setDuration] = useState<number>(45);
  const [selected, setSelected] = useState<Record<string, string[]>>(INITIAL);

  const open = selected[dateId] ?? [];

  function toggle(time: string) {
    setSelected((prev) => {
      const cur = prev[dateId] ?? [];
      const next = cur.includes(time) ? cur.filter((t) => t !== time) : [...cur, time];
      return { ...prev, [dateId]: next };
    });
  }

  return (
    <Screen edges={['top']} contentStyle={styles.content}>
      <AppBar onBack={() => router.back()} title="Availability" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.headline}>When can parents book consultations?</Text>
        <Text style={styles.sub}>
          Pick a date and session length, then tap the slots you're open for. Parents book an open slot
          directly — payment is arranged off-platform.
        </Text>

        {/* Date pills */}
        <Text style={styles.fieldLabel}>Date</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.rail}
          contentContainerStyle={styles.railContent}
        >
          {DATES.map((d) => {
            const active = d.id === dateId;
            const has = (selected[d.id] ?? []).length > 0;
            return (
              <Pressable
                key={d.id}
                onPress={() => setDateId(d.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.datePill, active ? styles.datePillActive : null]}
              >
                <Text style={[styles.dateDow, active && { color: colors.inkInv }]}>{d.dow}</Text>
                <Text style={[styles.dateNum, active && { color: colors.inkInv }]}>{d.date}</Text>
                <View
                  style={[
                    styles.dateDot,
                    { backgroundColor: has ? (active ? colors.highlight : colors.brand) : 'transparent' },
                  ]}
                />
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Session duration */}
        <Text style={styles.fieldLabel}>Session length</Text>
        <View style={styles.durationRow}>
          {DURATIONS.map((d) => {
            const active = d === duration;
            return (
              <Pressable
                key={d}
                onPress={() => setDuration(d)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.durationPill, active ? styles.durationPillActive : styles.durationPillIdle]}
              >
                <Text style={[styles.durationText, active && { color: colors.inkInv }]}>{d} min</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Time-slot grid */}
        <View style={styles.slotHeader}>
          <Text style={styles.fieldLabel}>Open slots</Text>
          <Text style={styles.slotCount}>{open.length} selected</Text>
        </View>
        <View style={styles.grid}>
          {TIMES.map((t) => {
            const on = open.includes(t);
            return (
              <Pressable
                key={t}
                onPress={() => toggle(t)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.slot, on ? styles.slotOn : styles.slotOff]}
              >
                {on ? <Icon name="check" size={14} color={colors.brand} /> : null}
                <Text style={[styles.slotText, on && { color: colors.ink }]}>{t}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.note}>
          <Icon name="info" size={15} color={colors.ink3} />
          <Text style={styles.noteText}>
            Booking a slot holds your time and notifies you by text. Clinical discussion and payment happen
            off-platform.
          </Text>
        </View>
      </ScrollView>

      {/* Sticky save */}
      <View style={styles.footer}>
        <PrimaryButton
          onPress={() => router.back()}
          icon={<Icon name="check" size={18} color={colors.inkInv} />}
        >
          Save availability
        </PrimaryButton>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: 0 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 24 },
  headline: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.4, color: colors.ink, marginTop: 12 },
  sub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2, marginTop: 6 },

  fieldLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink2,
    marginTop: 22,
    marginBottom: 10,
  },
  rail: { marginHorizontal: -24 },
  railContent: { paddingHorizontal: 24, gap: 8 },
  datePill: {
    width: 56,
    height: 72,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    ...shadow.e1,
  },
  datePillActive: { backgroundColor: colors.ink },
  dateDow: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.4, color: colors.ink3 },
  dateNum: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, fontVariant: ['tabular-nums'] },
  dateDot: { width: 6, height: 6, borderRadius: radii.pill },

  durationRow: { flexDirection: 'row', gap: 10 },
  durationPill: {
    flex: 1,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  durationPillActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  durationPillIdle: { backgroundColor: colors.surface, borderColor: colors.hairline },
  durationText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  slotHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  slotCount: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink3, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  slot: {
    width: '31%',
    height: 46,
    borderRadius: radii.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1.5,
  },
  slotOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  slotOff: { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline },
  slotText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2, fontVariant: ['tabular-nums'] },

  note: { flexDirection: 'row', gap: 10, marginTop: 22, alignItems: 'flex-start' },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.ink2 },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 28,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    ...shadow.e2,
  },
});
