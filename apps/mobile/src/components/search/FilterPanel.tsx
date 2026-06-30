/**
 * FilterPanel (OH-201) — the unified Search filter UI, shared by the native
 * filter sheet (in a Modal) and the web filters rail. Operates on the
 * `SearchFilters` state from `@/lib/search`; the caller owns the state and
 * persists it. Provider-specific sub-filters (specialty = "license type") only
 * show when a Provider is in scope. RN primitives only.
 */
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { FilterChip } from '@/components/ui/Chip';
import { Toggle } from '@/components/ui/Toggle';
import {
  AGE_BAND_OPTIONS,
  BEHAVIOUR_OPTIONS,
  CATEGORY_CHOICES,
  MIN_RATING_OPTIONS,
  providerInScope,
  RADIUS_OPTIONS,
  RATE_CEILING_OPTIONS,
  SPECIALTY_OPTIONS,
  TIME_OF_DAY_OPTIONS,
  type SearchFilters,
} from '@/lib/search';
import { colors, fonts, radii } from '@/theme/tokens';

function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

export function FilterPanel({
  filters,
  onChange,
  onReset,
  scroll = true,
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
  onReset: () => void;
  scroll?: boolean;
}) {
  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch });
  const showProvider = providerInScope(filters);

  const body = (
    <>
      <View style={styles.head}>
        <Text style={styles.title}>Filters</Text>
        <Text onPress={onReset} style={styles.reset} accessibilityRole="button">
          Reset
        </Text>
      </View>

      <Field label="Category">
        <View style={styles.chipWrap}>
          {CATEGORY_CHOICES.map((c) => (
            <FilterChip
              key={c.value}
              label={c.label}
              active={filters.categories.includes(c.value)}
              onPress={() => set({ categories: toggle(filters.categories, c.value) })}
            />
          ))}
        </View>
      </Field>

      {showProvider ? (
        <Field label="Provider specialty">
          <View style={styles.chipWrap}>
            {SPECIALTY_OPTIONS.map((s) => (
              <FilterChip
                key={s.value}
                label={s.label}
                active={filters.specialties.includes(s.value)}
                onPress={() => set({ specialties: toggle(filters.specialties, s.value) })}
              />
            ))}
          </View>
        </Field>
      ) : null}

      <Field label="ZIP & radius">
        <TextInput
          value={filters.zip}
          onChangeText={(t) => set({ zip: t.replace(/[^0-9]/g, '').slice(0, 5) })}
          placeholder="ZIP code"
          placeholderTextColor={colors.ink3}
          keyboardType="number-pad"
          maxLength={5}
          style={styles.input}
          accessibilityLabel="ZIP code"
        />
        <View style={[styles.chipWrap, styles.gapTop]}>
          {RADIUS_OPTIONS.map((r) => (
            <FilterChip
              key={r}
              label={`${r} mi`}
              active={filters.radiusMiles === r}
              onPress={() => set({ radiusMiles: r })}
            />
          ))}
        </View>
      </Field>

      <Field label="Time of day">
        <View style={styles.todRow}>
          {TIME_OF_DAY_OPTIONS.map((t) => {
            const on = filters.timeOfDay === t.value;
            return (
              <Pressable
                key={t.value}
                onPress={() => set({ timeOfDay: on ? null : t.value })}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.todTile, on ? styles.todOn : styles.todOff]}
              >
                <Text style={styles.todName}>{t.label}</Text>
                <Text style={styles.todSpan}>{t.span}</Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      <Field label="Rate ceiling">
        <View style={styles.chipWrap}>
          {RATE_CEILING_OPTIONS.map((cents) => (
            <FilterChip
              key={cents}
              label={`Up to $${cents / 100}`}
              active={filters.maxRateCents === cents}
              onPress={() => set({ maxRateCents: filters.maxRateCents === cents ? null : cents })}
            />
          ))}
        </View>
      </Field>

      <Field label="Minimum rating">
        <View style={styles.chipWrap}>
          {MIN_RATING_OPTIONS.map((n) => (
            <FilterChip
              key={n}
              label={`${n}★ & up`}
              active={filters.minRating === n}
              onPress={() => set({ minRating: filters.minRating === n ? 0 : n })}
            />
          ))}
        </View>
      </Field>

      <Field label="Ages served">
        <View style={styles.chipWrap}>
          {AGE_BAND_OPTIONS.map((a) => (
            <FilterChip
              key={a.value}
              label={a.label}
              active={filters.agesServed.includes(a.value)}
              onPress={() => set({ agesServed: toggle(filters.agesServed, a.value) })}
            />
          ))}
        </View>
      </Field>

      <Field label="Behaviour comfort (Caregivers)">
        <View style={styles.chipWrap}>
          {BEHAVIOUR_OPTIONS.map((b) => (
            <FilterChip
              key={b.value}
              label={b.label}
              active={filters.behaviourComfort.includes(b.value)}
              onPress={() => set({ behaviourComfort: toggle(filters.behaviourComfort, b.value) })}
            />
          ))}
        </View>
      </Field>

      <View style={styles.taxRow}>
        <View style={styles.flexMin}>
          <Text style={styles.taxTitle}>Tax-credit friendly</Text>
          <Text style={styles.taxSub}>Will issue IRS Form W-10 (Babysitter / Nanny)</Text>
        </View>
        <Toggle on={filters.taxCreditFriendly} onPress={() => set({ taxCreditFriendly: !filters.taxCreditFriendly })} />
      </View>
    </>
  );

  if (!scroll) return <View>{body}</View>;
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: 24 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  reset: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brand },

  field: { marginTop: 18 },
  fieldLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink2,
    marginBottom: 10,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gapTop: { marginTop: 10 },

  input: {
    height: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.ink,
  },

  todRow: { flexDirection: 'row', gap: 8 },
  todTile: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  todOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  todOff: { backgroundColor: colors.surfaceAlt, borderColor: 'transparent' },
  todName: { fontFamily: fonts.bold, fontSize: 12.5, color: colors.ink },
  todSpan: { fontFamily: fonts.regular, fontSize: 10, color: colors.ink3 },

  taxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 22,
    padding: 14,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
  },
  flexMin: { flex: 1, minWidth: 0 },
  taxTitle: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },
  taxSub: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink2, marginTop: 2 },
});
