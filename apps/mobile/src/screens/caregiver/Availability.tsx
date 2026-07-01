/**
 * Caregiver Availability editor (OH-220) — the weekly 7×3 day/band grid + free-text
 * note + Pause toggle that lives on the Caregiver's profile (design §5.11.3.3).
 *
 * Per CONTEXT.md § Availability: a general weekly summary (NOT a per-slot calendar)
 * — Parents see a rendered teaser on the profile; actual Bookings are negotiated in
 * chat. Bands are platform-fixed (Morning 6–12 · Afternoon 12–18 · Evening 18–22).
 * Persists to the same `provider_profiles` columns the profile builder (OH-188)
 * writes, via `PATCH /v1/providers/me/profile` — so the two surfaces stay in sync.
 *
 * Reached from the Schedule tab. This is the Caregiver analogue of the Provider's
 * consultation-slot editor; the `/availability` route dispatches by role.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Toggle } from '@/components/ui/Toggle';
import {
  ApiError,
  getCaregiverProfile,
  patchCaregiverProfile,
  type CaregiverProfile,
} from '@/api/client';
import { AVAILABILITY_BANDS, AVAILABILITY_DAYS, AVAILABILITY_NOTE_MAX } from '@/lib/profile';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

type Grid = Record<string, Record<string, boolean>>;

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKEND_KEYS = ['sat', 'sun'];

function setDays(grid: Grid, dayKeys: string[], on: boolean): Grid {
  const next: Grid = { ...grid };
  for (const day of dayKeys) {
    if (on) {
      const bands: Record<string, boolean> = {};
      for (const b of AVAILABILITY_BANDS) bands[b.key] = true;
      next[day] = bands;
    } else {
      delete next[day];
    }
  }
  return next;
}

export function CaregiverAvailability() {
  const router = useRouter();
  const [grid, setGrid] = useState<Grid>({});
  const [note, setNote] = useState('');
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCaregiverProfile()
      .then((p: CaregiverProfile) => {
        if (cancelled) return;
        setGrid((p.availabilityGrid ?? {}) as Grid);
        setNote(p.availabilityNote ?? '');
        setPaused(p.paused);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'Could not load your availability.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (day: string, band: string) => {
    setSaved(false);
    setGrid((g) => {
      const on = g[day]?.[band] === true;
      const next: Grid = { ...g, [day]: { ...(g[day] ?? {}) } };
      if (on) delete next[day]![band];
      else next[day]![band] = true;
      if (Object.keys(next[day]!).length === 0) delete next[day];
      return next;
    });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await patchCaregiverProfile({
        availabilityGrid: grid,
        availabilityNote: note.trim().length > 0 ? note.trim() : null,
        paused,
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen scroll={false} edges={['top']}>
      <AppBar title="Availability" onBack={() => router.back()} />

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Pause listing */}
            <View style={styles.pauseRow}>
              <View style={styles.pauseIcon}>
                <Icon name="lock" size={16} color={colors.ink} />
              </View>
              <View style={styles.flexMin}>
                <Text style={styles.rowTitle}>Pause new bookings</Text>
                <Text style={styles.rowSub}>Hidden from search until you&apos;re back. Existing bookings continue.</Text>
              </View>
              <Toggle
                on={paused}
                onPress={() => {
                  setSaved(false);
                  setPaused((v) => !v);
                }}
              />
            </View>

            {/* Editor headline */}
            <Text style={styles.headline}>When are you generally available?</Text>
            <Text style={styles.sub}>
              Tap a band to toggle. Parents see a summary on your profile — actual bookings are arranged in chat.
            </Text>

            {/* 7×3 grid */}
            <View style={styles.grid}>
              <View style={styles.gridHeaderRow}>
                <View style={styles.dayCol} />
                {AVAILABILITY_BANDS.map((b) => (
                  <View key={b.key} style={styles.headCell}>
                    <Text style={styles.headLabel}>{b.label}</Text>
                    <Text style={styles.headTime}>{b.time}</Text>
                  </View>
                ))}
              </View>
              {AVAILABILITY_DAYS.map((d) => (
                <View key={d.key} style={styles.gridRow}>
                  <Text style={[styles.dayCol, styles.dayLabel]}>{d.label}</Text>
                  {AVAILABILITY_BANDS.map((b) => {
                    const on = grid[d.key]?.[b.key] === true;
                    return (
                      <Pressable
                        key={b.key}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${d.label} ${b.label}`}
                        onPress={() => toggle(d.key, b.key)}
                        style={[styles.cell, on ? styles.cellOn : styles.cellOff]}
                      >
                        {on ? <Icon name="check" size={16} color={colors.inkInv} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>

            {/* Bulk-apply */}
            <View style={styles.bulkRow}>
              <BulkChip label="All weekdays" onPress={() => { setSaved(false); setGrid((g) => setDays(g, WEEKDAY_KEYS, true)); }} />
              <BulkChip label="Weekends" onPress={() => { setSaved(false); setGrid((g) => setDays(g, WEEKEND_KEYS, true)); }} />
              <BulkChip label="Clear all" onPress={() => { setSaved(false); setGrid({}); }} />
            </View>

            {/* Free-text note */}
            <Text style={styles.noteLabel}>Note for parents (optional)</Text>
            <TextInput
              value={note}
              onChangeText={(t) => {
                setSaved(false);
                setNote(t);
              }}
              placeholder="e.g. Weekends are flexible for last-minute sessions."
              placeholderTextColor={colors.ink3}
              multiline
              maxLength={AVAILABILITY_NOTE_MAX}
              style={styles.note}
            />
            <View style={styles.noteMetaRow}>
              <Text style={styles.noteMeta}>Shown on your profile</Text>
              <Text style={styles.noteMeta}>
                {note.length}/{AVAILABILITY_NOTE_MAX}
              </Text>
            </View>

            {error ? <Text style={styles.err}>{error}</Text> : null}
          </ScrollView>

          {/* Sticky save */}
          <View style={styles.footer}>
            <Pressable
              onPress={save}
              disabled={saving}
              style={[styles.save, saving && styles.saveDisabled]}
              accessibilityRole="button"
            >
              {saving ? (
                <ActivityIndicator color={colors.inkInv} />
              ) : (
                <>
                  <Icon name="check" size={18} color={colors.inkInv} />
                  <Text style={styles.saveText}>{saved ? 'Saved' : 'Save availability'}</Text>
                </>
              )}
            </Pressable>
          </View>
        </>
      )}
    </Screen>
  );
}

export default CaregiverAvailability;

function BulkChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.bulkChip} accessibilityRole="button">
      <Text style={styles.bulkChipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  state: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1, marginHorizontal: -24 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 28, paddingTop: 8 },
  flexMin: { flex: 1, minWidth: 0 },

  pauseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 14,
    ...shadow.e1,
  },
  pauseIcon: { width: 36, height: 36, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  rowSub: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, color: colors.ink2, marginTop: 2 },

  headline: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink, marginTop: 22 },
  sub: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink2, marginTop: 4 },

  grid: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 14, marginTop: 14, ...shadow.e1 },
  gridHeaderRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8, gap: 6 },
  dayCol: { width: 44 },
  headCell: { flex: 1, alignItems: 'center' },
  headLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.3, color: colors.ink },
  headTime: { fontFamily: fonts.regular, fontSize: 9.5, color: colors.ink3, marginTop: 2, fontVariant: ['tabular-nums'] },
  gridRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 6 },
  dayLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  cell: { flex: 1, height: 42, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  cellOn: { backgroundColor: colors.brand },
  cellOff: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.hairline },

  bulkRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  bulkChip: { paddingHorizontal: 14, height: 36, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  bulkChipText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink },

  noteLabel: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginTop: 24, marginBottom: 8 },
  note: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: 14,
    minHeight: 84,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  noteMetaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  noteMeta: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3, fontVariant: ['tabular-nums'] },

  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, textAlign: 'center', marginTop: 14 },

  footer: { paddingTop: 12, paddingBottom: 8, borderTopWidth: 1, borderTopColor: colors.hairline },
  save: {
    height: 52,
    borderRadius: radii.lg,
    backgroundColor: colors.brand,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...shadow.e1,
  },
  saveDisabled: { opacity: 0.6 },
  saveText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
});
