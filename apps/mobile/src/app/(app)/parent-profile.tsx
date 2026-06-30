/**
 * Parent profile (OH-200) — the family-level profile that replaces the removed
 * Child entity (ADR-0012): a free-text Bio, a Preferences checklist, an optional
 * default service address, and the consent-gated Safety-Behaviors checklist.
 *
 * The Safety-Behaviors section is locked behind an explicit, timestamped
 * sensitive-info consent (ADR-0012 / PRD story 3): until the Parent grants
 * consent the checklist can't be edited; withdrawing consent erases every
 * behaviour + the timestamp (story 74) while Bio + Preferences survive. Reached
 * from Account (parent only).
 *
 * Design reference: Claude design project — screens/consent.jsx (the consent
 * gate) + the profile-builder section/chip language (translated to RN/Expo).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TextField } from '@/components/ui/TextField';
import {
  ApiError,
  getParentProfile,
  grantSafetyConsent,
  patchParentProfile,
  putSafetyBehaviors,
  withdrawSafetyConsent,
  type ParentPreference,
  type ParentProfile,
  type ParentSafetyBehavior,
} from '@/api/client';
import { BIO_MAX, PREFERENCE_OPTIONS, SAFETY_BEHAVIOR_OPTIONS } from '@/lib/parent-profile';
import { colors, fonts, radii, shadow, spacing } from '@/theme/tokens';

interface AddressForm {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
}

interface FormState {
  bio: string;
  preferences: ParentPreference[];
  safetyBehaviors: ParentSafetyBehavior[];
  address: AddressForm;
}

function profileToForm(p: ParentProfile): FormState {
  return {
    bio: p.bio ?? '',
    preferences: [...p.preferences],
    safetyBehaviors: [...p.safetyBehaviors],
    address: {
      line1: p.defaultAddress.line1 ?? '',
      line2: p.defaultAddress.line2 ?? '',
      city: p.defaultAddress.city ?? '',
      state: p.defaultAddress.state ?? '',
      postalCode: p.defaultAddress.postalCode ?? '',
    },
  };
}

function blankToNull(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

function consentDateLabel(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function ParentProfileScreen() {
  const router = useRouter();
  const { role } = useAuth();
  const [profile, setProfile] = useState<ParentProfile | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // The two consent checkboxes (reset whenever the gate is shown).
  const [understand, setUnderstand] = useState(false);
  const [agree, setAgree] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await getParentProfile();
        if (!alive) return;
        setProfile(p);
        setForm(profileToForm(p));
      } catch (err) {
        if (alive) setError(messageOf(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function patchForm(next: Partial<FormState>) {
    setForm((f) => (f ? { ...f, ...next } : f));
    setSaved(false);
  }
  function patchAddress(next: Partial<AddressForm>) {
    setForm((f) => (f ? { ...f, address: { ...f.address, ...next } } : f));
    setSaved(false);
  }

  function applyProfile(p: ParentProfile) {
    setProfile(p);
    setForm(profileToForm(p));
  }

  async function save() {
    if (!profile || !form) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      let updated = await patchParentProfile({
        bio: blankToNull(form.bio),
        preferences: form.preferences,
        defaultAddress: {
          line1: blankToNull(form.address.line1),
          line2: blankToNull(form.address.line2),
          city: blankToNull(form.address.city),
          state: blankToNull(form.address.state)?.toUpperCase() ?? null,
          postalCode: blankToNull(form.address.postalCode),
        },
      });
      // Safety Behaviors persist only when consent is in force (the gated PUT).
      if (updated.hasConsent) {
        updated = await putSafetyBehaviors(form.safetyBehaviors);
      }
      applyProfile(updated);
      setSaved(true);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSaving(false);
    }
  }

  async function grantConsent() {
    setConsentBusy(true);
    setError(null);
    try {
      const updated = await grantSafetyConsent();
      applyProfile(updated);
      setUnderstand(false);
      setAgree(false);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setConsentBusy(false);
    }
  }

  async function withdrawConsent() {
    setConsentBusy(true);
    setError(null);
    try {
      const updated = await withdrawSafetyConsent();
      applyProfile(updated);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setConsentBusy(false);
    }
  }

  const hasConsent = profile?.hasConsent ?? false;

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <View style={styles.appBar}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8} style={styles.backBtn}>
          <Icon name="chevron-left" size={22} color={colors.ink} />
        </Pressable>
        <Text style={styles.heading}>Family profile</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? <Text style={styles.muted}>Loading…</Text> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {role && role !== 'parent' && !loading ? (
        <Notice tone="warn">The family profile is for Parents.</Notice>
      ) : null}

      {profile && form && !loading ? (
        <View style={{ gap: spacing.md }}>
          <SectionCard
            title="About your family"
            hint="Visible to Caregivers you engage. Don’t include more about your child than needed."
          >
            <MultilineField
              label="Bio"
              value={form.bio}
              onChangeText={(v) => patchForm({ bio: v })}
              placeholder="A little about your family, your home, and what a good day looks like."
              max={BIO_MAX}
            />
          </SectionCard>

          <SectionCard title="Preferences" hint="Caregiver traits that matter to you. Tap to toggle.">
            <ChipMultiSelect
              options={PREFERENCE_OPTIONS}
              selected={form.preferences}
              onChange={(preferences) => patchForm({ preferences })}
            />
          </SectionCard>

          <SectionCard
            title="Default address"
            hint="Pre-fills a booking’s address. A Caregiver only sees the exact address after they accept — before that, just an approximate distance."
          >
            <TextField
              label="Street address"
              value={form.address.line1}
              onChangeText={(v) => patchAddress({ line1: v })}
              placeholder="123 Main St"
              autoCapitalize="words"
            />
            <View style={{ height: spacing.md }} />
            <TextField
              label="Apt, suite, etc. (optional)"
              value={form.address.line2}
              onChangeText={(v) => patchAddress({ line2: v })}
              placeholder="Apt 4B"
              autoCapitalize="words"
            />
            <View style={{ height: spacing.md }} />
            <TextField
              label="City"
              value={form.address.city}
              onChangeText={(v) => patchAddress({ city: v })}
              placeholder="Austin"
              autoCapitalize="words"
            />
            <View style={{ height: spacing.md }} />
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <TextField
                  label="State"
                  value={form.address.state}
                  onChangeText={(v) => patchAddress({ state: v.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() })}
                  placeholder="TX"
                  autoCapitalize="characters"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label="ZIP"
                  value={form.address.postalCode}
                  onChangeText={(v) => patchAddress({ postalCode: v.replace(/\D/g, '').slice(0, 5) })}
                  placeholder="78701"
                  keyboardType="number-pad"
                />
              </View>
            </View>
          </SectionCard>

          <SectionCard
            title="Safety Behaviors"
            hint="A fixed checklist of behaviours you want Caregivers to be aware of. Sensitive — stored only after you consent."
          >
            {hasConsent ? (
              <View>
                <View style={styles.consentBadge}>
                  <Icon name="shield" size={13} color={colors.success} />
                  <Text style={styles.consentBadgeText}>
                    Consent given{profile.safetyBehaviorsConsentAt ? ` · ${consentDateLabel(profile.safetyBehaviorsConsentAt)}` : ''}
                  </Text>
                </View>
                <View style={{ height: spacing.md }} />
                <ChipMultiSelect
                  options={SAFETY_BEHAVIOR_OPTIONS}
                  selected={form.safetyBehaviors}
                  onChange={(safetyBehaviors) => patchForm({ safetyBehaviors })}
                />
                <View style={{ height: spacing.md }} />
                <Pressable
                  onPress={withdrawConsent}
                  disabled={consentBusy}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.withdrawBtn, { opacity: consentBusy ? 0.5 : pressed ? 0.85 : 1 }]}
                >
                  <Icon name="trash" size={15} color={colors.danger} />
                  <Text style={styles.withdrawText}>Withdraw consent &amp; erase Safety Behaviors</Text>
                </Pressable>
              </View>
            ) : (
              <ConsentGate
                understand={understand}
                agree={agree}
                onToggleUnderstand={() => setUnderstand((v) => !v)}
                onToggleAgree={() => setAgree((v) => !v)}
                busy={consentBusy}
                onGrant={grantConsent}
              />
            )}
          </SectionCard>

          {saved ? <Notice tone="neutral" icon="check-circle">Saved.</Notice> : null}
          <PrimaryButton onPress={save} loading={saving} disabled={loading}>
            Save profile
          </PrimaryButton>
          <View style={{ height: spacing.xl }} />
        </View>
      ) : null}
    </Screen>
  );
}

/* ── consent gate (two-checkbox unlock) ─────────────────────────────────────── */

