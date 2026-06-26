/**
 * Caregiver onboarding (WEB) — the step-by-step wizard from the Claude Design
 * cp-web `cp-onboarding.jsx`. Web is the system of record for heavy supply
 * onboarding (ID, documents, Checkr, Stripe Connect all run better in a browser),
 * so after a Caregiver claims their role the auth gate routes them here.
 *
 * Shape (mirrors mobile §5.1.13):
 *   Hub · 9-step progress  →  1 Category · 2 Profile basics · 3 Published Rates ·
 *   4 Government ID · 5 Background check · 6 Credentials · 7 Phone (optional) ·
 *   8 Agreements · 9 Bank & payouts
 *
 * The hub is the entry overview; each row enters the wizard at that step. Inside
 * the wizard the `WizardShell` chrome (CAREGIVER SETUP rail + sticky Back/Continue
 * footer) wraps each step body, which is wired to the real profile/verification
 * APIs (getCaregiverProfile/patchCaregiverProfile, getVerification + IdDocUpload /
 * PhoneVerify, addCaregiverCredential, Stripe Connect onboarding-link). Steps with
 * no own data field (Category, Background check, Agreements) advance the flow.
 *
 * Providers keep the lighter checklist hub that deep-links to verification /
 * provider-profile — the design wizard above is Caregiver-specific. Metro resolves
 * this `.web.tsx` over onboarding.tsx on web.
 */
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import {
  addCaregiverCredential,
  ApiError,
  createConnectOnboardingLink,
  getCaregiverProfile,
  getVerification,
  patchCaregiverProfile,
  type CaregiverCredential,
  type CaregiverProfile,
  type CaregiverProfilePatch,
  type Verification,
} from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { AvatarUpload } from '@/components/AvatarUpload';
import { Icon, type IconName } from '@/components/Icon';
import {
  CAREGIVER_WIZARD_STEPS,
  InfoNote,
  SecHead,
  WizChip,
  WizField,
  WizardShell,
  WizTextArea,
  WizToggle,
} from '@/components/onboarding/WizardChrome';
import { IdDocUpload } from '@/components/verification/IdDocUpload';
import { PhoneVerify } from '@/components/verification/PhoneVerify';
import {
  firstActionableStep,
  onboardingProgress,
  onboardingSteps,
  type OnboardingDest,
  type OnboardingStep,
  type OnboardingStatus,
} from '@/lib/onboarding';
import {
  AGE_BAND_OPTIONS,
  BEHAVIOUR_OPTIONS,
  CATEGORY_LABELS,
  centsToDollars,
  CREDENTIAL_TYPE_OPTIONS,
  dollarsToCents,
  isSurchargeCategory,
  LANGUAGE_OPTIONS,
  SPECIALTY_OPTIONS,
  tagChips,
  type AgeBand,
  type CredentialType,
  type SafetyBehavior,
} from '@/lib/profile';
import { landingTab } from '@/lib/roles';
import { CATEGORY_OPTIONS, type Category } from '@/lib/supply';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const WIDE = 920;

/** RN-web honors the web `background-image` shorthand; TS's ViewStyle does not list it. */
const brandGradient: ViewStyle = {
  backgroundImage: `linear-gradient(165deg, ${colors.catSpec} 0%, ${colors.catBaby} 100%)`,
} as unknown as ViewStyle;

function humanize(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'Set EXPO_PUBLIC_API_URL in apps/mobile/.env to reach the backend.';
    if (e.status === 404) return 'Finish choosing your role before setting up.';
    return e.message;
  }
  return 'Could not load your setup status.';
}

function messageOf(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return 'Something went wrong. Please try again.';
}

// ════════════════════════════════════════════════════════════════════════
// Controller — loads data + branches Caregiver wizard vs Provider hub
// ════════════════════════════════════════════════════════════════════════

