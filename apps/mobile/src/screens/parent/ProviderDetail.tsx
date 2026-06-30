/**
 * Caregiver profile view (OH-202) — Parent-facing, native + narrow web.
 * Design: screens/provider-detail.jsx + screens/provider.jsx.
 *
 * The destination of a Search result tap. Full-bleed hero Portrait over the
 * category pastel with overlay back/share/bookmark, an overlapping info block
 * (CategoryChip + badges + name + RatingValue + rate), an About/Availability/
 * Reviews TabStrip, and a sticky CTA bar driven by the profile's role-appropriate
 * `ctas` (Caregiver → Message + Book; Provider → Book-a-consultation). Real data
 * via `useSupplyProfile`; only APPROVED Credentials and PUBLIC Ratings are shown
 * (the backend enforces both).
 *
 * For a Provider (OH-203) the screen also shows the open consultation slots
 * (slot-pick) + the Verified-clinician credential breakdown; tapping a slot and
 * "Book consultation" creates the null-payment Booking (`bookConsultation`) and
 * lands on the schedule. A 402 surfaces the Parent-membership gate inline (the
 * upsell UI is OH-204). The paywall that gates Caregiver Message/Book is OH-204;
 * the real messaging thread is OH-205.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, CredBadge } from '@/components/ui/Badge';
import { CategoryChip, CATEGORY_TONE } from '@/components/ui/CategoryChip';
import { Chip } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { Portrait } from '@/components/ui/PhotoPlaceholder';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { RatingValue } from '@/components/ui/StarRating';
import { TabStrip } from '@/components/ui/TabStrip';
import { ApiError, bookConsultation, type SupplyProfile } from '@/api/client';
import { useParentGate } from '@/lib/paywallGate';
import { useSupplyProfile } from '@/lib/useSupplyProfile';
import {
  ageBandLabel,
  alsoOffersLabel,
  availabilityRows,
  behaviourLabel,
  categoryRateLabel,
  dollars,
  hasAnyAvailability,
  profileBadges,
  profileCategory,
} from '@/lib/supply-profile';
import { providerCredentialRows, slotLabel } from '@/lib/consultation';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const TABS = ['About', 'Availability', 'Reviews'] as const;
type Tab = (typeof TABS)[number];

export default function ProviderDetailScreen() {
  const router = useRouter();
  const { id, zip } = useLocalSearchParams<{ id?: string; role?: string; zip?: string }>();
  const { data, loading, error, notFound, refetch } = useSupplyProfile(id ?? null, zip);
  const [tab, setTab] = useState<Tab>('About');
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const { gate, openPaywall } = useParentGate();

  if (loading) {
    return (
      <Screen edges={['top']} contentStyle={styles.centered}>
        <ActivityIndicator color={colors.brand} />
      </Screen>
    );
  }

  if (notFound || error || !data) {
    return (
      <Screen edges={['top']} contentStyle={styles.centered}>
        <Text style={styles.errorTitle}>{notFound ? 'Profile unavailable' : error}</Text>
        <Text style={styles.errorSub}>
          {notFound
            ? 'This profile is no longer available. Try another match from your search.'
            : 'We couldn’t load this profile.'}
        </Text>
        <View style={styles.errorActions}>
          {!notFound ? (
            <Pressable onPress={refetch} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.back()} style={styles.retryGhost}>
            <Text style={styles.retryGhostText}>Back to search</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const tone = colors[CATEGORY_TONE[profileCategory(data)]];
  const also = alsoOffersLabel(data);
  const fromRate = dollars(data.fromRateCents);
  const metaBits = [
    data.headline,
    data.distanceMiles != null ? `${data.distanceMiles} mi away` : data.areaLabel,
  ].filter(Boolean) as string[];

  // Message / Book-request are Parent-Subscription-gated (OH-204): a not-entitled
  // Parent is routed to the paywall, which resumes the action once subscribed.
  const openMessage = () =>
    gate({ kind: 'message', id: data.id, name: data.displayName ?? undefined }, () =>
      router.push({ pathname: '/message-thread', params: { id: data.id, name: data.displayName ?? '' } }),
    );
  const openBooking = () =>
    gate({ kind: 'book-request', id: data.id }, () =>
      router.push({ pathname: '/booking-compose', params: { id: data.id } }),
    );

  // Consultation slot-pick (OH-203): book the selected open slot. Null payment —
  // no checkout. A 402 is the Parent-Subscription gate → route to the paywall with
  // a book-consultation intent so it re-attempts this booking once subscribed (OH-204).
  const slots = data.consultationSlots;
  const bookConsult = async () => {
    const slotId = selectedSlot;
    if (!slotId) {
      setBookError('Pick a time to book.');
      return;
    }
    setBooking(true);
    setBookError(null);
    try {
      await bookConsultation(data.id, slotId);
      router.replace('/bookings');
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        openPaywall({ kind: 'book-consultation', id: data.id, slotId });
        setBooking(false);
        return;
      } else if (e instanceof ApiError && e.status === 409) {
        setBookError('That time was just taken — pick another slot.');
        refetch();
        setSelectedSlot(null);
      } else {
        setBookError(e instanceof ApiError ? e.message : 'Could not complete the booking.');
      }
      setBooking(false);
    }
  };

  return (
    <Screen edges={['top']} contentStyle={styles.content}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <Portrait height={300} tint={tone} label="" />
          <View style={styles.heroBar}>
            <IconButton name="chevron-left" onPress={() => router.back()} accessibilityLabel="Back" />
            <View style={styles.heroActions}>
              <IconButton name="bookmark" accessibilityLabel="Save" />
              <IconButton name="arrow-up-right" accessibilityLabel="Share" />
            </View>
          </View>
          <View style={styles.heroFoot}>
            <CategoryChip category={profileCategory(data)} />
            {also ? (
              <View style={styles.alsoPill}>
                <Text style={styles.alsoText}>{also}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Info block */}
        <View style={styles.body}>
          <View style={styles.infoRow}>
            <View style={styles.infoLeft}>
              <Text style={styles.name}>{data.displayName ?? 'Caregiver'}</Text>
              {metaBits.length > 0 ? <Text style={styles.sub}>{metaBits.join(' · ')}</Text> : null}
              {data.rating.count > 0 ? (
                <View style={styles.ratingRow}>
                  <RatingValue value={data.rating.average ?? 0} size={16} />
                  <Text style={styles.ratingMeta}>
                    · {data.rating.count} {data.rating.count === 1 ? 'review' : 'reviews'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.ratingMeta}>New to Our Haven · no reviews yet</Text>
              )}
            </View>
            {fromRate ? (
              <View style={styles.rateCol}>
                <Text style={styles.rateFrom}>FROM</Text>
                <Text style={styles.rateBig}>{fromRate}</Text>
                <Text style={styles.ratePer}>{data.role === 'provider' ? 'per session' : 'per hour'}</Text>
              </View>
            ) : null}
          </View>

          {data.negotiable ? (
            <View style={styles.offerRow}>
              <View style={styles.offerPill}>
                <Icon name="sparkle" size={12} color={colors.brand} />
                <Text style={styles.offerText}>Open to Offers</Text>
              </View>
            </View>
          ) : null}

          {/* Badges */}
          <View style={styles.badges}>
            {profileBadges(data).map((b) => (
              <Badge key={b} kind={b} />
            ))}
          </View>

          {/* Consultation slots — Provider slot-pick (OH-203) */}
          {data.role === 'provider' ? (
            <View style={styles.slotsSection}>
              <Text style={styles.eyebrow}>Open consultation slots</Text>
              {slots.length === 0 ? (
                <Text style={styles.slotsEmpty}>
                  No open slots right now. Check back soon or message to ask about availability.
                </Text>
              ) : (
                <View style={styles.slotList}>
                  {slots.map((s) => {
                    const sel = selectedSlot === s.id;
                    return (
                      <Pressable
                        key={s.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: sel }}
                        onPress={() => {
                          setSelectedSlot(s.id);
                          setBookError(null);
                        }}
                        style={({ pressed }) => [styles.slotRow, sel && styles.slotRowSel, { opacity: pressed ? 0.9 : 1 }]}
                      >
                        <Icon name="clock" size={16} color={sel ? colors.brand : colors.ink2} />
                        <Text style={[styles.slotText, sel && styles.slotTextSel]}>{slotLabel(s)}</Text>
                        {sel ? <Icon name="check-circle" size={18} color={colors.brand} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}

          {/* Tabs */}
          <TabStrip tabs={TABS} value={tab} onChange={setTab} style={styles.tabs} />

          {tab === 'About' ? <AboutTab data={data} /> : null}
          {tab === 'Availability' ? <AvailabilityTab data={data} /> : null}
          {tab === 'Reviews' ? <ReviewsTab data={data} /> : null}
        </View>
      </ScrollView>

      {/* Sticky CTA — driven by the profile's role-appropriate actions */}
      <View style={styles.footer}>
        {bookError ? <Text style={styles.bookError}>{bookError}</Text> : null}
        <View style={styles.footerRow}>
          {data.ctas.includes('message') ? (
            <Pressable
              onPress={openMessage}
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.9 : 1 }]}
            >
              <Icon name="message" size={18} color={colors.ink} />
              <Text style={styles.secondaryText}>Message</Text>
            </Pressable>
          ) : null}
          {data.ctas.includes('book') ? (
            <PrimaryButton onPress={openBooking} style={styles.primaryBtn}>
              Book a slot
            </PrimaryButton>
          ) : null}
          {data.ctas.includes('book-consultation') ? (
            <PrimaryButton
              onPress={bookConsult}
              loading={booking}
              disabled={slots.length === 0}
              style={styles.primaryBtn}
            >
              {selectedSlot ? 'Book consultation' : 'Select a time'}
            </PrimaryButton>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

/* ── tabs ───────────────────────────────────────────────────────────────────── */

function AboutTab({ data }: { data: SupplyProfile }) {
  return (
    <View style={styles.tabBody}>
      {data.bio ? <Text style={styles.paragraph}>{data.bio}</Text> : null}

      {data.specialtyTags.length > 0 ? (
        <>
          <Text style={styles.eyebrow}>Specialties</Text>
          <View style={styles.wrapRow}>
            {data.specialtyTags.map((s) => (
              <View key={s} style={styles.outlineChip}>
                <Text style={styles.outlineChipText}>{s}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {data.languages.length > 0 ? (
        <>
          <Text style={styles.eyebrow}>Languages</Text>
          <Text style={styles.value}>{data.languages.join(' · ')}</Text>
        </>
      ) : null}

      {data.categoryRates.length > 0 ? (
        <>
          <Text style={styles.eyebrow}>Services & rates</Text>
          <View style={styles.rateList}>
            {data.categoryRates.map((r) => (
              <View key={r.category} style={styles.rateItem}>
                <View style={styles.rateTag}>
                  <Text style={styles.rateTagText}>{categoryRateLabel(r)}</Text>
                </View>
                {r.perChildSurchargeCents != null ? (
                  <Text style={styles.rateNote} numberOfLines={1}>
                    +{dollars(r.perChildSurchargeCents)}/hr per extra child
                  </Text>
                ) : (
                  <View style={styles.flexMin} />
                )}
                <Text style={styles.rateItemRate}>
                  {dollars(r.publishedRateCents)}
                  <Text style={styles.rateItemUnit}>/hr</Text>
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {data.agesServed.length > 0 || data.behaviourComfort.length > 0 ? (
        <Text style={styles.eyebrow}>Ages & comfort</Text>
      ) : null}
      {data.agesServed.length > 0 ? (
        <Text style={styles.value}>Works with {data.agesServed.map(ageBandLabel).join(', ')}</Text>
      ) : null}
      {data.behaviourComfort.length > 0 ? (
        <View style={styles.wrapRow}>
          {data.behaviourComfort.map((b) => (
            <Chip key={b} label={behaviourLabel(b)} tone="comfort" />
          ))}
        </View>
      ) : null}

      {data.credentials.length > 0 ? (
        <>
          <Text style={styles.eyebrow}>Credentials</Text>
          <View style={styles.wrapRow}>
            {data.credentials.map((cr) => (
              <CredBadge key={cr.id} label={cr.label} status="verified" icon="check-circle" />
            ))}
          </View>
        </>
      ) : null}

      {/* Provider clinical credential breakdown (OH-203) */}
      {data.providerCredential ? (
        <>
          <Text style={styles.eyebrow}>Verified clinician</Text>
          <View style={styles.credList}>
            {providerCredentialRows(data.providerCredential).map((row) => (
              <View key={row.label} style={styles.credRow}>
                <Icon
                  name={row.ok ? 'check-circle' : 'clock'}
                  size={16}
                  color={row.ok ? colors.success : colors.ink3}
                />
                <Text style={styles.credText}>{row.label}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function AvailabilityTab({ data }: { data: SupplyProfile }) {
  if (!hasAnyAvailability(data.availabilityGrid)) {
    return (
      <View style={styles.tabBody}>
        <Text style={styles.paragraph}>
          {data.availabilitySummary ?? 'Send a message to ask about availability.'}
        </Text>
        {data.availabilityNote ? <Text style={styles.availNote}>{data.availabilityNote}</Text> : null}
      </View>
    );
  }
  return (
    <View style={styles.tabBody}>
      <Text style={styles.paragraph}>Typical weekly availability. Send a message to confirm a specific slot.</Text>
      {availabilityRows(data.availabilityGrid).map((a) => (
        <View key={a.day} style={styles.availRow}>
          <Text style={styles.availDay}>{a.day}</Text>
          <Text style={[styles.availBands, a.bands == null && styles.availOff]}>{a.bands ?? 'Unavailable'}</Text>
        </View>
      ))}
      {data.availabilityNote ? <Text style={styles.availNote}>{data.availabilityNote}</Text> : null}
    </View>
  );
}

function ReviewsTab({ data }: { data: SupplyProfile }) {
  if (data.rating.reviews.length === 0) {
    return (
      <View style={styles.tabBody}>
        <Text style={styles.paragraph}>No reviews yet — be the first family to book.</Text>
      </View>
    );
  }
  return (
    <View style={styles.tabBody}>
      {data.rating.reviews.map((r, i) => (
        <View key={i} style={styles.reviewCard}>
          <View style={styles.reviewHead}>
            <Avatar label="Family" size="sm" tone="catBaby" />
            <View style={styles.reviewWho}>
              <Text style={styles.reviewName}>Verified family</Text>
              <RatingValue value={r.stars} size={13} />
            </View>
          </View>
          {r.text ? <Text style={styles.reviewText}>{r.text}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: 0 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  errorTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink, textAlign: 'center' },
  errorSub: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, textAlign: 'center' },
  errorActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  retry: { height: 44, paddingHorizontal: 20, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkInv },
  retryGhost: { height: 44, paddingHorizontal: 20, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  retryGhostText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },

  hero: { height: 300 },
  heroBar: { position: 'absolute', top: 12, left: 24, right: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroActions: { flexDirection: 'row', gap: 8 },
  heroFoot: { position: 'absolute', bottom: 44, left: 24, flexDirection: 'row', alignItems: 'center', gap: 8 },
  alsoPill: { height: 28, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: 'rgba(22,21,19,0.55)', alignItems: 'center', justifyContent: 'center' },
  alsoText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.inkInv },

  body: { marginTop: -28, backgroundColor: colors.canvas, borderTopLeftRadius: 36, borderTopRightRadius: 36, paddingTop: 24, paddingHorizontal: 24 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  infoLeft: { flex: 1, minWidth: 0 },
  flexMin: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 32, letterSpacing: -0.6, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, marginTop: 6 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  ratingMeta: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 8 },
  rateCol: { alignItems: 'flex-end' },
  rateFrom: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.3, color: colors.ink3 },
  rateBig: { fontFamily: fonts.bold, fontSize: 40, lineHeight: 40, letterSpacing: -1.2, color: colors.ink, fontVariant: ['tabular-nums'] },
  ratePer: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 4 },

  offerRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  offerPill: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: colors.brandSoft },
  offerText: { fontFamily: fonts.bold, fontSize: 11.5, color: colors.brand },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },

  slotsSection: { marginTop: 24 },
  slotsEmpty: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, marginTop: 10 },
  slotList: { gap: 8, marginTop: 12 },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    height: 52,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  slotRowSel: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  slotText: { flex: 1, minWidth: 0, fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  slotTextSel: { fontFamily: fonts.semibold, color: colors.ink },

  credList: { gap: 10, marginTop: 12 },
  credRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  credText: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },

  tabs: { marginTop: 24 },
  tabBody: { marginTop: 20 },
  paragraph: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, color: colors.ink },
  eyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2, marginTop: 24 },
  value: { fontFamily: fonts.regular, fontSize: 15, color: colors.ink, marginTop: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  outlineChip: { height: 32, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  outlineChipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink },

  rateList: { gap: 8, marginTop: 10 },
  rateItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radii.sm, padding: 12, borderWidth: 1, borderColor: colors.hairline },
  rateTag: { height: 26, paddingHorizontal: 11, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  rateTagText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink },
  rateNote: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2 },
  rateItemRate: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] },
  rateItemUnit: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },

  availRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  availDay: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  availBands: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2 },
  availOff: { color: colors.ink3 },
  availNote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2, marginTop: 14 },

  reviewCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, marginBottom: 12, ...shadow.e1 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewWho: { gap: 2 },
  reviewName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  reviewText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink, marginTop: 10 },

  footer: {
    backgroundColor: colors.surface,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 24,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    ...shadow.e2,
  },
  footerRow: { flexDirection: 'row', gap: 10 },
  bookError: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginBottom: 10, textAlign: 'center' },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  secondaryText: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: -0.2, color: colors.ink },
  primaryBtn: { flex: 1 },
});