function ConsentGate({
  understand,
  agree,
  onToggleUnderstand,
  onToggleAgree,
  busy,
  onGrant,
}: {
  understand: boolean;
  agree: boolean;
  onToggleUnderstand: () => void;
  onToggleAgree: () => void;
  busy: boolean;
  onGrant: () => void;
}) {
  const ready = understand && agree;
  return (
    <View style={{ gap: spacing.md }}>
      <Notice tone="warn">
        Safety Behaviors hold sensitive information about your child. We store them only after your explicit consent, and
        only Caregivers you engage ever see them. You can withdraw any time — every behaviour and the timestamp are then
        permanently deleted.
      </Notice>
      <View style={{ gap: spacing.sm }}>
        <Checkbox
          checked={understand}
          onPress={onToggleUnderstand}
          label="I understand Safety Behaviors are sensitive information about my child and how Our Haven uses them."
        />
        <Checkbox
          checked={agree}
          onPress={onToggleAgree}
          label="I consent to Our Haven storing my Safety Behaviors checklist on my family profile."
        />
      </View>
      <PrimaryButton onPress={onGrant} loading={busy} disabled={!ready}>
        Give consent
      </PrimaryButton>
    </View>
  );
}

function Checkbox({ checked, onPress, label }: { checked: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={[styles.checkRow, checked ? styles.checkRowOn : styles.checkRowOff]}
    >
      <View style={[styles.box, checked ? styles.boxOn : styles.boxOff]}>
        {checked ? <Icon name="check" size={14} color={colors.inkInv} /> : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

/* ── shared building blocks (mirroring profile-builder) ─────────────────────── */

function SectionCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {hint ? <Text style={styles.cardHint}>{hint}</Text> : null}
      <View style={{ height: spacing.md }} />
      {children}
    </View>
  );
}

function MultilineField({
  label,
  value,
  onChangeText,
  placeholder,
  max,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  max: number;
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.multiline}
        value={value}
        onChangeText={(v) => onChangeText(v.slice(0, max))}
        placeholder={placeholder}
        placeholderTextColor={colors.ink3}
        multiline
        textAlignVertical="top"
      />
      <Text style={styles.counter}>
        {value.length}/{max}
      </Text>
    </View>
  );
}

