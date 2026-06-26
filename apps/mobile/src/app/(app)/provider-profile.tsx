/**
 * Provider (clinical) profile builder (OH-189) — the Provider-editable profile:
 * specialty + per-session display Rate (display-only; Provider payment is
 * off-platform), identity (display name / headline / bio), consultation-slot
 * publishing (the dated windows the M2.7 scheduler surfaces to Parents), and a
 * read-only license/insurance/screening credential-status badge (uploads happen
 * on the Verification screen). A read-only Parent preview rounds it out. Reached
 * from Account (provider only).
 *
 * Design reference: Claude design project — web-screens/provider-profile.jsx
 * (translated to RN/Expo primitives + tokens).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/components/Icon';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TextField } from '@/components/ui/TextField';
import {
  ApiError,
  getProviderProfile,
  listConsultationSlots,
  patchProviderProfile,
  publishConsultationSlot,
  withdrawConsultationSlot,
  type ConsultationSlot,
  type ProviderClinicalProfile,
  type ProviderCredentialStatus,
  type ProviderSpecialty,
} from '@/api/client';
import {
  DOC_STATUS_LABELS,
  OVERALL_STATUS_LABELS,
  SLOT_TIME_OPTIONS,
  SPECIALTY_LABELS,
  SPECIALTY_OPTIONS,
  centsToDollars,
  dollarsToCents,
  minToLabel,
  overallStatusTone,
  sessionRateLabel,
  slotWindowLabel,
  specialtyLabel,
} from '@/lib/provider-profile';
import { colors, fonts, radii, shadow, spacing } from '@/theme/tokens';

const DURATION_OPTIONS = [30, 45, 60, 90];

interface FormState {
  specialty: ProviderSpecialty | null;
  displayName: string;
  headline: string;
  bio: string;
  rate: string;
}

function profileToForm(p: ProviderClinicalProfile): FormState {
  return {
    specialty: p.specialty,
    displayName: p.displayName ?? '',
    headline: p.headline ?? '',
    bio: p.bio ?? '',
    rate: centsToDollars(p.perSessionRateCents),
  };
}

function blankToNull(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

export default function ProviderProfileScreen() {
  const router = useRouter();
  const { role } = useAuth();
  const [profile, setProfile] = useState<ProviderClinicalProfile | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [slots, setSlots] = useState<ConsultationSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [p, s] = await Promise.all([getProviderProfile(), listConsultationSlots()]);
        if (!alive) return;
        setProfile(p);
        setForm(profileToForm(p));
        setSlots(s.slots);
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
      const updated = await patchProviderProfile({
        specialty: form.specialty ?? undefined,
        displayName: blankToNull(form.displayName),
        headline: blankToNull(form.headline),
        bio: blankToNull(form.bio),
        perSessionRateCents: dollarsToCents(form.rate),
      });
      setProfile(updated);
      setForm(profileToForm(updated));
      setSaved(true);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSaving(false);
    }
  }

  const wrongRole = role && role !== 'provider' && !loading;

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
      {wrongRole ? <Notice tone="warn">This profile builder is for clinical Providers.</Notice> : null}

      {profile && form && preview ? <ProfilePreview profile={profile} form={form} slots={slots} /> : null}

      {profile && form && !preview ? (
        <View style={{ gap: spacing.md }}>
          <SectionCard title="Identity" hint="What Parents see at the top of your profile.">
            <TextField label="Display name" value={form.displayName} onChangeText={(v) => patchForm({ displayName: v })} placeholder="e.g. Dr. Maya Greene" autoCapitalize="words" />
            <View style={{ height: spacing.md }} />
            <TextField label="Headline" value={form.headline} onChangeText={(v) => patchForm({ headline: v })} placeholder="One short line under your name" autoCapitalize="sentences" helper={`${form.headline.length}/120`} />
            <View style={{ height: spacing.md }} />
            <MultilineField label="About" value={form.bio} onChangeText={(v) => patchForm({ bio: v })} placeholder="Your clinical focus, approach, and who you help." max={600} />
          </SectionCard>

          <SectionCard title="Specialty" hint="Your clinical discipline. Drives discovery and which license board verifies you.">
            <SpecialtyPicker value={form.specialty} onChange={(specialty) => patchForm({ specialty })} />
          </SectionCard>

          <SectionCard title="Per-session rate" hint="Shown to Parents as a guide. Payment for clinical sessions is arranged off-platform.">
            <TextField label="Rate per session ($)" value={form.rate} onChangeText={(v) => patchForm({ rate: v })} placeholder="0.00" keyboardType="decimal-pad" />
          </SectionCard>

          <SectionCard title="Consultation slots" hint="Publish the windows you’re open for consultations. Parents book an open slot directly.">
            <SlotManager slots={slots} onChange={setSlots} onError={setError} />
          </SectionCard>

          <SectionCard title="Verification" hint="Your license, insurance and background check. Managed on the Verification screen; status shown here.">
            <CredentialStatusView status={profile.credentialStatus} />
            <View style={{ height: spacing.md }} />
            <Pressable
              onPress={() => router.push('/verification')}
              accessibilityRole="button"
              style={({ pressed }) => [styles.linkBtn, { opacity: pressed ? 0.9 : 1 }]}
            >
              <Icon name="shield" size={16} color={colors.ink} />
              <Text style={styles.linkBtnText}>Manage verification</Text>
            </Pressable>
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

/* ── specialty single-select ────────────────────────────────────────────────── */

