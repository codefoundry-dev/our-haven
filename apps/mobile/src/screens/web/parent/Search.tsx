/**
 * ParentSearchWeb (OH-201) — the unified Search results on desktop web.
 * Content-only: the route dispatcher wraps this in
 * <ParentWebShell active="search">.
 *
 * An always-on left filters rail (the shared FilterPanel) beside a results
 * header (count) and a multi-column grid of result cards rendered through the
 * blur-to-unblur preview wall (full SupplyCards + locked teaser cards), plus a
 * paywall banner when supply is hidden behind the wall. Same data + filter state
 * as the native screen (`@/lib/search` + `useSearch`); RN primitives only.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { WebPageHeader } from '@/components/web/ParentWebShell';
import { BlurredResultCard, FullResultCard } from '@/components/search/ResultCard';
import { FilterPanel } from '@/components/search/FilterPanel';
import { Icon } from '@/components/Icon';
import { usePreview } from '@/preview/PreviewProvider';
import { shapeBrowse } from '@/preview/questionnaire';
import {
  buildSearchQuery,
  EMPTY_FILTERS,
  filtersFromPreview,
  summaryFromCategories,
  type SearchFilters,
} from '@/lib/search';
import { useSearch } from '@/lib/useSearch';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export function ParentSearchWeb() {
  const router = useRouter();
  const { answers } = usePreview();

  const shape = shapeBrowse(answers);
  const leadCategory = shape.shaped ? shape.categories[0] : null;
  const initial = useMemo(
    () => filtersFromPreview({ leadCategory, age: answers?.age ?? null }),
    [leadCategory, answers?.age],
  );

  const [filters, setFilters] = useState<SearchFilters>(initial);
  const query = useMemo(() => buildSearchQuery(filters), [filters]);
  const { data, loading, error, refetch } = useSearch(query);

  const entitled = data?.entitled ?? false;
  const blurredCount = data?.blurredCount ?? 0;
  const total = data?.total ?? 0;

  const openProfile = (id: string, role: string) =>
    router.push({
      pathname: '/provider-detail',
      params: { id, role, ...(filters.zip.trim() ? { zip: filters.zip.trim() } : {}) },
    });

  return (
    <View>
      <WebPageHeader greet="Discover" title={summaryFromCategories(filters.categories)} actions={['bell', 'message']} />

      <View style={styles.body}>
        <View style={styles.layout}>
          {/* left · persistent filters rail */}
          <View style={styles.filtersCol}>
            <View style={styles.filters}>
              <FilterPanel filters={filters} onChange={setFilters} onReset={() => setFilters(EMPTY_FILTERS)} scroll={false} />
            </View>
          </View>

          {/* right · results */}
          <View style={styles.resultsCol}>
            <View style={styles.resultsHead}>
              <Text style={styles.resultsTitle}>
                {loading ? 'Searching…' : `${total} ${total === 1 ? 'result' : 'results'}`}
              </Text>
              <View style={styles.sortPill}>
                <Text style={styles.sortText}>Best match</Text>
                <Icon name="chevron-down" size={14} color={colors.ink} />
              </View>
            </View>

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
                <Icon name="arrow-right" size={16} color={colors.ink} />
              </Pressable>
            ) : null}

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

            <View style={styles.grid}>
              {data?.results.map((item) =>
                item.kind === 'full' ? (
                  <FullResultCard
                    key={item.card.id}
                    card={item.card}
                    layout="tile"
                    onOpen={() => openProfile(item.card.id, item.card.role)}
                  />
                ) : (
                  <BlurredResultCard
                    key={item.card.id}
                    card={item.card}
                    layout="tile"
                    onUnlock={() => router.push('/paywall')}
                  />
                ),
              )}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flexMin: { flex: 1, minWidth: 0 },

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start', marginTop: 18 },
  filtersCol: { flexGrow: 1, flexBasis: 288, minWidth: 264, maxWidth: 332 },
  resultsCol: { flexGrow: 2, flexBasis: 560, minWidth: 360 },

  filters: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 22, ...shadow.e1 },

  resultsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  resultsTitle: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink },
  sortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  sortText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  paywall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    padding: 16,
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

  loader: { marginTop: 24 },
  empty: { paddingTop: 24, alignItems: 'center', gap: 6 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, textAlign: 'center' },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, textAlign: 'center' },
  retry: { marginTop: 8, height: 40, paddingHorizontal: 20, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
});
