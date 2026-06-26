/**
 * SupplyOnboarding (WEB) — desktop layout for the supply role-claim step.
 *
 * The unified RN/Expo app renders the mobile card column on phones; on the web
 * the supply onboarding deserves the full-viewport, two-pane treatment from the
 * Claude Design "Our Haven caregiver provider web" project (cp-web/cp-onboarding
 * → POWebShell / CPOnboardHub): a brand/value panel on the left and a wide form
 * on the right. Metro resolves this `.web.tsx` over `SupplyOnboarding.tsx` on web.
 *
 * Functionally identical to the native screen: it captures the Caregiver's
 * categories (multi-select, ADR-0015) or the Provider's clinical specialty
 * (single-select, ADR-0011) + resident state, claims the role via
 * POST /v1/auth/role-claim, and refreshes the session so the auth gate routes in.
 */
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import { ApiError, roleClaim } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Icon, type IconName } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { RolePill } from '@/components/ui/RolePill';
import { StatePicker } from '@/components/ui/StatePicker';
import {
  CATEGORY_OPTIONS,
  SPECIALTY_OPTIONS,
  type Category,
  type Specialty,
  type StateCode,
} from '@/lib/supply';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

/** Below this viewport width the two panes stack into a single column. */
const WIDE_BREAKPOINT = 920;

interface PanelCopy {
  eyebrow: string;
  title: string;
  subtitle: string;
  bullets: { icon: IconName; label: string }[];
}

interface FormCopy {
  title: string;
  subtitle: string;
  sectionTitle: string;
  sectionHint: string;
}

const PANEL: Record<'caregiver' | 'provider', PanelCopy> = {
  caregiver: {
    eyebrow: 'Caregiver onboarding',
    title: 'Let’s get you ready to earn.',
    subtitle:
      'One account, one background check, covers every service you offer. Your progress saves as you go.',
    bullets: [
      { icon: 'shield', label: 'Bank-grade identity + background checks' },
      { icon: 'dollar', label: 'Same-day payouts once verified' },
      { icon: 'lock', label: 'Your documents are never shown to Parents' },
    ],
  },
  provider: {
    eyebrow: 'Provider onboarding',
    title: 'Set up your clinical practice.',
    subtitle:
      'Tell us your specialty and where you practice. Licensing and insurance verification run next — they work best in a browser.',
    bullets: [
      { icon: 'shield', label: 'License + insurance verified before you go live' },
      { icon: 'briefcase', label: 'Consultation booking built for clinicians' },
      { icon: 'lock', label: 'Your credentials are never shown to Parents' },
    ],
  },
};

const FORM: Record<'caregiver' | 'provider', FormCopy> = {
  caregiver: {
    title: 'Set up your Caregiver profile.',
    subtitle: 'Pick the services you offer and where you’re based. You can be more than one.',
    sectionTitle: 'What do you offer?',
    sectionHint: 'Select all that apply — at least one.',
  },
  provider: {
    title: 'Set up your Provider profile.',
    subtitle: 'Choose your clinical specialty and where you practice.',
    sectionTitle: 'Your specialty',
    sectionHint: 'Choose one.',
  },
};

/** RN-web honors the web `background-image` shorthand; TS's ViewStyle does not list it. */
const brandGradient: ViewStyle = {
  backgroundImage: `linear-gradient(165deg, ${colors.catSpec} 0%, ${colors.catBaby} 100%)`,
} as unknown as ViewStyle;

