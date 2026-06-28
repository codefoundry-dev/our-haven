/**
 * Children (Parent) — a simple roster of the children a Parent can attach to a
 * Job or Booking. Rendered as a 2-column grid of colored monogram tiles plus an
 * "Add child" tile, with an empty-state variant when none are added yet.
 *
 * Note: per ADR-0012 there is no first-class Child entity — child count + ages
 * ride on the Offer/Booking. This screen is a lightweight local roster (mock
 * data) to seed those inputs. UI-only skeleton.
 *
 * This is the native + narrow-web body. The bespoke desktop layout lives in
 * `@/screens/web/parent/Children` and is chosen by `children.web.tsx`.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
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

export default function ChildrenScreen() {
  const router = useRouter();
  // Flip to [] to preview the empty state.
  const [children] = useState<Child[]>(CHILDREN);

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar title="Children" onBack={() => router.back()} />

      <Text style={styles.h1}>Your children.</Text>
      <Text style={styles.lede}>Attach a child to a Job or Booking. We only ever share an age — never a name.</Text>

      {children.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Icon name="users" size={28} color={colors.brand} />
          </View>
          <Text style={styles.emptyTitle}>No children added yet</Text>
          <Text style={styles.emptySub}>Add a child to speed up posting Jobs and sending Booking requests.</Text>
          <Pressable accessibilityRole="button" style={styles.emptyBtn}>
            <Icon name="plus" size={16} color={colors.inkInv} />
            <Text style={styles.emptyBtnText}>Add child</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.grid}>
          {children.map((c) => (
            <View key={c.id} style={styles.cardCol}>
              <View style={[styles.monogram, { backgroundColor: colors[c.tone] }]}>
                <Text style={styles.monogramText}>{c.name[0]?.toUpperCase()}</Text>
              </View>
              <Text style={styles.childName} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={styles.childAge}>Age {c.age}</Text>
            </View>
          ))}

          <Pressable accessibilityRole="button" style={({ pressed }) => [styles.cardCol, styles.addCard, { opacity: pressed ? 0.9 : 1 }]}>
            <View style={styles.addTile}>
              <Icon name="plus" size={24} color={colors.ink2} />
            </View>
            <Text style={styles.addLabel}>Add child</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },
  h1: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 32, letterSpacing: -0.5, color: colors.ink, marginTop: 8 },
  lede: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, marginTop: 6, marginBottom: 20 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 },
  cardCol: { width: '48%' },
  monogram: { width: '100%', aspectRatio: 1, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center', ...shadow.e1 },
  monogramText: { fontFamily: fonts.bold, fontSize: 48, letterSpacing: -1, color: colors.ink },
  childName: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, marginTop: 10 },
  childAge: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 2 },

  addCard: { justifyContent: 'flex-start' },
  addTile: { width: '100%', aspectRatio: 1, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.monoGray, borderStyle: 'dashed', backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  addLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink2, marginTop: 10 },

  empty: { alignItems: 'center', paddingTop: 32, gap: 10 },
  emptyIcon: { width: 64, height: 64, borderRadius: radii.lg, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, textAlign: 'center', maxWidth: 280 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingHorizontal: 22, borderRadius: radii.pill, backgroundColor: colors.brand, marginTop: 8 },
  emptyBtnText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
});