function ChipMultiSelect<V extends string>({
  options,
  selected,
  onChange,
}: {
  options: { value: V; label: string }[];
  selected: V[];
  onChange: (next: V[]) => void;
}) {
  function toggle(v: V) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <Pressable
            key={o.value}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => toggle(o.value)}
            style={[styles.chip, on ? styles.chipOn : styles.chipOff]}
          >
            {on ? <Icon name="check" size={13} color={colors.inkInv} /> : null}
            <Text style={[styles.chipText, on && { color: colors.inkInv }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing['2xl'] },
  appBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, paddingBottom: spacing.lg },
  backBtn: { width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  heading: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink3 },

  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.xl, ...shadow.e1 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 16, letterSpacing: -0.3, color: colors.ink },
  cardHint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 4 },

  fieldLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  multiline: { marginTop: 6, minHeight: 110, borderRadius: radii.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, padding: 14, fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  counter: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3, marginTop: 6, textAlign: 'right' },

  row: { flexDirection: 'row', gap: spacing.md },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1.5 },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipOff: { backgroundColor: colors.surface, borderColor: colors.hairline },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  consentBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', height: 28, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: 'rgba(47,122,77,0.12)' },
  consentBadgeText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.success },
  withdrawBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.danger, backgroundColor: colors.surface },
  withdrawText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.danger },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: 14, borderRadius: radii.lg },
  checkRowOn: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.ink },
  checkRowOff: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.hairline },
  box: { width: 24, height: 24, borderRadius: 8, marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.ink },
  boxOff: { borderWidth: 1.5, borderColor: colors.ink },
  checkLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink },
});