export function SupplyOnboarding({ role }: { role: 'caregiver' | 'provider' }) {
  const { session, refresh } = useAuth();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;

  const panel = PANEL[role];
  const form = FORM[role];
  const email = session?.user?.email ?? null;

  const [categories, setCategories] = useState<Category[]>([]);
  const [specialty, setSpecialty] = useState<Specialty | null>(null);
  const [state, setState] = useState<StateCode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtypeChosen = role === 'caregiver' ? categories.length > 0 : specialty !== null;
  const canSubmit = subtypeChosen && state !== null && !loading;

  const toggleCategory = (value: Category) =>
    setCategories((prev) => (prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]));

  const onSubmit = async () => {
    if (!canSubmit || state === null) return;
    setError(null);
    setLoading(true);
    try {
      if (role === 'caregiver') {
        await roleClaim({ role: 'caregiver', categories, state });
      } else {
        await roleClaim({ role: 'provider', specialty: specialty!, state });
      }
      await refresh(); // auth gate redirects into (app) once the role lands in the token
      // Leave `loading` set — the redirect unmounts this screen.
    } catch (e) {
      setLoading(false);
      setError(
        e instanceof ApiError
          ? e.status === 0
            ? 'Set EXPO_PUBLIC_API_URL in apps/mobile/.env to reach the backend.'
            : e.status === 409
              ? 'Your role is already set — it can’t be changed.'
              : e.message
          : 'Could not set up your account. Please try again.',
      );
    }
  };

  return (
    <View style={styles.root}>
      {wide ? <BrandPanel panel={panel} email={email} /> : null}

      <ScrollView
        style={styles.formScroll}
        contentContainerStyle={[styles.formContent, !wide && styles.formContentNarrow]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.formInner}>
          {!wide ? <CompactHeader panel={panel} /> : null}

          <View style={styles.pill}>
            <RolePill role={role} />
          </View>
          <Text style={styles.title}>{form.title}</Text>
          <Text style={styles.subtitle}>{form.subtitle}</Text>

          <Text style={styles.sectionTitle}>{form.sectionTitle}</Text>
          <Text style={styles.sectionHint}>{form.sectionHint}</Text>

          {role === 'caregiver' ? (
            <View style={styles.tileGrid}>
              {CATEGORY_OPTIONS.map((opt) => (
                <CategoryTile
                  key={opt.value}
                  label={opt.label}
                  blurb={opt.blurb}
                  tone={colors[opt.tone]}
                  selected={categories.includes(opt.value)}
                  onPress={() => toggleCategory(opt.value)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.specialtyList}>
              {SPECIALTY_OPTIONS.map((opt) => (
                <SpecialtyRow
                  key={opt.value}
                  label={opt.label}
                  blurb={opt.blurb}
                  selected={specialty === opt.value}
                  onPress={() => setSpecialty(opt.value)}
                />
              ))}
            </View>
          )}

          <View style={styles.stateBlock}>
            <StatePicker value={state} onChange={setState} />
            <Text style={styles.sectionHint}>Determines which state-specific rules apply to you.</Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.ctaRow}>
            <Pressable
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={onSubmit}
              style={({ pressed }) => [
                styles.cta,
                { backgroundColor: pressed ? colors.brandPressed : colors.brand, opacity: canSubmit ? 1 : 0.5 },
              ]}
            >
              <Text style={styles.ctaText}>{loading ? 'Setting up…' : 'Continue'}</Text>
              {!loading ? <Icon name="arrow-right" size={18} color={colors.inkInv} /> : null}
            </Pressable>
          </View>

          <View style={styles.notice}>
            <Notice>This sets your permanent role on Our Haven. You’ll verify your ID next.</Notice>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Left brand / value panel ──────────────────────────────────────────────
function BrandPanel({ panel, email }: { panel: PanelCopy; email: string | null }) {
  return (
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
  );
}

// ── Compact header for the stacked (narrow) layout ────────────────────────
function CompactHeader({ panel }: { panel: PanelCopy }) {
  return (
    <View style={styles.compactHeader}>
      <View style={styles.logoMarkDark}>
        <Text style={styles.logoMarkText}>oh</Text>
      </View>
      <View style={styles.eyebrowChipNarrow}>
        <Text style={styles.eyebrowChipText}>{panel.eyebrow}</Text>
      </View>
    </View>
  );
}

// ── Caregiver category tile (colored, multi-select) ───────────────────────
function CategoryTile({
  label,
  blurb,
  tone,
  selected,
  onPress,
}: {
  label: string;
  blurb: string;
  tone: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.tile, { backgroundColor: tone, borderColor: selected ? colors.ink : 'transparent' }]}
    >
      <View style={styles.tileIcon}>
        <Icon name={label === 'Tutor' ? 'briefcase' : label === 'Nanny' ? 'house' : 'person'} size={22} color={colors.ink} />
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileBlurb}>{blurb}</Text>
      {selected ? (
        <View style={styles.tileCheck}>
          <Icon name="check" size={15} color={colors.inkInv} />
        </View>
      ) : null}
    </Pressable>
  );
}

