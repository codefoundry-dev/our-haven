/**
 * Caregiver profile builder (OH-188) — the unified Caregiver-editable profile:
 * per-category Published Rate (+ Babysitter/Nanny per-child surcharge), the 7×3
 * availability grid + note + paused, the negotiable toggle, ages-served +
 * behaviour-comfort (shared Safety-Behaviors taxonomy), the Credentials umbrella
 * (admin-reviewed; "Pending review" until approved), and a read-only Parent
 * preview that hides pending Credentials. Reached from Account (caregiver only).
 *
 * Design reference: Claude design project — web-screens/provider-profile.jsx +
 * provider-availability.jsx (translated to RN/Expo primitives + tokens).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { AvatarUpload } from '@/components/AvatarUpload';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TextField } from '@/components/ui/TextField';
import {
  ApiError,
  addCaregiverCredential,
  deleteCaregiverCredential,
  getCaregiverProfile,
  patchCaregiverProfile,
  type CaregiverCredential,
  type CaregiverProfile,
  type CaregiverProfilePatch,
} from '@/api/client';
import type { Category } from '@/lib/supply';
import {
  AGE_BAND_OPTIONS,
  AVAILABILITY_BANDS,
  AVAILABILITY_DAYS,
  AVAILABILITY_NOTE_MAX,
  BEHAVIOUR_OPTIONS,
  CATEGORY_LABELS,
  CREDENTIAL_TYPE_LABELS,
  CREDENTIAL_TYPE_OPTIONS,
  centsToDollars,
  dollarsToCents,
  isSurchargeCategory,
  LANGUAGE_OPTIONS,
  rateLabel,
  SPECIALTY_OPTIONS,
  tagChips,
  type AgeBand,
  type CredentialType,
  type SafetyBehavior,
} from '@/lib/profile';
import { colors, fonts, radii, shadow, spacing } from '@/theme/tokens';

type Grid = Record<string, Record<string, boolean>>;

interface FormState {
  displayName: string;
  headline: string;
  bio: string;
  zip: string;
  yearsExperience: string;
  languages: string[];
  specialties: string[];
  rates: Record<string, { rate: string; surcharge: string }>;
  grid: Grid;
  note: string;
  paused: boolean;
  negotiable: boolean;
  agesServed: AgeBand[];
  behaviourComfort: SafetyBehavior[];
}

function profileToForm(p: CaregiverProfile): FormState {
  const rates: FormState['rates'] = {};
  for (const cat of p.categories) {
    const found = p.categoryRates.find((r) => r.category === cat);
    rates[cat] = {
      rate: centsToDollars(found?.publishedRateCents ?? null),
      surcharge: centsToDollars(found?.perChildSurchargeCents ?? null),
    };
  }
  return {
    displayName: p.displayName ?? '',
    headline: p.headline ?? '',
    bio: p.bio ?? '',
    zip: p.zip ?? '',
    yearsExperience: p.yearsExperience == null ? '' : String(p.yearsExperience),
    languages: [...p.languages],
    specialties: [...p.specialties],
    rates,
    grid: (p.availabilityGrid ?? {}) as Grid,
    note: p.availabilityNote ?? '',
    paused: p.paused,
    negotiable: p.negotiable,
    agesServed: [...p.agesServed],
    behaviourComfort: [...p.behaviourComfort],
  };
}

function blankToNull(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

function identityInitials(displayName: string): string {
  return (
    (displayName.trim() || 'Y N')
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'YN'
  );
}

export default function ProfileBuilderScreen() {
  const router = useRouter();
  const { role } = useAuth();
  const [profile, setProfile] = useState<CaregiverProfile | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await getCaregiverProfile();
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

  async function save() {
    if (!profile || !form) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const categoryRates = profile.categories.flatMap((cat) => {
        const entry = form.rates[cat];
        const rateCents = dollarsToCents(entry?.rate ?? '');
        if (rateCents === null) return [];
        const surcharge = isSurchargeCategory(cat) ? dollarsToCents(entry?.surcharge ?? '') : null;
        return [{ category: cat, publishedRateCents: rateCents, perChildSurchargeCents: surcharge }];
      });
      const patch: CaregiverProfilePatch = {
        displayName: blankToNull(form.displayName),
        headline: blankToNull(form.headline),
        bio: blankToNull(form.bio),
        languages: form.languages,
        specialties: form.specialties,
        categoryRates,
        availabilityGrid: form.grid,
        availabilityNote: blankToNull(form.note),
        paused: form.paused,
        negotiable: form.negotiable,
        agesServed: form.agesServed,
        behaviourComfort: form.behaviourComfort,
      };
      // ZIP / years only sent when valid-or-cleared (a partial entry is left out
      // so the save never trips the server's format check).
      const zip = form.zip.trim();
      if (zip === '') patch.zip = null;
      else if (/^\d{5}$/.test(zip)) patch.zip = zip;
      const yrs = form.yearsExperience.trim();
      if (yrs === '') patch.yearsExperience = null;
      else {
        const n = Number.parseInt(yrs, 10);
        if (Number.isFinite(n) && n >= 0 && n <= 75) patch.yearsExperience = n;
      }
      const updated = await patchCaregiverProfile(patch);
      setProfile(updated);
      setForm(profileToForm(updated));
      setSaved(true);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSaving(false);
    }
  }

  function onCredentialsChange(credentials: CaregiverCredential[]) {
    setProfile((p) => (p ? { ...p, credentials } : p));
  }

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <View style={styles.appBar}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8} style={styles.backBtn}>
          <Icon name="chevron-left" size={22} color={colors.ink} />
        </Pressable>
        <Text style={styles.heading}>Profile</Text>
        {profile ? (
          <Pressable
            onPress={() => setPreview((v) => !v)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.previewToggle, { opacity: pressed ? 0.85 : 1 }, preview && styles.previewToggleOn]}
          >
            <Icon name="eye" size={16} color={preview ? colors.inkInv : colors.ink} />
            <Text style={[styles.previewToggleText, preview && { color: colors.inkInv }]}>
              {preview ? 'Editing' : 'Preview'}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
      </View>

      {loading ? <Text style={styles.muted}>Loading…</Text> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {role && role !== 'caregiver' && !loading ? (
        <Notice tone="warn">The profile builder is for Caregivers.</Notice>
      ) : null}

      {profile && form && preview ? (
        <ProfilePreview profile={profile} form={form} />
      ) : null}

      {profile && form && !preview ? (
        <View style={{ gap: spacing.md }}>
          <SectionCard title="Identity" hint="What Parents see at the top of your profile.">
            <AvatarUpload
              photoUrl={profile.photoUrl}
              initials={identityInitials(form.displayName)}
              size={84}
              onUploaded={setProfile}
            />
            <View style={{ height: spacing.lg }} />
            <TextField label="Display name" value={form.displayName} onChangeText={(v) => patchForm({ displayName: v })} placeholder="e.g. Maya G." autoCapitalize="words" />
            <View style={{ height: spacing.md }} />
            <TextField label="Headline" value={form.headline} onChangeText={(v) => patchForm({ headline: v })} placeholder="One short line under your name" autoCapitalize="sentences" helper={`${form.headline.length}/120`} />
            <View style={{ height: spacing.md }} />
            <View style={styles.rateRow}>
              <View style={{ flex: 1 }}>
                <TextField label="ZIP" value={form.zip} onChangeText={(v) => patchForm({ zip: v.replace(/\D/g, '').slice(0, 5) })} placeholder="90210" keyboardType="number-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <TextField label="Years of experience" value={form.yearsExperience} onChangeText={(v) => patchForm({ yearsExperience: v.replace(/\D/g, '').slice(0, 2) })} placeholder="4" keyboardType="number-pad" />
              </View>
            </View>
            <View style={{ height: spacing.md }} />
            <MultilineField label="About" value={form.bio} onChangeText={(v) => patchForm({ bio: v })} placeholder="How you work — experience, ages, approach." max={600} />
          </SectionCard>

          <SectionCard title="Specialties & languages" hint="Tags Parents filter by. Tap to toggle; the lists below are suggestions.">
            <Text style={styles.fieldLabel}>Specialties</Text>
            <View style={{ height: spacing.sm }} />
            <ChipMultiSelect
              options={tagChips(SPECIALTY_OPTIONS, form.specialties).map((t) => ({ value: t, label: t }))}
              selected={form.specialties}
              onChange={(specialties) => patchForm({ specialties })}
            />
            <View style={{ height: spacing.lg }} />
            <Text style={styles.fieldLabel}>Languages</Text>
            <View style={{ height: spacing.sm }} />
            <ChipMultiSelect
              options={tagChips(LANGUAGE_OPTIONS, form.languages).map((t) => ({ value: t, label: t }))}
              selected={form.languages}
              onChange={(languages) => patchForm({ languages })}
            />
          </SectionCard>

          <SectionCard title="Rates" hint="Set an hourly rate per category. The lowest drives your “from $X”.">
            {profile.categories.map((cat) => (
              <RateEditor
                key={cat}
                category={cat}
                rate={form.rates[cat]?.rate ?? ''}
                surcharge={form.rates[cat]?.surcharge ?? ''}
                onRate={(v) => patchForm({ rates: { ...form.rates, [cat]: { rate: v, surcharge: form.rates[cat]?.surcharge ?? '' } } })}
                onSurcharge={(v) => patchForm({ rates: { ...form.rates, [cat]: { rate: form.rates[cat]?.rate ?? '', surcharge: v } } })}
              />
            ))}
          </SectionCard>

          <SectionCard title="Availability" hint="Toggle the bands you’re usually open. Morning 6–12, Afternoon 12–6, Evening 6–10.">
            <AvailabilityEditor grid={form.grid} onToggle={(grid) => patchForm({ grid })} />
            <View style={{ height: spacing.md }} />
            <MultilineField label="Note" value={form.note} onChangeText={(v) => patchForm({ note: v })} placeholder="Optional — e.g. “Flexible weekends, last-minute OK.”" max={AVAILABILITY_NOTE_MAX} />
            <View style={{ height: spacing.md }} />
            <ToggleRow
              title="Pause new requests"
              blurb="Paused profiles are hidden from search. Existing bookings continue."
              value={form.paused}
              onValueChange={(v) => patchForm({ paused: v })}
            />
          </SectionCard>

          <SectionCard title="Negotiation">
            <ToggleRow
              title="Open to rate negotiation"
              blurb="When off, Parents can only Accept or Decline — the Counter affordance is hidden and the rate locks to your published rate."
              value={form.negotiable}
              onValueChange={(v) => patchForm({ negotiable: v })}
            />
          </SectionCard>

          <SectionCard title="Ages served" hint="The age ranges you work with. Used by search filters.">
            <ChipMultiSelect
              options={AGE_BAND_OPTIONS}
              selected={form.agesServed}
              onChange={(agesServed) => patchForm({ agesServed })}
            />
          </SectionCard>

          <SectionCard title="Behaviour comfort" hint="Atypical behaviours you’re comfortable supporting. Matched against a family’s disclosed behaviours.">
            <ChipMultiSelect
              options={BEHAVIOUR_OPTIONS}
              selected={form.behaviourComfort}
              onChange={(behaviourComfort) => patchForm({ behaviourComfort })}
            />
          </SectionCard>

          <SectionCard title="Credentials" hint="Optional qualifications. Each is reviewed by our team and hidden from your public profile until approved.">
            <CredentialsEditor credentials={profile.credentials} onChange={onCredentialsChange} onError={setError} />
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

/* ── section card ───────────────────────────────────────────────────────────── */

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

