/**
 * ParentDiscoveryWeb — the Parent marketplace / discovery home on desktop web.
 * Content-only: the dispatcher wraps this in <ParentWebShell active="home">.
 *
 * Ported from the Claude Design web project (parent-web/pw-discovery.jsx) and the
 * native Parent Home: a search hero, a four-across category row, a "Recommended
 * for you" Provider grid, and a "Featured Providers" dark-card row. RN primitives
 * only; multi-column via flexDirection:'row' + gap + flexWrap.
 */
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { WebPageHeader } from '@/components/web/ParentWebShell';
import { Icon, type IconName } from '@/components/Icon';
import { Badge, type BadgeKind } from '@/components/ui/Badge';
import { CategoryChip, CATEGORY_TONE, type Category } from '@/components/ui/CategoryChip';
import { FilterChip } from '@/components/ui/Chip';
import { Portrait } from '@/components/ui/PhotoPlaceholder';
import { RatingValue } from '@/components/ui/StarRating';
import { SearchBar } from '@/components/ui/SearchBar';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

interface CategoryTile {
  name: Category;
  tone: ColorToken;
  count: string;
  icon: IconName;
}

const CATEGORIES: CategoryTile[] = [
  { name: 'Babysitter', tone: 'catBaby', count: '128 nearby', icon: 'person' },
  { name: 'Tutor', tone: 'catTutor', count: '64 nearby', icon: 'graduation' },
  { name: 'Nanny', tone: 'catNanny', count: '47 nearby', icon: 'users' },
  { name: 'Provider', tone: 'catSpec', count: '22 licensed', icon: 'shield' },
];

const QUICK_FILTERS = ['Top-rated', 'Within 10 mi', 'Tax-credit friendly', 'Available now'];

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

const RECOMMENDED: ProviderCardData[] = [
  { name: 'Maya Okafor', role: 'Tutor', blurb: 'K–8 math · builds number sense first', rate: 35, rating: 4.9, reviews: 87, distance: '1.4 mi', badges: ['verified', 'toprated'] },
  { name: 'Sofia Castillo', role: 'Babysitter', blurb: 'Evenings & weekends · CPR certified', rate: 22, rating: 4.6, reviews: 41, distance: '3.0 mi', badges: ['verified', 'tax'] },
  { name: 'Rosa Delgado', role: 'Nanny', blurb: 'After-school care for ages 4–8', rate: 28, rating: 4.8, reviews: 53, distance: '2.2 mi', badges: ['verified'] },
  { name: 'Priya Iyer', role: 'Tutor', blurb: 'Reading fluency & ESL bilingual', rate: 38, rating: 4.8, reviews: 64, distance: '0.9 mi', badges: ['verified', 'toprated'] },
  { name: 'Diego Mejia', role: 'Tutor', blurb: 'Pre-algebra & test prep', rate: 42, rating: 4.7, reviews: 29, distance: '2.1 mi', badges: ['verified', 'tax'] },
  { name: 'Naomi Brooks', role: 'Nanny', blurb: 'Full-time nanny · 9 yrs experience', rate: 30, rating: 4.9, reviews: 38, distance: '4.1 mi', badges: ['verified', 'toprated'] },
];

const FEATURED: { name: string; role: Category; tagline: string; rate: number; rating: number }[] = [
  { name: 'Dr. Camille Ramos', role: 'Provider', tagline: 'Pediatric occupational therapy · in-home consults', rate: 120, rating: 5.0 },
  { name: 'Lina Park', role: 'Babysitter', tagline: 'Newborn-care trained · overnight available', rate: 26, rating: 4.9 },
];

