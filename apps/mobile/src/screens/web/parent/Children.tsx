/**
 * ParentChildrenWeb — the Parent's family / children roster on desktop web.
 * Content-only: the route dispatcher wraps this in <ParentWebShell active="account">.
 *
 * Built from the native Parent Children screen (`@/screens/parent/Children`) plus
 * the Claude Design intent (screens/children.jsx → ScreenParentProfile): a clean,
 * centered single-column form (~720) with a "Your children" roster of monogram
 * cards + an "Add a child" affordance, and a consent-gated "Family safety
 * behaviours" section.
 *
 * PRD framing (ADR-0012): there is NO first-class Child entity — child count +
 * ages ride on the Offer/Booking, and the safety behaviours are a FAMILY-LEVEL,
 * consent-gated checklist revealed to a Caregiver only once engaged (Clinical
 * Providers never see it). RN primitives only (renders via RN-web).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { Card } from '@/components/ui/Card';
import { WebPageHeader } from '@/components/web/ParentWebShell';
import { useParentGate } from '@/lib/paywallGate';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

interface Child {
  id: string;
  name: string;
  age: number;
  tone: ColorToken;
}

const CHILDREN: Child[] = [
  { id: '1', name: 'Amara', age: 7, tone: 'catTutor' },
  { id: '2', name: 'Noah', age: 4, tone: 'catBaby' },
  { id: '3', name: 'Liam', age: 10, tone: 'catNanny' },
];

// Provisional Safety-Behaviors taxonomy (mirrors @/lib/profile BEHAVIOUR_OPTIONS;
// final list pending Ci'erro — M2.10). Family-level + consent-gated.
const BEHAVIOURS: readonly string[] = [
  'Aggression',
  'Self-injurious behaviour',
  'Wandering',
  'Meltdowns',
  'Property destruction',
  'Pica',
  'Sensory sensitivities',
  'Difficulty with transitions',
];

export function ParentChildrenWeb() {
  const router = useRouter();
  const go = (route: string) => router.push(route as never);
  const { gate } = useParentGate();
  const postJob = () => gate({ kind: 'post-job' }, () => go('/post-job'));

  const [children] = useState<Child[]>(CHILDREN);
  // Safety behaviours stay locked until the Parent explicitly consents.
  const [consented, setConsented] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  function toggleBehaviour(b: string) {
    setSelected((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]));
  }

  return (
    <View>
      <WebPageHeader greet="Parent · Family" title="Your children" actions={['bell', 'message']} />

      <View style={styles.body}>
        <View style={styles.column}>
          {/* privacy lede */}
          <View style={styles.lede}>
            <View style={styles.ledePill}>
              <Icon name="lock" size={13} color={colors.brand} />
              <Text style={styles.ledePillText}>Only an age is ever shared — never a name</Text>
            </View>
            <Text style={styles.ledeText}>
              Add the children you book care for. There&rsquo;s no separate child profile — the count and ages
              simply ride on each Job or Booking you send.
            </Text>
          </View>

          {/* ── Your children ─────────────────────────────────────── */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Your children</Text>
            <Text style={styles.sectionCount}>
              {children.length} {children.length === 1 ? 'child' : 'children'}
            </Text>
          </View>

          {children.length === 0 ? (
            <Card radius={radii.xl} padding={32} style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Icon name="users" size={28} color={colors.brand} />
              </View>
              <Text style={styles.emptyTitle}>No children added yet</Text>
              <Text style={styles.emptySub}>Add a child to speed up posting Jobs and sending Booking requests.</Text>
              <Pressable accessibilityRole="button" onPress={postJob} style={styles.emptyBtn}>
                <Icon name="plus" size={16} color={colors.inkInv} />
                <Text style={styles.emptyBtnText}>Add child</Text>
              </Pressable>
            </Card>
          ) : (
            <View style={styles.grid}>
              {children.map((c) => (
                <View key={c.id} style={styles.childCard}>
                  <View style={[styles.monogram, { backgroundColor: colors[c.tone] }]}>
                    <Text style={styles.monogramText}>{c.name[0]?.toUpperCase()}</Text>
                  </View>
                  <View style={styles.childMeta}>
                    <Text style={styles.childName} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.childAge}>Age {c.age}</Text>
                  </View>
                  <Pressable accessibilityRole="button" onPress={() => {}} style={styles.childEdit} hitSlop={6}>
                    <Icon name="edit" size={16} color={colors.ink2} />
                  </Pressable>
                </View>
              ))}

              <Pressable
                accessibilityRole="button"
                onPress={() => {}}
                style={({ pressed }) => [styles.addCard, { opacity: pressed ? 0.92 : 1 }]}
              >
                <View style={styles.addTile}>
                  <Icon name="plus" size={22} color={colors.ink2} />
                </View>
                <View style={styles.childMeta}>
                  <Text style={styles.addLabel}>Add a child</Text>
                  <Text style={styles.addSub}>Name &amp; age</Text>
                </View>
              </Pressable>
            </View>
          )}

          {/* ── Family safety behaviours (consent-gated) ──────────── */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Family safety behaviours</Text>
            <View style={[styles.statusPill, consented ? styles.statusPillOn : styles.statusPillOff]}>
              <Icon name={consented ? 'check-circle' : 'lock'} size={13} color={consented ? colors.success : colors.ink2} />
              <Text style={[styles.statusPillText, consented && { color: colors.success }]}>
                {consented ? 'Consented' : 'Locked'}
              </Text>
            </View>
          </View>
          <Text style={styles.sectionSub}>
            A fixed checklist of sensitive behaviours, stored only with your explicit consent and revealed to a
            Caregiver only once you engage them. Clinical Providers never see it.
          </Text>

          <Card radius={radii.xl} padding={22} style={styles.safetyCard}>
            {consented ? (
              <View style={styles.chipWrap}>
                {BEHAVIOURS.map((b) => {
                  const on = selected.includes(b);
                  return (
                    <Pressable
                      key={b}
                      onPress={() => toggleBehaviour(b)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={[styles.chip, on ? styles.chipOn : styles.chipOff]}
                    >
                      {on ? <Icon name="check" size={13} color={colors.inkInv} /> : null}
                      <Text style={[styles.chipText, on && { color: colors.inkInv }]}>{b}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View>
                {/* locked preview — desaturated chips behind a consent overlay */}
                <View style={styles.lockedChips} pointerEvents="none">
                  {BEHAVIOURS.map((b) => (
                    <View key={b} style={[styles.chip, styles.chipOff]}>
                      <Text style={styles.chipText}>{b}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.lockOverlay}>
                  <View style={styles.lockIcon}>
                    <Icon name="lock" size={18} color={colors.ink} />
                  </View>
                  <Text style={styles.lockTitle}>These stay private until you consent</Text>
                  <Pressable accessibilityRole="button" onPress={() => setConsented(true)} style={styles.consentBtn}>
                    <Icon name="shield" size={15} color={colors.ink} />
                    <Text style={styles.consentBtnText}>Review &amp; consent</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </Card>

          {consented ? (
            <View style={styles.note}>
              <Icon name="info" size={18} color={colors.brand} />
              <Text style={styles.noteText}>
                {selected.length} selected. These ride on the Booking as family context so a Caregiver can prepare —
                no names, no diagnoses.
              </Text>
            </View>
          ) : null}

          {/* save */}
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.saveBtn}>
            <Icon name="check" size={16} color={colors.inkInv} />
            <Text style={styles.saveText}>Save family profile</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  // a settings-style centered single column
  column: { width: '100%', maxWidth: 720, alignSelf: 'center' },

  // lede
  lede: { marginBottom: 4 },
  ledePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.brandSoft,
  },
  ledePillText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.brand },
  ledeText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.ink2, marginTop: 12, maxWidth: 560 },

  // section headers
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 32, marginBottom: 14 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.4, color: colors.ink },
  sectionCount: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink3 },
  sectionSub: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 20, color: colors.ink2, marginTop: -6, marginBottom: 14, maxWidth: 560 },

  // children grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  childCard: {
    flexGrow: 1,
    flexBasis: 280,
    minWidth: 240,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: 14,
    ...shadow.e1,
  },
  monogram: { width: 56, height: 56, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  monogramText: { fontFamily: fonts.bold, fontSize: 26, letterSpacing: -0.5, color: colors.ink },
  childMeta: { flex: 1, minWidth: 0 },
  childName: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  childAge: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 2, fontVariant: ['tabular-nums'] },
  childEdit: { width: 36, height: 36, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },

  addCard: {
    flexGrow: 1,
    flexBasis: 280,
    minWidth: 240,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.monoGray,
    backgroundColor: colors.surfaceAlt,
    padding: 14,
  },
  addTile: { width: 56, height: 56, borderRadius: radii.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.e1 },
  addLabel: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink2 },
  addSub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink3, marginTop: 2 },

  // empty state
  emptyCard: { alignItems: 'center', gap: 8 },
  emptyIcon: { width: 64, height: 64, borderRadius: radii.lg, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, textAlign: 'center', maxWidth: 320 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 22, borderRadius: radii.pill, backgroundColor: colors.brand, marginTop: 8 },
  emptyBtnText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },

  // safety section
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 26, paddingHorizontal: 10, borderRadius: radii.pill },
  statusPillOff: { backgroundColor: colors.surfaceAlt },
  statusPillOn: { backgroundColor: 'rgba(47,122,77,0.12)' },
  statusPillText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },

  safetyCard: { ...shadow.e1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1.5 },
  chipOff: { backgroundColor: colors.surfaceAlt, borderColor: colors.hairline },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },

  // locked preview
  lockedChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, opacity: 0.35 },
  lockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,247,221,0.6)',
    borderRadius: radii.lg,
  },
  lockIcon: { width: 44, height: 44, borderRadius: radii.pill, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.e1 },
  lockTitle: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },
  consentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 18,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  consentBtnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  // note
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: radii.md, backgroundColor: colors.brandSoft, marginTop: 14 },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },

  // save
  saveBtn: { height: 50, borderRadius: radii.pill, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 28 },
  saveText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
});