export default function OnboardingScreen() {
  const router = useRouter();
  const { session, role } = useAuth();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;

  const isProvider = role === 'provider';

  const [verification, setVerification] = useState<Verification | null>(null);
  const [profile, setProfile] = useState<CaregiverProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [v, p] = await Promise.all([
        getVerification(),
        isProvider ? Promise.resolve(null) : getCaregiverProfile(),
      ]);
      setVerification(v);
      setProfile(p);
    } catch (e) {
      setError(humanize(e));
    } finally {
      setLoading(false);
    }
  }, [isProvider]);

  useEffect(() => {
    load();
  }, [load]);

  const email = session?.user?.email ?? null;
  const goDashboard = () => router.replace(`/(app)/${landingTab(role ?? 'caregiver')}` as Href);

  if (loading && !verification) {
    return (
      <View style={[styles.root, styles.centerRoot]}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (error && !verification) {
    return (
      <View style={[styles.root, styles.centerRoot]}>
        <Text style={styles.error}>{error}</Text>
        <Pressable onPress={load} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
        <Pressable onPress={goDashboard} hitSlop={8}>
          <Text style={styles.skip}>Skip to dashboard</Text>
        </Pressable>
      </View>
    );
  }

  if (!verification) return null;

  if (isProvider) {
    return <ProviderHub verification={verification} email={email} wide={wide} onDashboard={goDashboard} />;
  }

  if (!profile) return null;

  return (
    <CaregiverWizard
      verification={verification}
      setVerification={setVerification}
      profile={profile}
      setProfile={setProfile}
      email={email}
      wide={wide}
      onDashboard={goDashboard}
    />
  );
}

// ════════════════════════════════════════════════════════════════════════
// Caregiver wizard
// ════════════════════════════════════════════════════════════════════════

type WizardView = 'hub' | number;

interface RateInput {
  rate: string;
  surcharge: string;
}

interface WizForm {
  firstName: string;
  lastName: string;
  zip: string;
  yearsExperience: string;
  bio: string;
  languages: string[];
  specialties: string[];
  agesServed: AgeBand[];
  behaviourComfort: SafetyBehavior[];
  rates: Record<string, RateInput>;
  negotiable: boolean;
}

const BIO_MAX = 500;

function splitName(displayName: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function profileToForm(p: CaregiverProfile): WizForm {
  const { firstName, lastName } = splitName(p.displayName);
  const rates: Record<string, RateInput> = {};
  for (const cat of p.categories) {
    const found = p.categoryRates.find((r) => r.category === cat);
    rates[cat] = {
      rate: centsToDollars(found?.publishedRateCents ?? null),
      surcharge: centsToDollars(found?.perChildSurchargeCents ?? null),
    };
  }
  return {
    firstName,
    lastName,
    zip: p.zip ?? '',
    yearsExperience: p.yearsExperience == null ? '' : String(p.yearsExperience),
    bio: p.bio ?? '',
    languages: [...p.languages],
    specialties: [...p.specialties],
    agesServed: [...p.agesServed],
    behaviourComfort: [...p.behaviourComfort],
    rates,
    negotiable: p.negotiable,
  };
}

function buildPatch(p: CaregiverProfile, form: WizForm): CaregiverProfilePatch {
  const categoryRates = p.categories.flatMap((cat) => {
    const entry = form.rates[cat];
    const rateCents = dollarsToCents(entry?.rate ?? '');
    if (rateCents === null) return [];
    const surcharge = isSurchargeCategory(cat) ? dollarsToCents(entry?.surcharge ?? '') : null;
    return [{ category: cat, publishedRateCents: rateCents, perChildSurchargeCents: surcharge }];
  });
  const displayName = `${form.firstName} ${form.lastName}`.trim();
  const patch: CaregiverProfilePatch = {
    displayName: displayName === '' ? null : displayName,
    headline: p.headline ?? null,
    bio: form.bio.trim() === '' ? null : form.bio.trim(),
    languages: form.languages,
    specialties: form.specialties,
    categoryRates,
    availabilityGrid: p.availabilityGrid ?? {},
    availabilityNote: p.availabilityNote ?? null,
    paused: p.paused,
    negotiable: form.negotiable,
    agesServed: form.agesServed,
    behaviourComfort: form.behaviourComfort,
  };
  // ZIP / years are only sent when valid-or-cleared; a partial entry (e.g. 3
  // digits) is left out so the save never trips the server's format check.
  const zip = form.zip.trim();
  if (zip === '') patch.zip = null;
  else if (/^\d{5}$/.test(zip)) patch.zip = zip;
  const yrs = form.yearsExperience.trim();
  if (yrs === '') patch.yearsExperience = null;
  else {
    const n = Number.parseInt(yrs, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 75) patch.yearsExperience = n;
  }
  return patch;
}

interface WizardProps {
  verification: Verification;
  setVerification: (v: Verification) => void;
  profile: CaregiverProfile;
  setProfile: (p: CaregiverProfile) => void;
  email: string | null;
  wide: boolean;
  onDashboard: () => void;
}

function CaregiverWizard({ verification, setVerification, profile, setProfile, email, wide, onDashboard }: WizardProps) {
  const [view, setView] = useState<WizardView>('hub');
  const [form, setForm] = useState<WizForm>(() => profileToForm(profile));
  const [saving, setSaving] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  const f = verification.facts;
  const has = (v: string | null | undefined) => v != null && v !== '';

  const patch = (next: Partial<WizForm>) => setForm((cur) => ({ ...cur, ...next }));

  const rows = hubRows(profile, form, f, accepted.size === AGREEMENTS.length);
  const doneCount = rows.filter((r) => r.state === 'done').length;
  const pct = Math.round((doneCount / rows.length) * 100);
  const firstUnfinished = rows.find((r) => r.state !== 'done')?.n ?? 9;

  const enter = (n: number) => {
    setStepError(null);
    setView(n);
  };
  const back = () => {
    setStepError(null);
    setView((v) => (typeof v === 'number' ? (v <= 1 ? 'hub' : v - 1) : 'hub'));
  };
  const advance = (n: number) => {
    setStepError(null);
    setView(n);
  };

  /** Persist the editable profile (steps 2 & 3) then advance. */
  const saveAndAdvance = async (n: number) => {
    setSaving(true);
    setStepError(null);
    try {
      const updated = await patchCaregiverProfile(buildPatch(profile, form));
      setProfile(updated);
      setForm(profileToForm(updated));
      advance(n);
    } catch (e) {
      setStepError(messageOf(e));
    } finally {
      setSaving(false);
    }
  };

  // ── Hub ──
  if (view === 'hub') {
    return (
      <HubShell panel={CAREGIVER_PANEL} email={email} wide={wide}>
        <View style={styles.hubHead}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.hubTitle}>Your setup</Text>
            <Text style={styles.hubSub}>
              {doneCount} of {rows.length} complete
              {rows.some((r) => r.state === 'active') ? ' · 1 in progress' : ''}
            </Text>
          </View>
          <View style={styles.pctCircle}>
            <Text style={styles.pctText}>{pct}%</Text>
          </View>
        </View>

        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>

        <View style={styles.hubRows}>
          {rows.map((r) => (
            <HubRow key={r.n} row={r} onPress={() => enter(r.n)} />
          ))}
        </View>

        <Pressable onPress={doneCount === rows.length ? onDashboard : () => enter(firstUnfinished)} style={styles.hubCta}>
          <Text style={styles.hubCtaText}>
            {doneCount === rows.length ? 'Go to dashboard' : `Continue setup · ${CAREGIVER_WIZARD_STEPS[firstUnfinished - 1]}`}
          </Text>
          <Icon name="arrow-right" size={16} color={colors.inkInv} />
        </Pressable>

        <Pressable onPress={onDashboard} hitSlop={8} style={styles.hubSkip}>
          <Text style={styles.skip}>Skip for now — go to dashboard →</Text>
        </Pressable>
      </HubShell>
    );
  }

  // ── Steps ──
  const step = view;
  const stepErrorNode = stepError ? <Text style={styles.stepError}>{stepError}</Text> : null;

  switch (step) {
    // 1 · Category ----------------------------------------------------------
    case 1:
      return (
        <WizardShell
          step={1}
          wide={wide}
          eyebrow="Categories"
          title="What kinds of care do you offer?"
          subtitle="You chose these at sign-up — one account, one background check, covers every service. You set a rate per category next."
          cta="Continue · Profile"
          onContinue={() => advance(2)}
          onBack={back}
          footnote="Each booking is for one category at a time. Your rating and verification are shared across all of them."
        >
          <View style={styles.tileGrid}>
            {CATEGORY_OPTIONS.map((c) => (
              <CategoryTile key={c.value} option={c} selected={profile.categories.includes(c.value)} />
            ))}
          </View>
          <View style={{ marginTop: 22 }}>
            <InfoNote>
              <Text style={styles.noteStrong}>{profile.categories.length} selected.</Text> A Parent books you in one
              category at a time — you set the rate, availability and any per-extra-child surcharge per category in the
              next steps.
            </InfoNote>
          </View>
        </WizardShell>
      );

    // 2 · Profile basics ----------------------------------------------------
    case 2: {
      const initials =
        `${form.firstName} ${form.lastName}`
          .trim()
          .split(/\s+/)
          .map((w) => w[0])
          .filter(Boolean)
          .slice(0, 2)
          .join('')
          .toUpperCase() || 'YN';
      return (
        <WizardShell
          step={2}
          wide={wide}
          eyebrow="Profile basics"
          title="Tell Parents who you are."
          subtitle="A clear name and a warm bio raise your reply rate. This is the public face Parents see in search."
          cta="Continue · Rate"
          busy={saving}
          savedLabel={saving ? 'Saving…' : 'Saved to draft'}
          onContinue={() => saveAndAdvance(3)}
          onBack={back}
        >
          <AvatarUpload photoUrl={profile.photoUrl} initials={initials} onUploaded={setProfile} />

          <View style={styles.fieldRow}>
            <WizField label="First name" value={form.firstName} onChangeText={(v) => patch({ firstName: v })} placeholder="Maya" autoCapitalize="words" />
            <WizField label="Last name" value={form.lastName} onChangeText={(v) => patch({ lastName: v })} placeholder="Okafor" autoCapitalize="words" />
          </View>
          <View style={styles.fieldRow}>
            <WizField
              label="ZIP"
              value={form.zip}
              onChangeText={(v) => patch({ zip: v.replace(/\D/g, '').slice(0, 5) })}
              placeholder="90210"
              keyboardType="number-pad"
              mono
              helper="5-digit US ZIP — used for search proximity."
            />
            <WizField
              label="Years of experience"
              value={form.yearsExperience}
              onChangeText={(v) => patch({ yearsExperience: v.replace(/\D/g, '').slice(0, 2) })}
              placeholder="4"
              keyboardType="number-pad"
              suffix="yrs"
            />
          </View>

          <View style={styles.bioHead}>
            <SecHead>Bio</SecHead>
            <Text style={styles.counter}>{form.bio.length} / {BIO_MAX}</Text>
          </View>
          <WizTextArea
            value={form.bio}
            onChangeText={(v) => patch({ bio: v })}
            maxLength={BIO_MAX}
            placeholder="How you work — experience, ages you love, your approach."
          />

          <SecHead style={styles.sectionGap}>Specialties</SecHead>
          <View style={styles.chipWrap}>
            {tagChips(SPECIALTY_OPTIONS, form.specialties).map((t) => (
              <WizChip
                key={t}
                label={t}
                on={form.specialties.includes(t)}
                onPress={() => patch({ specialties: toggle(form.specialties, t) })}
              />
            ))}
          </View>

          <SecHead style={styles.sectionGapSm}>Languages</SecHead>
          <View style={[styles.chipWrap, { marginTop: 12 }]}>
            {tagChips(LANGUAGE_OPTIONS, form.languages).map((t) => (
              <WizChip
                key={t}
                label={t}
                on={form.languages.includes(t)}
                onPress={() => patch({ languages: toggle(form.languages, t) })}
              />
            ))}
          </View>

          <SecHead style={styles.sectionGap}>Ages you work with</SecHead>
          <View style={styles.chipWrap}>
            {AGE_BAND_OPTIONS.map((o) => (
              <WizChip
                key={o.value}
                label={o.label}
                on={form.agesServed.includes(o.value)}
                onPress={() => patch({ agesServed: toggle(form.agesServed, o.value) })}
              />
            ))}
          </View>

          <SecHead style={styles.sectionGapSm}>Comfortable supporting</SecHead>
          <Text style={styles.sectionBlurb}>
            Parents disclose a child’s safety behaviours on their Job — declaring what you’re comfortable with helps you
            self-select the right fit.
          </Text>
          <View style={styles.chipWrap}>
            {BEHAVIOUR_OPTIONS.map((o) => (
              <WizChip
                key={o.value}
                label={o.label}
                on={form.behaviourComfort.includes(o.value)}
                onPress={() => patch({ behaviourComfort: toggle(form.behaviourComfort, o.value) })}
              />
            ))}
          </View>
          {stepErrorNode}
        </WizardShell>
      );
    }

    // 3 · Published Rates ---------------------------------------------------
    case 3:
      return (
        <RateStep
          profile={profile}
          form={form}
          patch={patch}
          wide={wide}
          saving={saving}
          stepError={stepError}
          onContinue={() => saveAndAdvance(4)}
          onBack={back}
        />
      );

    // 4 · Government ID -----------------------------------------------------
    case 4: {
      const uploaded = has(f.idDocUploadedAt);
      return (
        <WizardShell
          step={4}
          wide={wide}
          eyebrow="Identity"
          title="Verify your government ID."
          subtitle="We use bank-grade identity verification. Your ID is reviewed by Trust & Safety and is never shown to Parents."
          cta="Continue · Background check"
          ctaDisabled={!uploaded}
          onContinue={() => advance(5)}
          onBack={back}
        >
          {uploaded ? (
            <View style={styles.successCard}>
              <Icon name="check-circle" size={22} color={colors.success} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.successTitle}>ID received — under review</Text>
                <Text style={styles.successSub}>Thanks. Our team checks this within a day. You can continue.</Text>
              </View>
            </View>
          ) : (
            <View style={styles.idTile}>
              <View style={styles.idTileNum}>
                <Text style={styles.idTileNumText}>1</Text>
              </View>
              <View style={styles.idDashed}>
                <Text style={styles.idDashedText}>Photo ID · front or passport</Text>
              </View>
              <View>
                <Text style={styles.idTileLabel}>Upload your ID</Text>
                <Text style={styles.idTileSub}>A driver’s licence, state ID, or passport — image or PDF.</Text>
                <View style={{ marginTop: 14 }}>
                  <IdDocUpload onUploaded={setVerification} />
                </View>
              </View>
            </View>
          )}
          <View style={{ marginTop: 18 }}>
            <InfoNote icon="lock">
              Your ID is reviewed by a Trust &amp; Safety team member, encrypted at rest, and never visible to Parents.
            </InfoNote>
          </View>
        </WizardShell>
      );
    }

    // 5 · Background check ---------------------------------------------------
    case 5: {
      const passed = has(f.screeningPassedAt);
      const running = has(f.screeningInitiatedAt);
      const pill = passed
        ? { label: 'Cleared', bg: 'rgba(47,122,77,0.14)', fg: colors.success }
        : running
          ? { label: 'In progress', bg: 'rgba(201,122,42,0.14)', fg: colors.warning }
          : { label: 'Ready to start', bg: 'rgba(58,111,168,0.12)', fg: colors.info };
      return (
        <WizardShell
          step={5}
          wide={wide}
          eyebrow="Background check"
          title="Run a Checkr background check."
          subtitle="Checkr collects your details directly and runs a standard screening. It begins after your ID is reviewed."
          cta="Continue · Credentials"
          onContinue={() => advance(6)}
          onBack={back}
        >
          <View style={styles.checkrCard}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={[styles.statusPill, { backgroundColor: pill.bg }]}>
                <View style={[styles.statusDot, { backgroundColor: pill.fg }]} />
                <Text style={[styles.statusPillText, { color: pill.fg }]}>{pill.label}</Text>
              </View>
              <Text style={styles.checkrTitle}>Checkr · Standard package</Text>
              <Text style={styles.checkrSub}>Criminal records, sex-offender registry, SSN trace.</Text>
            </View>
            <Text style={styles.checkrMeta}>~10 min</Text>
          </View>

          <SecHead style={styles.sectionGap}>What we screen</SecHead>
          <View style={styles.screenGrid}>
            {SCREEN_ITEMS.map((it) => (
              <View key={it.t} style={styles.screenItem}>
                <Icon name="check-circle" size={22} color={colors.success} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.screenItemTitle}>{it.t}</Text>
                  <Text style={styles.screenItemSub}>{it.s}</Text>
                </View>
              </View>
            ))}
          </View>
          <View style={{ marginTop: 18 }}>
            <InfoNote>
              You’ll be guided through Checkr’s secure flow. When it finishes, your status updates here automatically.
            </InfoNote>
          </View>
        </WizardShell>
      );
    }

    // 6 · Credentials --------------------------------------------------------
    case 6:
      return (
        <CredentialsStep
          profile={profile}
          setProfile={setProfile}
          wide={wide}
          onContinue={() => advance(7)}
          onSkip={() => advance(7)}
          onBack={back}
        />
      );

    // 7 · Phone (optional) ---------------------------------------------------
    case 7: {
      const verified = has(f.phoneConfirmedAt);
      return (
        <WizardShell
          step={7}
          wide={wide}
          eyebrow="Phone · optional"
          title="Add a phone number?"
          subtitle="Optional for Caregivers. Adding one speeds up booking confirmations and lets families reach you faster on the day."
          cta="Continue · Agreements"
          secondary={verified ? undefined : 'Skip for now'}
          onSecondary={() => advance(8)}
          onContinue={() => advance(8)}
          onBack={back}
        >
          {verified ? (
            <View style={styles.successCard}>
              <Icon name="check-circle" size={22} color={colors.success} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.successTitle}>Phone verified</Text>
                <Text style={styles.successSub}>Booking alerts will be texted to your number.</Text>
              </View>
            </View>
          ) : (
            <View style={styles.phoneRow}>
              <View style={styles.phoneCard}>
                <PhoneVerify onVerified={setVerification} />
              </View>
              <View style={styles.phoneBenefits}>
                {PHONE_BENEFITS.map((it) => (
                  <View key={it.t} style={styles.benefitItem}>
                    <View style={styles.benefitIcon}>
                      <Icon name={it.icon} size={17} color={colors.ink} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.benefitTitle}>{it.t}</Text>
                      <Text style={styles.benefitSub}>{it.s}</Text>
                    </View>
                  </View>
                ))}
                <InfoNote icon="lock">
                  Your number is never shown to Parents — in-app messaging stays the default channel.
                </InfoNote>
              </View>
            </View>
          )}
        </WizardShell>
      );
    }

    // 8 · Agreements ---------------------------------------------------------
    case 8: {
      const allAccepted = accepted.size === AGREEMENTS.length;
      const toggleAgreement = (key: string) => {
        setAccepted((cur) => {
          const next = new Set(cur);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
      };
      return (
        <WizardShell
          step={8}
          wide={wide}
          eyebrow="Agreements"
          title="Review and accept."
          subtitle="A few agreements keep families safe and set out how bookings, payouts and screening work. Read each, then continue."
          cta="Continue · Bank"
          ctaDisabled={!allAccepted}
          onContinue={() => advance(9)}
          onBack={back}
        >
          <View style={{ gap: 12 }}>
            {AGREEMENTS.map((a) => (
              <AgreementRow key={a.key} agreement={a} checked={accepted.has(a.key)} onToggle={() => toggleAgreement(a.key)} />
            ))}
          </View>
          <View style={{ marginTop: 18 }}>
            <InfoNote icon="shield">
              Background-check consent is required by the FCRA before we can run Checkr. You can withdraw consent by
              contacting support, which will pause your account.
            </InfoNote>
          </View>
        </WizardShell>
      );
    }

    // 9 · Bank & payouts -----------------------------------------------------
    case 9: {
      const ready = has(f.connectAccountReadyAt);
      const openStripe = async () => {
        setSaving(true);
        setStepError(null);
        try {
          const { url } = await createConnectOnboardingLink();
          if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
        } catch (e) {
          setStepError(messageOf(e));
        } finally {
          setSaving(false);
        }
      };
      return (
        <WizardShell
          step={9}
          wide={wide}
          eyebrow="Get paid"
          title="Connect a bank for payouts."
          subtitle="Stripe collects your banking and tax info directly — we never store it. This is the last step."
          cta={ready ? 'Go to dashboard' : 'Continue to Stripe'}
          busy={saving}
          secondary={ready ? undefined : 'I’ll do this later'}
          onSecondary={onDashboard}
          onContinue={ready ? onDashboard : openStripe}
          onBack={back}
        >
          {ready ? (
            <View style={styles.successCard}>
              <Icon name="check-circle" size={22} color={colors.success} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.successTitle}>Payouts enabled</Text>
                <Text style={styles.successSub}>You’re all set — your earnings will land in your connected account.</Text>
              </View>
            </View>
          ) : (
            <>
              <View style={[styles.payoutHero, brandGradientDark]}>
                <Text style={styles.payoutKicker}>Payout schedule</Text>
                <Text style={styles.payoutHeroTitle}>Same-day payouts</Text>
                <Text style={styles.payoutHeroSub}>
                  Once a session’s ~24h review window closes with no dispute, your payout fires same-day (Stripe Instant
                  Payout / same-day ACH).
                </Text>
              </View>

              <SecHead style={styles.sectionGap}>Stripe will ask for</SecHead>
              <View style={{ gap: 10 }}>
                {STRIPE_ASKS.map((it) => (
                  <View key={it.t} style={styles.askItem}>
                    <View style={styles.benefitIcon}>
                      <Icon name={it.icon} size={17} color={colors.ink} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.benefitTitle}>{it.t}</Text>
                      <Text style={styles.benefitSub}>{it.s}</Text>
                    </View>
                  </View>
                ))}
              </View>
              {stepErrorNode}
              <View style={{ marginTop: 18 }}>
                <InfoNote icon="lock">
                  You’ll continue in Stripe’s secure flow in a new tab. Payout setup unlocks once your background check
                  has cleared; come back here and refresh when you’re done.
                </InfoNote>
              </View>
            </>
          )}
        </WizardShell>
      );
    }

    default:
      return null;
  }
}

