/**
 * ParentPostJobWeb — the Parent "Post a Job" multi-step wizard on desktop web
 * (OH-209). Content-only: the dispatcher wraps this in <ParentWebShell active="home">.
 *
 * Functionally identical to the native composer (`screens/parent/PostJob`) — same
 * editor state, the same shared compose helpers (`lib/postJob`), client-side draft
 * autosave (`lib/jobDraft`, survives the web checkout redirect), and the
 * publish-time Subscription gate — rendered in the bespoke desktop rail layout
 * (numbered step rail · right step body + footer). RN primitives only (RN-web).
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { editJob, getJob, getParentProfile, postJob, ApiError, type ParentProfile } from '@/api/client';
import { Icon } from '@/components/Icon';
import { WebPageHeader } from '@/components/web/ParentWebShell';
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
import type { IconName } from '@/components/Icon';

const CATEGORIES: { value: JobCategory; label: string; tone: ColorToken; icon: IconName }[] = [
  { value: 'babysitter', label: 'Babysitter', tone: 'catBaby', icon: 'person' },
  { value: 'tutor', label: 'Tutor', tone: 'catTutor', icon: 'graduation' },
  { value: 'nanny', label: 'Nanny', tone: 'catNanny', icon: 'users' },
];

const STEPS = ['Basics', 'Schedule', 'Children', 'Publish'] as const;
const STEP_TITLE = ['Who are you hiring for?', 'When do you need them?', 'Children & safety', 'Location & publish'] as const;

function emptySlot(): SlotDraft {
  return { date: '', start: '', end: '' };
}
function emptyRecurrence(): RecurrenceDraft {
  return { startDate: '', endDate: '', weekdays: [], start: '', end: '' };
}

export function ParentPostJobWeb() {
  const router = useRouter();
  const { entitled, openPaywall } = useParentGate();
  // Edit mode (OH-210, story 92) — with a `jobId` param, edit an existing open Job.
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const editing = Boolean(jobId);

  const [hydrating, setHydrating] = useState(true);
  const [profileBehaviors, setProfileBehaviors] = useState<string[]>([]);
  const [step, setStep] = useState(0);

  const [category, setCategory] = useState<JobCategory>('tutor');
  const [mode, setMode] = useState<ScheduleMode>('recurring');
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
    () => ({ category, mode, description, slots, recurrence, childCount, childAges, disclosed, discloseNone, line1, line2, city, stateCode, postal, budget }),
    [category, mode, description, slots, recurrence, childCount, childAges, disclosed, discloseNone, line1, line2, city, stateCode, postal, budget],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // EDIT mode: hydrate from the existing Job (not the create draft). Consent is
      // intentionally not pre-set — the Parent re-acknowledges it on save.
      if (editing && jobId) {
        try {
          const job = await getJob(jobId);
          if (cancelled) return;
          setCategory(job.category);
          setMode(job.scheduleKind === 'recurring' ? 'recurring' : 'one-off');
          setDescription(job.description);
          if (job.scheduleKind === 'recurring' && job.recurrence) {
            const r = job.recurrence;
            setRecurrence({
              startDate: r.startDate,
              endDate: r.endDate,
              weekdays: [...r.weekdays],
              start: formatMin(r.startMin),
              end: formatMin(r.endMin),
            });
          } else if (job.slots.length > 0) {
            setSlots(job.slots.map((s) => ({ date: s.date, start: formatMin(s.startMin), end: formatMin(s.endMin) })));
          }
          setChildCount(job.childCount ?? 1);
          setChildAges((job.childAges ?? []).length ? job.childAges.map(String) : ['']);
          setDisclosed(job.safetyBehaviors ?? []);
          setDiscloseNone((job.safetyBehaviors ?? []).length === 0);
          if (job.serviceAddress) {
            setLine1(job.serviceAddress.line1 ?? '');
            setLine2(job.serviceAddress.line2 ?? '');
            setCity(job.serviceAddress.city ?? '');
            setStateCode(job.serviceAddress.state ?? '');
            setPostal(job.serviceAddress.postalCode ?? '');
          }
          setBudget(job.budgetHintCents != null ? String(job.budgetHintCents / 100) : '');
        } catch (e) {
          if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load this Job to edit.');
        }
        try {
          const p: ParentProfile = await getParentProfile();
          if (!cancelled) setProfileBehaviors(p.safetyBehaviors ?? []);
        } catch {
          /* disclosure options optional */
        }
        if (!cancelled) setHydrating(false);
        return;
      }

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
        // profile optional
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editing, jobId]);

  const hydrated = !hydrating;
  useEffect(() => {
    if (!hydrated || editing) return; // edit mode never pollutes the create draft
    const t = setTimeout(() => void saveJobDraft(state), 400);
    return () => clearTimeout(t);
  }, [state, hydrated, editing]);

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
  const toggleWeekday = (d: number) =>
    setRecurrence((r) => ({ ...r, weekdays: r.weekdays.includes(d) ? r.weekdays.filter((x) => x !== d) : [...r.weekdays, d] }));
  const grantConsent = () => {
    if (consent) {
      setConsent(false);
      setConsentAt(null);
    } else {
      setConsent(true);
      setConsentAt(new Date().toISOString());
    }
  };

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
        const ages = childAges.slice(0, childCount);
        const agesOk = ages.length === childCount && ages.every((a) => /^\d{1,2}$/.test(a) && Number(a) <= 17);
        return agesOk && (discloseNone || disclosed.length > 0) && consent;
      }
      case 3:
        return /^\d{5}$/.test(postal.trim());
      default:
        return false;
    }
  }, [step, description, mode, occurrences, recurrence, slots, childAges, childCount, discloseNone, disclosed, consent, postal]);

  const isLast = step === STEPS.length - 1;

  const onPrimary = async () => {
    if (!stepValid) return;
    if (!isLast) {
      setStep(step + 1);
      return;
    }
    setError(null);
    const built = buildJobBody(state, consent);
    if (!built.ok) {
      setError(built.reason);
      return;
    }
    if (!entitled) {
      openPaywall({ kind: 'post-job' });
      return;
    }
    setPublishing(true);
    try {
      if (editing && jobId) {
        await editJob(jobId, built.body);
        router.replace({ pathname: '/job-applicants', params: { jobId } });
      } else {
        const res = await postJob(built.body);
        await clearJobDraft();
        router.replace({ pathname: '/home', params: { posted: String(res.jobs.length) } });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        openPaywall({ kind: 'post-job' });
        return;
      }
      setError(e instanceof Error ? e.message : `Could not ${editing ? 'save' : 'publish'} your Job. Please try again.`);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <View>
      <WebPageHeader greet="Family · Jobs" title={editing ? 'Edit Job' : 'Post a Job'} actions={['bell', 'message']} />
      <View style={styles.body}>
        <View style={styles.wizard}>
          {/* left · step rail */}
          <View style={styles.rail}>
            <Text style={styles.railEyebrow}>Post a Job</Text>
            <View style={styles.railList}>
              {STEPS.map((label, i) => {
                const done = i < step;
                const on = i === step;
                return (
                  <Pressable key={label} onPress={() => setStep(i)} style={[styles.railItem, on && styles.railItemOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                    <View style={[styles.railNum, done ? styles.railNumDone : on ? styles.railNumOn : styles.railNumTodo]}>
                      {done ? <Icon name="check" size={14} color={colors.inkInv} /> : <Text style={[styles.railNumText, { color: on ? colors.inkInv : colors.ink3 }]}>{i + 1}</Text>}
                    </View>
                    <Text style={[styles.railLabel, { color: on || done ? colors.ink : colors.ink3, fontFamily: on ? fonts.bold : fonts.medium }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* right · step body */}
          <View style={styles.pane}>
            <View style={styles.paneInner}>
              <Text style={styles.eyebrow}>Step {step + 1} of {STEPS.length} · {STEPS[step]}</Text>
              <Text style={styles.title}>{STEP_TITLE[step]}</Text>

              {hydrating ? (
                <View style={styles.loading}><ActivityIndicator color={colors.brand} /></View>
              ) : (
                <>
                  {step === 0 ? (
                    <View>
                      <Text style={styles.sectionLabel}>Category</Text>
                      <View style={styles.catGrid}>
                        {CATEGORIES.map((c) => {
                          const selected = c.value === category;
                          return (
                            <Pressable
                              key={c.value}
                              onPress={() => {
                                setCategory(c.value);
                                if (c.value === 'tutor') {
                                  setChildCount(1);
                                  setChildAges((prev) => [prev[0] ?? '']);
                                }
                              }}
                              style={[styles.tile, { backgroundColor: colors[c.tone] }, selected && styles.tileSelected]}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                            >
                              <Icon name={c.icon} size={28} color={colors.ink} />
                              <Text style={styles.tileName}>{c.label}</Text>
                              {selected ? <View style={styles.tileCheck}><Icon name="check" size={14} color={colors.inkInv} /></View> : null}
                            </Pressable>
                          );
                        })}
                      </View>

                      <Text style={styles.sectionLabel}>Scope</Text>
                      <View style={styles.segment}>
                        {(['one-off', 'recurring'] as const).map((m) => (
                          <Pressable key={m} onPress={() => setMode(m)} style={[styles.segOpt, mode === m && styles.segOptOn]} accessibilityRole="button" accessibilityState={{ selected: mode === m }}>
                            <Text style={[styles.segText, { color: mode === m ? colors.ink : colors.ink2 }]}>{m === 'one-off' ? 'One-off' : 'Recurring'}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <Text style={styles.scopeHint}>
                        {mode === 'one-off' ? 'One or a few specific dates — several dates post as one Job each.' : 'Repeats on the weekdays you choose, between a start and end date.'}
                      </Text>

                      <View style={styles.descHeader}>
                        <Text style={styles.sectionLabelInline}>Job description</Text>
                        <Text style={styles.counter}>{description.length} / 2000</Text>
                      </View>
                      <View style={styles.textareaWrap}>
                        <TextInput value={description} onChangeText={(v) => setDescription(v.slice(0, 2000))} multiline textAlignVertical="top" placeholder="What does your family need? Leave out full names, school names, or your exact address." placeholderTextColor={colors.ink3} style={styles.textarea} />
                      </View>
                    </View>
                  ) : null}

                  {step === 1 ? (
                    mode === 'recurring' ? (
                      <View>
                        <Text style={styles.sectionLabel}>Runs between</Text>
                        <View style={styles.row}>
                          <WInput placeholder="Start date (YYYY-MM-DD)" value={recurrence.startDate} onChangeText={(v) => setRecurrence((r) => ({ ...r, startDate: v }))} />
                          <WInput placeholder="End date (YYYY-MM-DD)" value={recurrence.endDate} onChangeText={(v) => setRecurrence((r) => ({ ...r, endDate: v }))} />
                        </View>
                        <Text style={styles.sectionLabel}>On these days</Text>
                        <View style={styles.weekRow}>
                          {WEEKDAYS.map((d) => {
                            const on = recurrence.weekdays.includes(d.value);
                            return (
                              <Pressable key={d.value} onPress={() => toggleWeekday(d.value)} style={[styles.dayChip, on && styles.dayChipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                                <Text style={[styles.dayText, on && styles.dayTextOn]}>{d.short}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <Text style={styles.sectionLabel}>Time window</Text>
                        <View style={styles.row}>
                          <WInput placeholder="Start (3:30 PM)" value={recurrence.start} onChangeText={(v) => setRecurrence((r) => ({ ...r, start: v }))} />
                          <WInput placeholder="End (5:00 PM)" value={recurrence.end} onChangeText={(v) => setRecurrence((r) => ({ ...r, end: v }))} />
                        </View>
                        {occurrences.length > 0 ? (
                          <View style={styles.previewCard}>
                            <Text style={styles.previewTitle}>
                              Creates {occurrences.length} session{occurrences.length === 1 ? '' : 's'}
                              {parseClock(recurrence.start) != null && parseClock(recurrence.end) != null ? ` · ${formatMin(parseClock(recurrence.start)!)}–${formatMin(parseClock(recurrence.end)!)}` : ''}
                            </Text>
                            <Text style={styles.previewDates}>{occurrences.slice(0, 8).join(' · ')}{occurrences.length > 8 ? ` · +${occurrences.length - 8} more` : ''}</Text>
                          </View>
                        ) : (
                          <Text style={styles.scopeHint}>Pick dates, weekdays, and a time window to preview the sessions.</Text>
                        )}
                      </View>
                    ) : (
                      <View>
                        {slots.map((s, i) => (
                          <View key={i} style={styles.slotCard}>
                            {slots.length > 1 ? (
                              <View style={styles.slotHead}>
                                <Text style={styles.slotIdx}>Date {i + 1}</Text>
                                <Pressable onPress={() => setSlots((p) => p.filter((_, j) => j !== i))} hitSlop={6}><Icon name="trash" size={15} color={colors.ink3} /></Pressable>
                              </View>
                            ) : null}
                            <WInput placeholder="Date (YYYY-MM-DD)" value={s.date} onChangeText={(v) => setSlots((p) => p.map((x, j) => (j === i ? { ...x, date: v } : x)))} />
                            <View style={styles.row}>
                              <WInput placeholder="Start (6:00 PM)" value={s.start} onChangeText={(v) => setSlots((p) => p.map((x, j) => (j === i ? { ...x, start: v } : x)))} />
                              <WInput placeholder="End (9:00 PM)" value={s.end} onChangeText={(v) => setSlots((p) => p.map((x, j) => (j === i ? { ...x, end: v } : x)))} />
                            </View>
                          </View>
                        ))}
                        <Pressable onPress={() => setSlots((p) => [...p, emptySlot()])} style={styles.addRow} hitSlop={6}>
                          <Icon name="plus" size={15} color={colors.brand} />
                          <Text style={styles.addText}>Add another date</Text>
                        </Pressable>
                        {slots.length > 1 ? <Text style={styles.scopeHint}>These {slots.length} dates post as {slots.length} separate one-off Jobs.</Text> : null}
                      </View>
                    )
                  ) : null}

                  {step === 2 ? (
                    <View>
                      <Text style={styles.sectionLabel}>Children on this Job</Text>
                      <View style={styles.stepperRow}>
                        <Text style={styles.stepLabel}>How many?</Text>
                        <View style={styles.stepper}>
                          <Pressable onPress={() => setCount(childCount - 1)} disabled={category === 'tutor'} style={styles.stepBtn} hitSlop={6}><Icon name="x" size={12} color={colors.ink2} /></Pressable>
                          <Text style={styles.stepN}>{childCount}</Text>
                          <Pressable onPress={() => setCount(childCount + 1)} disabled={category === 'tutor'} style={styles.stepBtn} hitSlop={6}><Icon name="plus" size={14} color={colors.ink2} /></Pressable>
                        </View>
                      </View>
                      {category === 'tutor' ? <Text style={styles.scopeHint}>Tutoring is one child per Job.</Text> : null}
                      <View style={styles.ageRow}>
                        {childAges.slice(0, childCount).map((a, i) => (
                          <WInput key={i} placeholder={`Age ${i + 1}`} value={a} onChangeText={(v) => setChildAges((p) => p.map((x, j) => (j === i ? v.replace(/[^\d]/g, '').slice(0, 2) : x)))} style={styles.ageInput} />
                        ))}
                      </View>

                      <Text style={styles.sectionLabel}>Share safety behaviours</Text>
                      <Text style={styles.discLead}>Disclose a subset so in-category Caregivers can judge fit before applying, or share none. Required.</Text>
                      {profileBehaviors.length > 0 ? (
                        <View style={styles.chipWrap}>
                          {profileBehaviors.map((b) => {
                            const opt = SAFETY_BEHAVIOR_OPTIONS.find((o) => o.value === b);
                            return (
                              <Pressable key={b} onPress={() => toggleBehavior(b)} style={[styles.chip, disclosed.includes(b) && styles.chipOn]}>
                                <Text style={[styles.chipText, disclosed.includes(b) && styles.chipTextOn]}>{opt?.label ?? b}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : (
                        <Text style={styles.scopeHint}>You haven&rsquo;t added safety behaviours to your profile.</Text>
                      )}
                      <Pressable onPress={() => { setDiscloseNone(true); setDisclosed([]); }} style={styles.noneRow} hitSlop={6}>
                        <Icon name={discloseNone ? 'check' : 'shield'} size={15} color={discloseNone ? colors.brand : colors.ink3} />
                        <Text style={[styles.noneText, discloseNone && styles.noneTextOn]}>Share none</Text>
                      </Pressable>

                      <Pressable onPress={grantConsent} style={[styles.consentCard, consent && styles.consentCardOn]} accessibilityRole="checkbox" accessibilityState={{ checked: consent }}>
                        <View style={[styles.ackBox, consent ? styles.ackBoxOn : styles.ackBoxOff]}>{consent ? <Icon name="check" size={14} color={colors.inkInv} /> : null}</View>
                        <View style={styles.flexMin}>
                          <Text style={styles.consentTitle}>I consent to this disclosure</Text>
                          <Text style={styles.consentBody}>The child count, ages, and behaviours I disclose will be shown to verified in-category Caregivers who view this Job.</Text>
                          {consent && consentAt ? <Text style={styles.consentStamp}>Consent given · {new Date(consentAt).toLocaleDateString()}</Text> : null}
                        </View>
                      </Pressable>
                    </View>
                  ) : null}

                  {step === 3 ? (
                    <View>
                      <Text style={styles.sectionLabel}>Location</Text>
                      <Text style={styles.discLead}>The ZIP shows applicants an approximate distance. Your exact address is revealed only to the Caregiver you award.</Text>
                      <View style={styles.row}>
                        <WInput placeholder="City" value={city} onChangeText={setCity} />
                        <WInput placeholder="ST" value={stateCode} onChangeText={(v) => setStateCode(v.toUpperCase().slice(0, 2))} style={styles.stInput} />
                        <WInput placeholder="ZIP" value={postal} onChangeText={(v) => setPostal(v.replace(/[^\d]/g, '').slice(0, 5))} style={styles.zipInput} />
                      </View>
                      <WInput placeholder="Street address (optional)" value={line1} onChangeText={setLine1} />
                      <WInput placeholder="Apt / unit (optional)" value={line2} onChangeText={setLine2} />

                      <Text style={styles.sectionLabel}>Budget hint · optional</Text>
                      <View style={styles.row}>
                        <WInput placeholder="$ / hour (optional)" value={budget} onChangeText={(v) => setBudget(v.replace(/[^\d.]/g, ''))} />
                      </View>

                      <View style={styles.note}>
                        <Icon name="info" size={18} color={colors.ink2} />
                        <Text style={styles.noteText}>Publishing a Job uses your active Subscription. Posted Jobs auto-expire after 14 days if nobody is awarded.</Text>
                      </View>
                    </View>
                  ) : null}

                  {error ? <Text style={styles.err}>{error}</Text> : null}
                </>
              )}
            </View>

            {/* footer */}
            <View style={styles.footer}>
              <Pressable onPress={() => { void saveJobDraft(state); router.back(); }} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.saveDraft}>Save draft</Text>
              </Pressable>
              <View style={styles.flex} />
              <Pressable onPress={onPrimary} disabled={!stepValid || publishing} accessibilityRole="button" style={[styles.nextBtn, (!stepValid || publishing) && styles.nextBtnOff]}>
                <Text style={styles.nextText}>{isLast ? (publishing ? (editing ? 'Saving…' : 'Publishing…') : editing ? 'Save changes' : 'Publish Job') : `Next · ${STEPS[step + 1]}`}</Text>
                {!publishing ? <Icon name="arrow-right" size={16} color={colors.inkInv} /> : null}
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function WInput({ style, ...props }: React.ComponentProps<typeof TextInput>) {
  return <TextInput {...props} placeholderTextColor={colors.ink3} style={[styles.input, style]} />;
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flex: { flex: 1 },
  flexMin: { flex: 1, minWidth: 0 },
  loading: { paddingVertical: 60, alignItems: 'center' },

  wizard: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: colors.surface, borderRadius: radii.xl, overflow: 'hidden', ...shadow.e1 },
  rail: { width: 256, flexShrink: 0, borderRightWidth: 1, borderRightColor: colors.hairline, backgroundColor: colors.surfaceAlt, paddingVertical: 30, paddingHorizontal: 22 },
  railEyebrow: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 20, marginLeft: 4 },
  railList: { gap: 4 },
  railItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14 },
  railItemOn: { backgroundColor: colors.surface, ...shadow.e1 },
  railNum: { width: 28, height: 28, borderRadius: radii.pill, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  railNumDone: { backgroundColor: colors.brand },
  railNumOn: { backgroundColor: colors.ink },
  railNumTodo: { backgroundColor: colors.surface },
  railNumText: { fontFamily: fonts.bold, fontSize: 12.5, fontVariant: ['tabular-nums'] },
  railLabel: { fontSize: 14 },

  pane: { flex: 1, minWidth: 0 },
  paneInner: { paddingVertical: 34, paddingHorizontal: 40 },
  eyebrow: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, color: colors.ink, marginTop: 12, marginBottom: 18 },

  footer: { flexDirection: 'row', alignItems: 'center', gap: 16, borderTopWidth: 1, borderTopColor: colors.hairline, paddingVertical: 16, paddingHorizontal: 40 },
  saveDraft: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink2 },
  nextBtn: { height: 50, paddingHorizontal: 26, borderRadius: radii.pill, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nextBtnOff: { opacity: 0.4 },
  nextText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },

  sectionLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginTop: 24, marginBottom: 12 },
  sectionLabelInline: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },

  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexGrow: 1, flexBasis: 150, minWidth: 140, height: 124, borderRadius: 20, padding: 14, justifyContent: 'space-between', borderWidth: 2, borderColor: 'transparent' },
  tileSelected: { borderColor: colors.ink },
  tileName: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  tileCheck: { position: 'absolute', top: 10, right: 10, width: 24, height: 24, borderRadius: radii.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },

  segment: { flexDirection: 'row', alignItems: 'center', maxWidth: 320, height: 46, padding: 4, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  segOpt: { flex: 1, height: 38, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  segOptOn: { backgroundColor: colors.surface, ...shadow.e1 },
  segText: { fontFamily: fonts.semibold, fontSize: 13.5 },
  scopeHint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink3, marginTop: 12, maxWidth: 460 },

  descHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24, marginBottom: 8 },
  counter: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink3 },
  textareaWrap: { borderRadius: 16, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.brand },
  textarea: { minHeight: 170, padding: 18, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, color: colors.ink },

  input: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.ink, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 12, marginTop: 8 },
  row: { flexDirection: 'row', gap: 10, maxWidth: 480 },
  stInput: { flex: 0, width: 74, textAlign: 'center' },
  zipInput: { flex: 0, width: 110 },

  slotCard: { backgroundColor: colors.surfaceAlt, borderRadius: radii.md, padding: 14, marginTop: 12, maxWidth: 480 },
  slotHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  slotIdx: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  addText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brand },

  weekRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayChip: { width: 48, height: 42, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  dayChipOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  dayText: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.ink2 },
  dayTextOn: { color: colors.brand, fontFamily: fonts.semibold },

  previewCard: { backgroundColor: colors.brandSoft, borderRadius: radii.md, padding: 16, marginTop: 18, maxWidth: 480 },
  previewTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  previewDates: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 19, color: colors.ink2, marginTop: 6 },

  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', maxWidth: 320 },
  stepLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, paddingHorizontal: 12, paddingVertical: 6 },
  stepBtn: { padding: 4 },
  stepN: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, minWidth: 18, textAlign: 'center' },
  ageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, maxWidth: 480 },
  ageInput: { flex: 0, width: 84 },

  discLead: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, lineHeight: 19, maxWidth: 480 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, maxWidth: 520 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  chipOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  chipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },
  chipTextOn: { color: colors.brand, fontFamily: fonts.semibold },
  noneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  noneText: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink3 },
  noneTextOn: { color: colors.brand, fontFamily: fonts.semibold },

  consentCard: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, borderWidth: 1, borderColor: colors.hairline, marginTop: 20, maxWidth: 520 },
  consentCardOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  ackBox: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  ackBoxOn: { backgroundColor: colors.brand },
  ackBoxOff: { borderWidth: 1.5, borderColor: colors.ink3 },
  consentTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  consentBody: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink2, marginTop: 4 },
  consentStamp: { fontFamily: fonts.semibold, fontSize: 11, color: colors.brand, marginTop: 8 },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.surfaceAlt, maxWidth: 560, marginTop: 20 },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink2 },
  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 18 },
});
