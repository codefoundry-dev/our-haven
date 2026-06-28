/**
 * ProviderAvailabilityWeb — the clinical Provider's consultation-slot editor on
 * desktop web. Content-only: the route dispatcher wraps this in
 * <WebShell role="provider" active="availability">.
 *
 * Consultation-centric per ADR-0011 / CONTEXT.md: Parents book an open slot
 * directly and clinical discussion + payment happen OFF-PLATFORM — so this keeps
 * the native slot-picker semantics (date · session length · open slots) and does
 * NOT show the Stripe-Connect commission rate card from the raw caregiver design
 * (web-screens/provider-availability.jsx). The two-column desktop layout borrows
 * that design's card + right-rail shape. RN primitives only (renders via RN-web).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { Card } from '@/components/ui/Card';
import { WebPageHeader } from '@/components/web/WebShell';
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

// Seeded selection per date id → the slots currently marked open (mirrors native).
const INITIAL: Record<string, string[]> = {
  tue: ['9:00 AM', '10:30 AM', '1:00 PM'],
  wed: ['1:45 PM', '2:30 PM'],
};

export function ProviderAvailabilityWeb() {
  const router = useRouter();
  const [dateId, setDateId] = useState('tue');
  const [duration, setDuration] = useState<number>(45);
  const [selected, setSelected] = useState<Record<string, string[]>>(INITIAL);

  const open = selected[dateId] ?? [];
  const weekTotal = Object.values(selected).reduce((n, arr) => n + arr.length, 0);
  const daysOpen = Object.values(selected).filter((arr) => arr.length > 0).length;

  function toggle(time: string) {
    setSelected((prev) => {
      const cur = prev[dateId] ?? [];
      const next = cur.includes(time) ? cur.filter((t) => t !== time) : [...cur, time];
      return { ...prev, [dateId]: next };
    });
  }

  return (
    <View>
      <WebPageHeader greet="Provider · Availability" title="Consultation slots" actions={['bell', 'message']} />

      <View style={styles.body}>
        <View style={styles.layout}>
          {/* ── left · the slot editor ────────────────────────────── */}
          <View style={styles.mainCol}>
            <Card radius={radii.xl} padding={28} style={styles.editor}>
              <Text style={styles.headline}>When can parents book consultations?</Text>
              <Text style={styles.sub}>
                Pick a date and session length, then tap the slots you&rsquo;re open for. Parents book an open
                slot directly — payment is arranged off-platform.
              </Text>

              {/* date row */}
              <Text style={styles.fieldLabel}>Date</Text>
              <View style={styles.dateRow}>
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
              </View>

              {/* session length */}
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

              {/* open slots grid */}
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
                      {on ? <Icon name="check" size={15} color={colors.brand} /> : null}
                      <Text style={[styles.slotText, on && { color: colors.ink }]}>{t}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          </View>

          {/* ── right · week summary + save ───────────────────────── */}
          <View style={styles.sideCol}>
            <Card radius={radii.xl} padding={22} style={styles.sideCard}>
              <Text style={styles.secHead}>This week</Text>
              <View style={styles.statRow}>
                <View style={styles.statTile}>
                  <Text style={styles.statValue}>{weekTotal}</Text>
                  <Text style={styles.statLabel}>Open slots</Text>
                </View>
                <View style={styles.statTile}>
                  <Text style={styles.statValue}>{daysOpen}</Text>
                  <Text style={styles.statLabel}>Days open</Text>
                </View>
                <View style={styles.statTile}>
                  <Text style={styles.statValue}>{duration}</Text>
                  <Text style={styles.statLabel}>Min / session</Text>
                </View>
              </View>
            </Card>

            <View style={styles.note}>
              <Icon name="info" size={18} color={colors.brand} />
              <Text style={styles.noteText}>
                Booking a slot holds your time and notifies you by text. Clinical discussion and payment happen
                off-platform.
              </Text>
            </View>

            <Pressable onPress={() => router.back()} style={styles.saveBtn}>
              <Icon name="check" size={16} color={colors.inkInv} />
              <Text style={styles.saveText}>Save availability</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  mainCol: { flexGrow: 1.6, flexBasis: 560, minWidth: 360 },
  sideCol: { flexGrow: 1, flexBasis: 320, minWidth: 280, gap: 16 },

  editor: { ...shadow.e1 },
  headline: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.ink2, marginTop: 8, maxWidth: 560 },

  fieldLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink2,
    marginTop: 24,
    marginBottom: 12,
  },

  dateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  datePill: {
    width: 64,
    height: 78,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  datePillActive: { backgroundColor: colors.ink },
  dateDow: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.4, color: colors.ink3 },
  dateNum: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
  dateDot: { width: 6, height: 6, borderRadius: radii.pill },

  durationRow: { flexDirection: 'row', gap: 10 },
  durationPill: {
    flexGrow: 1,
    flexBasis: 120,
    height: 46,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  durationPillActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  durationPillIdle: { backgroundColor: colors.surface, borderColor: colors.hairline },
  durationText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  slotHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  slotCount: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.ink3, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  slot: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 130,
    height: 52,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
  },
  slotOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  slotOff: { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline },
  slotText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink2, fontVariant: ['tabular-nums'] },

  // right column
  sideCard: { ...shadow.e1 },
  secHead: { fontFamily: fonts.bold, fontSize: 11.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 14 },
  statRow: { flexDirection: 'row', gap: 12 },
  statTile: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radii.sm, paddingVertical: 14, paddingHorizontal: 12 },
  statValue: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink, fontVariant: ['tabular-nums'] },
  statLabel: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink2, marginTop: 2 },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },

  saveBtn: { height: 50, borderRadius: radii.pill, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  saveText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
});
