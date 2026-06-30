/**
 * OfferComposer (OH-206) — the Parent's structured Book-request builder, opened
 * from a Direct-Message thread. Collects the concrete schedule (a single date or
 * several hand-picked dates → multi-day one-off, ADR-0014), the child count + ages
 * (Tutor is single-child), an EXPLICIT Safety-Behaviors disclosure (a chosen
 * subset of the Parent's checklist OR "Share none" — required before sending,
 * ADR-0016 / story 133), the service address (pre-filled from the Parent profile;
 * revealed to the Caregiver only on accept), and the rate (locked to the
 * Caregiver's published Rate when they are non-negotiable, ADR-0017). Shows a live
 * total preview. Shared native + web (RN primitives → RN-web).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import {
  getParentProfile,
  getSupplyProfile,
  type ComposeOfferBody,
  type ParentProfile,
  type SupplyProfile,
} from '@/api/client';
import { SAFETY_BEHAVIOR_OPTIONS } from '@/lib/parent-profile';
import { formatMoney } from '@/lib/offerCopy';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

type Category = 'babysitter' | 'tutor' | 'nanny';
const CATEGORY_LABEL: Record<Category, string> = { babysitter: 'Babysitter', tutor: 'Tutor', nanny: 'Nanny' };

interface SlotDraft {
  date: string;
  start: string;
  end: string;
}

export interface OfferComposerProps {
  visible: boolean;
  providerId: string;
  counterpartName: string;
  onClose: () => void;
  onSubmit: (body: ComposeOfferBody) => Promise<void>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `'6:00 PM'` → minutes-from-midnight, or null if unparseable. */
function parseClock(input: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])\s*$/.exec(input);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const pm = m[3]!.toLowerCase() === 'pm';
  if (h < 1 || h > 12 || min < 0 || min > 59) return null;
  if (h === 12) h = 0;
  if (pm) h += 12;
  return h * 60 + min;
}

function validDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const [y, mo, da] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, mo! - 1, da!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo! - 1 && dt.getUTCDate() === da;
}

function emptySlot(): SlotDraft {
  return { date: '', start: '', end: '' };
}

