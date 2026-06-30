/**
 * ParentProviderWeb — Caregiver profile view on desktop web (OH-202).
 * Content-only: the dispatcher wraps this in <ParentWebShell>.
 *
 * Desktop analogue of the native Provider-detail screen: a two-column layout —
 * left is the hero Portrait, identity, badges, and an About/Availability/Reviews
 * TabStrip; right is a Book/Message action card with the rate + quick facts (the
 * desktop form of the native sticky CTA bar). Real data via `useSupplyProfile`;
 * only APPROVED Credentials + PUBLIC Ratings are shown. RN primitives only.
 *
 * For a Provider (OH-203) the action card carries the open consultation slots
 * (slot-pick) + the book button (`bookConsultation`, null payment); the About tab
 * adds the Verified-clinician credential breakdown. A 402 surfaces the
 * Parent-membership gate inline (the upsell UI is OH-204).
 */
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { WebPageHeader } from '@/components/web/ParentWebShell';
import { Icon, type IconName } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, CredBadge } from '@/components/ui/Badge';
import { CategoryChip, CATEGORY_TONE } from '@/components/ui/CategoryChip';
import { Chip } from '@/components/ui/Chip';
import { Portrait } from '@/components/ui/PhotoPlaceholder';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { RatingValue } from '@/components/ui/StarRating';
import { TabStrip } from '@/components/ui/TabStrip';
import { ApiError, bookConsultation, type SupplyProfile } from '@/api/client';
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