/** Mutate-free toggle for a value in an array. */
function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

// ── Step 3 (rates) extracted so it can hold its own active-category state ──
function RateStep({
  profile,
  form,
  patch,
  wide,
  saving,
  stepError,
  onContinue,
  onBack,
}: {
  profile: CaregiverProfile;
  form: WizForm;
  patch: (next: Partial<WizForm>) => void;
  wide: boolean;
  saving: boolean;
  stepError: string | null;
  onContinue: () => void;
  onBack: () => void;
}) {
  const [activeCat, setActiveCat] = useState<Category>(profile.categories[0] ?? 'babysitter');
  const entry = form.rates[activeCat] ?? { rate: '', surcharge: '' };
  const numericRate = entry.rate.trim() === '' ? null : Number(entry.rate);

  const setRate = (raw: string) => patch({ rates: { ...form.rates, [activeCat]: { ...entry, rate: raw } } });
  const setSurcharge = (raw: string) => patch({ rates: { ...form.rates, [activeCat]: { ...entry, surcharge: raw } } });
  const bump = (delta: number) => {
    const base = numericRate ?? 24;
    const next = Math.min(120, Math.max(15, base + delta));
    setRate(String(next));
  };
  const fillPct = numericRate == null ? 0 : Math.min(100, Math.max(0, ((numericRate - 15) / (120 - 15)) * 100));

  return (
    <WizardShell
      step={3}
      wide={wide}
      eyebrow="Published Rates"
      title="Set a rate per category."
      subtitle="Each service you offer has its own guide price. Parents see these on your profile and in search filters."
      cta="Continue · ID"
      busy={saving}
      savedLabel={saving ? 'Saving…' : 'Saved to draft'}
      onContinue={onContinue}
      onBack={onBack}
    >
      {profile.categories.length > 1 ? (
        <View style={styles.catSwitch}>
          {profile.categories.map((cat) => (
            <WizChip key={cat} label={CATEGORY_LABELS[cat]} on={cat === activeCat} onPress={() => setActiveCat(cat)} />
          ))}
        </View>
      ) : null}

      <View style={styles.rateCard}>
        <Text style={styles.rateCardKicker}>{CATEGORY_LABELS[activeCat]} · per hour</Text>
        <View style={styles.rateBigRow}>
          <Text style={styles.rateBig}>{numericRate == null ? '$—' : `$${numericRate}`}</Text>
          <Text style={styles.rateBigUnit}>/hr</Text>
        </View>
        <View style={styles.stepperRow}>
          <Pressable onPress={() => bump(-1)} style={styles.stepBtn} accessibilityLabel="Lower rate">
            <Text style={styles.stepBtnText}>−</Text>
          </Pressable>
          <View style={styles.rateTrack}>
            <View style={[styles.rateTrackFill, { width: `${fillPct}%` }]} />
          </View>
          <Pressable onPress={() => bump(1)} style={styles.stepBtn} accessibilityLabel="Raise rate">
            <Text style={styles.stepBtnText}>+</Text>
          </Pressable>
        </View>
        <View style={styles.rateScale}>
          <Text style={styles.rateScaleText}>$15</Text>
          <Text style={styles.rateScaleText}>$120</Text>
        </View>
      </View>

      {isSurchargeCategory(activeCat) ? (
        <View style={{ marginTop: 16 }}>
          <WizField
            label="Per extra child (+ $/hr)"
            value={entry.surcharge}
            onChangeText={setSurcharge}
            placeholder="0.00"
            keyboardType="decimal-pad"
            suffix="/hr"
          />
        </View>
      ) : null}

      <View style={styles.negotiateCard}>
        <View style={styles.benefitIcon}>
          <Icon name="sparkle" size={17} color={colors.ink} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.benefitTitle}>Allow negotiation</Text>
          <Text style={styles.benefitSub}>On: Parents can send Offers and Counter your rate. Off: your published rate is fixed.</Text>
        </View>
        <WizToggle on={form.negotiable} onToggle={() => patch({ negotiable: !form.negotiable })} label="Allow negotiation" />
      </View>

      <View style={{ marginTop: 16 }}>
        <InfoNote icon="info">Set a competitive rate for each category — you can change it any time from your profile.</InfoNote>
      </View>
      {stepError ? <Text style={styles.stepError}>{stepError}</Text> : null}
    </WizardShell>
  );
}

