/**
 * Search / discovery results (design: screens/search.jsx) — native + narrow web.
 *
 * Back + read-only SearchBar + filter button, a horizontal active-filter chip
 * strip, a results header, and a vertical list of Provider cards. Cards tap into
 * the Provider detail. UI scaffold — inline sample data.
 *
 * The desktop layout lives in `@/screens/web/parent/Search` and is chosen by
 * `search.web.tsx` at wide viewports; this body renders on native + narrow web.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Badge, type BadgeKind } from '@/components/ui/Badge';
import { CategoryChip, CATEGORY_TONE, type Category } from '@/components/ui/CategoryChip';
import { FilterChip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { Portrait } from '@/components/ui/PhotoPlaceholder';
import { RatingValue } from '@/components/ui/StarRating';
import { SearchBar } from '@/components/ui/SearchBar';
import { usePreview } from '@/preview/PreviewProvider';
import { shapeBrowse } from '@/preview/questionnaire';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

interface FilterDef {
  label: string;
  active?: boolean;
  removable?: boolean;
}

const DEFAULT_FILTERS: FilterDef[] = [
  { label: 'Tutor', active: true },
  { label: 'Babysitter' },
  { label: 'Top-rated', active: true, removable: true },
  { label: 'Within 10 mi', active: true, removable: true },
  { label: 'Tax-credit' },
  { label: 'Available now' },
];

/**
 * Fold the ephemeral preview answers into the chip strip so the first browse
 * opens on the shaped category (story 111). The leading category becomes the
 * first, pre-activated chip; everything else keeps its default state.
 */
function filtersFor(chips: string[], leadCategory: string | null): FilterDef[] {
  if (!leadCategory) return DEFAULT_FILTERS;
  const rest = DEFAULT_FILTERS.filter((f) => f.label !== leadCategory);
  const merged: FilterDef[] = [{ label: leadCategory, active: true }, ...rest];
  return merged.map((f) => (chips.includes(f.label) ? { ...f, active: true } : f));
}

interface Provider {
  name: string;
  role: Category;
  rate: number;
  rating: number;
  distance: string;
  badges: BadgeKind[];
}

const PROVIDERS: Provider[] = [
  { name: 'Maya Okafor', role: 'Tutor', rate: 35, rating: 4.9, distance: '1.4 mi', badges: ['verified', 'toprated'] },
  { name: 'Diego Mejia', role: 'Tutor', rate: 42, rating: 4.7, distance: '2.1 mi', badges: ['verified', 'tax'] },
  { name: 'Priya Iyer', role: 'Tutor', rate: 38, rating: 4.8, distance: '0.9 mi', badges: ['verified'] },
  { name: 'Sofia Castillo', role: 'Babysitter', rate: 22, rating: 4.6, distance: '3.0 mi', badges: ['verified', 'tax'] },
];

export default function SearchScreen() {
  const router = useRouter();
  const { answers } = usePreview();

  // Seed the first browse from the ephemeral preview answers, if any.
  const shape = shapeBrowse(answers);
  const leadCategory = shape.shaped ? shape.categories[0] : null;
  const filters = useMemo(() => filtersFor(shape.chips, leadCategory), [shape.chips, leadCategory]);

  const [active, setActive] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(filters.map((f) => [f.label, !!f.active])),
  );

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      {/* App bar */}
      <View style={styles.appBar}>
        <IconButton name="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
        <SearchBar
          value={leadCategory ? `${leadCategory} · near you` : 'Tutor · K–8 math'}
          onPress={() => {}}
          style={styles.search}
        />
        <IconButton name="sliders" accessibilityLabel="Filters" style={styles.filterBtn} />
      </View>

      {/* Filter chip strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chips}
        contentContainerStyle={styles.chipsContent}
      >
        {filters.map((f) => (
          <FilterChip
            key={f.label}
            label={f.label}
            active={active[f.label]}
            removable={f.removable && active[f.label]}
            onPress={() => setActive((a) => ({ ...a, [f.label]: !a[f.label] }))}
            onRemove={() => setActive((a) => ({ ...a, [f.label]: false }))}
          />
        ))}
      </ScrollView>

      {/* Results header */}
      <View style={styles.resultsHeader}>
        <Text style={styles.resultsCount}>24 providers</Text>
        <View style={styles.sort}>
          <Text style={styles.sortText}>Best match</Text>
          <Icon name="chevron-down" size={14} color={colors.ink} />
        </View>
      </View>

      {/* Provider cards */}
      {PROVIDERS.map((p) => (
        <Pressable
          key={p.name}
          onPress={() => router.push('/provider-detail')}
          accessibilityRole="button"
          accessibilityLabel={`${p.name}, ${p.role}`}
          style={({ pressed }) => [styles.card, { opacity: pressed ? 0.94 : 1 }]}
        >
          <View style={styles.cardRow}>
            <View style={styles.portraitWrap}>
              <Portrait height={110} tint={colors[CATEGORY_TONE[p.role]]} label="" radius={radii.lg} />
              <CategoryChip category={p.role} style={styles.portraitChip} />
            </View>
            <View style={styles.cardInfo}>
              <View style={styles.cardTop}>
                <View style={styles.cardName}>
                  <Text style={styles.name} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <View style={styles.metaRow}>
                    <RatingValue value={p.rating} size={13} />
                    <Text style={styles.distance}>· {p.distance}</Text>
                  </View>
                </View>
                <Icon name="bookmark" size={18} color={colors.ink2} />
              </View>

              <View style={styles.badges}>
                {p.badges.map((b) => (
                  <Badge key={b} kind={b} />
                ))}
              </View>

              <View style={styles.cardBottom}>
                <Text style={styles.rate}>
                  ${p.rate}
                  <Text style={styles.rateUnit}>/hr</Text>
                </Text>
                <View style={styles.viewPill}>
                  <Text style={styles.viewText}>View</Text>
                  <Icon name="chevron-right" size={14} color={colors.ink} />
                </View>
              </View>
            </View>
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120, paddingHorizontal: 0 },
  appBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, paddingHorizontal: 16 },
  search: { flex: 1, height: 44 },
  filterBtn: { backgroundColor: colors.surfaceAlt },

  chips: { marginTop: 14 },
  chipsContent: { paddingHorizontal: 24, gap: 8 },

  resultsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8 },
  resultsCount: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sortText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  card: { marginHorizontal: 24, marginTop: 12, backgroundColor: colors.surface, borderRadius: 24, padding: 12, ...shadow.e1 },
  cardRow: { flexDirection: 'row', gap: 12 },
  portraitWrap: { width: 96, height: 110, borderRadius: radii.lg, overflow: 'hidden' },
  portraitChip: { position: 'absolute', top: 6, left: 6, height: 22, paddingHorizontal: 8 },
  cardInfo: { flex: 1, minWidth: 0 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardName: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  distance: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  cardBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 8 },
  rate: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, fontVariant: ['tabular-nums'] },
  rateUnit: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2 },
  viewPill: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  viewText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },
});