/* ── multiline field ────────────────────────────────────────────────────────── */

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
      <Text style={styles.counter}>{value.length}/{max}</Text>
    </View>
  );
}

/* ── per-category rate editor ───────────────────────────────────────────────── */

function RateEditor({
  category,
  rate,
  surcharge,
  onRate,
  onSurcharge,
}: {
  category: Category;
  rate: string;
  surcharge: string;
  onRate: (v: string) => void;
  onSurcharge: (v: string) => void;
}) {
  const showSurcharge = isSurchargeCategory(category);
  return (
    <View style={styles.rateBlock}>
      <Text style={styles.rateCat}>{CATEGORY_LABELS[category]}</Text>
      <View style={styles.rateRow}>
        <View style={{ flex: 1 }}>
          <TextField label="Hourly rate ($)" value={rate} onChangeText={onRate} placeholder="0.00" keyboardType="decimal-pad" />
        </View>
        {showSurcharge ? (
          <View style={{ flex: 1 }}>
            <TextField label="Per-child + ($/hr)" value={surcharge} onChangeText={onSurcharge} placeholder="0.00" keyboardType="decimal-pad" />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ── availability grid ──────────────────────────────────────────────────────── */

function AvailabilityEditor({ grid, onToggle }: { grid: Grid; onToggle: (grid: Grid) => void }) {
  function toggle(day: string, band: string) {
    const on = grid[day]?.[band] === true;
    const next: Grid = { ...grid, [day]: { ...(grid[day] ?? {}) } };
    if (on) delete next[day]![band];
    else next[day]![band] = true;
    onToggle(next);
  }
  return (
    <View>
      <View style={styles.gridHeaderRow}>
        <View style={styles.gridDayCol} />
        {AVAILABILITY_BANDS.map((b) => (
          <View key={b.key} style={styles.gridHeadCell}>
            <Text style={styles.gridHeadLabel}>{b.label}</Text>
            <Text style={styles.gridHeadTime}>{b.time}</Text>
          </View>
        ))}
      </View>
      {AVAILABILITY_DAYS.map((d) => (
        <View key={d.key} style={styles.gridRow}>
          <Text style={[styles.gridDayCol, styles.gridDayLabel]}>{d.label}</Text>
          {AVAILABILITY_BANDS.map((b) => {
            const on = grid[d.key]?.[b.key] === true;
            return (
              <Pressable
                key={b.key}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${d.label} ${b.label}`}
                onPress={() => toggle(d.key, b.key)}
                style={[styles.cell, on ? styles.cellOn : styles.cellOff]}
              >
                {on ? <Icon name="check" size={13} color={colors.inkInv} /> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/* ── chip multi-select ──────────────────────────────────────────────────────── */

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

/* ── toggle row ─────────────────────────────────────────────────────────────── */

function ToggleRow({
  title,
  blurb,
  value,
  onValueChange,
}: {
  title: string;
  blurb?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.toggleTitle}>{title}</Text>
        {blurb ? <Text style={styles.toggleBlurb}>{blurb}</Text> : null}
      </View>
      <Toggle value={value} onValueChange={onValueChange} label={title} />
    </View>
  );
}

function Toggle({ value, onValueChange, label }: { value: boolean; onValueChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onValueChange(!value)}
      style={[styles.switch, value ? styles.switchOn : styles.switchOff]}
    >
      <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
    </Pressable>
  );
}

/* ── credentials editor ─────────────────────────────────────────────────────── */

function CredentialsEditor({
  credentials,
  onChange,
  onError,
}: {
  credentials: CaregiverCredential[];
  onChange: (next: CaregiverCredential[]) => void;
  onError: (msg: string) => void;
}) {
  const [type, setType] = useState<CredentialType>('certification');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    const trimmed = label.trim();
    if (trimmed === '') return;
    setBusy(true);
    try {
      const { credential } = await addCaregiverCredential({ type, label: trimmed });
      onChange([...credentials, credential]);
      setLabel('');
    } catch (err) {
      onError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await deleteCaregiverCredential(id);
      onChange(credentials.filter((c) => c.id !== id));
    } catch (err) {
      onError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {credentials.length === 0 ? <Text style={styles.muted}>No credentials yet.</Text> : null}
      {credentials.map((c) => (
        <View key={c.id} style={styles.credRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.credLabel}>{c.label}</Text>
            <View style={styles.credMetaRow}>
              <Text style={styles.credType}>{CREDENTIAL_TYPE_LABELS[c.type]}</Text>
              <StatusPill review={c.review} statusLabel={c.statusLabel} />
            </View>
          </View>
          <Pressable onPress={() => remove(c.id)} disabled={busy} accessibilityRole="button" hitSlop={6}>
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        </View>
      ))}

      <View style={styles.addCred}>
        <View style={styles.typeRow}>
          {CREDENTIAL_TYPE_OPTIONS.map((o) => {
            const on = o.value === type;
            return (
              <Pressable key={o.value} onPress={() => setType(o.value)} style={[styles.typeChip, on ? styles.chipOn : styles.chipOff]}>
                <Text style={[styles.chipText, on && { color: colors.inkInv }]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ height: spacing.sm }} />
        <TextField label="Credential" value={label} onChangeText={setLabel} placeholder="e.g. CPR / First Aid" autoCapitalize="words" />
        {type === 'title' ? (
          <View style={{ marginTop: spacing.sm }}>
            <Notice tone="warn">Titles that read as a licensed clinical role (e.g. “Nurse”) may be rejected to keep the Caregiver/Provider line clear.</Notice>
          </View>
        ) : null}
        <View style={{ height: spacing.sm }} />
        <Pressable
          onPress={add}
          disabled={busy || label.trim() === ''}
          accessibilityRole="button"
          style={({ pressed }) => [styles.addBtn, { opacity: busy || label.trim() === '' ? 0.5 : pressed ? 0.9 : 1 }]}
        >
          <Icon name="plus" size={16} color={colors.ink} />
          <Text style={styles.addBtnText}>Add credential</Text>
        </Pressable>
      </View>
    </View>
  );
}

function StatusPill({ review, statusLabel }: { review: CaregiverCredential['review']; statusLabel: string }) {
  const tone =
    review === 'approved'
      ? { bg: 'rgba(47,122,77,0.14)', fg: colors.success, icon: 'check' as const }
      : review === 'rejected'
        ? { bg: 'rgba(178,58,47,0.12)', fg: colors.danger, icon: 'info' as const }
        : { bg: colors.surfaceAlt, fg: colors.ink2, icon: 'clock' as const };
  return (
    <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
      <Icon name={tone.icon} size={11} color={tone.fg} />
      <Text style={[styles.statusText, { color: tone.fg }]}>{statusLabel}</Text>
    </View>
  );
}

/* ── read-only Parent preview ───────────────────────────────────────────────── */

function ProfilePreview({ profile, form }: { profile: CaregiverProfile; form: FormState }) {
  const [activeCat, setActiveCat] = useState<Category>(profile.categories[0] ?? 'babysitter');
  const approved = profile.credentials.filter((c) => c.review === 'approved');
  const rateCents = dollarsToCents(form.rates[activeCat]?.rate ?? '');
  const ageLabels = form.agesServed.map((a) => AGE_BAND_OPTIONS.find((o) => o.value === a)?.label ?? a);
  const behaviourLabels = form.behaviourComfort.map((b) => BEHAVIOUR_OPTIONS.find((o) => o.value === b)?.label ?? b);
  const initials = (form.displayName.trim() || 'Y N')
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const days = AVAILABILITY_DAYS.filter((d) => AVAILABILITY_BANDS.some((b) => form.grid[d.key]?.[b.key])).map((d) => d.label);

  return (
    <View style={styles.card}>
      <Text style={styles.previewEyebrow}>Parent view · read-only</Text>
      <View style={styles.previewInner}>
        {form.paused ? <Notice tone="warn">Paused — hidden from search.</Notice> : null}
        <View style={styles.previewHead}>
          {profile.photoUrl ? (
            <Image source={{ uri: profile.photoUrl }} style={styles.previewAvatar} resizeMode="cover" />
          ) : (
            <View style={styles.previewAvatar}>
              <Text style={styles.previewInitials}>{initials}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.previewName}>{form.displayName.trim() || 'Your name'}</Text>
            {form.headline.trim() ? <Text style={styles.previewHeadline}>{form.headline.trim()}</Text> : null}
          </View>
        </View>

        {profile.categories.length > 1 ? (
          <View style={styles.catSwitch}>
            {profile.categories.map((cat) => {
              const on = cat === activeCat;
              return (
                <Pressable key={cat} onPress={() => setActiveCat(cat)} style={[styles.catSwitchBtn, on ? styles.chipOn : styles.chipOff]}>
                  <Text style={[styles.chipText, on && { color: colors.inkInv }]}>{CATEGORY_LABELS[cat]}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.previewRateRow}>
          <View>
            <Text style={styles.previewFrom}>{CATEGORY_LABELS[activeCat]}</Text>
            <Text style={styles.previewRate}>{rateLabel(rateCents)}</Text>
          </View>
          {!form.negotiable ? <Text style={styles.previewLock}>Rate locked</Text> : null}
        </View>

        {form.bio.trim() ? <Text style={styles.previewBio}>{form.bio.trim()}</Text> : null}

        {days.length > 0 ? (
          <Text style={styles.previewMeta}>Available: {days.join(', ')}</Text>
        ) : null}

        {form.specialties.length > 0 ? <PreviewChips title="Specialties" items={form.specialties} /> : null}
        {form.languages.length > 0 ? <PreviewChips title="Languages" items={form.languages} /> : null}
        {ageLabels.length > 0 ? <PreviewChips title="Ages served" items={ageLabels} /> : null}
        {behaviourLabels.length > 0 ? <PreviewChips title="Comfortable supporting" items={behaviourLabels} /> : null}

        {approved.length > 0 ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={styles.previewSection}>Credentials</Text>
            {approved.map((c) => (
              <View key={c.id} style={styles.previewCred}>
                <Icon name="check-circle" size={14} color={colors.success} />
                <Text style={styles.previewCredText}>{c.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {approved.length === 0 && profile.credentials.length > 0 ? (
          <Text style={[styles.previewMeta, { marginTop: spacing.md }]}>Pending credentials are hidden until approved.</Text>
        ) : null}
      </View>
    </View>
  );
}

function PreviewChips({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={styles.previewSection}>{title}</Text>
      <View style={styles.chips}>
        {items.map((t) => (
          <View key={t} style={styles.previewChip}>
            <Text style={styles.previewChipText}>{t}</Text>
          </View>
        ))}
      </View>
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
  previewToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  previewToggleOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  previewToggleText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink3 },

  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.xl, ...shadow.e1 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 16, letterSpacing: -0.3, color: colors.ink },
  cardHint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 4 },

  fieldLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  multiline: { marginTop: 6, minHeight: 96, borderRadius: radii.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, padding: 14, fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  counter: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3, marginTop: 6, textAlign: 'right' },

  rateBlock: { marginBottom: spacing.md },
  rateCat: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink, marginBottom: spacing.sm },
  rateRow: { flexDirection: 'row', gap: spacing.md },

  gridHeaderRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: spacing.sm },
  gridDayCol: { width: 52 },
  gridHeadCell: { flex: 1, alignItems: 'center' },
  gridHeadLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },
  gridHeadTime: { fontFamily: fonts.regular, fontSize: 10, color: colors.ink3, marginTop: 1 },
  gridRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  gridDayLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  cell: { flex: 1, height: 40, marginHorizontal: 4, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  cellOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  cellOff: { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1.5 },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipOff: { backgroundColor: colors.surface, borderColor: colors.hairline },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toggleTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  toggleBlurb: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 3 },
  switch: { width: 48, height: 28, borderRadius: radii.pill, padding: 2, justifyContent: 'center' },
  switchOn: { backgroundColor: colors.brand },
  switchOff: { backgroundColor: colors.monoGray },
  knob: { width: 24, height: 24, borderRadius: radii.pill, backgroundColor: colors.surface },
  knobOn: { alignSelf: 'flex-end' },
  knobOff: { alignSelf: 'flex-start' },

  credRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  credLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  credMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  credType: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  removeText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.danger },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 22, paddingHorizontal: 9, borderRadius: radii.pill },
  statusText: { fontFamily: fonts.semibold, fontSize: 11 },

  addCred: { marginTop: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.hairline },
  typeRow: { flexDirection: 'row', gap: spacing.sm },
  typeChip: { height: 34, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.surface },
  addBtnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  previewEyebrow: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  previewInner: { marginTop: spacing.md, backgroundColor: colors.canvas, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  previewAvatar: { width: 52, height: 52, borderRadius: radii.pill, backgroundColor: colors.catSpec, alignItems: 'center', justifyContent: 'center' },
  previewInitials: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  previewName: { fontFamily: fonts.bold, fontSize: 16, letterSpacing: -0.3, color: colors.ink },
  previewHeadline: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 2 },
  catSwitch: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  catSwitchBtn: { height: 34, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  previewRateRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.hairline },
  previewFrom: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink2 },
  previewRate: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.5, color: colors.ink },
  previewLock: { fontFamily: fonts.semibold, fontSize: 11, color: colors.ink2 },
  previewBio: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2, marginTop: spacing.sm },
  previewMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  previewSection: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2, marginBottom: spacing.sm },
  previewChip: { height: 30, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, justifyContent: 'center' },
  previewChipText: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink },
  previewCred: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  previewCredText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink },
});
