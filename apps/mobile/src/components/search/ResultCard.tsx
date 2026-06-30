/**
 * Search result cards (OH-201) — the two halves of the blur-to-unblur preview
 * wall, shared by the native list + the web grid via a `layout` prop:
 *
 *   - FullResultCard    a revealed SupplyCard: photo placeholder, name, rating,
 *                       distance, badges, "from $X", and the role-appropriate
 *                       CTA(s) (Caregiver → Message/Book; Provider →
 *                       Book-a-consultation). Tapping opens the profile.
 *   - BlurredResultCard a locked teaser: the category tone + a frosted scrim +
 *                       lock, plus only the marketing-safe facts the backend
 *                       returns (no name / photo / exact location). Tapping
 *                       routes to the Subscription paywall.
 *
 * `expo-blur` is not installed (and CI forbids new deps), so the "blur" is a
 * frosted scrim overlay over the tinted Portrait silhouette — cross-platform and
 * dependency-free.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Badge, type BadgeKind } from '@/components/ui/Badge';
import { CategoryChip, CATEGORY_TONE, type Category } from '@/components/ui/CategoryChip';
import { Portrait } from '@/components/ui/PhotoPlaceholder';
import { RatingValue } from '@/components/ui/StarRating';
import type { SearchBlurredCard, SearchResultCard } from '@/api/client';
import { categoryLabel, formatFromRate } from '@/lib/search';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export type CardLayout = 'row' | 'tile';

function displayCategory(card: { role: string; categories: string[]; categoryKey?: string }): Category {
  if (card.role === 'provider') return 'Provider';
  const c = card.categoryKey ?? card.categories[0];
  if (c === 'babysitter') return 'Babysitter';
  if (c === 'nanny') return 'Nanny';
  return 'Tutor';
}

function badgesFor(card: { taxCreditFriendly: boolean; fcchBadge: boolean; ratingAverage: number; ratingCount: number }): BadgeKind[] {
  const out: BadgeKind[] = ['verified']; // only listable (vetted) supply is returned
  if (card.ratingCount > 0 && card.ratingAverage >= 4.8) out.push('toprated');
  if (card.taxCreditFriendly) out.push('tax');
  if (card.fcchBadge) out.push('fcch');
  return out;
}

const CTA_LABEL: Record<string, string> = {
  message: 'Message',
  book: 'Book',
  'book-consultation': 'Book consultation',
};

export function FullResultCard({
  card,
  layout,
  onOpen,
}: {
  card: SearchResultCard;
  layout: CardLayout;
  onOpen: () => void;
}) {
  const tone = colors[CATEGORY_TONE[displayCategory(card)]];
  const tile = layout === 'tile';
  const fromRate = formatFromRate(card.fromRateCents);
  const metaBits = [
    card.distanceMiles != null ? `${card.distanceMiles} mi` : card.areaLabel,
    card.availabilitySummary,
  ].filter(Boolean) as string[];

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${card.displayName ?? 'Profile'}, ${categoryLabel(card)}`}
      style={({ pressed }) => [tile ? styles.tile : styles.row, { opacity: pressed ? 0.95 : 1 }]}
    >
      <View style={tile ? styles.tilePortrait : styles.rowPortrait}>
        <Portrait height={tile ? 150 : 110} tint={tone} label="" radius={radii.lg} />
        <CategoryChip category={displayCategory(card)} style={styles.portraitChip} />
      </View>

      <View style={tile ? styles.tileBody : styles.rowBody}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {card.displayName ?? categoryLabel(card)}
          </Text>
          {card.ratingCount > 0 ? <RatingValue value={card.ratingAverage} count={card.ratingCount} size={13} /> : null}
        </View>

        {card.headline ? (
          <Text style={styles.headline} numberOfLines={1}>
            {card.headline}
          </Text>
        ) : null}
        {metaBits.length > 0 ? (
          <Text style={styles.meta} numberOfLines={1}>
            {metaBits.join(' · ')}
          </Text>
        ) : null}

        <View style={styles.badges}>
          {badgesFor(card).map((b) => (
            <Badge key={b} kind={b} />
          ))}
        </View>

        <View style={styles.foot}>
          {fromRate ? (
            <Text style={styles.rate}>
              {fromRate}
              <Text style={styles.rateUnit}>/hr</Text>
            </Text>
          ) : (
            <Text style={styles.rateMuted}>Rate on request</Text>
          )}
          <View style={styles.ctaRow}>
            {card.ctas.map((cta) => (
              <View key={cta} style={styles.ctaPill}>
                <Text style={styles.ctaText}>{CTA_LABEL[cta] ?? cta}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export function BlurredResultCard({
  card,
  layout,
  onUnlock,
}: {
  card: SearchBlurredCard;
  layout: CardLayout;
  onUnlock: () => void;
}) {
  const tone = colors[CATEGORY_TONE[displayCategory(card)]];
  const tile = layout === 'tile';
  const fromRate = formatFromRate(card.fromRateCents);

  return (
    <Pressable
      onPress={onUnlock}
      accessibilityRole="button"
      accessibilityLabel={`Locked ${categoryLabel(card)} — subscribe to view`}
      style={({ pressed }) => [tile ? styles.tile : styles.row, { opacity: pressed ? 0.95 : 1 }]}
    >
      <View style={tile ? styles.tilePortrait : styles.rowPortrait}>
        <Portrait height={tile ? 150 : 110} tint={tone} label="" radius={radii.lg} />
        {/* Frosted scrim + lock = the "blur" (no expo-blur dep). */}
        <View style={[styles.scrim, { borderRadius: radii.lg }]} />
        <View style={styles.lockBubble}>
          <Icon name="lock" size={tile ? 20 : 16} color={colors.ink} />
        </View>
        <CategoryChip category={displayCategory(card)} style={styles.portraitChip} />
      </View>

      <View style={tile ? styles.tileBody : styles.rowBody}>
        <View style={styles.nameRow}>
          <Text style={styles.lockedName} numberOfLines={1}>
            {categoryLabel(card)}
          </Text>
          {card.ratingCount > 0 ? <RatingValue value={card.ratingAverage} count={card.ratingCount} size={13} /> : null}
        </View>
        {card.areaLabel ? (
          <Text style={styles.meta} numberOfLines={1}>
            {card.areaLabel}
          </Text>
        ) : null}

        <View style={styles.badges}>
          {card.taxCreditFriendly ? <Badge kind="tax" /> : null}
          {card.fcchBadge ? <Badge kind="fcch" /> : null}
        </View>

        <View style={styles.foot}>
          {fromRate ? (
            <Text style={styles.rate}>
              {fromRate}
              <Text style={styles.rateUnit}>/hr</Text>
            </Text>
          ) : (
            <Text style={styles.rateMuted}>Rate hidden</Text>
          )}
          <View style={styles.unlockPill}>
            <Icon name="lock" size={12} color={colors.inkInv} />
            <Text style={styles.unlockText}>Subscribe to view</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: 24, padding: 12, ...shadow.e1 },
  rowPortrait: { width: 96, height: 110, borderRadius: radii.lg, overflow: 'hidden' },
  rowBody: { flex: 1, minWidth: 0 },

  tile: {
    flexGrow: 1,
    flexBasis: 300,
    minWidth: 280,
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 12,
    ...shadow.e1,
  },
  tilePortrait: { height: 150, borderRadius: radii.lg, overflow: 'hidden' },
  tileBody: { paddingTop: 14, paddingHorizontal: 4 },

  portraitChip: { position: 'absolute', top: 6, left: 6, height: 22, paddingHorizontal: 8 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(251,247,239,0.55)' },
  lockBubble: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 40,
    height: 40,
    marginLeft: -20,
    marginTop: -20,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.e2,
  },

  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, minWidth: 0, fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  lockedName: { flex: 1, minWidth: 0, fontFamily: fonts.bold, fontSize: 16, color: colors.ink2 },
  headline: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 4 },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3, marginTop: 4 },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },

  foot: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 12 },
  rate: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, fontVariant: ['tabular-nums'] },
  rateUnit: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2 },
  rateMuted: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink3 },

  ctaRow: { flexDirection: 'row', gap: 6, flexShrink: 0 },
  ctaPill: { height: 32, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkInv },

  unlockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
  },
  unlockText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.inkInv },
});
