/**
 * Job apply (Caregiver) — the apply flow for an open Job. Built from the Offer/
 * application tone in the design (screens/offer.jsx + screens/jobs-detail.jsx): a
 * short Job recap, the Caregiver's proposed rate with a negotiable Toggle, an
 * optional message to the Parent, a credentials preview, and a sticky Submit CTA.
 * Reached from /job-detail. Mock data; UI-only.
 *
 * This is the native (and narrow-web) body; the desktop layout lives in
 * `@/screens/web/cp/JobApply` and is chosen by `job-apply.web.tsx`.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { CredBadge } from '@/components/ui/Badge';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Toggle } from '@/components/ui/Toggle';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const JOB = {
  category: 'Tutor' as const,
  title: '5th-grade math support, twice weekly after school',
  when: 'Tue & Thu · 3:30–5:00 PM · Recurring',
  budget: 'Budget hint · $30–40 / hr',
};

const MESSAGE_MAX = 280;

export default function JobApplyScreen() {
  const router = useRouter();
  const [rate, setRate] = useState('34');
  const [negotiable, setNegotiable] = useState(true);
  const [message, setMessage] = useState('');

  return (
    <Screen edges={['top']}>
      <AppBar onBack={() => router.back()} title="Apply" />

      <ScrollBody>
        {/* Job recap */}
        <View style={styles.recap}>
          <CategoryChip category={JOB.category} />
          <Text style={styles.recapTitle}>{JOB.title}</Text>
          <View style={styles.recapMetaRow}>
            <Icon name="clock" size={14} color={colors.ink3} />
            <Text style={styles.recapMeta}>{JOB.when}</Text>
          </View>
          <Text style={styles.recapBudget}>{JOB.budget}</Text>
        </View>

        {/* Your rate */}
        <Text style={styles.sectionLabel}>Your rate</Text>
        <View style={styles.rateField}>
          <Text style={styles.rateCurrency}>$</Text>
          <TextInput
            value={rate}
            onChangeText={(v) => setRate(v.replace(/[^\d.]/g, '').slice(0, 6))}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.ink3}
            style={styles.rateInput}
            accessibilityLabel="Hourly rate"
          />
          <Text style={styles.rateUnit}>/hr</Text>
        </View>

        <View style={styles.toggleRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.toggleTitle}>Open to negotiation</Text>
            <Text style={styles.toggleSub}>Let the Parent counter your rate. Off locks it to your offer.</Text>
          </View>
          <Toggle on={negotiable} onPress={() => setNegotiable((v) => !v)} />
        </View>

        {/* Message */}
        <View style={styles.msgHead}>
          <Text style={styles.sectionLabel}>Message to Parent (optional)</Text>
          <Text style={styles.counter}>{message.length}/{MESSAGE_MAX}</Text>
        </View>
        <TextInput
          value={message}
          onChangeText={(v) => setMessage(v.slice(0, MESSAGE_MAX))}
          placeholder="Introduce yourself and why you're a fit. Numbers and emails are hidden."
          placeholderTextColor={colors.ink3}
          style={styles.msgInput}
          multiline
          textAlignVertical="top"
        />

        {/* Credentials preview */}
        <Text style={styles.sectionLabel}>Your credentials</Text>
        <Text style={styles.credHint}>Shared with the Parent when you apply.</Text>
        <View style={styles.creds}>
          <CredBadge label="Background check · Checkr" status="verified" icon="shield" />
          <CredBadge label="CPR & First Aid" status="verified" icon="check-circle" />
          <CredBadge label="Water Safety Instructor" status="pending" />
        </View>
      </ScrollBody>

      {/* Sticky Submit CTA */}
      <View style={styles.footer}>
        <View style={styles.footerSummary}>
          <Text style={styles.footerLabel}>Your rate</Text>
          <Text style={styles.footerValue}>${rate || '0'}/hr</Text>
        </View>
        <View style={{ flex: 1 }}>
          <PrimaryButton
            icon={<Icon name="arrow-right" size={18} color={colors.inkInv} />}
            onPress={() => router.push('/opportunities')}
          >
            Submit application
          </PrimaryButton>
        </View>
      </View>
    </Screen>
  );
}

function ScrollBody({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      style={styles.bodyWrap}
      contentContainerStyle={styles.body}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bodyWrap: { flex: 1, marginHorizontal: -24 },
  body: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },

  recap: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, ...shadow.e1, gap: 8 },
  recapTitle: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21, color: colors.ink },
  recapMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recapMeta: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  recapBudget: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2 },

  sectionLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginTop: 24, marginBottom: 10 },

  rateField: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 56, paddingHorizontal: 18, borderRadius: radii.lg, backgroundColor: colors.surfaceAlt },
  rateCurrency: { fontFamily: fonts.bold, fontSize: 20, color: colors.ink2 },
  rateInput: { flex: 1, fontFamily: fonts.bold, fontSize: 22, color: colors.ink, padding: 0, fontVariant: ['tabular-nums'] },
  rateUnit: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  toggleTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  toggleSub: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.ink2, marginTop: 2 },

  msgHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  counter: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink3, marginBottom: 10 },
  msgInput: { minHeight: 110, borderRadius: radii.lg, backgroundColor: colors.surfaceAlt, padding: 14, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.ink },

  credHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: -4, marginBottom: 10 },
  creds: { gap: 8, alignItems: 'flex-start' },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: -24,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 16,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    ...shadow.e2,
  },
  footerSummary: { minWidth: 72 },
  footerLabel: { fontFamily: fonts.regular, fontSize: 11, color: colors.ink2 },
  footerValue: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink, marginTop: 2, fontVariant: ['tabular-nums'] },
});
