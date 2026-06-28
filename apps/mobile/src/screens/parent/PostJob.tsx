/**
 * Post a Job (Parent) — ported from the Claude design project
 * (screens/post-job.jsx, collapsed from the 4-step wizard into one form for the
 * skeleton): category select, description, schedule + scope, location, budget
 * hint, children attach, Safety-Behaviour disclosure, a negotiable toggle, and
 * a "Post Job" CTA. UI-only with mock data.
 *
 * The bespoke desktop layout lives in `@/screens/web/parent/PostJob`
 * (`ParentPostJobWeb`) and is chosen by `post-job.web.tsx` at wide web widths;
 * this native body still renders on native and narrow web.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Chip } from '@/components/ui/Chip';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TabStrip } from '@/components/ui/TabStrip';
import { Toggle } from '@/components/ui/Toggle';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

type Category = 'Babysitter' | 'Tutor' | 'Nanny';
type Scope = 'One-off' | 'Recurring';

const CATEGORIES: { name: Category; tone: ColorToken; icon: IconName }[] = [
  { name: 'Babysitter', tone: 'catBaby', icon: 'person' },
  { name: 'Tutor', tone: 'catTutor', icon: 'graduation' },
  { name: 'Nanny', tone: 'catNanny', icon: 'users' },
];

export default function PostJobScreen() {
  const router = useRouter();
  const [category, setCategory] = useState<Category>('Tutor');
  const [scope, setScope] = useState<Scope>('Recurring');
  const [desc, setDesc] = useState(
    'Our 5th-grader needs help shoring up fractions, ratios, and word problems before middle-school placement testing. Looking for someone patient and structured.',
  );
  const [negotiable, setNegotiable] = useState(true);

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar title="Post a Job" onBack={() => router.back()} />

      <Text style={styles.h1}>Describe what you need.</Text>
      <Text style={styles.lede}>Pick a category, then share enough for the right Caregiver to know they're a fit.</Text>

      {/* Category */}
      <Text style={styles.sectionLabel}>Category</Text>
      <View style={styles.tileGrid}>
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
              <Icon name={c.icon} size={26} color={colors.ink} />
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

      {/* Scope */}
      <Text style={styles.sectionLabel}>Scope</Text>
      <TabStrip<Scope> tabs={['One-off', 'Recurring'] as const} value={scope} onChange={setScope} />
      <Text style={styles.hint}>
        {scope === 'One-off' ? 'A single date and time.' : 'Repeats on the weekdays you choose, between a start and end date.'}
      </Text>

      {/* Description */}
      <View style={styles.labelRow}>
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
      <Text style={styles.tip}>Tip — leave out full names, school names, or your exact address. Share those after you award the Job.</Text>

      {/* Schedule + location summary */}
      <Text style={styles.sectionLabel}>Schedule & location</Text>
      <View style={styles.card}>
        <SummaryRow icon="calendar" label="Schedule" value="Tue & Thu · 3:30–5:00 PM · creates 12 sessions" />
        <View style={styles.divider} />
        <SummaryRow icon="pin" label="Location" value="90210 · Beverly Hills, CA" />
      </View>

      {/* Budget hint */}
      <Text style={styles.sectionLabel}>Budget hint · optional</Text>
      <View style={styles.card}>
        <View style={styles.budgetRow}>
          <View style={styles.budgetIcon}>
            <Icon name="dollar" size={18} color={colors.ink} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.budgetValue}>$30–40 / hr</Text>
            <Text style={styles.budgetSub}>Non-binding. Negotiation happens via Offers.</Text>
          </View>
        </View>
        <View style={styles.negotiableRow}>
          <Text style={styles.negotiableLabel}>Rate is negotiable</Text>
          <Toggle on={negotiable} onPress={() => setNegotiable((v) => !v)} />
        </View>
      </View>

      {/* Children attach */}
      <Text style={styles.sectionLabel}>Children on this Job</Text>
      <Pressable onPress={() => router.push('/children')} accessibilityRole="button" style={({ pressed }) => [styles.linkCard, { opacity: pressed ? 0.9 : 1 }]}>
        <View style={styles.linkIcon}>
          <Icon name="users" size={18} color={colors.brand} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.linkTitle}>1 child · age 10</Text>
          <Text style={styles.linkSub}>Count and ages ride on the Offer — no names or notes.</Text>
        </View>
        <Icon name="chevron-right" size={20} color={colors.ink3} />
      </Pressable>

      {/* Safety Behaviors disclosure */}
      <Text style={styles.sectionLabel}>Safety Behaviors</Text>
      <View style={styles.card}>
        <Text style={styles.disclose}>Disclosed to applicants for this Job:</Text>
        <View style={styles.chipWrap}>
          <Chip label="Food allergies" tone="safety" icon="shield" />
          <Chip label="EpiPen on site" tone="safety" icon="shield" />
        </View>
        <Pressable onPress={() => router.push('/consent')} accessibilityRole="button" style={styles.consentLink}>
          <Icon name="lock" size={14} color={colors.brand} />
          <Text style={styles.consentLinkText}>Review & consent to edit</Text>
        </Pressable>
      </View>

      <PrimaryButton style={styles.cta} onPress={() => router.back()} icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}>
        Post Job
      </PrimaryButton>
      <Text style={styles.footNote}>Posting uses your active Subscription. Jobs auto-expire after 14 days if nobody is awarded.</Text>
    </Screen>
  );
}

function SummaryRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryIcon}>
        <Icon name={icon} size={14} color={colors.ink} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text style={styles.summaryValue}>{value}</Text>
      </View>
      <Text style={styles.editLink}>Edit</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 140 },
  h1: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.5, color: colors.ink, marginTop: 8 },
  lede: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, marginTop: 6 },

  sectionLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginTop: 24, marginBottom: 10 },
  sectionLabelInline: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24, marginBottom: 8 },
  counter: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink3, marginTop: 10 },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  tile: { width: '48%', height: 116, borderRadius: radii.lg, padding: 14, justifyContent: 'space-between', borderWidth: 2, borderColor: 'transparent' },
  tileSelected: { borderColor: colors.ink },
  tileName: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  tileCheck: { position: 'absolute', top: 10, right: 10, width: 24, height: 24, borderRadius: radii.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },

  textareaWrap: { borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.ink },
  textarea: { minHeight: 160, padding: 16, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink },
  tip: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink3, marginTop: 10 },

  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1 },
  divider: { height: 1, backgroundColor: colors.hairline, marginVertical: 12 },

  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  summaryIcon: { width: 32, height: 32, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  summaryLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },
  summaryValue: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink, marginTop: 4 },
  editLink: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },

  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  budgetIcon: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.catTutor, alignItems: 'center', justifyContent: 'center' },
  budgetValue: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
  budgetSub: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink2, marginTop: 2 },
  negotiableRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.hairline },
  negotiableLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  linkCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1 },
  linkIcon: { width: 38, height: 38, borderRadius: radii.pill, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  linkTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  linkSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },

  disclose: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  consentLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  consentLinkText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.brand },

  cta: { marginTop: 28 },
  footNote: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.ink3, textAlign: 'center', marginTop: 12 },
});
