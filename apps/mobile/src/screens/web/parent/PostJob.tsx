/**
 * ParentPostJobWeb — the Parent "Post a Job" multi-step wizard on desktop web.
 * Content-only: the dispatcher wraps this in <ParentWebShell active="home">.
 *
 * Ported from the Claude Design web project (parent-web/pw-jobs.jsx,
 * PWPostJob1..4 + the WizardShell idiom). Because this screen already lives
 * INSIDE the ParentWebShell side-rail, the numbered step rail is built as a panel
 * WITHIN the content area (a surface card split row: left step rail · right step
 * body + footer) rather than a full-viewport shell. The wizard's step + selection
 * state (category / scope / description / negotiable / safety-disclose) is kept
 * here and mirrors the native PostJob screen. RN primitives only (renders via
 * RN-web); no CSS grid — flexbox throughout.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon, type IconName } from '@/components/Icon';
import { Chip } from '@/components/ui/Chip';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { Toggle } from '@/components/ui/Toggle';
import { WebPageHeader } from '@/components/web/ParentWebShell';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

type Category = 'Babysitter' | 'Tutor' | 'Nanny';
type Scope = 'One-off' | 'Recurring';

const CATEGORIES: { name: Category; tone: ColorToken; icon: IconName }[] = [
  { name: 'Babysitter', tone: 'catBaby', icon: 'person' },
  { name: 'Tutor', tone: 'catTutor', icon: 'graduation' },
  { name: 'Nanny', tone: 'catNanny', icon: 'users' },
];

const STEPS = ['Category', 'Description', 'Logistics', 'Review'] as const;
const NEXT_LABEL = ['Next · Description', 'Next · Logistics', 'Next · Review', 'Publish Job'] as const;
const STEP_TITLE = ['Who are you hiring for?', 'Describe what you need.', 'When and where?', 'Review & publish.'] as const;

export function ParentPostJobWeb() {
  const router = useRouter();
  const go = (r: string) => router.push(r as never);

  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<Category>('Tutor');
  const [scope, setScope] = useState<Scope>('Recurring');
  const [desc, setDesc] = useState(
    'Our 5th-grader needs help shoring up fractions, ratios, and word problems before middle-school placement testing. Looking for someone patient, structured, and comfortable with a curious-but-restless learner.',
  );
  const [ack, setAck] = useState(true);
  const [negotiable, setNegotiable] = useState(true);

  const schedule =
    scope === 'Recurring'
      ? 'Tue & Thu · 3:30–5:00 PM · May 26 – Jul 2 · creates 12 sessions'
      : 'Single date · 3:30–5:00 PM · 1 session';

  function onPrimary() {
    if (step < STEPS.length - 1) setStep(step + 1);
    else router.back();
  }

  return (
    <View>
      <WebPageHeader greet="Family · Jobs" title="Post a Job" actions={['bell', 'message']} />

      <View style={styles.body}>
        <View style={styles.wizard}>
          {/* ── left · numbered step rail (panel within content) ──── */}
          <View style={styles.rail}>
            <Text style={styles.railEyebrow}>Post a Job</Text>
            <View style={styles.railList}>
              {STEPS.map((label, i) => {
                const done = i < step;
                const on = i === step;
                return (
                  <Pressable
                    key={label}
                    onPress={() => setStep(i)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[styles.railItem, on ? styles.railItemOn : null]}
                  >
                    <View
                      style={[
                        styles.railNum,
                        done ? styles.railNumDone : on ? styles.railNumOn : styles.railNumTodo,
                      ]}
                    >
                      {done ? (
                        <Icon name="check" size={14} color={colors.inkInv} />
                      ) : (
                        <Text style={[styles.railNumText, { color: on ? colors.inkInv : colors.ink3 }]}>{i + 1}</Text>
                      )}
                    </View>
                    <Text
                      style={[
                        styles.railLabel,
                        { color: on || done ? colors.ink : colors.ink3, fontFamily: on ? fonts.bold : fonts.medium },
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* ── right · step body + footer ─────────────────────────── */}
          <View style={styles.pane}>
            <View style={styles.paneInner}>
              <Text style={styles.eyebrow}>
                Step {step + 1} of {STEPS.length} · {STEPS[step]}
              </Text>
              <Text style={styles.title}>{STEP_TITLE[step]}</Text>

              {step === 0 ? (
                <StepCategory
                  category={category}
                  setCategory={setCategory}
                  scope={scope}
                  setScope={setScope}
                />
              ) : null}
              {step === 1 ? (
                <StepDescription category={category} desc={desc} setDesc={setDesc} ack={ack} setAck={setAck} />
              ) : null}
              {step === 2 ? (
                <StepLogistics
                  scope={scope}
                  schedule={schedule}
                  negotiable={negotiable}
                  setNegotiable={setNegotiable}
                  onConsent={() => go('/consent')}
                />
              ) : null}
              {step === 3 ? (
                <StepReview category={category} scope={scope} schedule={schedule} onEdit={setStep} />
              ) : null}
            </View>

            {/* footer */}
            <View style={styles.footer}>
              <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.saveDraft}>Save draft</Text>
              </Pressable>
              <View style={styles.flex} />
              <Pressable onPress={onPrimary} accessibilityRole="button" style={styles.nextBtn}>
                <Text style={styles.nextText}>{NEXT_LABEL[step]}</Text>
                <Icon name="arrow-right" size={16} color={colors.inkInv} />
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

/* ── Step 1 · Category + Scope ───────────────────────────────────────────── */
function StepCategory({
  category,
  setCategory,
  scope,
  setScope,
}: {
  category: Category;
  setCategory: (c: Category) => void;
  scope: Scope;
  setScope: (s: Scope) => void;
}) {
  return (
    <View>
      <Text style={styles.lede}>Pick the category and how often you&rsquo;ll need them.</Text>

      <Text style={styles.sectionLabel}>Category</Text>
      <View style={styles.catGrid}>
        {CATEGORIES.map((c) => {
          const selected = c.name === category;
          return (
            <Pressable
              key={c.name}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setCategory(c.name)}
              style={[styles.tile, { backgroundColor: colors[c.tone] }, selected && styles.tileSelected]}
            >
              <Icon name={c.icon} size={28} color={colors.ink} />
              <Text style={styles.tileName}>{c.name}</Text>
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
        {(['One-off', 'Recurring'] as const).map((s) => {
          const on = s === scope;
          return (
            <Pressable
              key={s}
              onPress={() => setScope(s)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.segOpt, on ? styles.segOptOn : null]}
            >
              <Text style={[styles.segText, { color: on ? colors.ink : colors.ink2 }]}>{s}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.scopeHint}>
        {scope === 'One-off'
          ? 'One-off is a single date and time — you’ll set the exact date next.'
          : 'Recurring repeats on the weekdays you choose, between a start and end date — you’ll set the exact dates and times next.'}
      </Text>
    </View>
  );
}

/* ── Step 2 · Description ─────────────────────────────────────────────────── */
function StepDescription({
  category,
  desc,
  setDesc,
  ack,
  setAck,
}: {
  category: Category;
  desc: string;
  setDesc: (v: string) => void;
  ack: boolean;
  setAck: (v: boolean) => void;
}) {
  return (
    <View>
      <Text style={styles.lede}>Share enough for a {category} to know if they&rsquo;re the right fit.</Text>

      <View style={styles.infoBanner}>
        <Icon name="info" size={18} color={colors.ink} />
        <Text style={styles.infoBannerText}>
          <Text style={styles.infoBannerStrong}>Your Job will be visible to verified Caregivers</Text> in your category
          and area. Avoid including more about your child than is needed.
        </Text>
      </View>

      <Pressable
        onPress={() => setAck(!ack)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ack }}
        style={styles.ackRow}
      >
        <View style={[styles.ackBox, ack ? styles.ackBoxOn : styles.ackBoxOff]}>
          {ack ? <Icon name="check" size={14} color={colors.inkInv} /> : null}
        </View>
        <Text style={styles.ackText}>I understand my description will be visible to multiple Caregivers.</Text>
      </Pressable>

      <View style={styles.descHeader}>
        <Text style={styles.sectionLabelInline}>Job description</Text>
        <Text style={styles.counter}>{desc.length} / 1500</Text>
      </View>
      <View style={styles.textareaWrap}>
        <TextInput
          value={desc}
          onChangeText={(v) => setDesc(v.slice(0, 1500))}
          multiline
          textAlignVertical="top"
          placeholder="What does your family need?"
          placeholderTextColor={colors.ink3}
          style={styles.textarea}
        />
      </View>
      <Text style={styles.tip}>
        Tip — leave out full names, school names, or your exact address. You can share those after you award the Job.
      </Text>
    </View>
  );
}

/* ── Step 3 · Logistics ──────────────────────────────────────────────────── */
function StepLogistics({
  scope,
  schedule,
  negotiable,
  setNegotiable,
  onConsent,
}: {
  scope: Scope;
  schedule: string;
  negotiable: boolean;
  setNegotiable: (v: boolean) => void;
  onConsent: () => void;
}) {
  return (
    <View>
      <Text style={styles.lede}>Set the date, time, and ZIP you need. Negotiation happens later, via Offers.</Text>

      <Text style={styles.sectionLabel}>Location</Text>
      <View style={styles.zipWrap}>
        <Text style={styles.fieldLabel}>ZIP code</Text>
        <View style={styles.zipBox}>
          <Text style={styles.zipValue}>90210</Text>
        </View>
      </View>
      <View style={styles.locHint}>
        <Icon name="pin" size={14} color={colors.ink3} />
        <Text style={styles.locHintText}>
          Beverly Hills, CA · Caregivers see an approximate distance from this ZIP — no radius to set.
        </Text>
      </View>

      <Text style={styles.sectionLabel}>Schedule</Text>
      <View style={styles.card}>
        <SummaryRow icon="calendar" label={scope} value={schedule} />
      </View>

      <Text style={styles.sectionLabel}>Safety Behaviors</Text>
      <View style={styles.card}>
        <Text style={styles.disclose}>Disclosed to applicants for this Job:</Text>
        <View style={styles.chipWrap}>
          <Chip label="Food allergies" tone="safety" icon="shield" />
          <Chip label="EpiPen on site" tone="safety" icon="shield" />
        </View>
        <Pressable onPress={onConsent} accessibilityRole="button" style={styles.consentLink}>
          <Icon name="lock" size={14} color={colors.brand} />
          <Text style={styles.consentLinkText}>Review &amp; consent to edit</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>Budget hint · optional</Text>
      <View style={styles.card}>
        <View style={styles.budgetRow}>
          <View style={styles.budgetIcon}>
            <Icon name="dollar" size={18} color={colors.ink} />
          </View>
          <View style={styles.flexMin}>
            <Text style={styles.budgetValue}>$30–40 / hr</Text>
            <Text style={styles.budgetSub}>Non-binding. Negotiation happens via Offers.</Text>
          </View>
        </View>
        <View style={styles.negotiableRow}>
          <Text style={styles.negotiableLabel}>Rate is negotiable</Text>
          <Toggle on={negotiable} onPress={() => setNegotiable(!negotiable)} />
        </View>
      </View>
    </View>
  );
}

/* ── Step 4 · Review ─────────────────────────────────────────────────────── */
function StepReview({
  category,
  scope,
  schedule,
  onEdit,
}: {
  category: Category;
  scope: Scope;
  schedule: string;
  onEdit: (step: number) => void;
}) {
  return (
    <View>
      <Text style={styles.lede}>Once live, verified {category}s in your area can apply with an Offer.</Text>

      <View style={styles.reviewHead}>
        <View style={styles.reviewHeadTop}>
          <CategoryChip category={category} />
          <Text style={styles.reviewScope}>{scope}</Text>
        </View>
        <Text style={styles.reviewTitle}>5th-grade math support, twice weekly after school</Text>
        <Text style={styles.reviewMeta}>Tue & Thu · 3:30–5:00 PM · 12 sessions · 90210</Text>
      </View>

      <View style={styles.detailCard}>
        <DetailRow
          icon="edit"
          label="Description"
          value="Our 5th-grader needs help shoring up fractions, ratios, and word problems before placement testing…"
          onEdit={() => onEdit(1)}
        />
        <View style={styles.detailDivider} />
        <DetailRow icon="calendar" label="Schedule" value={`${scope} · ${schedule}`} onEdit={() => onEdit(2)} />
        <View style={styles.detailDivider} />
        <DetailRow icon="pin" label="Location" value="90210 · Beverly Hills, CA" onEdit={() => onEdit(2)} />
        <View style={styles.detailDivider} />
        <DetailRow icon="shield" label="Safety Behaviors" value="Disclosed: Food allergies · EpiPen" onEdit={() => onEdit(2)} />
        <View style={styles.detailDivider} />
        <DetailRow icon="dollar" label="Budget hint" value="$30–40 / hr · non-binding" onEdit={() => onEdit(2)} />
      </View>

      <View style={styles.note}>
        <Icon name="info" size={18} color={colors.ink2} />
        <Text style={styles.noteText}>
          Posting a Job uses your active Subscription. Posted Jobs auto-expire after 14 days if nobody is awarded.
        </Text>
      </View>
    </View>
  );
}

function SummaryRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryIcon}>
        <Icon name={icon} size={14} color={colors.ink} />
      </View>
      <View style={styles.flexMin}>
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text style={styles.summaryValue}>{value}</Text>
      </View>
      <Text style={styles.editLink}>Edit</Text>
    </View>
  );
}

function DetailRow({
  icon,
  label,
  value,
  onEdit,
}: {
  icon: IconName;
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIcon}>
        <Icon name={icon} size={14} color={colors.ink} />
      </View>
      <View style={styles.flexMin}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
      <Pressable onPress={onEdit} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.editLink}>Edit</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flex: { flex: 1 },
  flexMin: { flex: 1, minWidth: 0 },

  // wizard panel
  wizard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    overflow: 'hidden',
    ...shadow.e1,
  },

  // left step rail
  rail: {
    width: 256,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: colors.hairline,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: 30,
    paddingHorizontal: 22,
  },
  railEyebrow: {
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink2,
    marginBottom: 20,
    marginLeft: 4,
  },
  railList: { gap: 4 },
  railItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14 },
  railItemOn: { backgroundColor: colors.surface, ...shadow.e1 },
  railNum: { width: 28, height: 28, borderRadius: radii.pill, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  railNumDone: { backgroundColor: colors.brand },
  railNumOn: { backgroundColor: colors.ink },
  railNumTodo: { backgroundColor: colors.surface },
  railNumText: { fontFamily: fonts.bold, fontSize: 12.5, fontVariant: ['tabular-nums'] },
  railLabel: { fontSize: 14 },

  // right pane
  pane: { flex: 1, minWidth: 0 },
  paneInner: { paddingVertical: 34, paddingHorizontal: 40 },
  eyebrow: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, color: colors.ink, marginTop: 12, marginBottom: 18 },
  lede: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink2, marginBottom: 22, maxWidth: 560 },

  // footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingVertical: 16,
    paddingHorizontal: 40,
  },
  saveDraft: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink2 },
  nextBtn: { height: 50, paddingHorizontal: 26, borderRadius: radii.pill, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nextText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },

  // shared section labels
  sectionLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginTop: 24, marginBottom: 12 },
  sectionLabelInline: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },

  // step 1 — category tiles
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexGrow: 1, flexBasis: 150, minWidth: 140, height: 124, borderRadius: 20, padding: 14, justifyContent: 'space-between', borderWidth: 2, borderColor: 'transparent' },
  tileSelected: { borderColor: colors.ink },
  tileName: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  tileCheck: { position: 'absolute', top: 10, right: 10, width: 24, height: 24, borderRadius: radii.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },

  // step 1 — scope segmented control
  segment: { flexDirection: 'row', alignItems: 'center', maxWidth: 320, height: 46, padding: 4, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  segOpt: { flex: 1, height: 38, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  segOptOn: { backgroundColor: colors.surface, ...shadow.e1 },
  segText: { fontFamily: fonts.semibold, fontSize: 13.5 },
  scopeHint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink3, marginTop: 12, maxWidth: 460 },

  // step 2 — description
  infoBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surfaceAlt },
  infoBannerText: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: colors.ink },
  infoBannerStrong: { fontFamily: fonts.semibold, color: colors.ink },
  ackRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surface, marginTop: 14, ...shadow.e1 },
  ackBox: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  ackBoxOn: { backgroundColor: colors.ink },
  ackBoxOff: { borderWidth: 1.5, borderColor: colors.ink3 },
  ackText: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, color: colors.ink },
  descHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 22, marginBottom: 8 },
  counter: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink3 },
  textareaWrap: { borderRadius: 16, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.brand },
  textarea: { minHeight: 180, padding: 18, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, color: colors.ink },
  tip: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink3, marginTop: 12 },

  // step 3 — logistics
  zipWrap: { maxWidth: 320 },
  fieldLabel: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink2, marginBottom: 8 },
  zipBox: { height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.surface, justifyContent: 'center', paddingHorizontal: 16 },
  zipValue: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
  locHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  locHintText: { flex: 1, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink3 },

  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, maxWidth: 480, ...shadow.e1 },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  summaryIcon: { width: 32, height: 32, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  summaryLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },
  summaryValue: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink, marginTop: 4 },
  editLink: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink2 },

  disclose: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  consentLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  consentLinkText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brand },

  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  budgetIcon: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.catTutor, alignItems: 'center', justifyContent: 'center' },
  budgetValue: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
  budgetSub: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink2, marginTop: 2 },
  negotiableRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.hairline },
  negotiableLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  // step 4 — review
  reviewHead: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 20, maxWidth: 560, ...shadow.e1 },
  reviewHeadTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewScope: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink3 },
  reviewTitle: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, letterSpacing: -0.3, color: colors.ink, marginTop: 12 },
  reviewMeta: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 6 },
  detailCard: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: 18, paddingVertical: 6, maxWidth: 560, marginTop: 16, ...shadow.e1 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14 },
  detailIcon: { width: 32, height: 32, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  detailLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },
  detailValue: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink, marginTop: 4 },
  detailDivider: { height: 1, backgroundColor: colors.hairline },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.surfaceAlt, maxWidth: 560, marginTop: 16 },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink2 },
});