export function OfferComposer({ visible, providerId, counterpartName, onClose, onSubmit }: OfferComposerProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [supply, setSupply] = useState<SupplyProfile | null>(null);
  const [parent, setParent] = useState<ParentProfile | null>(null);

  const [category, setCategory] = useState<Category>('babysitter');
  const [slots, setSlots] = useState<SlotDraft[]>([emptySlot()]);
  const [childCount, setChildCount] = useState(1);
  const [childAges, setChildAges] = useState<string[]>(['']);
  const [disclosed, setDisclosed] = useState<Set<string>>(new Set());
  const [discloseNone, setDiscloseNone] = useState(false);
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [postal, setPostal] = useState('');
  const [rate, setRate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── load the Caregiver rates + the Parent profile on open ──────────────────
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const [s, p] = await Promise.all([getSupplyProfile(providerId), getParentProfile()]);
        if (cancelled) return;
        setSupply(s);
        setParent(p);
        const firstCat = (s.categoryRates[0]?.category ?? 'babysitter') as Category;
        setCategory(firstCat);
        const r = s.categoryRates.find((c) => c.category === firstCat)?.publishedRateCents ?? 0;
        setRate(r ? String(r / 100) : '');
        const a = p.defaultAddress;
        setLine1(a?.line1 ?? '');
        setLine2(a?.line2 ?? '');
        setCity(a?.city ?? '');
        setStateCode(a?.state ?? '');
        setPostal(a?.postalCode ?? '');
        setLoading(false);
      } catch {
        if (cancelled) return;
        setLoadError('Could not load booking details. Please try again.');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, providerId]);

  const negotiable = supply?.negotiable ?? true;
  const rateLocked = !negotiable;
  const categoryOptions = (supply?.categoryRates.map((c) => c.category) ?? []) as Category[];
  const selectedRate = supply?.categoryRates.find((c) => c.category === category);
  const surchargeCents = category === 'tutor' ? 0 : (selectedRate?.perChildSurchargeCents ?? 0);
  const profileBehaviors = parent?.safetyBehaviors ?? [];

  const onPickCategory = (c: Category) => {
    setCategory(c);
    const r = supply?.categoryRates.find((x) => x.category === c)?.publishedRateCents ?? 0;
    setRate(r ? String(r / 100) : '');
    if (c === 'tutor') {
      setChildCount(1);
      setChildAges((prev) => [prev[0] ?? '']);
    }
  };

  const setCount = (n: number) => {
    const next = Math.max(1, Math.min(category === 'tutor' ? 1 : 12, n));
    setChildCount(next);
    setChildAges((prev) => {
      const copy = [...prev];
      copy.length = next;
      return copy.map((v) => v ?? '');
    });
  };

  const toggleBehavior = (v: string) => {
    setDiscloseNone(false);
    setDisclosed((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  // ── live total preview ─────────────────────────────────────────────────────
  const totalMinutes = useMemo(
    () =>
      slots.reduce((sum, s) => {
        const a = parseClock(s.start);
        const b = parseClock(s.end);
        return a != null && b != null && b > a ? sum + (b - a) : sum;
      }, 0),
    [slots],
  );
  const rateCents = Math.round((Number(rate) || 0) * 100);
  const previewTotal = useMemo(() => {
    const hours = totalMinutes / 60;
    const base = Math.round(rateCents * hours);
    const sur = Math.round(surchargeCents * hours * Math.max(0, childCount - 1));
    return base + sur;
  }, [rateCents, totalMinutes, surchargeCents, childCount]);

  const disclosureChosen = discloseNone || disclosed.size > 0;
  const agesValid = childAges.length === childCount && childAges.every((a) => /^\d{1,2}$/.test(a) && Number(a) <= 17);
  const slotsValid =
    slots.length > 0 &&
    slots.every((s) => {
      const a = parseClock(s.start);
      const b = parseClock(s.end);
      return validDate(s.date) && a != null && b != null && b > a;
    });
  const canSubmit = !submitting && !loading && rateCents > 0 && agesValid && slotsValid && disclosureChosen;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const parsed = slots.map((s) => ({
        date: s.date,
        startMin: parseClock(s.start)!,
        endMin: parseClock(s.end)!,
      }));
      const schedule: ComposeOfferBody['schedule'] =
        parsed.length === 1 ? { kind: 'one-off', slot: parsed[0]! } : { kind: 'multi-day', slots: parsed };
      const anyAddr = [line1, line2, city, stateCode, postal].some((v) => v.trim() !== '');
      const body: ComposeOfferBody = {
        category,
        proposedRateCents: rateCents,
        childCount,
        childAges: childAges.map((a) => Number(a)),
        safetyBehaviors: (discloseNone ? [] : [...disclosed]) as ComposeOfferBody['safetyBehaviors'],
        serviceAddress: anyAddr
          ? {
              line1: line1.trim() || null,
              line2: line2.trim() || null,
              city: city.trim() || null,
              state: stateCode.trim() || null,
              postalCode: postal.trim() || null,
            }
          : null,
        schedule,
      };
      await onSubmit(body);
      onClose();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not send your booking request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.sheet}>
        <View style={styles.handleRow}>
          <Text style={styles.heading}>Send a booking request</Text>
          <Pressable onPress={onClose} accessibilityLabel="Close" style={styles.close} hitSlop={8}>
            <Icon name="x" size={20} color={colors.ink2} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.fill}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : loadError ? (
          <View style={styles.fill}>
            <Text style={styles.err}>{loadError}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.lead}>Propose the time, children, and rate to {counterpartName.split(' ')[0]}.</Text>

            {/* Category */}
            {categoryOptions.length > 1 ? (
              <Field label="Service">
                <View style={styles.chips}>
                  {categoryOptions.map((c) => (
                    <Chip key={c} label={CATEGORY_LABEL[c]} active={c === category} onPress={() => onPickCategory(c)} />
                  ))}
                </View>
              </Field>
            ) : null}

            {/* Schedule */}
            <Field label={slots.length > 1 ? 'Dates' : 'Date & time'}>
              {slots.map((s, i) => (
                <View key={i} style={styles.slotCard}>
                  {slots.length > 1 ? (
                    <View style={styles.slotHead}>
                      <Text style={styles.slotIdx}>Date {i + 1}</Text>
                      <Pressable onPress={() => setSlots((p) => p.filter((_, j) => j !== i))} hitSlop={6}>
                        <Icon name="trash" size={15} color={colors.ink3} />
                      </Pressable>
                    </View>
                  ) : null}
                  <Input
                    placeholder="Date (YYYY-MM-DD)"
                    value={s.date}
                    onChangeText={(v) => setSlots((p) => p.map((x, j) => (j === i ? { ...x, date: v } : x)))}
                  />
                  <View style={styles.timeRow}>
                    <Input
                      placeholder="Start (6:00 PM)"
                      value={s.start}
                      onChangeText={(v) => setSlots((p) => p.map((x, j) => (j === i ? { ...x, start: v } : x)))}
                      style={styles.timeInput}
                    />
                    <Input
                      placeholder="End (9:00 PM)"
                      value={s.end}
                      onChangeText={(v) => setSlots((p) => p.map((x, j) => (j === i ? { ...x, end: v } : x)))}
                      style={styles.timeInput}
                    />
                  </View>
                </View>
              ))}
              <Pressable onPress={() => setSlots((p) => [...p, emptySlot()])} style={styles.addRow} hitSlop={6}>
                <Icon name="plus" size={15} color={colors.brand} />
                <Text style={styles.addText}>Add another date</Text>
              </Pressable>
            </Field>

            {/* Children */}
            <Field label="Children">
              <View style={styles.stepperRow}>
                <Text style={styles.stepLabel}>How many?</Text>
                <View style={styles.stepper}>
                  <Pressable onPress={() => setCount(childCount - 1)} disabled={category === 'tutor'} style={styles.stepBtn} hitSlop={6}>
                    <Icon name="x" size={12} color={colors.ink2} />
                  </Pressable>
                  <Text style={styles.stepN}>{childCount}</Text>
                  <Pressable onPress={() => setCount(childCount + 1)} disabled={category === 'tutor'} style={styles.stepBtn} hitSlop={6}>
                    <Icon name="plus" size={14} color={colors.ink2} />
                  </Pressable>
                </View>
              </View>
              {category === 'tutor' ? <Text style={styles.hint}>Tutoring is one child per booking.</Text> : null}
              <View style={styles.ageRow}>
                {childAges.map((a, i) => (
                  <Input
                    key={i}
                    placeholder={`Age ${i + 1}`}
                    value={a}
                    onChangeText={(v) => setChildAges((p) => p.map((x, j) => (j === i ? v.replace(/[^\d]/g, '') : x)))}
                    keyboardType="number-pad"
                    style={styles.ageInput}
                  />
                ))}
              </View>
            </Field>

            {/* Disclosure (explicit, required) */}
            <Field label="Share safety behaviours">
              <Text style={styles.discLead}>
                Choose what to share so this caregiver can judge fit. This is required — pick any that apply, or share none.
              </Text>
              {profileBehaviors.length > 0 ? (
                <View style={styles.chips}>
                  {profileBehaviors.map((b) => {
                    const opt = SAFETY_BEHAVIOR_OPTIONS.find((o) => o.value === b);
                    return (
                      <Chip
                        key={b}
                        label={opt?.label ?? b}
                        active={disclosed.has(b)}
                        onPress={() => toggleBehavior(b)}
                      />
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.hint}>You haven't added safety behaviours to your profile.</Text>
              )}
              <Pressable
                onPress={() => {
                  setDiscloseNone(true);
                  setDisclosed(new Set());
                }}
                style={[styles.noneRow, discloseNone && styles.noneRowActive]}
                hitSlop={6}
              >
                <Icon name={discloseNone ? 'check' : 'shield'} size={15} color={discloseNone ? colors.brand : colors.ink3} />
                <Text style={[styles.noneText, discloseNone && styles.noneTextActive]}>Share none</Text>
              </Pressable>
            </Field>

            {/* Service address */}
            <Field label="Service address (shared after they accept)">
              <Input placeholder="Street address" value={line1} onChangeText={setLine1} />
              <Input placeholder="Apt / unit (optional)" value={line2} onChangeText={setLine2} />
              <View style={styles.timeRow}>
                <Input placeholder="City" value={city} onChangeText={setCity} style={styles.timeInput} />
                <Input placeholder="ST" value={stateCode} onChangeText={(v) => setStateCode(v.toUpperCase().slice(0, 2))} style={styles.stateInput} />
                <Input placeholder="ZIP" value={postal} onChangeText={(v) => setPostal(v.replace(/[^\d]/g, '').slice(0, 5))} keyboardType="number-pad" style={styles.zipInput} />
              </View>
            </Field>

            {/* Rate */}
            <Field label="Rate">
              <View style={styles.rateRow}>
                <Text style={styles.dollar}>$</Text>
                <TextInput
                  value={rate}
                  onChangeText={(v) => setRate(v.replace(/[^\d.]/g, ''))}
                  editable={!rateLocked}
                  keyboardType="decimal-pad"
                  style={[styles.rateInput, rateLocked && styles.rateLocked]}
                  placeholder="0"
                  placeholderTextColor={colors.ink3}
                />
                <Text style={styles.perHr}>/ hour</Text>
              </View>
              {rateLocked ? <Text style={styles.hint}>This caregiver sets a fixed rate.</Text> : null}
            </Field>

            {/* Total + submit */}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Estimated total</Text>
              <Text style={styles.totalValue}>{formatMoney(previewTotal)}</Text>
            </View>
            {submitError ? <Text style={styles.err}>{submitError}</Text> : null}
            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              style={[styles.submit, !canSubmit && styles.submitDisabled]}
              accessibilityRole="button"
            >
              {submitting ? (
                <ActivityIndicator color={colors.inkInv} />
              ) : (
                <Text style={styles.submitText}>Send booking request</Text>
              )}
            </Pressable>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Input({ style, ...props }: React.ComponentProps<typeof TextInput>) {
  return <TextInput {...props} placeholderTextColor={colors.ink3} style={[styles.input, style]} />;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]} hitSlop={4}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.canvas },
  handleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  heading: { flex: 1, fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  close: { padding: 4 },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, textAlign: 'center' },

  body: { padding: 20, gap: 20, paddingBottom: 40 },
  lead: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, lineHeight: 20 },

  field: { gap: 8 },
  fieldLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  input: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 11 },

  slotCard: { backgroundColor: colors.surfaceAlt, borderRadius: radii.md, padding: 12, gap: 8 },
  slotHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slotIdx: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },
  timeRow: { flexDirection: 'row', gap: 8 },
  timeInput: { flex: 1 },
  stateInput: { width: 64, textAlign: 'center' },
  zipInput: { width: 88 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  addText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brand },

  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, paddingHorizontal: 12, paddingVertical: 6 },
  stepBtn: { padding: 4 },
  stepN: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, minWidth: 18, textAlign: 'center' },
  ageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ageInput: { width: 72 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },

  discLead: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, lineHeight: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  chipActive: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  chipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },
  chipTextActive: { color: colors.brand, fontFamily: fonts.semibold },
  noneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  noneRowActive: {},
  noneText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink3 },
  noneTextActive: { color: colors.brand, fontFamily: fonts.semibold },

  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 4 },
  dollar: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink2 },
  rateInput: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: colors.ink, paddingVertical: 11 },
  rateLocked: { color: colors.ink2 },
  perHr: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink3 },

  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  totalLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink2 },
  totalValue: { fontFamily: fonts.bold, fontSize: 22, color: colors.brand },
  submit: { backgroundColor: colors.brand, borderRadius: radii.lg, paddingVertical: 15, alignItems: 'center', ...shadow.e1 },
  submitDisabled: { opacity: 0.4 },
  submitText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
});
