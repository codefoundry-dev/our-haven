/**
 * Search / discovery results (OH-201) — native + narrow web.
 *
 * The unified search surface: a read-only SearchBar + filter button (opening the
 * shared FilterPanel in a modal), a category quick-toggle chip strip, a results
 * header, and the ranked results rendered through the blur-to-unblur preview
 * wall — full SupplyCards interleaved with locked teaser cards for a
 * not-yet-subscribed Parent, with a paywall banner. Seeds the first browse from
 * the ephemeral preview answers (OH-198).
 *
 * The desktop layout lives in `@/screens/web/parent/Search` and is chosen by
 * `search.web.tsx` at wide viewports; this body renders on native + narrow web.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { BlurredResultCard, FullResultCard } from '@/components/search/ResultCard';
import { FilterPanel } from '@/components/search/FilterPanel';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { FilterChip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { SearchBar } from '@/components/ui/SearchBar';
import { usePreview } from '@/preview/PreviewProvider';
import { shapeBrowse } from '@/preview/questionnaire';
import {
  activeFilterCount,
  buildSearchQuery,
  CATEGORY_CHOICES,
  EMPTY_FILTERS,
  filtersFromPreview,
  type SearchFilters,
} from '@/lib/search';
import { useSearch } from '@/lib/useSearch';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

function summaryLabel(filters: SearchFilters): string {
  if (filters.categories.length === 0) return 'Caregivers & Providers · near you';
  const labels = filters.categories.map((c) => CATEGORY_CHOICES.find((o) => o.value === c)?.label ?? c);
  return `${labels.join(' · ')} · near you`;
}

export default function SearchScreen() {
  const router = useRouter();
  const { answers } = usePreview();

  // Seed the first browse from the ephemeral preview answers, if any.
  const shape = shapeBrowse(answers);
  const leadCategory = shape.shaped ? shape.categories[0] : null;
  const initial = useMemo(
    () => filtersFromPreview({ leadCategory, age: answers?.age ?? null }),
    [leadCategory, answers?.age],
  );

  const [filters, setFilters] = useState<SearchFilters>(initial);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const query = useMemo(() => buildSearchQuery(filters), [filters]);
  const { data, loading, error, refetch } = useSearch(query);

  const toggleCategory = (value: SearchFilters['categories'][number]) =>
    setFilters((f) => ({
      ...f,
      categories: f.categories.includes(value) ? f.categories.filter((c) => c !== value) : [...f.categories, value],
    }));

  const activeCount = activeFilterCount(filters);
  const entitled = data?.entitled ?? false;
  const blurredCount = data?.blurredCount ?? 0;

  const openProfile = (id: string, role: string) =>
    router.push({ pathname: '/provider-detail', params: { id, role } });

  return (
    <Screen scroll edges={['top']} contentStyle={styles.content}>
      {/* App bar */}
      <View style={styles.appBar}>
        <IconButton name="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
        <SearchBar value={summaryLabel(filters)} onPress={() => setFiltersOpen(true)} style={styles.search} />
        <IconButton
          name="sliders"
          onPress={() => setFiltersOpen(true)}
          accessibilityLabel={activeCount > 0 ? `Filters (${activeCount} active)` : 'Filters'}
          badge={activeCount > 0}
          style={styles.filterBtn}
        />
      </View>

      {/* Category quick toggles */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chips}
        contentContainerStyle={styles.chipsContent}
      >
        {CATEGORY_CHOICES.map((c) => (
          <FilterChip
            key={c.value}
            label={c.label}
            active={filters.categories.includes(c.value)}
            onPress={() => toggleCategory(c.value)}
          />
        ))}
      </ScrollView>

      {/* Paywall banner — only when there is locked supply behind the wall */}
      {!entitled && blurredCount > 0 ? (
        <Pressable onPress={() => router.push('/paywall')} style={styles.paywall}>
          <View style={styles.paywallIcon}>
            <Icon name="sparkle" size={16} color={colors.inkInv} />
          </View>
          <View style={styles.flexMin}>
            <Text style={styles.paywallTitle}>Unlock the full marketplace</Text>
            <Text style={styles.paywallSub} numberOfLines={1}>
              {blurredCount} more {blurredCount === 1 ? 'match is' : 'matches are'} hidden — subscribe to view everyone.
            </Text>
          </View>
          <Icon name="chevron-right" size={16} color={colors.ink} />
        </Pressable>
      ) : null}

      {/* Results header */}
      <View style={styles.resultsHeader}>
        <Text style={styles.resultsCount}>
          {loading ? 'Searching…' : `${data?.total ?? 0} ${(data?.total ?? 0) === 1 ? 'result' : 'results'}`}
        </Text>
        <View style={styles.sort}>
          <Text style={styles.sortText}>Best match</Text>
          <Icon name="chevron-down" size={14} color={colors.ink} />
        </View>
      </View>

      {/* States */}
      {loading ? <ActivityIndicator color={colors.brand} style={styles.loader} /> : null}
      {error ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{error}</Text>
          <Pressable onPress={refetch} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {!loading && !error && (data?.results.length ?? 0) === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No matches yet</Text>
          <Text style={styles.emptySub}>Try widening your radius or clearing a filter.</Text>
        </View>
      ) : null}

      {/* Results */}
      <View style={styles.list}>
        {data?.results.map((item) =>
          item.kind === 'full' ? (
            <FullResultCard
              key={item.card.id}
              card={item.card}
              layout="row"
              onOpen={() => openProfile(item.card.id, item.card.role)}
            />
          ) : (
            <BlurredResultCard key={item.card.id} card={item.card} layout="row" onUnlock={() => router.push('/paywall')} />
          ),
        )}
      </View>

      {/* Filter sheet */}
      <Modal visible={filtersOpen} animationType="slide" transparent onRequestClose={() => setFiltersOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetGrab} />
            <FilterPanel filters={filters} onChange={setFilters} onReset={() => setFilters(EMPTY_FILTERS)} />
            <Pressable onPress={() => setFiltersOpen(false)} style={styles.apply}>
              <Text style={styles.applyText}>
                {loading ? 'Show results' : `Show ${data?.total ?? 0} ${(data?.total ?? 0) === 1 ? 'result' : 'results'}`}
              </Text>
              <Icon name="arrow-right" size={16} color={colors.inkInv} />
            </Pressable>
          </View>
        </View>
      </Modal>
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

  paywall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 24,
    marginTop: 16,
    padding: 14,
    borderRadius: radii.lg,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  paywallIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paywallTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  paywallSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },
  flexMin: { flex: 1, minWidth: 0 },

  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 8,
  },
  resultsCount: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sortText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  loader: { marginTop: 24 },
  empty: { paddingHorizontal: 24, paddingTop: 32, alignItems: 'center', gap: 6 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, textAlign: 'center' },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, textAlign: 'center' },
  retry: { marginTop: 8, height: 40, paddingHorizontal: 20, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },

  list: { paddingHorizontal: 24, gap: 12, marginTop: 4 },

  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(22,21,19,0.4)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.canvas,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 28,
    ...shadow.e3,
  },
  sheetGrab: { alignSelf: 'center', width: 40, height: 4, borderRadius: radii.pill, backgroundColor: colors.monoGray, marginBottom: 8 },
  apply: {
    height: 50,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },
  applyText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkInv },
});
