/**
 * ParentSearchWeb — the Parent marketplace search / discovery results on desktop
 * web. Content-only: the route dispatcher wraps this in
 * <ParentWebShell active="search">.
 *
 * Ported from the Claude Design web project (parent-web/pw-discovery.jsx
 * PWDiscover): the mobile filter sheet becomes an always-on left filters rail,
 * beside a results header (count + sort), an active quick-filter chip strip, and
 * a multi-column grid of Provider cards. Reuses the same primitives + the
 * vertical ProviderCard shape from Discovery.tsx; cards route to /provider-detail.
 * The native screen's filter/search state is preserved here. RN primitives only.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { WebPageHeader } from '@/components/web/ParentWebShell';
import { Icon } from '@/components/Icon';
import { Badge, type BadgeKind } from '@/components/ui/Badge';
import { CategoryChip, CATEGORY_TONE, type Category } from '@/components/ui/CategoryChip';
import { FilterChip } from '@/components/ui/Chip';
import { Portrait } from '@/components/ui/PhotoPlaceholder';
import { RatingValue } from '@/components/ui/StarRating';
import { SearchBar } from '@/components/ui/SearchBar';
import { Toggle } from '@/components/ui/Toggle';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

// Quick filters — the removable active-chip strip from the native screen.
const QUICK_FILTERS = ['Top-rated', 'Within 10 mi', 'Tax-credit', 'Available now'] as const;
const QUICK_INITIAL: Record<string, boolean> = { 'Top-rated': true, 'Within 10 mi': true };

type ColorTone = 'catBaby' | 'catTutor' | 'catNanny' | 'catSpec';
const FILTER_CATS: { name: Category; tone: ColorTone }[] = [
  { name: 'Babysitter', tone: 'catBaby' },
  { name: 'Tutor', tone: 'catTutor' },
  { name: 'Nanny', tone: 'catNanny' },
  { name: 'Provider', tone: 'catSpec' },
];

const TIMES_OF_DAY: { name: string; span: string }[] = [
  { name: 'Morning', span: '6–12' },
  { name: 'Afternoon', span: '12–6' },
  { name: 'Evening', span: '6–10' },
];

interface ProviderCardData {
  name: string;
  role: Category;
  blurb: string;
  rate: number;
  rating: number;
  reviews: number;
  distance: string;
  badges: BadgeKind[];
}

// Native PROVIDERS, enriched with a blurb + review count for the richer web card.
const RESULTS: ProviderCardData[] = [
  { name: 'Maya Okafor', role: 'Tutor', blurb: 'K–8 math · builds number sense first', rate: 35, rating: 4.9, reviews: 87, distance: '1.4 mi', badges: ['verified', 'toprated'] },
  { name: 'Diego Mejia', role: 'Tutor', blurb: 'Pre-algebra & test prep', rate: 42, rating: 4.7, reviews: 29, distance: '2.1 mi', badges: ['verified', 'tax'] },
  { name: 'Priya Iyer', role: 'Tutor', blurb: 'Reading fluency & ESL bilingual', rate: 38, rating: 4.8, reviews: 64, distance: '0.9 mi', badges: ['verified'] },
  { name: 'Daniel Reyes', role: 'Tutor', blurb: 'Algebra I–II · patient & structured', rate: 40, rating: 4.9, reviews: 51, distance: '1.8 mi', badges: ['verified', 'toprated'] },
  { name: 'Sofia Castillo', role: 'Babysitter', blurb: 'Evenings & weekends · CPR certified', rate: 22, rating: 4.6, reviews: 41, distance: '3.0 mi', badges: ['verified', 'tax'] },
  { name: 'Amelia Fox', role: 'Tutor', blurb: 'Elementary reading & writing', rate: 36, rating: 4.6, reviews: 33, distance: '2.4 mi', badges: ['verified'] },
];

export function ParentSearchWeb() {
  const router = useRouter();
  const go = (route: string) => router.push(route as never);

  // Preserved native state + the persistent filters-rail state.
  const [quick, setQuick] = useState<Record<string, boolean>>(QUICK_INITIAL);
  const [cats, setCats] = useState<Record<string, boolean>>({ Tutor: true });
  const [minRating, setMinRating] = useState(4);
  const [taxCredit, setTaxCredit] = useState(true);
  const [timeOfDay, setTimeOfDay] = useState('Afternoon');

  const resultCount = RESULTS.length === 6 ? 24 : RESULTS.length; // scaffold count

  const activeCats = useMemo(() => Object.keys(cats).filter((k) => cats[k]), [cats]);

  return (
    <View>
      <WebPageHeader greet="Discover" title="Tutor · K–8 math" actions={['bell', 'message']} />

      <View style={styles.body}>
        {/* ── sticky-ish filter bar: search + quick filters + count ──── */}
        <View style={styles.bar}>
          <View style={styles.barTop}>
            <SearchBar
              value="Tutor · K–8 math"
              placeholder="Search Caregivers, skills, or specialties"
              onPress={() => go('/search')}
              onFilter={() => {}}
              style={styles.barSearch}
            />
            <Pressable onPress={() => {}} style={styles.sortPill}>
              <Text style={styles.sortText}>Best match</Text>
              <Icon name="chevron-down" size={14} color={colors.ink} />
            </Pressable>
          </View>
          <View style={styles.barBottom}>
            <View style={styles.quickRow}>
              {QUICK_FILTERS.map((f) => (
                <FilterChip
                  key={f}
                  label={f}
                  active={quick[f]}
                  removable={quick[f]}
                  onPress={() => setQuick((q) => ({ ...q, [f]: !q[f] }))}
                  onRemove={() => setQuick((q) => ({ ...q, [f]: false }))}
                />
              ))}
            </View>
            <Text style={styles.barCount}>{resultCount} providers</Text>
          </View>
        </View>

        {/* ── two columns: filters rail · results grid ──────────────── */}
        <View style={styles.layout}>
          {/* left · persistent filters */}
          <View style={styles.filtersCol}>
            <View style={styles.filters}>
              <View style={styles.filtersHead}>
                <Text style={styles.filtersTitle}>Filters</Text>
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    setQuick(QUICK_INITIAL);
                    setCats({ Tutor: true });
                    setMinRating(4);
                    setTaxCredit(true);
                    setTimeOfDay('Afternoon');
                  }}
                >
                  <Text style={styles.filtersReset}>Reset</Text>
                </Pressable>
              </View>

              {/* category */}
              <Text style={styles.fieldLabel}>Category</Text>
              <View style={styles.catRow}>
                {FILTER_CATS.map((c) => {
                  const on = !!cats[c.name];
                  return (
                    <Pressable
                      key={c.name}
                      onPress={() => setCats((m) => ({ ...m, [c.name]: !m[c.name] }))}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={[
                        styles.catChip,
                        on
                          ? { backgroundColor: colors[c.tone] }
                          : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
                      ]}
                    >
                      {on ? <Icon name="check" size={13} color={colors.ink} /> : null}
                      <Text style={styles.catChipText}>{c.name}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* ZIP & radius */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>ZIP &amp; radius</Text>
                <Text style={styles.fieldValue}>90210 · 10 mi</Text>
              </View>
              <FauxSlider pct={30} />
              <View style={styles.scaleRow}>
                {['5', '10', '25', '50 mi'].map((s) => (
                  <Text key={s} style={styles.scaleText}>
                    {s}
                  </Text>
                ))}
              </View>

              {/* time of day */}
              <Text style={[styles.fieldLabel, styles.fieldGap]}>Time of day</Text>
              <View style={styles.todRow}>
                {TIMES_OF_DAY.map((t) => {
                  const on = t.name === timeOfDay;
                  return (
                    <Pressable
                      key={t.name}
                      onPress={() => setTimeOfDay(t.name)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={[styles.todTile, on ? styles.todTileOn : styles.todTileOff]}
                    >
                      <Text style={styles.todName}>{t.name}</Text>
                      <Text style={styles.todSpan}>{t.span}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* rate ceiling */}
              <View style={[styles.fieldRow, styles.fieldGap]}>
                <Text style={styles.fieldLabel}>Rate ceiling</Text>
                <Text style={styles.fieldValue}>Up to $45/hr</Text>
              </View>
              <FauxSlider pct={58} />

              {/* min rating */}
              <Text style={[styles.fieldLabel, styles.fieldGap]}>Minimum rating</Text>
              <View style={styles.ratingRow}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const on = n === minRating;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => setMinRating(n)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={[styles.ratingPill, on ? styles.ratingPillOn : styles.ratingPillOff]}
                    >
                      <Text style={[styles.ratingNum, on && { color: colors.inkInv }]}>{n}</Text>
                      <Icon name="star" size={12} color={on ? colors.highlight : colors.ink3} />
                    </Pressable>
                  );
                })}
              </View>

              {/* tax-credit toggle */}
              <View style={styles.taxRow}>
                <View style={styles.flexMin}>
                  <Text style={styles.taxTitle}>Tax-credit friendly</Text>
                  <Text style={styles.taxSub}>Qualifying paperwork on file</Text>
                </View>
                <Toggle on={taxCredit} onPress={() => setTaxCredit((v) => !v)} />
              </View>

              <Pressable onPress={() => {}} style={styles.showBtn}>
                <Text style={styles.showText}>Show {resultCount} results</Text>
                <Icon name="arrow-right" size={16} color={colors.inkInv} />
              </Pressable>
            </View>
          </View>

          {/* right · results grid */}
          <View style={styles.resultsCol}>
            <View style={styles.resultsHead}>
              <Text style={styles.resultsTitle}>{resultCount} providers</Text>
              {activeCats.length > 0 ? (
                <Text style={styles.resultsMeta}>{activeCats.join(' · ')}</Text>
              ) : null}
            </View>
            <View style={styles.grid}>
              {RESULTS.map((p) => (
                <ProviderCard key={p.name} data={p} onPress={() => go('/provider-detail')} />
              ))}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function FauxSlider({ pct }: { pct: number }) {
  return (
    <View style={styles.slider}>
      <View style={[styles.sliderFill, { width: `${pct}%` }]} />
      <View style={[styles.sliderKnob, { left: `${pct}%` }]} />
    </View>
  );
}

function ProviderCard({ data, onPress }: { data: ProviderCardData; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { opacity: pressed ? 0.95 : 1 }]}>
      <View style={styles.cardPortrait}>
        <Portrait height={150} tint={colors[CATEGORY_TONE[data.role]]} label="" radius={radii.lg} />
        <CategoryChip category={data.role} style={styles.cardChip} />
        <View style={styles.cardSave}>
          <Icon name="bookmark" size={16} color={colors.ink} />
        </View>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardNameRow}>
          <Text style={styles.cardName} numberOfLines={1}>
            {data.name}
          </Text>
          <RatingValue value={data.rating} count={data.reviews} size={13} />
        </View>
        <Text style={styles.cardBlurb} numberOfLines={1}>
          {data.blurb} · {data.distance}
        </Text>
        <View style={styles.cardBadges}>
          {data.badges.map((b) => (
            <Badge key={b} kind={b} />
          ))}
        </View>
        <View style={styles.cardFoot}>
          <Text style={styles.cardRate}>
            ${data.rate}
            <Text style={styles.cardRateUnit}>/hr</Text>
          </Text>
          <View style={styles.cardView}>
            <Text style={styles.cardViewText}>View</Text>
            <Icon name="chevron-right" size={14} color={colors.ink} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flexMin: { flex: 1, minWidth: 0 },

  // filter bar
  bar: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 18, ...shadow.e1 },
  barTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  barSearch: { flex: 1, minWidth: 0, backgroundColor: colors.surfaceAlt },
  sortPill: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  sortText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  barBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1, minWidth: 0 },
  barCount: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2, flexShrink: 0 },

  // layout
  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start', marginTop: 18 },
  filtersCol: { flexGrow: 1, flexBasis: 288, minWidth: 264, maxWidth: 332 },
  resultsCol: { flexGrow: 2, flexBasis: 560, minWidth: 360 },

  // filters panel
  filters: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 22, ...shadow.e1 },
  filtersHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  filtersTitle: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  filtersReset: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brand },

  fieldLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink2,
    marginTop: 18,
    marginBottom: 10,
  },
  fieldGap: { marginTop: 22 },
  fieldRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  fieldValue: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink, fontVariant: ['tabular-nums'] },

  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
  },
  catChipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  // sliders (display only)
  slider: { height: 4, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, marginTop: 14 },
  sliderFill: { position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: radii.pill, backgroundColor: colors.brand },
  sliderKnob: {
    position: 'absolute',
    top: -8,
    marginLeft: -10,
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.brand,
    ...shadow.e2,
  },
  scaleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  scaleText: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3 },

  // time of day
  todRow: { flexDirection: 'row', gap: 8 },
  todTile: {
    flex: 1,
    height: 60,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1.5,
  },
  todTileOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  todTileOff: { backgroundColor: colors.surfaceAlt, borderColor: 'transparent' },
  todName: { fontFamily: fonts.bold, fontSize: 12.5, color: colors.ink },
  todSpan: { fontFamily: fonts.regular, fontSize: 10, color: colors.ink3 },

  // min rating
  ratingRow: { flexDirection: 'row', gap: 6 },
  ratingPill: {
    flex: 1,
    height: 38,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderWidth: 1,
  },
  ratingPillOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  ratingPillOff: { backgroundColor: colors.surface, borderColor: colors.hairline },
  ratingNum: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  // tax-credit
  taxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 22,
    padding: 14,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
  },
  taxTitle: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },
  taxSub: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink2, marginTop: 2 },

  showBtn: {
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
  },
  showText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkInv },

  // results
  resultsHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 },
  resultsTitle: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink },
  resultsMeta: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  card: { flexGrow: 1, flexBasis: 300, minWidth: 280, backgroundColor: colors.surface, borderRadius: 24, padding: 12, ...shadow.e1 },
  cardPortrait: { height: 150, borderRadius: radii.lg, overflow: 'hidden' },
  cardChip: { position: 'absolute', top: 10, left: 10, height: 24, paddingHorizontal: 10 },
  cardSave: { position: 'absolute', top: 10, right: 10, width: 32, height: 32, borderRadius: radii.pill, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.e1 },
  cardBody: { paddingTop: 14, paddingHorizontal: 4 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardName: { flex: 1, minWidth: 0, fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  cardBlurb: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 6 },
  cardBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  cardFoot: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 14 },
  cardRate: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
  cardRateUnit: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2 },
  cardView: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 34, paddingHorizontal: 16, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  cardViewText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
});