// ── Step 6 (credentials) extracted to hold add-form state ──
function CredentialsStep({
  profile,
  setProfile,
  wide,
  onContinue,
  onSkip,
  onBack,
}: {
  profile: CaregiverProfile;
  setProfile: (p: CaregiverProfile) => void;
  wide: boolean;
  onContinue: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const [type, setType] = useState<CredentialType>('certification');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    const trimmed = label.trim();
    if (trimmed === '') return;
    setBusy(true);
    setErr(null);
    try {
      const { credential } = await addCaregiverCredential({ type, label: trimmed });
      setProfile({ ...profile, credentials: [...profile.credentials, credential] });
      setLabel('');
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <WizardShell
      step={6}
      wide={wide}
      eyebrow="Credentials"
      title="Add your credentials."
      subtitle="Certifications apply across every category you offer. Verified badges show on your profile and lift you in search."
      cta="Continue · Phone"
      secondary="Skip for now"
      onSecondary={onSkip}
      onContinue={onContinue}
      onBack={onBack}
    >
      <SecHead style={{ marginBottom: 12 }}>Your credentials</SecHead>
      {profile.credentials.length === 0 ? (
        <Text style={styles.credEmpty}>No credentials yet — optional, but they help you stand out.</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {profile.credentials.map((c) => (
            <CredentialCard key={c.id} credential={c} />
          ))}
        </View>
      )}

      <View style={styles.addCred}>
        <SecHead style={{ marginBottom: 10 }}>Add a credential</SecHead>
        <View style={styles.typeRow}>
          {CREDENTIAL_TYPE_OPTIONS.map((o) => (
            <WizChip key={o.value} label={o.label} on={o.value === type} onPress={() => setType(o.value)} />
          ))}
        </View>
        <View style={{ height: 12 }} />
        <View style={styles.addCredRow}>
          <WizField label="Credential" value={label} onChangeText={setLabel} placeholder="e.g. CPR / First Aid" autoCapitalize="words" />
          <Pressable
            onPress={add}
            disabled={busy || label.trim() === ''}
            style={[styles.addBtn, (busy || label.trim() === '') && styles.addBtnDisabled]}
          >
            <Icon name="plus" size={16} color={colors.ink} />
            <Text style={styles.addBtnText}>Add</Text>
          </Pressable>
        </View>
        {type === 'title' ? (
          <Text style={styles.credWarn}>
            Titles that read as a licensed clinical role (e.g. “Nurse”) may be rejected to keep the Caregiver/Provider
            line clear.
          </Text>
        ) : null}
        {err ? <Text style={styles.stepError}>{err}</Text> : null}
      </View>

      <View style={{ marginTop: 18 }}>
        <InfoNote icon="info">
          Optional, but Parents filtering for specific safety skills (allergy care, water safety) only see you if you’ve
          added the matching credential.
        </InfoNote>
      </View>
    </WizardShell>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Hub pieces
// ════════════════════════════════════════════════════════════════════════

interface HubRowData {
  n: number;
  label: string;
  sub: string;
  state: 'done' | 'active' | 'todo';
}

function hubRows(p: CaregiverProfile, form: WizForm, f: Verification['facts'], agreementsDone: boolean): HubRowData[] {
  const has = (v: string | null | undefined) => v != null && v !== '';
  const catLabels = p.categories.map((c) => CATEGORY_LABELS[c]).join(' · ') || 'Chosen at sign-up';
  const profileDone = (p.displayName ?? '').trim() !== '' && (p.bio ?? '').trim() !== '';
  const ratesDone = p.categories.length > 0 && p.categories.every((c) => (p.categoryRates.find((r) => r.category === c)?.publishedRateCents ?? null) !== null);
  const screening = has(f.screeningPassedAt) ? 'done' : has(f.screeningInitiatedAt) ? 'active' : 'todo';

  return [
    { n: 1, label: 'Categories', sub: catLabels, state: 'done' },
    { n: 2, label: 'Profile basics', sub: 'Photo, bio, ages & comfort', state: profileDone ? 'done' : 'todo' },
    { n: 3, label: 'Published Rates', sub: ratesDone ? rateSummary(p) : 'Set your hourly rate per category', state: ratesDone ? 'done' : 'todo' },
    { n: 4, label: 'Government ID', sub: has(f.idDocUploadedAt) ? 'Received — under review' : 'Verified via Stripe Identity', state: has(f.idDocUploadedAt) ? 'done' : 'todo' },
    { n: 5, label: 'Background check', sub: screening === 'active' ? 'Checkr · in progress' : screening === 'done' ? 'Cleared' : 'Checkr standard package', state: screening },
    { n: 6, label: 'Credentials', sub: p.credentials.length > 0 ? `${p.credentials.length} added` : 'CPR · CDA · optional', state: p.credentials.length > 0 ? 'done' : 'todo' },
    { n: 7, label: 'Phone (optional)', sub: has(f.phoneConfirmedAt) ? 'Verified' : 'Speeds up bookings', state: has(f.phoneConfirmedAt) ? 'done' : 'todo' },
    { n: 8, label: 'Agreements', sub: 'Caregiver terms + safety policy', state: agreementsDone ? 'done' : 'todo' },
    { n: 9, label: 'Bank & payouts', sub: has(f.connectAccountReadyAt) ? 'Payouts enabled' : 'Stripe Connect', state: has(f.connectAccountReadyAt) ? 'done' : 'todo' },
  ];
}

function rateSummary(p: CaregiverProfile): string {
  return p.categories
    .map((c) => {
      const cents = p.categoryRates.find((r) => r.category === c)?.publishedRateCents ?? null;
      return cents == null ? null : `${CATEGORY_LABELS[c]} $${Math.round(cents / 100)}`;
    })
    .filter(Boolean)
    .join(' · ') || 'Set per category';
}

function HubRow({ row, onPress }: { row: HubRowData; onPress: () => void }) {
  const done = row.state === 'done';
  const active = row.state === 'active';
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.row, active && styles.rowActive]}>
      <View style={[styles.rowNum, { backgroundColor: done ? colors.catSpec : active ? colors.highlight : colors.surfaceAlt }]}>
        {done ? <Icon name="check" size={15} color={colors.ink} /> : <Text style={styles.rowNumText}>{row.n}</Text>}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowLabel}>{row.label}</Text>
        <Text style={styles.rowSub}>{row.sub}</Text>
      </View>
      {done ? (
        <Text style={styles.rowDone}>Done</Text>
      ) : active ? (
        <View style={styles.rowProgress}>
          <View style={styles.rowProgressDot} />
          <Text style={styles.rowProgressText}>In progress</Text>
        </View>
      ) : (
        <Icon name="chevron-right" size={18} color={colors.ink3} />
      )}
    </Pressable>
  );
}