function SpecialtyPicker({
  value,
  onChange,
}: {
  value: ProviderSpecialty | null;
  onChange: (next: ProviderSpecialty) => void;
}) {
  return (
    <View style={styles.chips}>
      {SPECIALTY_OPTIONS.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
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

/* ── consultation-slot manager ──────────────────────────────────────────────── */

function SlotManager({
  slots,
  onChange,
  onError,
}: {
  slots: ConsultationSlot[];
  onChange: (next: ConsultationSlot[]) => void;
  onError: (msg: string) => void;
}) {
  const [date, setDate] = useState('');
  const [startMin, setStartMin] = useState(540); // 9:00 AM
  const [duration, setDuration] = useState(60);
  const [busy, setBusy] = useState(false);

  const endMin = Math.min(startMin + duration, 1440);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date.trim());

  async function add() {
    if (!dateValid) {
      onError('Enter the date as YYYY-MM-DD.');
      return;
    }
    setBusy(true);
    try {
      const slot = await publishConsultationSlot({ date: date.trim(), startMin, endMin });
      // Keep the list sorted by date then start.
      onChange([...slots, slot].sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin));
      setDate('');
    } catch (err) {
      onError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await withdrawConsultationSlot(id);
      onChange(slots.filter((s) => s.id !== id));
    } catch (err) {
      onError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {slots.length === 0 ? <Text style={styles.muted}>No slots published yet.</Text> : null}
      {slots.map((s) => (
        <View key={s.id} style={styles.slotRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.slotLabel}>{slotWindowLabel(s.date, s.startMin, s.endMin)}</Text>
            <Text style={styles.slotMeta}>{s.bookable ? 'Open · bookable' : 'Booked'}</Text>
          </View>
          {s.bookable ? (
            <Pressable onPress={() => remove(s.id)} disabled={busy} accessibilityRole="button" hitSlop={6}>
              <Text style={styles.removeText}>Withdraw</Text>
            </Pressable>
          ) : (
            <View style={styles.heldPill}>
              <Icon name="lock" size={11} color={colors.ink2} />
              <Text style={styles.heldText}>Held</Text>
            </View>
          )}
        </View>
      ))}

      <View style={styles.addSlot}>
        <TextField label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
        <View style={{ height: spacing.sm }} />
        <Text style={styles.fieldLabel}>Start time</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeRow}>
          {SLOT_TIME_OPTIONS.map((o) => {
            const min = Number(o.value);
            const on = min === startMin;
            return (
              <Pressable key={o.value} onPress={() => setStartMin(min)} style={[styles.timeChip, on ? styles.chipOn : styles.chipOff]}>
                <Text style={[styles.timeChipText, on && { color: colors.inkInv }]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={{ height: spacing.sm }} />
        <Text style={styles.fieldLabel}>Duration</Text>
        <View style={styles.timeRow}>
          {DURATION_OPTIONS.map((d) => {
            const on = d === duration;
            return (
              <Pressable key={d} onPress={() => setDuration(d)} style={[styles.timeChip, on ? styles.chipOn : styles.chipOff]}>
                <Text style={[styles.timeChipText, on && { color: colors.inkInv }]}>{d} min</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ height: spacing.sm }} />
        <Text style={styles.slotPreview}>
          {dateValid ? `${minToLabel(startMin)} – ${minToLabel(endMin)}` : 'Pick a date to publish a slot.'}
        </Text>
        <Pressable
          onPress={add}
          disabled={busy || !dateValid}
          accessibilityRole="button"
          style={({ pressed }) => [styles.addBtn, { opacity: busy || !dateValid ? 0.5 : pressed ? 0.9 : 1 }]}
        >
          <Icon name="plus" size={16} color={colors.ink} />
          <Text style={styles.addBtnText}>Publish slot</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ── credential status (read-only) ──────────────────────────────────────────── */

function CredentialStatusView({ status }: { status: ProviderCredentialStatus }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.overallRow}>
        <Text style={styles.overallLabel}>Overall</Text>
        <OverallBadge overall={status.overall} />
      </View>
      <DocRow label="License" status={status.license} />
      <DocRow label="Insurance" status={status.insurance} />
      <DocRow label="Background check" status={status.screening === 'passed' ? 'verified' : 'missing'} customLabel={status.screening === 'passed' ? 'Passed' : 'Pending'} />
      {status.publiclyVerified ? (
        <Text style={styles.verifiedNote}>Parents see a “Verified” badge on your profile.</Text>
      ) : (
        <Text style={styles.muted}>The “Verified” badge appears once license, insurance and your background check are all cleared.</Text>
      )}
    </View>
  );
}

function OverallBadge({ overall }: { overall: ProviderCredentialStatus['overall'] }) {
  const tone = overallStatusTone(overall);
  const palette =
    tone === 'success'
      ? { bg: 'rgba(47,122,77,0.14)', fg: colors.success, icon: 'check' as const }
      : tone === 'danger'
        ? { bg: 'rgba(178,58,47,0.12)', fg: colors.danger, icon: 'info' as const }
        : tone === 'neutral'
          ? { bg: colors.surfaceAlt, fg: colors.ink2, icon: 'clock' as const }
          : { bg: colors.surfaceAlt, fg: colors.ink3, icon: 'clock' as const };
  return (
    <View style={[styles.statusPill, { backgroundColor: palette.bg }]}>
      <Icon name={palette.icon} size={11} color={palette.fg} />
      <Text style={[styles.statusText, { color: palette.fg }]}>{OVERALL_STATUS_LABELS[overall]}</Text>
    </View>
  );
}

function DocRow({
  label,
  status,
  customLabel,
}: {
  label: string;
  status: ProviderCredentialStatus['license'];
  customLabel?: string;
}) {
  const verified = status === 'verified';
  return (
    <View style={styles.docRow}>
      <Text style={styles.docLabel}>{label}</Text>
      <View style={styles.docStatus}>
        <Icon name={verified ? 'check-circle' : 'clock'} size={13} color={verified ? colors.success : colors.ink3} />
        <Text style={[styles.docStatusText, verified && { color: colors.success }]}>
          {customLabel ?? DOC_STATUS_LABELS[status]}
        </Text>
      </View>
    </View>
  );
}

/* ── read-only Parent preview ───────────────────────────────────────────────── */

function ProfilePreview({
  profile,
  form,
  slots,
}: {
  profile: ProviderClinicalProfile;
  form: FormState;
  slots: ConsultationSlot[];
}) {
  const rateCents = dollarsToCents(form.rate);
  const bookable = slots.filter((s) => s.bookable);
  const initials = (form.displayName.trim() || 'Dr')
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <View style={styles.card}>
      <Text style={styles.previewEyebrow}>Parent view · read-only</Text>
      <View style={styles.previewInner}>
        <View style={styles.previewHead}>
          <View style={styles.previewAvatar}>
            <Text style={styles.previewInitials}>{initials}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.previewName}>{form.displayName.trim() || 'Your name'}</Text>
            <Text style={styles.previewHeadline}>{form.headline.trim() || specialtyLabel(form.specialty)}</Text>
          </View>
          {profile.credentialStatus.publiclyVerified ? (
            <View style={styles.verifiedBadge}>
              <Icon name="check" size={11} color={colors.success} />
              <Text style={styles.verifiedBadgeText}>Verified</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.previewRateRow}>
          <View>
            <Text style={styles.previewFrom}>{specialtyLabel(form.specialty)}</Text>
            <Text style={styles.previewRate}>{sessionRateLabel(rateCents)}</Text>
          </View>
        </View>

        {form.bio.trim() ? <Text style={styles.previewBio}>{form.bio.trim()}</Text> : null}

        <View style={{ marginTop: spacing.md }}>
          <Text style={styles.previewSection}>Consultation slots</Text>
          {bookable.length === 0 ? (
            <Text style={styles.previewMeta}>No open slots right now.</Text>
          ) : (
            bookable.slice(0, 4).map((s) => (
              <View key={s.id} style={styles.previewSlot}>
                <Icon name="clock" size={13} color={colors.ink2} />
                <Text style={styles.previewSlotText}>{slotWindowLabel(s.date, s.startMin, s.endMin)}</Text>
              </View>
            ))
          )}
        </View>
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

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1.5 },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipOff: { backgroundColor: colors.surface, borderColor: colors.hairline },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  slotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  slotLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  slotMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },
  removeText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.danger },
  heldPill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 22, paddingHorizontal: 9, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  heldText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.ink2 },

  addSlot: { marginTop: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.hairline },
  timeRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm, flexWrap: 'wrap' },
  timeChip: { height: 34, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  timeChipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  slotPreview: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2, marginBottom: spacing.sm },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.surface },
  addBtnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  overallRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  overallLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  docRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.hairline },
  docLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  docStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  docStatusText: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  verifiedNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.success, marginTop: 2 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 22, paddingHorizontal: 9, borderRadius: radii.pill },
  statusText: { fontFamily: fonts.semibold, fontSize: 11 },

  linkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.surface },
  linkBtnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  previewEyebrow: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  previewInner: { marginTop: spacing.md, backgroundColor: colors.canvas, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  previewAvatar: { width: 52, height: 52, borderRadius: radii.pill, backgroundColor: colors.catSpec, alignItems: 'center', justifyContent: 'center' },
  previewInitials: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  previewName: { fontFamily: fonts.bold, fontSize: 16, letterSpacing: -0.3, color: colors.ink },
  previewHeadline: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 2 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 9, borderRadius: radii.pill, backgroundColor: 'rgba(47,122,77,0.14)' },
  verifiedBadgeText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.success },
  previewRateRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.hairline },
  previewFrom: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink2 },
  previewRate: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.5, color: colors.ink },
  previewBio: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2, marginTop: spacing.sm },
  previewSection: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2, marginBottom: spacing.sm },
  previewMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  previewSlot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  previewSlotText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink },
});