// ── Provider specialty row (single-select) ────────────────────────────────
function SpecialtyRow({
  label,
  blurb,
  selected,
  onPress,
}: {
  label: string;
  blurb: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.specialtyRow,
        { borderColor: selected ? colors.brand : colors.hairline, backgroundColor: selected ? colors.brandSoft : colors.surface },
      ]}
    >
      <View style={styles.specialtyCopy}>
        <Text style={styles.specialtyLabel}>{label}</Text>
        <Text style={styles.specialtyBlurb}>{blurb}</Text>
      </View>
      <View style={[styles.radio, selected ? styles.radioOn : styles.radioOff]}>
        {selected ? <Icon name="check" size={14} color={colors.inkInv} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.canvas },

  // brand panel
  brandPanel: { width: 460, flexShrink: 0, paddingVertical: 48, paddingHorizontal: 44, justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  logoMark: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  logoMarkDark: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  logoMarkText: { fontFamily: fonts.bold, fontSize: 17, color: colors.inkInv, letterSpacing: -0.5 },
  wordmark: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  brandBody: { flex: 1, justifyContent: 'center' },
  eyebrowChip: {
    alignSelf: 'flex-start', height: 34, paddingHorizontal: 14, borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.6)', justifyContent: 'center', marginBottom: 22,
  },
  eyebrowChipNarrow: {
    alignSelf: 'flex-start', height: 30, paddingHorizontal: 12, borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt, justifyContent: 'center',
  },
  eyebrowChipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  brandTitle: { fontFamily: fonts.bold, fontSize: 40, lineHeight: 45, letterSpacing: -1.4, color: colors.ink, maxWidth: 360 },
  brandSubtitle: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.ink, opacity: 0.78, marginTop: 16, maxWidth: 340 },
  bullets: { marginTop: 30, gap: 14 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bulletIcon: {
    width: 34, height: 34, borderRadius: radii.pill, backgroundColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  bulletLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 14.5, color: colors.ink },
  signedIn: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink, opacity: 0.6 },

  // form pane
  formScroll: { flex: 1 },
  formContent: { paddingVertical: 56, paddingHorizontal: 56, alignItems: 'flex-start' },
  formContentNarrow: { paddingVertical: 32, paddingHorizontal: 22 },
  formInner: { width: '100%', maxWidth: 620 },
  compactHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },

  pill: { marginBottom: 16 },
  title: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, letterSpacing: -1, color: colors.ink },
  subtitle: { fontFamily: fonts.regular, fontSize: 15.5, lineHeight: 23, color: colors.ink2, marginTop: 8, maxWidth: 540 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.2, color: colors.ink, marginTop: 30 },
  sectionHint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink3, marginTop: 4 },

  // caregiver tiles
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 16 },
  tile: {
    flexGrow: 1, flexBasis: 180, minWidth: 180, borderRadius: radii.lg, padding: 20,
    borderWidth: 2.5,
  },
  tileIcon: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(22,21,19,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  tileLabel: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink, marginTop: 14 },
  tileBlurb: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, color: colors.ink, opacity: 0.72, marginTop: 4 },
  tileCheck: {
    position: 'absolute', top: 14, right: 14, width: 26, height: 26, borderRadius: radii.pill,
    backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center',
  },

  // provider specialty rows
  specialtyList: { gap: 12, marginTop: 16, width: '100%' },
  specialtyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderRadius: radii.lg, borderWidth: 1.5,
  },
  specialtyCopy: { flex: 1, minWidth: 0 },
  specialtyLabel: { fontFamily: fonts.semibold, fontSize: 15.5, letterSpacing: -0.2, color: colors.ink },
  specialtyBlurb: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, color: colors.ink2, marginTop: 2 },
  radio: { width: 24, height: 24, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: colors.brand },
  radioOff: { borderWidth: 1.5, borderColor: colors.monoGray },

  stateBlock: { marginTop: 26, width: '100%', maxWidth: 420 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 16 },

  ctaRow: { marginTop: 26 },
  cta: {
    height: 54, paddingHorizontal: 28, borderRadius: radii.pill, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'flex-start',
  },
  ctaText: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: -0.2, color: colors.inkInv },

  notice: { marginTop: 18, width: '100%', maxWidth: 540, ...shadow.e1 },
});