export function ParentProviderWeb() {
  const router = useRouter();
  const { id, zip } = useLocalSearchParams<{ id?: string; role?: string; zip?: string }>();
  const { data, loading, error, notFound, refetch } = useSupplyProfile(id ?? null, zip);
  const [tab, setTab] = useState<Tab>('About');
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);

  if (loading) {
    return (
      <View>
        <WebPageHeader greet="Profile" title="Loading…" />
        <View style={styles.stateBox}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </View>
    );
  }

  if (notFound || error || !data) {
    return (
      <View>
        <WebPageHeader greet="Profile" title={notFound ? 'Profile unavailable' : 'Something went wrong'} />
        <View style={styles.stateBox}>
          <Text style={styles.stateSub}>
            {notFound
              ? 'This profile is no longer available. Try another match from your search.'
              : (error ?? 'We couldn’t load this profile.')}
          </Text>
          <View style={styles.stateActions}>
            {!notFound ? (
              <Pressable onPress={refetch} style={styles.retry}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => router.back()} style={styles.retryGhost}>
              <Text style={styles.retryGhostText}>Back to search</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  const tone = colors[CATEGORY_TONE[profileCategory(data)]];
  const also = alsoOffersLabel(data);
  const fromRate = dollars(data.fromRateCents);
  const metaBits = [
    data.headline,
    data.distanceMiles != null ? `${data.distanceMiles} mi away` : data.areaLabel,
  ].filter(Boolean) as string[];

  const facts: { icon: IconName; label: string; value: string }[] = [];
  if (data.distanceMiles != null || data.areaLabel) {
    facts.push({ icon: 'pin', label: 'Location', value: data.distanceMiles != null ? `${data.distanceMiles} mi away` : data.areaLabel! });
  }
  if (data.yearsExperience != null) {
    facts.push({ icon: 'check-circle', label: 'Experience', value: `${data.yearsExperience} yrs` });
  }
  if (data.availabilitySummary) {
    facts.push({ icon: 'clock', label: 'Availability', value: data.availabilitySummary });
  }

  const openMessage = () =>
    router.push({ pathname: '/message-thread', params: { id: data.id, name: data.displayName ?? '' } });
  const openBooking = () => router.push({ pathname: '/booking-compose', params: { id: data.id } });

  // Consultation slot-pick (OH-203): book the selected open slot (null payment).
  const slots = data.consultationSlots;
  const bookConsult = async () => {
    if (!selectedSlot) {
      setBookError('Pick a time to book.');
      return;
    }
    setBooking(true);
    setBookError(null);
    try {
      await bookConsultation(data.id, selectedSlot);
      router.replace('/bookings');
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        setBookError('A Parent membership is required to book a consultation.');
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
    <View>
      <WebPageHeader greet="Profile" title={data.displayName ?? 'Caregiver'} actions={['arrow-up-right', 'bookmark']} />

      <View style={styles.body}>
        <View style={styles.columns}>
          {/* ── left: profile ─────────────────────────────── */}
          <View style={styles.main}>
            <View style={styles.heroCard}>
              <View style={styles.heroPortrait}>
                <Portrait height={300} tint={tone} label="" radius={radii.lg} />
              </View>
              <View style={styles.heroInfo}>
                <View style={styles.heroChips}>
                  <CategoryChip category={profileCategory(data)} />
                  {also ? (
                    <View style={styles.alsoPill}>
                      <Text style={styles.alsoText}>{also}</Text>
                    </View>
                  ) : null}
                </View>
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
                <View style={styles.badges}>
                  {profileBadges(data).map((b) => (
                    <Badge key={b} kind={b} />
                  ))}
                </View>
                {data.negotiable ? (
                  <View style={styles.offerPill}>
                    <Icon name="sparkle" size={12} color={colors.brand} />
                    <Text style={styles.offerText}>Open to Offers</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <TabStrip tabs={TABS} value={tab} onChange={setTab} style={styles.tabs} />

            {tab === 'About' ? <AboutTab data={data} /> : null}
            {tab === 'Availability' ? <AvailabilityTab data={data} /> : null}
            {tab === 'Reviews' ? <ReviewsTab data={data} /> : null}
          </View>

          {/* ── right: booking action card ──────────────────── */}
          <View style={styles.aside}>
            <View style={styles.bookCard}>
              {fromRate ? (
                <View style={styles.rateBlock}>
                  <Text style={styles.rateFrom}>FROM</Text>
                  <Text style={styles.rateBig}>
                    {fromRate}
                    <Text style={styles.ratePer}> {data.role === 'provider' ? '/session' : '/hr'}</Text>
                  </Text>
                </View>
              ) : null}

              {data.ctas.includes('book') ? (
                <PrimaryButton onPress={openBooking} style={styles.bookBtn}>
                  Book a slot
                </PrimaryButton>
              ) : null}
              {data.ctas.includes('book-consultation') ? (
                <View style={styles.slotsBlock}>
                  <Text style={styles.slotsHeading}>Open consultation slots</Text>
                  {slots.length === 0 ? (
                    <Text style={styles.slotsEmpty}>No open slots right now. Check back soon.</Text>
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
                            <Icon name="clock" size={15} color={sel ? colors.brand : colors.ink2} />
                            <Text style={[styles.slotText, sel && styles.slotTextSel]}>{slotLabel(s)}</Text>
                            {sel ? <Icon name="check-circle" size={16} color={colors.brand} /> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                  {bookError ? <Text style={styles.bookError}>{bookError}</Text> : null}
                  <PrimaryButton
                    onPress={bookConsult}
                    loading={booking}
                    disabled={slots.length === 0}
                    style={styles.bookBtn}
                  >
                    {selectedSlot ? 'Book consultation' : 'Select a time'}
                  </PrimaryButton>
                </View>
              ) : null}
              {data.ctas.includes('message') ? (
                <Pressable
                  onPress={openMessage}
                  style={({ pressed }) => [styles.messageBtn, { opacity: pressed ? 0.9 : 1 }]}
                >
                  <Icon name="message" size={18} color={colors.ink} />
                  <Text style={styles.messageText}>Message</Text>
                </Pressable>
              ) : null}

              {facts.length > 0 ? (
                <View style={styles.facts}>
                  {facts.map((f) => (
                    <View key={f.label} style={styles.factRow}>
                      <View style={styles.factIcon}>
                        <Icon name={f.icon} size={15} color={colors.brand} />
                      </View>
                      <View style={styles.flexMin}>
                        <Text style={styles.factLabel}>{f.label}</Text>
                        <Text style={styles.factValue}>{f.value}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={styles.safeNote}>
                <Icon name="shield" size={14} color={colors.brand} />
                <Text style={styles.safeNoteText}>
                  Payments and messaging stay on-platform. Contact details are auto-redacted until a Job is awarded.
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
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
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flexMin: { flex: 1, minWidth: 0 },
  columns: { flexDirection: 'row', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' },
  main: { flex: 1, minWidth: 420 },
  aside: { width: 320 },

  stateBox: { paddingHorizontal: 36, paddingTop: 32, alignItems: 'flex-start', gap: 12 },
  stateSub: { fontFamily: fonts.regular, fontSize: 15, color: colors.ink2, maxWidth: 520 },
  stateActions: { flexDirection: 'row', gap: 10 },
  retry: { height: 44, paddingHorizontal: 20, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkInv },
  retryGhost: { height: 44, paddingHorizontal: 20, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  retryGhostText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  heroCard: { flexDirection: 'row', gap: 20, backgroundColor: colors.surface, borderRadius: 24, padding: 16, ...shadow.e1 },
  heroPortrait: { width: 240, borderRadius: radii.lg, overflow: 'hidden' },
  heroInfo: { flex: 1, minWidth: 0, paddingVertical: 6 },
  heroChips: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alsoPill: { height: 28, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  alsoText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink2 },
  name: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 34, letterSpacing: -0.8, color: colors.ink, marginTop: 14 },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, marginTop: 6 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  ratingMeta: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 8 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  offerPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, height: 26, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: colors.brandSoft, marginTop: 14 },
  offerText: { fontFamily: fonts.bold, fontSize: 11.5, color: colors.brand },

  tabs: { marginTop: 24, maxWidth: 420 },
  tabBody: { marginTop: 22 },
  paragraph: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, color: colors.ink, maxWidth: 640 },
  eyebrow: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2, marginTop: 24 },
  value: { fontFamily: fonts.regular, fontSize: 15, color: colors.ink, marginTop: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, maxWidth: 640 },
  outlineChip: { height: 32, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  outlineChipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink },

  rateList: { gap: 8, marginTop: 10, maxWidth: 520 },
  rateItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radii.sm, padding: 12, borderWidth: 1, borderColor: colors.hairline },
  rateTag: { height: 26, paddingHorizontal: 11, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  rateTagText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink },
  rateNote: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2 },
  rateItemRate: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] },
  rateItemUnit: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },

  availRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.hairline, maxWidth: 520 },
  availDay: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  availBands: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2 },
  availOff: { color: colors.ink3 },
  availNote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2, marginTop: 14, maxWidth: 520 },

  reviewCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, marginBottom: 12, maxWidth: 640, ...shadow.e1 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewWho: { gap: 2 },
  reviewName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  reviewText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink, marginTop: 10 },

  // booking card
  bookCard: { backgroundColor: colors.surface, borderRadius: 24, padding: 20, ...shadow.e2 },
  rateBlock: { marginBottom: 16 },
  rateFrom: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.3, color: colors.ink3 },
  rateBig: { fontFamily: fonts.bold, fontSize: 36, lineHeight: 38, letterSpacing: -1.2, color: colors.ink, fontVariant: ['tabular-nums'], marginTop: 2 },
  ratePer: { fontFamily: fonts.regular, fontSize: 15, letterSpacing: 0, color: colors.ink2 },
  bookBtn: { height: 52 },
  messageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.surface, marginTop: 10 },
  messageText: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: -0.2, color: colors.ink },

  slotsBlock: { gap: 10 },
  slotsHeading: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink3 },
  slotsEmpty: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink2 },
  slotList: { gap: 8 },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    height: 46,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  slotRowSel: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  slotText: { flex: 1, minWidth: 0, fontFamily: fonts.medium, fontSize: 13, color: colors.ink },
  slotTextSel: { fontFamily: fonts.semibold },
  bookError: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.danger },

  credList: { gap: 10, marginTop: 12 },
  credRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  credText: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },

  facts: { marginTop: 18, gap: 14 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  factIcon: { width: 34, height: 34, borderRadius: radii.pill, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  factLabel: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.3, textTransform: 'uppercase', color: colors.ink3 },
  factValue: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.ink, marginTop: 1 },

  safeNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 18, padding: 12, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  safeNoteText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink },
});
