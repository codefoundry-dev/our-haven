/**
 * Preview questionnaire (design: screens/preview-questionnaire.jsx) — the
 * ephemeral, Parent-only sign-up survey that shapes the first browse session
 * (PRD-0001 story 111, ADR-0012).
 *
 * Three steps — child's age band · neurotypical/neurodivergent · optional focus
 * areas — each with a privacy reassurance ("on-device only · not visible to any
 * Provider · not saved to a Child profile"). Answers are committed to the
 * in-memory PreviewProvider and then evaporate with the session; nothing is
 * persisted server-side. "Skip" or finishing both land the Parent on Home, where
 * the answers re-order the browse.
 *
 * Reached once after Parent role-claim (the auth gate redirects a just-claimed
 * Parent here), or again later via the Home "Adjust" affordance (`?adjust=1`,
 * which shows a real Back button on step 1 instead of leaving).
 */
import { useRouter, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { usePreview } from '@/preview/PreviewProvider';
import {
  AGE_BANDS,
  FOCUS_AREAS,
  PROFILE_TILES,
  type AgeBand,
  type FocusArea,
  type PreviewProfile,
} from '@/preview/questionnaire';
import { colors, fonts, maxContentWidth, radii, shadow } from '@/theme/tokens';

const HOME = '/(app)/home' as Href;

export default function PreviewQuestionnaire() {
  const router = useRouter();
  const { commit } = usePreview();
  const { adjust } = useLocalSearchParams<{ adjust?: string }>();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [age, setAge] = useState<AgeBand | null>(null);
  const [profile, setProfile] = useState<PreviewProfile | null>(null);
  const [focus, setFocus] = useState<FocusArea[]>([]);

  const leave = () => router.replace(HOME);

  const skip = () => {
    commit(null); // explicit "show me everything" — no shaping
    leave();
  };

  const finish = () => {
    commit({ age, profile, focus });
    leave();
  };

  const back = () => {
    if (step > 1) {
      setStep((s) => (s - 1) as 1 | 2 | 3);
    } else if (adjust) {
      router.back();
    }
  };

  const toggleFocus = (id: FocusArea) =>
    setFocus((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));

  // Step 1's back chevron only makes sense when there's somewhere to return to
  // (re-opened from Home). On first run it would point at role-claim, so we hide it.
  const showBack = step > 1 || !!adjust;
  const footerPad = Math.max(insets.bottom, 20);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.col}>
        {/* Header — back · progress dots · skip */}
        <View style={styles.header}>
          {showBack ? (
            <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={styles.headerBtn}>
              <Icon name="chevron-left" size={22} color={colors.ink} />
            </Pressable>
          ) : (
            <View style={styles.headerBtn} />
          )}

          <View style={styles.progress}>
            <View style={styles.dots}>
              {[1, 2, 3].map((i) => (
                <View
                  key={i}
                  style={[styles.dot, i <= step ? styles.dotOn : styles.dotOff]}
                />
              ))}
            </View>
            <Text style={styles.stepLabel}>Step {step} of 3</Text>
          </View>

          <Pressable onPress={skip} hitSlop={10} accessibilityRole="button" style={styles.skip}>
            <Text style={styles.skipText}>Skip — show me everything</Text>
          </Pressable>
        </View>

        {/* Body */}
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          {step === 1 && (
            <>
              <Text style={styles.h1}>How old is your child?</Text>
              <Text style={styles.lede}>
                We use this to shape what you see first. Your answers stay on this device and aren&apos;t
                saved to your account.
              </Text>
              <View style={styles.ageGrid}>
                {AGE_BANDS.map((band) => {
                  const on = age === band.id;
                  return (
                    <Pressable
                      key={band.id}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={band.label}
                      onPress={() => setAge(band.id)}
                      style={[styles.ageTile, band.wide && styles.ageTileWide, on ? styles.tileOn : styles.tileOff]}
                    >
                      <Text style={styles.ageLabel}>{band.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <PrivacyNote />
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.h1}>Tell us a bit about your child.</Text>
              <Text style={styles.lede}>
                We use this to surface the right Providers first. This isn&apos;t saved to your account or
                shared with any Provider.
              </Text>
              <View style={styles.tiles}>
                {PROFILE_TILES.map((t) => {
                  const on = profile === t.id;
                  return (
                    <Pressable
                      key={t.id}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={t.title}
                      onPress={() => setProfile(t.id)}
                      style={[styles.profileTile, on ? styles.tileOn : styles.profileTileOff]}
                    >
                      <Text style={styles.profileTitle}>{t.title}</Text>
                      <Text style={[styles.profileSub, on && styles.profileSubOn]}>{t.sub}</Text>
                      {on ? (
                        <View style={styles.profileCheck}>
                          <Icon name="check-circle" size={24} color={colors.brand} strokeWidth={1.8} />
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
              <PrivacyNote />
            </>
          )}

          {step === 3 && (
            <>
              <Text style={styles.h1}>Any specific focus areas?</Text>
              <Text style={styles.lede}>Optional — tap any that apply, or skip if you&apos;d rather just browse.</Text>
              <View style={styles.chips}>
                {FOCUS_AREAS.map((f) => {
                  const on = focus.includes(f.id);
                  return (
                    <Pressable
                      key={f.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={f.label}
                      onPress={() => toggleFocus(f.id)}
                      style={[styles.chip, on ? styles.chipOn : styles.chipOff]}
                    >
                      {on ? <Icon name="check" size={12} color={colors.inkInv} /> : null}
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.privacyCard}>
                <Icon name="lock" size={16} color={colors.ink2} />
                <Text style={styles.privacyCardText}>
                  These choices stay on this device. They aren&apos;t saved to a Child profile, and they
                  aren&apos;t visible to any Provider.
                </Text>
              </View>
            </>
          )}
        </ScrollView>

        {/* Footer CTA */}
        <View style={[styles.footer, { paddingBottom: footerPad }]}>
          {step === 1 ? (
            <PrimaryButton
              onPress={() => setStep(2)}
              icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
            >
              Continue
            </PrimaryButton>
          ) : (
            <View style={styles.footerRow}>
              <Pressable onPress={back} accessibilityRole="button" style={styles.ghostBtn}>
                <Text style={styles.ghostText}>Back</Text>
              </Pressable>
              <PrimaryButton
                onPress={step === 2 ? () => setStep(3) : finish}
                icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
                style={styles.primaryWide}
              >
                {step === 2 ? 'Continue' : 'See my matches'}
              </PrimaryButton>
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

function PrivacyNote() {
  return (
    <View style={styles.privacyNote}>
      <Icon name="lock" size={14} color={colors.ink3} />
      <Text style={styles.privacyNoteText}>
        On-device only · not visible to any Provider · not saved to a Child profile.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  col: { flex: 1, width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
  fill: { flex: 1, width: '100%' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 4,
  },
  headerBtn: { width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  progress: { alignItems: 'center', gap: 6 },
  dots: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: radii.pill },
  dotOn: { backgroundColor: colors.brand },
  dotOff: { borderWidth: 1.5, borderColor: colors.ink3 },
  stepLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.ink2,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  skip: { width: 72, alignItems: 'flex-end' },
  skipText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 14, color: colors.ink2, textAlign: 'right' },

  body: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 28 },
  h1: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, color: colors.ink },
  lede: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, marginTop: 12 },

  // Step 1 — age grid
  ageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 26 },
  ageTile: {
    width: '47%',
    flexGrow: 1,
    height: 56,
    borderRadius: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ageTileWide: { width: '100%' },
  ageLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, textAlign: 'center' },

  tileOn: { backgroundColor: colors.brandSoft, borderWidth: 1.5, borderColor: colors.brand },
  tileOff: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: 'transparent' },

  // Step 2 — profile tiles
  tiles: { gap: 12, marginTop: 24 },
  profileTile: { borderRadius: 24, paddingVertical: 16, paddingHorizontal: 18 },
  profileTileOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  profileTitle: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.2, color: colors.ink },
  profileSub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink2, marginTop: 4 },
  profileSubOn: { paddingRight: 32 },
  profileCheck: { position: 'absolute', top: 16, right: 16 },

  // Step 3 — focus chips
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 24 },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipOn: { backgroundColor: colors.brand },
  chipOff: { backgroundColor: colors.surfaceAlt },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  chipTextOn: { color: colors.inkInv },

  // Privacy reassurance
  privacyNote: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 22 },
  privacyNoteText: { flex: 1, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.ink3 },
  privacyCard: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    marginTop: 26,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  privacyCardText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2 },

  // Footer
  footer: {
    paddingHorizontal: 24,
    paddingTop: 14,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    ...shadow.e2,
  },
  footerRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  ghostBtn: { flex: 1, height: 56, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink2 },
  primaryWide: { flex: 1.6 },
});
