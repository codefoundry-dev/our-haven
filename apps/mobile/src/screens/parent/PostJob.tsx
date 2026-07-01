/**
 * Post a Job (Parent) — OH-209. The multi-step composer that publishes a posted
 * Job open to verified in-category Caregivers (CONTEXT § Job; ADR-0014 schedule;
 * ADR-0016 disclose-or-none + timestamped consent).
 *
 *   Step 1 Basics     — category + one-off/recurring + scope description
 *   Step 2 Schedule    — one-off single/multi date+time, or an anchored recurring
 *                        rule with a live occurrence preview
 *   Step 3 Children     — count + ages + EXPLICIT Safety-Behaviors disclose-or-none
 *                        under a one-time timestamped consent
 *   Step 4 Location     — ZIP (+ optional street/budget) + review + Publish
 *
 * Draft autosave is client-side (`jobDraft`) — it survives leaving the screen and
 * the web checkout redirect; a `jobs` row is created only on publish. The
 * Subscription gate fires on PUBLISH (not on entering): an unsubscribed Parent
 * composes freely, then hits the paywall at publish and resumes here on return
 * (the stashed draft rehydrates). A multi-day one-off publishes one Job per date.
 *
 * The bespoke desktop layout lives in `@/screens/web/parent/PostJob`
 * (`ParentPostJobWeb`), chosen by `post-job.web.tsx` at wide web widths; this
 * native body renders on native and narrow web.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { getParentProfile, postJob, ApiError, type ParentProfile } from '@/api/client';
import { AppBar } from '@/components/AppBar';
import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { clearJobDraft, readJobDraft, saveJobDraft } from '@/lib/jobDraft';
import { useParentGate } from '@/lib/paywallGate';
import { SAFETY_BEHAVIOR_OPTIONS } from '@/lib/parent-profile';
import {
  buildJobBody,
  expandOccurrences,
  formatMin,
  parseClock,
  parseSlots,
  WEEKDAYS,
  type JobCategory,
  type JobComposeState,
  type RecurrenceDraft,
  type ScheduleMode,
  type SlotDraft,
} from '@/lib/postJob';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

const CATEGORIES: { value: JobCategory; label: string; tone: ColorToken; icon: IconName }[] = [
  { value: 'babysitter', label: 'Babysitter', tone: 'catBaby', icon: 'person' },
  { value: 'tutor', label: 'Tutor', tone: 'catTutor', icon: 'graduation' },
  { value: 'nanny', label: 'Nanny', tone: 'catNanny', icon: 'users' },
];

const STEP_TITLES = ['The basics', 'When', 'Children & safety', 'Location & publish'];

function emptySlot(): SlotDraft {
  return { date: '', start: '', end: '' };
}
function emptyRecurrence(): RecurrenceDraft {
  return { startDate: '', endDate: '', weekdays: [], start: '', end: '' };
}

export default function PostJobScreen() {
  const router = useRouter();
  const { entitled, openPaywall } = useParentGate();

  const [hydrating, setHydrating] = useState(true);
  const [profileBehaviors, setProfileBehaviors] = useState<string[]>([]);
  const [step, setStep] = useState(0);

  // ── editor state ────────────────────────────────────────────────────────────
  const [category, setCategory] = useState<JobCategory>('babysitter');
  const [mode, setMode] = useState<ScheduleMode>('one-off');
  const [description, setDescription] = useState('');
  const [slots, setSlots] = useState<SlotDraft[]>([emptySlot()]);
  const [recurrence, setRecurrence] = useState<RecurrenceDraft>(emptyRecurrence());
  const [childCount, setChildCount] = useState(1);
  const [childAges, setChildAges] = useState<string[]>(['']);
  const [disclosed, setDisclosed] = useState<string[]>([]);
  const [discloseNone, setDiscloseNone] = useState(false);
  const [consent, setConsent] = useState(false);
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [postal, setPostal] = useState('');
  const [budget, setBudget] = useState('');

  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state: JobComposeState = useMemo(
    () => ({
      category,
      mode,
      description,
      slots,
      recurrence,
      childCount,
      childAges,
      disclosed,
      discloseNone,
      line1,
      line2,
      city,
      stateCode,
      postal,
      budget,
    }),
    [category, mode, description, slots, recurrence, childCount, childAges, disclosed, discloseNone, line1, line2, city, stateCode, postal, budget],
  );

  // ── hydrate from a saved draft, then load the profile (disclosure options +
  //    default-address prefill only when the draft didn't already carry one) ────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = await readJobDraft();
      if (cancelled) return;
      if (draft) {
        setCategory(draft.category);
        setMode(draft.mode);
        setDescription(draft.description);
        setSlots(draft.slots.length ? draft.slots : [emptySlot()]);
        setRecurrence(draft.recurrence ?? emptyRecurrence());
        setChildCount(draft.childCount);
        setChildAges(draft.childAges.length ? draft.childAges : ['']);
        setDisclosed(draft.disclosed ?? []);
        setDiscloseNone(draft.discloseNone);
        setLine1(draft.line1);
        setLine2(draft.line2);
        setCity(draft.city);
        setStateCode(draft.stateCode);
        setPostal(draft.postal);
        setBudget(draft.budget);
      }
      try {
        const p: ParentProfile = await getParentProfile();
        if (cancelled) return;
        setProfileBehaviors(p.safetyBehaviors ?? []);
        const a = p.defaultAddress;
        if (!draft && a) {
          setLine1(a.line1 ?? '');
          setLine2(a.line2 ?? '');
          setCity(a.city ?? '');
          setStateCode(a.state ?? '');
          setPostal(a.postalCode ?? '');
        }
      } catch {
        // Profile is optional for compose — disclosure just shows "Share none".
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── debounced autosave (consent is intentionally never stashed) ─────────────
  const hydrated = !hydrating;
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => void saveJobDraft(state), 400);
    return () => clearTimeout(t);
  }, [state, hydrated]);

  const onPickCategory = (c: JobCategory) => {
    setCategory(c);
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
      return Array.from(copy, (v) => v ?? '');
    });
  };

  const toggleBehavior = (v: string) => {
    setDiscloseNone(false);
    setDisclosed((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  };

  const toggleWeekday = (d: number) => {
    setRecurrence((r) => ({
      ...r,
      weekdays: r.weekdays.includes(d) ? r.weekdays.filter((x) => x !== d) : [...r.weekdays, d],
    }));
  };

  const grantConsent = () => {
    if (consent) {
      setConsent(false);
      setConsentAt(null);
    } else {
      setConsent(true);
      setConsentAt(new Date().toISOString());
    }
  };

  // ── per-step "can advance" gates (light — the Edge is the source of truth) ──
  const occurrences = useMemo(() => (mode === 'recurring' ? expandOccurrences(recurrence) : []), [mode, recurrence]);
  const stepValid = useMemo(() => {
    switch (step) {
      case 0:
        return description.trim().length > 0;
      case 1:
        return mode === 'recurring'
          ? occurrences.length > 0 && parseClock(recurrence.start) != null && parseClock(recurrence.end) != null
          : parseSlots(slots) != null;
      case 2: {
        const agesOk =
          childAges.slice(0, childCount).length === childCount &&
          childAges.slice(0, childCount).every((a) => /^\d{1,2}$/.test(a) && Number(a) <= 17);
        const disclosureChosen = discloseNone || disclosed.length > 0;
        return agesOk && disclosureChosen && consent;
      }
      case 3:
        return /^\d{5}$/.test(postal.trim());
      default:
        return false;
    }
  }, [step, description, mode, occurrences, recurrence, slots, childAges, childCount, discloseNone, disclosed, consent, postal]);

  const publish = async () => {
    setError(null);
    const built = buildJobBody(state, consent);
    if (!built.ok) {
      setError(built.reason);
      return;
    }
    // The gate fires on PUBLISH (CONTEXT § Subscription): an unsubscribed Parent
    // is sent to the paywall with the post-job intent; the stashed draft resumes
    // this screen on return. The server also enforces the gate (402) as a backstop.
    if (!entitled) {
      openPaywall({ kind: 'post-job' });
      return;
    }
    setPublishing(true);
    try {
      const res = await postJob(built.body);
      await clearJobDraft();
      const n = res.jobs.length;
      router.replace({ pathname: '/home', params: { posted: String(n) } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        openPaywall({ kind: 'post-job' });
        return;
      }
      setError(e instanceof Error ? e.message : 'Could not publish your Job. Please try again.');
    } finally {
      setPublishing(false);
    }
  };

  const isLast = step === STEP_TITLES.length - 1;

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar title="Post a Job" onBack={() => (step === 0 ? router.back() : setStep((s) => s - 1))} />

      {/* progress */}
      <View style={styles.progressRow}>
        {STEP_TITLES.map((t, i) => (
          <View key={t} style={[styles.progressPip, i <= step && styles.progressPipOn]} />
        ))}
      </View>
      <Text style={styles.stepKicker}>Step {step + 1} of {STEP_TITLES.length}</Text>
      <Text style={styles.h1}>{STEP_TITLES[step]}</Text>

      {hydrating ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <>
          {step === 0 ? (
            <StepBasics
              category={category}
              onPickCategory={onPickCategory}
              mode={mode}
              onMode={setMode}
              description={description}
              onDescription={setDescription}
            />
          ) : null}

          {step === 1 ? (
            <StepSchedule
              mode={mode}
              slots={slots}
              setSlots={setSlots}
              recurrence={recurrence}
              setRecurrence={setRecurrence}
              toggleWeekday={toggleWeekday}
              occurrences={occurrences}
            />
          ) : null}

          {step === 2 ? (
            <StepChildren
              category={category}
              childCount={childCount}
              setCount={setCount}
              childAges={childAges}
              setChildAges={setChildAges}
              profileBehaviors={profileBehaviors}
              disclosed={disclosed}
              discloseNone={discloseNone}
              toggleBehavior={toggleBehavior}
              onDiscloseNone={() => {
                setDiscloseNone(true);
                setDisclosed([]);
              }}
              consent={consent}
              consentAt={consentAt}
              onConsent={grantConsent}
            />
          ) : null}

          {step === 3 ? (
            <StepLocation
              line1={line1}
              setLine1={setLine1}
              line2={line2}
              setLine2={setLine2}
              city={city}
              setCity={setCity}
              stateCode={stateCode}
              setStateCode={setStateCode}
              postal={postal}
              setPostal={setPostal}
              budget={budget}
              setBudget={setBudget}
              state={state}
              occurrences={occurrences}
            />
          ) : null}

          {error ? <Text style={styles.err}>{error}</Text> : null}

          {isLast ? (
            <>
              <PrimaryButton
                style={styles.cta}
                onPress={publish}
                disabled={!stepValid || publishing}
                icon={publishing ? undefined : <Icon name="arrow-right" size={18} color={colors.inkInv} />}
              >
                {publishing ? 'Publishing…' : 'Publish Job'}
              </PrimaryButton>
              <Text style={styles.footNote}>
                Publishing uses your active Subscription. Jobs auto-expire after 14 days if nobody is awarded.
              </Text>
            </>
          ) : (
            <PrimaryButton
              style={styles.cta}
              onPress={() => setStep((s) => s + 1)}
              disabled={!stepValid}
              icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
            >
              Continue
            </PrimaryButton>
          )}
          <Text style={styles.draftNote}>Your progress is saved as a draft on this device.</Text>
        </>
      )}
    </Screen>
  );
}