// ── Two-pane hub shell (gradient brand panel + scroll content) ──
interface PanelCopy {
  eyebrow: string;
  title: string;
  subtitle: string;
  bullets: { icon: IconName; label: string }[];
}

const CAREGIVER_PANEL: PanelCopy = {
  eyebrow: 'Caregiver onboarding',
  title: 'Let’s get you ready to earn.',
  subtitle: 'Nine quick steps — most caregivers finish in about 20 minutes. Your progress saves as you go.',
  bullets: [
    { icon: 'shield', label: 'Bank-grade identity + background checks' },
    { icon: 'dollar', label: 'Same-day payouts once verified' },
    { icon: 'lock', label: 'Your documents are never shown to Parents' },
  ],
};

const PROVIDER_PANEL: PanelCopy = {
  eyebrow: 'Provider onboarding',
  title: 'Set up your clinical practice.',
  subtitle: 'A few steps to go live — license and insurance verification work best here in a browser.',
  bullets: [
    { icon: 'shield', label: 'License + insurance verified before you go live' },
    { icon: 'briefcase', label: 'Consultation booking built for clinicians' },
    { icon: 'lock', label: 'Your credentials are never shown to Parents' },
  ],
};

function HubShell({
  panel,
  email,
  wide,
  children,
}: {
  panel: PanelCopy;
  email: string | null;
  wide: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.root}>
      {wide ? (
        <View style={[styles.brandPanel, brandGradient]}>
          <View style={styles.brandRow}>
            <View style={styles.logoMark}>
              <Text style={styles.logoMarkText}>oh</Text>
            </View>
            <Text style={styles.wordmark}>Our Haven</Text>
          </View>
          <View style={styles.brandBody}>
            <View style={styles.eyebrowChip}>
              <Text style={styles.eyebrowChipText}>{panel.eyebrow}</Text>
            </View>
            <Text style={styles.brandTitle}>{panel.title}</Text>
            <Text style={styles.brandSubtitle}>{panel.subtitle}</Text>
            <View style={styles.bullets}>
              {panel.bullets.map((b) => (
                <View key={b.label} style={styles.bulletRow}>
                  <View style={styles.bulletIcon}>
                    <Icon name={b.icon} size={17} color={colors.ink} />
                  </View>
                  <Text style={styles.bulletLabel}>{b.label}</Text>
                </View>
              ))}
            </View>
          </View>
          {email ? <Text style={styles.signedIn}>Signed in as {email}</Text> : <View />}
        </View>
      ) : null}

      <ScrollView style={styles.rightScroll} contentContainerStyle={[styles.rightContent, !wide && styles.rightContentNarrow]} showsVerticalScrollIndicator={false}>
        <View style={styles.rightInner}>
          {!wide ? (
            <View style={styles.compactHeader}>
              <View style={styles.logoMark}>
                <Text style={styles.logoMarkText}>oh</Text>
              </View>
              <View style={styles.eyebrowChipNarrow}>
                <Text style={styles.eyebrowChipText}>{panel.eyebrow}</Text>
              </View>
            </View>
          ) : null}
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Provider hub — checklist that deep-links to verification / provider-profile
// ════════════════════════════════════════════════════════════════════════

function ProviderHub({
  verification,
  email,
  wide,
  onDashboard,
}: {
  verification: Verification;
  email: string | null;
  wide: boolean;
  onDashboard: () => void;
}) {
  const router = useRouter();
  const steps = onboardingSteps(verification);
  const progress = onboardingProgress(steps);
  const activated = verification.state === 'activated';
  const next = firstActionableStep(steps);

  const hrefOf = (dest: OnboardingDest): Href | null => {
    if (dest === 'verification') return '/(app)/verification' as Href;
    if (dest === 'profile') return '/(app)/provider-profile' as Href;
    return null;
  };
  const open = (s: OnboardingStep) => {
    const href = hrefOf(s.dest);
    if (href) router.push(href);
  };

  return (
    <HubShell panel={PROVIDER_PANEL} email={email} wide={wide}>
      <View style={styles.hubHead}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.hubTitle}>Your setup</Text>
          <Text style={styles.hubSub}>
            {activated ? 'You’re verified and ready to go.' : `${progress.done} of ${progress.total} complete`}
          </Text>
        </View>
        <View style={styles.pctCircle}>
          <Text style={styles.pctText}>{progress.pct}%</Text>
        </View>
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress.pct}%` }]} />
      </View>

      <View style={styles.hubRows}>
        {steps.map((s) => (
          <ProviderRow key={s.key} step={s} onPress={() => open(s)} />
        ))}
      </View>

      <Pressable onPress={activated || !next ? onDashboard : () => open(next)} style={styles.hubCta}>
        <Text style={styles.hubCtaText}>{activated || !next ? 'Go to dashboard' : `Continue setup · ${next.label}`}</Text>
        <Icon name="arrow-right" size={16} color={colors.inkInv} />
      </Pressable>

      {!activated ? (
        <Pressable onPress={onDashboard} hitSlop={8} style={styles.hubSkip}>
          <Text style={styles.skip}>Skip for now — go to dashboard →</Text>
        </Pressable>
      ) : null}
    </HubShell>
  );
}

const PROVIDER_TAG: Record<OnboardingStatus, { label: string; bg: string; fg: string } | null> = {
  done: { label: 'Done', bg: 'rgba(47,122,77,0.14)', fg: colors.success },
  'in-progress': { label: 'In progress', bg: 'rgba(201,122,42,0.14)', fg: colors.warning },
  optional: { label: 'Optional', bg: colors.surfaceAlt, fg: colors.ink2 },
  blocked: { label: 'On hold', bg: colors.surfaceAlt, fg: colors.ink3 },
  todo: null,
};

function ProviderRow({ step, onPress }: { step: OnboardingStep; onPress: () => void }) {
  const done = step.status === 'done';
  const active = step.status === 'in-progress';
  const tag = PROVIDER_TAG[step.status];
  const tappable = step.dest !== null && step.status !== 'blocked';
  return (
    <Pressable accessibilityRole={tappable ? 'button' : undefined} onPress={tappable ? onPress : undefined} disabled={!tappable} style={[styles.row, active && styles.rowActive]}>
      <View style={[styles.rowNum, { backgroundColor: done ? colors.catSpec : active ? colors.highlight : colors.surfaceAlt }]}>
        {done ? <Icon name="check" size={15} color={colors.ink} /> : <Text style={styles.rowNumText}>{step.n}</Text>}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowLabel}>{step.label}</Text>
        <Text style={styles.rowSub}>{step.sub}</Text>
      </View>
      {tag ? (
        <View style={[styles.providerTag, { backgroundColor: tag.bg }]}>
          <Text style={[styles.providerTagText, { color: tag.fg }]}>{tag.label}</Text>
        </View>
      ) : tappable ? (
        <Icon name="chevron-right" size={18} color={colors.ink3} />
      ) : null}
    </Pressable>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Small step subcomponents + static copy
// ════════════════════════════════════════════════════════════════════════

const CATEGORY_ICON: Record<Category, IconName> = { babysitter: 'person', tutor: 'briefcase', nanny: 'house' };

function CategoryTile({ option, selected }: { option: (typeof CATEGORY_OPTIONS)[number]; selected: boolean }) {
  return (
    <View style={[styles.tile, { backgroundColor: colors[option.tone] }, selected && styles.tileSelected]}>
      <View style={styles.tileIcon}>
        <Icon name={CATEGORY_ICON[option.value]} size={22} color={colors.ink} />
      </View>
      <Text style={styles.tileName}>{option.label}</Text>
      <Text style={styles.tileDesc}>{option.blurb}</Text>
      {selected ? (
        <View style={styles.tileCheck}>
          <Icon name="check" size={15} color={colors.inkInv} />
        </View>
      ) : null}
    </View>
  );
}

function CredentialCard({ credential }: { credential: CaregiverCredential }) {
  const pending = credential.review === 'pending';
  const rejected = credential.review === 'rejected';
  const tone = rejected
    ? { bg: 'rgba(178,58,47,0.12)', fg: colors.danger, icon: 'info' as const }
    : pending
      ? { bg: colors.surfaceAlt, fg: colors.warning, icon: 'clock' as const }
      : { bg: 'rgba(47,122,77,0.12)', fg: colors.success, icon: 'check-circle' as const };
  return (
    <View style={styles.credCard}>
      <View style={[styles.credIcon, { backgroundColor: tone.bg }]}>
        <Icon name={tone.icon} size={18} color={tone.fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.credTitle}>{credential.label}</Text>
        <Text style={styles.credMeta}>{credential.statusLabel}</Text>
      </View>
      <View style={[styles.credPill, { backgroundColor: tone.bg }]}>
        <Text style={[styles.credPillText, { color: tone.fg }]}>{credential.review}</Text>
      </View>
    </View>
  );
}

interface Agreement {
  key: string;
  label: string;
  sub: string;
}

const AGREEMENTS: Agreement[] = [
  { key: 'terms', label: 'Caregiver Terms of Service', sub: 'How bookings, payouts and cancellations work.' },
  { key: 'safety', label: 'Safety & Conduct Policy', sub: 'Conduct standards and family-safety expectations.' },
  { key: 'screening', label: 'Background-check consent (FCRA)', sub: 'You authorize Checkr to run a screening.' },
  { key: 'contractor', label: 'Independent-contractor acknowledgement', sub: 'You provide care as an independent contractor, not an employee.' },
];

function AgreementRow({ agreement, checked, onToggle }: { agreement: Agreement; checked: boolean; onToggle: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={[styles.agreeRow, checked && styles.agreeRowOn]}
    >
      <View style={[styles.checkbox, checked && styles.checkboxOn]}>{checked ? <Icon name="check" size={15} color={colors.inkInv} /> : null}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.agreeLabel}>{agreement.label}</Text>
        <Text style={styles.agreeSub}>{agreement.sub}</Text>
      </View>
    </Pressable>
  );
}

const SCREEN_ITEMS = [
  { t: 'Criminal records', s: 'National + county-level' },
  { t: 'SSN trace', s: 'Confirms identity matches records' },
  { t: 'Sex-offender registry', s: 'National search' },
  { t: 'Identity verification', s: 'Cross-referenced with ID upload' },
];

const PHONE_BENEFITS: { icon: IconName; t: string; s: string }[] = [
  { icon: 'bell', t: 'Faster booking alerts', s: 'Get a text the moment a family requests you.' },
  { icon: 'message', t: 'Day-of coordination', s: 'Families can reach you about arrival & pickup.' },
];

const STRIPE_ASKS: { icon: IconName; t: string; s: string }[] = [
  { icon: 'briefcase', t: 'Legal name + DOB', s: 'For IRS reporting' },
  { icon: 'house', t: 'US bank account', s: 'For ACH payouts (no fees)' },
  { icon: 'receipt', t: 'SSN or EIN', s: '1099-NEC at year-end if > $600' },
];

/** RN-web honors the web `background-image` shorthand; cast for the dark payout hero. */
const brandGradientDark: ViewStyle = {
  backgroundColor: colors.ink,
} as ViewStyle;

// ════════════════════════════════════════════════════════════════════════
// Styles
// ════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.canvas },
  centerRoot: { alignItems: 'center', justifyContent: 'center', gap: 14 },
  error: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.danger, textAlign: 'center' },
  retry: { backgroundColor: colors.brand, borderRadius: radii.pill, paddingHorizontal: 24, paddingVertical: 14 },
  retryText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
  skip: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2, textDecorationLine: 'underline' },

  // brand panel
  brandPanel: { width: 460, flexShrink: 0, paddingVertical: 48, paddingHorizontal: 44, justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  logoMark: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  logoMarkText: { fontFamily: fonts.bold, fontSize: 17, color: colors.inkInv, letterSpacing: -0.5 },
  wordmark: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  brandBody: { flex: 1, justifyContent: 'center' },
  eyebrowChip: { alignSelf: 'flex-start', height: 34, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: 'rgba(255,255,255,0.6)', justifyContent: 'center', marginBottom: 22 },
  eyebrowChipNarrow: { alignSelf: 'flex-start', height: 30, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, justifyContent: 'center' },
  eyebrowChipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  brandTitle: { fontFamily: fonts.bold, fontSize: 40, lineHeight: 45, letterSpacing: -1.4, color: colors.ink, maxWidth: 360 },
  brandSubtitle: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.ink, opacity: 0.78, marginTop: 16, maxWidth: 340 },
  bullets: { marginTop: 30, gap: 14 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bulletIcon: { width: 34, height: 34, borderRadius: radii.pill, backgroundColor: 'rgba(255,255,255,0.55)', alignItems: 'center', justifyContent: 'center' },
  bulletLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 14.5, color: colors.ink },
  signedIn: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink, opacity: 0.6 },

  // right column
  rightScroll: { flex: 1 },
  rightContent: { paddingVertical: 56, paddingHorizontal: 56, alignItems: 'center' },
  rightContentNarrow: { paddingVertical: 32, paddingHorizontal: 22, alignItems: 'flex-start' },
  rightInner: { width: '100%', maxWidth: 640 },
  compactHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },

  hubHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  hubTitle: { fontFamily: fonts.bold, fontSize: 28, letterSpacing: -0.8, color: colors.ink },
  hubSub: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, marginTop: 4 },
  pctCircle: { width: 64, height: 64, borderRadius: radii.pill, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.e1 },
  pctText: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink },

  track: { marginTop: 18, height: 8, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radii.pill, backgroundColor: colors.brand },

  hubRows: { marginTop: 24, gap: 10 },
  row: { backgroundColor: colors.surface, borderRadius: radii.md, paddingVertical: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1.5, borderColor: 'transparent', ...shadow.e1 },
  rowActive: { borderColor: colors.brand },
  rowNum: { width: 32, height: 32, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  rowNumText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  rowLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  rowSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 1 },
  rowDone: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.success },
  rowProgress: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowProgressDot: { width: 6, height: 6, borderRadius: radii.pill, backgroundColor: colors.warning },
  rowProgressText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.warning },
  providerTag: { height: 22, paddingHorizontal: 9, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  providerTagText: { fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 0.2, textTransform: 'uppercase' },

  hubCta: { marginTop: 24, height: 54, paddingHorizontal: 28, borderRadius: radii.pill, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'flex-start' },
  hubCtaText: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: -0.2, color: colors.inkInv },
  hubSkip: { marginTop: 14 },

  // step shared
  stepError: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 14 },
  noteStrong: { fontFamily: fonts.bold, color: colors.ink },
  sectionGap: { marginTop: 24, marginBottom: 12 },
  sectionGapSm: { marginTop: 20, marginBottom: 4 },
  sectionBlurb: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink3, marginBottom: 12, maxWidth: 520 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  // step 1 tiles
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  tile: { flexGrow: 1, flexBasis: 180, minWidth: 160, borderRadius: 22, padding: 20, borderWidth: 2.5, borderColor: 'transparent' },
  tileSelected: { borderColor: colors.ink },
  tileIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(22,21,19,0.10)', alignItems: 'center', justifyContent: 'center' },
  tileName: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink, marginTop: 14 },
  tileDesc: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, color: colors.ink, opacity: 0.72, marginTop: 4 },
  tileCheck: { position: 'absolute', top: 14, right: 14, width: 26, height: 26, borderRadius: radii.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },

  // step 2 profile
  fieldRow: { flexDirection: 'row', gap: 14, marginTop: 26 },
  bioHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 22, marginBottom: 8 },
  counter: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },

  // step 3 rates
  catSwitch: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  rateCard: { backgroundColor: colors.ink, borderRadius: 24, padding: 26 },
  rateCardKicker: { fontFamily: fonts.semibold, fontSize: 11, color: colors.inkInv, opacity: 0.6, letterSpacing: 0.5, textTransform: 'uppercase' },
  rateBigRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 },
  rateBig: { fontFamily: fonts.bold, fontSize: 60, lineHeight: 64, color: colors.inkInv, letterSpacing: -2 },
  rateBigUnit: { fontFamily: fonts.regular, fontSize: 17, color: colors.inkInv, opacity: 0.6 },
  stepperRow: { marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 44, height: 44, borderRadius: radii.pill, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontFamily: fonts.semibold, fontSize: 22, color: colors.inkInv },
  rateTrack: { flex: 1, height: 5, borderRadius: radii.pill, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  rateTrackFill: { height: 5, borderRadius: radii.pill, backgroundColor: colors.highlight },
  rateScale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  rateScaleText: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.inkInv, opacity: 0.5 },
  negotiateCard: { marginTop: 16, backgroundColor: colors.surface, borderRadius: 20, padding: 18, ...shadow.e1, flexDirection: 'row', alignItems: 'center', gap: 14 },

  // step 4 ID
  idTile: { backgroundColor: colors.ink, borderRadius: 22, padding: 22, gap: 16 },
  idTileNum: { width: 30, height: 30, borderRadius: radii.pill, backgroundColor: colors.highlight, alignItems: 'center', justifyContent: 'center' },
  idTileNumText: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  idDashed: { minHeight: 96, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(255,216,77,0.6)', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  idDashedText: { fontFamily: fonts.mono, fontSize: 11, color: 'rgba(255,255,255,0.6)', letterSpacing: 0.5 },
  idTileLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
  idTileSub: { fontFamily: fonts.regular, fontSize: 12.5, color: 'rgba(251,247,239,0.7)', marginTop: 2 },

  successCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 18, padding: 18, ...shadow.e1 },
  successTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  successSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 2 },

  // step 5 checkr
  checkrCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 22, padding: 22, ...shadow.e1 },
  statusPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, height: 28, paddingHorizontal: 12, borderRadius: radii.pill },
  statusDot: { width: 6, height: 6, borderRadius: radii.pill },
  statusPillText: { fontFamily: fonts.semibold, fontSize: 12.5 },
  checkrTitle: { fontFamily: fonts.bold, fontSize: 19, color: colors.ink, marginTop: 12, letterSpacing: -0.3 },
  checkrSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 4 },
  checkrMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },
  screenGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  screenItem: { flexGrow: 1, flexBasis: 240, minWidth: 220, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 16, padding: 16, ...shadow.e1 },
  screenItemTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  screenItemSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },

  // step 6 credentials
  credEmpty: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink3 },
  credCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 16, padding: 16, ...shadow.e1 },
  credIcon: { width: 38, height: 38, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  credTitle: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink },
  credMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },
  credPill: { height: 22, paddingHorizontal: 9, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  credPillText: { fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 0.2, textTransform: 'uppercase' },
  addCred: { marginTop: 18, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.hairline },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  addCredRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, paddingHorizontal: 20, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.surface },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  credWarn: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.warning, marginTop: 12 },

  // step 7 phone
  phoneRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  phoneCard: { flexGrow: 1, flexBasis: 280, minWidth: 260, backgroundColor: colors.surface, borderRadius: 20, padding: 22, ...shadow.e1 },
  phoneBenefits: { flexGrow: 1, flexBasis: 280, minWidth: 260, gap: 12 },
  benefitItem: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 16, padding: 16, ...shadow.e1 },
  benefitIcon: { width: 38, height: 38, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  benefitTitle: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink },
  benefitSub: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, color: colors.ink2, marginTop: 2 },

  // step 8 agreements
  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1.5, borderColor: 'transparent', ...shadow.e1 },
  agreeRowOn: { borderColor: colors.brand },
  checkbox: { width: 26, height: 26, borderRadius: 8, borderWidth: 1.5, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  agreeLabel: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink },
  agreeSub: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, color: colors.ink2, marginTop: 2 },

  // step 9 bank
  payoutHero: { borderRadius: 24, padding: 26 },
  payoutKicker: { fontFamily: fonts.semibold, fontSize: 11, color: colors.inkInv, opacity: 0.6, letterSpacing: 0.5, textTransform: 'uppercase' },
  payoutHeroTitle: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, color: colors.inkInv, letterSpacing: -0.8, marginTop: 6 },
  payoutHeroSub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.inkInv, opacity: 0.72, marginTop: 8, maxWidth: 460 },
  askItem: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 16, padding: 16, ...shadow.e1 },
});