export function ParentDiscoveryWeb() {
  const router = useRouter();
  const go = (route: string) => router.push(route as never);

  return (
    <View>
      <WebPageHeader greet="Good morning, Adjei" title="Find trusted care nearby" actions={['calendar', 'bell']} />

      <View style={styles.body}>
        {/* Search hero */}
        <View style={styles.hero}>
          <View style={styles.heroText}>
            <View style={styles.heroPill}>
              <Icon name="pin" size={13} color={colors.brand} />
              <Text style={styles.heroPillText}>Beverly Hills, CA · 90210</Text>
            </View>
            <Text style={styles.heroTitle}>Find Trusted Providers Near You.</Text>
            <Text style={styles.heroSub}>
              Search vetted Caregivers and licensed Providers — or post a Job and let them apply to you.
            </Text>
          </View>
          <SearchBar
            value="Tutor · K–8 math"
            placeholder="Search Caregivers, skills, or specialties"
            onPress={() => go('/search')}
            onFilter={() => go('/search')}
            style={styles.heroSearch}
          />
          <View style={styles.heroFilters}>
            {QUICK_FILTERS.map((f) => (
              <FilterChip key={f} label={f} active={f === 'Top-rated'} onPress={() => go('/search')} />
            ))}
          </View>
        </View>

        {/* Category tiles */}
        <View style={styles.catRow}>
          {CATEGORIES.map((cat) => (
            <Pressable
              key={cat.name}
              onPress={() => go('/search')}
              style={({ pressed }) => [styles.catTile, { backgroundColor: colors[cat.tone], opacity: pressed ? 0.92 : 1 }]}
            >
              <View style={styles.catIcon}>
                <Icon name={cat.icon} size={34} color={colors.ink} />
              </View>
              <Text style={styles.catName}>{cat.name}</Text>
              <Text style={styles.catCount}>{cat.count}</Text>
            </Pressable>
          ))}
        </View>

        {/* Recommended grid */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Recommended for you</Text>
          <Pressable onPress={() => go('/search')} hitSlop={8}>
            <Text style={styles.sectionAction}>See all 24</Text>
          </Pressable>
        </View>
        <View style={styles.grid}>
          {RECOMMENDED.map((p) => (
            <ProviderCard key={p.name} data={p} onPress={() => go('/provider-detail')} />
          ))}
        </View>

        {/* Featured */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Featured Providers</Text>
        </View>
        <View style={styles.featuredRow}>
          {FEATURED.map((f) => (
            <Pressable
              key={f.name}
              onPress={() => go('/provider-detail')}
              style={({ pressed }) => [styles.featured, { opacity: pressed ? 0.94 : 1 }]}
            >
              <View style={styles.featuredTop}>
                <View style={[styles.featuredTone, { backgroundColor: colors[CATEGORY_TONE[f.role]] }]}>
                  <Text style={styles.featuredToneText}>{f.role}</Text>
                </View>
                <RatingValue value={f.rating} size={14} />
              </View>
              <Text style={styles.featuredName}>{f.name}</Text>
              <Text style={styles.featuredTag}>{f.tagline}</Text>
              <View style={styles.featuredBottom}>
                <Text style={styles.featuredRate}>
                  ${f.rate}
                  <Text style={styles.featuredRateUnit}>/hr</Text>
                </Text>
                <View style={styles.featuredCta}>
                  <Text style={styles.featuredCtaText}>View profile</Text>
                  <Icon name="arrow-up-right" size={15} color={colors.inkInv} />
                </View>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
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

  // hero
  hero: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 28, ...shadow.e1 },
  heroText: { maxWidth: 560 },
  heroPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.brandSoft, marginBottom: 14 },
  heroPillText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.brand },
  heroTitle: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, letterSpacing: -1, color: colors.ink },
  heroSub: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink2, marginTop: 10 },
  heroSearch: { marginTop: 22, maxWidth: 640, ...shadow.e1, backgroundColor: colors.surfaceAlt },
  heroFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },

  // categories
  catRow: { flexDirection: 'row', gap: 16, marginTop: 28 },
  catTile: { flex: 1, minWidth: 0, height: 150, borderRadius: 24, padding: 18, justifyContent: 'space-between', overflow: 'hidden' },
  catIcon: { opacity: 0.8 },
  catName: { fontFamily: fonts.bold, fontSize: 19, color: colors.ink },
  catCount: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink, opacity: 0.7, marginTop: 2 },

  // section
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 36, marginBottom: 16 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink },
  sectionAction: { fontFamily: fonts.semibold, fontSize: 14, color: colors.brand },

  // recommended grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  card: { width: 340, backgroundColor: colors.surface, borderRadius: 24, padding: 12, ...shadow.e1 },
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

  // featured
  featuredRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  featured: { flex: 1, minWidth: 360, backgroundColor: colors.brand, borderRadius: 24, padding: 22 },
  featuredTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  featuredTone: { height: 26, paddingHorizontal: 11, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  featuredToneText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink },
  featuredName: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.4, color: colors.inkInv, marginTop: 16 },
  featuredTag: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.inkInv, opacity: 0.85, marginTop: 6 },
  featuredBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 },
  featuredRate: { fontFamily: fonts.bold, fontSize: 22, color: colors.inkInv, fontVariant: ['tabular-nums'] },
  featuredRateUnit: { fontFamily: fonts.medium, fontSize: 13, color: colors.inkInv, opacity: 0.8 },
  featuredCta: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 16, borderRadius: radii.pill, backgroundColor: 'rgba(251,247,239,0.16)' },
  featuredCtaText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkInv },
});