/* ── step bodies ──────────────────────────────────────────────────────────────── */

function StepBasics({
  category,
  onPickCategory,
  mode,
  onMode,
  description,
  onDescription,
}: {
  category: JobCategory;
  onPickCategory: (c: JobCategory) => void;
  mode: ScheduleMode;
  onMode: (m: ScheduleMode) => void;
  description: string;
  onDescription: (v: string) => void;
}) {
  return (
    <>
      <Text style={styles.sectionLabel}>Category</Text>
      <View style={styles.tileGrid}>
        {CATEGORIES.map((c) => {
          const selected = c.value === category;
          return (
            <Pressable
              key={c.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onPickCategory(c.value)}
              style={[styles.tile, { backgroundColor: colors[c.tone] }, selected && styles.tileSelected]}
            >
              <Icon name={c.icon} size={26} color={colors.ink} />
              <Text style={styles.tileName}>{c.label}</Text>
              {selected ? (
                <View style={styles.tileCheck}>
                  <Icon name="check" size={14} color={colors.inkInv} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.sectionLabel}>Scope</Text>
      <View style={styles.segment}>
        {(['one-off', 'recurring'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => onMode(m)}
            style={[styles.segmentBtn, mode === m && styles.segmentBtnOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === m }}
          >
            <Text style={[styles.segmentText, mode === m && styles.segmentTextOn]}>
              {m === 'one-off' ? 'One-off' : 'Recurring'}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>
        {mode === 'one-off'
          ? 'One or a few specific dates. Several dates post as one Job each.'
          : 'Repeats on the weekdays you choose, between a start and end date.'}
      </Text>

      <View style={styles.labelRow}>
        <Text style={styles.sectionLabelInline}>Job description</Text>
        <Text style={styles.counter}>{description.length} / 2000</Text>
      </View>
      <View style={styles.textareaWrap}>
        <TextInput
          value={description}
          onChangeText={(v) => onDescription(v.slice(0, 2000))}
          multiline
          textAlignVertical="top"
          placeholder="What does your family need? Leave out full names, school names, or your exact address — share those after you award."
          placeholderTextColor={colors.ink3}
          style={styles.textarea}
        />
      </View>
    </>
  );
}

function StepSchedule({
  mode,
  slots,
  setSlots,
  recurrence,
  setRecurrence,
  toggleWeekday,
  occurrences,
}: {
  mode: ScheduleMode;
  slots: SlotDraft[];
  setSlots: React.Dispatch<React.SetStateAction<SlotDraft[]>>;
  recurrence: RecurrenceDraft;
  setRecurrence: React.Dispatch<React.SetStateAction<RecurrenceDraft>>;
  toggleWeekday: (d: number) => void;
  occurrences: string[];
}) {
  if (mode === 'recurring') {
    return (
      <>
        <Field label="Runs between">
          <View style={styles.timeRow}>
            <Input
              placeholder="Start date (YYYY-MM-DD)"
              value={recurrence.startDate}
              onChangeText={(v) => setRecurrence((r) => ({ ...r, startDate: v }))}
              style={styles.timeInput}
            />
            <Input
              placeholder="End date (YYYY-MM-DD)"
              value={recurrence.endDate}
              onChangeText={(v) => setRecurrence((r) => ({ ...r, endDate: v }))}
              style={styles.timeInput}
            />
          </View>
        </Field>
        <Field label="On these days">
          <View style={styles.weekRow}>
            {WEEKDAYS.map((d) => {
              const on = recurrence.weekdays.includes(d.value);
              return (
                <Pressable
                  key={d.value}
                  onPress={() => toggleWeekday(d.value)}
                  style={[styles.dayChip, on && styles.dayChipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.dayText, on && styles.dayTextOn]}>{d.short}</Text>
                </Pressable>
              );
            })}
          </View>
        </Field>
        <Field label="Time window">
          <View style={styles.timeRow}>
            <Input
              placeholder="Start (3:30 PM)"
              value={recurrence.start}
              onChangeText={(v) => setRecurrence((r) => ({ ...r, start: v }))}
              style={styles.timeInput}
            />
            <Input
              placeholder="End (5:00 PM)"
              value={recurrence.end}
              onChangeText={(v) => setRecurrence((r) => ({ ...r, end: v }))}
              style={styles.timeInput}
            />
          </View>
        </Field>
        <OccurrencePreview occurrences={occurrences} recurrence={recurrence} />
      </>
    );
  }

  return (
    <>
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
      {slots.length > 1 ? (
        <Text style={styles.hint}>These {slots.length} dates post as {slots.length} separate one-off Jobs.</Text>
      ) : null}
    </>
  );
}

function OccurrencePreview({ occurrences, recurrence }: { occurrences: string[]; recurrence: RecurrenceDraft }) {
  const a = parseClock(recurrence.start);
  const b = parseClock(recurrence.end);
  if (occurrences.length === 0) {
    return <Text style={styles.hint}>Pick dates, weekdays, and a time window to preview the sessions.</Text>;
  }
  const window = a != null && b != null ? ` · ${formatMin(a)}–${formatMin(b)}` : '';
  const shown = occurrences.slice(0, 6);
  return (
    <View style={styles.previewCard}>
      <Text style={styles.previewTitle}>
        Creates {occurrences.length} session{occurrences.length === 1 ? '' : 's'}
        {window}
      </Text>
      <Text style={styles.previewDates}>
        {shown.join(' · ')}
        {occurrences.length > shown.length ? ` · +${occurrences.length - shown.length} more` : ''}
      </Text>
    </View>
  );
}

function StepChildren({
  category,
  childCount,
  setCount,
  childAges,
  setChildAges,
  profileBehaviors,
  disclosed,
  discloseNone,
  toggleBehavior,
  onDiscloseNone,
  consent,
  consentAt,
  onConsent,
}: {
  category: JobCategory;
  childCount: number;
  setCount: (n: number) => void;
  childAges: string[];
  setChildAges: React.Dispatch<React.SetStateAction<string[]>>;
  profileBehaviors: string[];
  disclosed: string[];
  discloseNone: boolean;
  toggleBehavior: (v: string) => void;
  onDiscloseNone: () => void;
  consent: boolean;
  consentAt: string | null;
  onConsent: () => void;
}) {
  return (
    <>
      <Field label="Children on this Job">
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
        {category === 'tutor' ? <Text style={styles.hint}>Tutoring is one child per Job.</Text> : null}
        <View style={styles.ageRow}>
          {childAges.slice(0, childCount).map((a, i) => (
            <Input
              key={i}
              placeholder={`Age ${i + 1}`}
              value={a}
              onChangeText={(v) => setChildAges((p) => p.map((x, j) => (j === i ? v.replace(/[^\d]/g, '').slice(0, 2) : x)))}
              keyboardType="number-pad"
              style={styles.ageInput}
            />
          ))}
        </View>
        <Text style={styles.hint}>Count and ages ride on the Job — no names or notes.</Text>
      </Field>

      <Field label="Share safety behaviours">
        <Text style={styles.discLead}>
          Choose what to disclose so in-category Caregivers can judge fit before they apply. This is required — pick any that
          apply, or share none.
        </Text>
        {profileBehaviors.length > 0 ? (
          <View style={styles.chips}>
            {profileBehaviors.map((b) => {
              const opt = SAFETY_BEHAVIOR_OPTIONS.find((o) => o.value === b);
              return (
                <Chip key={b} label={opt?.label ?? b} active={disclosed.includes(b)} onPress={() => toggleBehavior(b)} />
              );
            })}
          </View>
        ) : (
          <Text style={styles.hint}>You haven't added safety behaviours to your profile.</Text>
        )}
        <Pressable onPress={onDiscloseNone} style={styles.noneRow} hitSlop={6}>
          <Icon name={discloseNone ? 'check' : 'shield'} size={15} color={discloseNone ? colors.brand : colors.ink3} />
          <Text style={[styles.noneText, discloseNone && styles.noneTextActive]}>Share none</Text>
        </Pressable>
      </Field>

      <Pressable onPress={onConsent} style={[styles.consentCard, consent && styles.consentCardOn]} accessibilityRole="checkbox" accessibilityState={{ checked: consent }}>
        <View style={[styles.checkbox, consent && styles.checkboxOn]}>
          {consent ? <Icon name="check" size={13} color={colors.inkInv} /> : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.consentTitle}>I consent to this disclosure</Text>
          <Text style={styles.consentBody}>
            I understand the child count, ages, and the safety behaviours I disclose above will be shown to verified in-category
            Caregivers who view this Job.
          </Text>
          {consent && consentAt ? (
            <Text style={styles.consentStamp}>Consent given · {new Date(consentAt).toLocaleDateString()}</Text>
          ) : null}
        </View>
      </Pressable>
    </>
  );
}

function StepLocation({
  line1,
  setLine1,
  line2,
  setLine2,
  city,
  setCity,
  stateCode,
  setStateCode,
  postal,
  setPostal,
  budget,
  setBudget,
  state,
  occurrences,
}: {
  line1: string;
  setLine1: (v: string) => void;
  line2: string;
  setLine2: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  stateCode: string;
  setStateCode: (v: string) => void;
  postal: string;
  setPostal: (v: string) => void;
  budget: string;
  setBudget: (v: string) => void;
  state: JobComposeState;
  occurrences: string[];
}) {
  const cat = CATEGORIES.find((c) => c.value === state.category)?.label ?? state.category;
  const scheduleSummary =
    state.mode === 'recurring'
      ? `${occurrences.length} session${occurrences.length === 1 ? '' : 's'}`
      : parseSlots(state.slots)
        ? `${state.slots.length} date${state.slots.length === 1 ? '' : 's'}${state.slots.length > 1 ? ' · one Job each' : ''}`
        : '—';
  return (
    <>
      <Field label="Location">
        <Text style={styles.discLead}>
          The ZIP shows applicants an approximate distance. Your exact address is only revealed to the Caregiver you award.
        </Text>
        <View style={styles.timeRow}>
          <Input placeholder="City" value={city} onChangeText={setCity} style={styles.timeInput} />
          <Input placeholder="ST" value={stateCode} onChangeText={(v) => setStateCode(v.toUpperCase().slice(0, 2))} style={styles.stateInput} />
          <Input
            placeholder="ZIP"
            value={postal}
            onChangeText={(v) => setPostal(v.replace(/[^\d]/g, '').slice(0, 5))}
            keyboardType="number-pad"
            style={styles.zipInput}
          />
        </View>
        <Input placeholder="Street address (optional)" value={line1} onChangeText={setLine1} />
        <Input placeholder="Apt / unit (optional)" value={line2} onChangeText={setLine2} />
      </Field>

      <Field label="Budget hint · optional">
        <View style={styles.rateRow}>
          <Text style={styles.dollar}>$</Text>
          <TextInput
            value={budget}
            onChangeText={(v) => setBudget(v.replace(/[^\d.]/g, ''))}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.ink3}
            style={styles.rateInput}
          />
          <Text style={styles.perHr}>/ hour</Text>
        </View>
        <Text style={styles.hint}>Non-binding. The Agreed Rate is negotiated on the Offer.</Text>
      </Field>

      <Text style={styles.sectionLabel}>Review</Text>
      <View style={styles.card}>
        <ReviewRow label="Category" value={cat} />
        <View style={styles.divider} />
        <ReviewRow label="Schedule" value={scheduleSummary} />
        <View style={styles.divider} />
        <ReviewRow label="Children" value={`${state.childCount} · ${state.discloseNone ? 'no behaviours shared' : `${state.disclosed.length} behaviour${state.disclosed.length === 1 ? '' : 's'} shared`}`} />
      </View>
    </>
  );
}

/* ── small shared primitives ─────────────────────────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.sectionLabel}>{label}</Text>
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

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 140 },
  progressRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  progressPip: { flex: 1, height: 4, borderRadius: radii.pill, backgroundColor: colors.hairline },
  progressPipOn: { backgroundColor: colors.brand },
  stepKicker: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink3, marginTop: 16 },
  h1: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.5, color: colors.ink, marginTop: 4 },
  loading: { paddingVertical: 60, alignItems: 'center' },

  sectionLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginTop: 24, marginBottom: 10 },
  sectionLabelInline: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },
  fieldBlock: { marginTop: 4 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24, marginBottom: 8 },
  counter: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink3, marginTop: 10 },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  tile: { width: '48%', height: 116, borderRadius: radii.lg, padding: 14, justifyContent: 'space-between', borderWidth: 2, borderColor: 'transparent' },
  tileSelected: { borderColor: colors.ink },
  tileName: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  tileCheck: { position: 'absolute', top: 10, right: 10, width: 24, height: 24, borderRadius: radii.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },

  segment: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radii.pill, padding: 4 },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: radii.pill },
  segmentBtnOn: { backgroundColor: colors.surface, ...shadow.e1 },
  segmentText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
  segmentTextOn: { color: colors.ink },

  textareaWrap: { borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.ink },
  textarea: { minHeight: 150, padding: 16, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink },

  input: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 11, marginTop: 8 },

  slotCard: { backgroundColor: colors.surfaceAlt, borderRadius: radii.md, padding: 12, marginTop: 12 },
  slotHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  slotIdx: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },
  timeRow: { flexDirection: 'row', gap: 8 },
  timeInput: { flex: 1 },
  stateInput: { width: 64, textAlign: 'center' },
  zipInput: { width: 88 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  addText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brand },

  weekRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayChip: { width: 44, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  dayChipOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  dayText: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2 },
  dayTextOn: { color: colors.brand, fontFamily: fonts.semibold },

  previewCard: { backgroundColor: colors.brandSoft, borderRadius: radii.md, padding: 14, marginTop: 16 },
  previewTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  previewDates: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.ink2, marginTop: 6 },

  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, paddingHorizontal: 12, paddingVertical: 6 },
  stepBtn: { padding: 4 },
  stepN: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, minWidth: 18, textAlign: 'center' },
  ageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  ageInput: { width: 72 },

  discLead: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, lineHeight: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  chipActive: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  chipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },
  chipTextActive: { color: colors.brand, fontFamily: fonts.semibold },
  noneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  noneText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink3 },
  noneTextActive: { color: colors.brand, fontFamily: fonts.semibold },

  consentCard: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, borderWidth: 1, borderColor: colors.hairline, marginTop: 20 },
  consentCardOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  checkbox: { width: 22, height: 22, borderRadius: radii.sm, borderWidth: 1.5, borderColor: colors.ink3, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  consentTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  consentBody: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.ink2, marginTop: 4 },
  consentStamp: { fontFamily: fonts.semibold, fontSize: 11, color: colors.brand, marginTop: 8 },

  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 4, marginTop: 8 },
  dollar: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink2 },
  rateInput: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, color: colors.ink, paddingVertical: 11 },
  perHr: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink3 },

  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1 },
  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: 12 },
  reviewRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  reviewLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },
  reviewValue: { flex: 1, textAlign: 'right', fontFamily: fonts.regular, fontSize: 14, color: colors.ink },

  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 18 },
  cta: { marginTop: 28 },
  footNote: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.ink3, textAlign: 'center', marginTop: 12 },
  draftNote: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3, textAlign: 'center', marginTop: 10 },
});
