/**
 * CaregiverJobApplyWeb — the Caregiver's apply-to-a-Job flow on desktop web.
 *
 * Composes an Offer against an open Parent Job. Two-column desktop layout:
 *  - left  · the Job summary recap + the proposal composer (rate, negotiable
 *            toggle, message to Parent, credentials preview).
 *  - right · a "Your Offer" total card whose styling borrows the design ref's
 *            "Offer · from Maya / $X total / When·Rate·Scope grid" card
 *            (DesignSync screens/jobs-detail.jsx), with the live computed total
 *            and the Submit CTA.
 *
 * Caregivers DO use Stripe/Offers/commission (per PRD) — so the total is a real
 * computed Offer figure (rate × hours/session × sessions). Keeps the native
 * state (rate, negotiable, message). Content-only: the route dispatcher wraps
 * this in <WebShell role="caregiver" active="opportunities">. RN primitives only.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { CredBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { Toggle } from '@/components/ui/Toggle';
import { WebPageHeader } from '@/components/web/WebShell';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

const JOB = {
  category: 'Tutor' as const,
  title: '5th-grade math support, twice weekly after school',
  when: 'Tue & Thu · 3:30–5:00 PM · Recurring',
  budget: '$30–40 / hr',
  scope: '1.5 h / session · 12 sessions',
  hoursPerSession: 1.5,
  sessions: 12,
  parent: 'Adjei O.',
  rating: '4.8',
};

const MESSAGE_MAX = 280;

function money(n: number) {
  return n % 1 === 0
    ? `$${n.toLocaleString('en-US')}`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CaregiverJobApplyWeb() {
  const router = useRouter();
  const go = (r: string) => router.push(r as never);
  const [rate, setRate] = useState('34');
  const [negotiable, setNegotiable] = useState(true);
  const [message, setMessage] = useState('');

  const rateNum = parseFloat(rate) || 0;
  const total = Math.round(rateNum * JOB.hoursPerSession * JOB.sessions * 100) / 100;

  return (
    <View>
      <WebPageHeader greet="Opportunities · Apply" title="Apply to this Job" actions={['bell', 'message']} />

      <View style={styles.body}>
        <View style={styles.layout}>
          {/* ── left · job recap + proposal composer ──────────────── */}
          <View style={styles.mainCol}>
            {/* Job recap */}
            <Card radius={radii.xl} padding={24} style={styles.recap}>
              <View style={styles.recapTop}>
                <CategoryChip category={JOB.category} />
                <Text style={styles.recapPosted}>Recurring · 7 of 15 applied</Text>
              </View>
              <Text style={styles.recapTitle}>{JOB.title}</Text>
              <View style={styles.recapMetaRow}>
                <Icon name="clock" size={15} color={colors.ink3} />
                <Text style={styles.recapMeta}>{JOB.when}</Text>
              </View>
              <View style={styles.recapDivider} />
              <View style={styles.recapFoot}>
                <Avatar label={JOB.parent} size="sm" tone="monoGray" />
                <Text style={styles.recapParent}>{JOB.parent}</Text>
                <View style={styles.recapRating}>
                  <Icon name="star" size={13} color={colors.highlight} />
                  <Text style={styles.recapRatingText}>{JOB.rating}</Text>
                </View>
                <View style={styles.flex} />
                <Text style={styles.recapBudget}>
                  {JOB.budget}
                  <Text style={styles.recapBudgetHint}> · budget hint</Text>
                </Text>
              </View>
            </Card>

            {/* Proposal composer */}
            <Card radius={radii.xl} padding={28} style={styles.composer}>
              <Text style={styles.composerHead}>Compose your Offer</Text>
              <Text style={styles.composerSub}>
                Set the rate you&rsquo;re proposing and add a short note. Numbers and emails are hidden until the
                Parent awards the Job.
              </Text>

              {/* Your rate */}
              <Text style={styles.fieldLabel}>Your rate</Text>
              <View style={styles.rateRow}>
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
                <View style={styles.hint}>
                  <Icon name="info" size={14} color={colors.ink2} />
                  <Text style={styles.hintText}>Parent&rsquo;s budget hint is {JOB.budget}</Text>
                </View>
              </View>

              <View style={styles.toggleRow}>
                <View style={styles.flexMin}>
                  <Text style={styles.toggleTitle}>Open to negotiation</Text>
                  <Text style={styles.toggleSub}>Let the Parent counter your rate. Off locks it to your offer.</Text>
                </View>
                <Toggle on={negotiable} onPress={() => setNegotiable((v) => !v)} />
              </View>

              {/* Message */}
              <View style={styles.msgHead}>
                <Text style={[styles.fieldLabel, styles.fieldLabelInline]}>Message to Parent (optional)</Text>
                <Text style={styles.counter}>
                  {message.length}/{MESSAGE_MAX}
                </Text>
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
              <Text style={styles.fieldLabel}>Your credentials</Text>
              <Text style={styles.credHint}>Shared with the Parent when you apply.</Text>
              <View style={styles.creds}>
                <CredBadge label="Background check · Checkr" status="verified" icon="shield" />
                <CredBadge label="CPR & First Aid" status="verified" icon="check-circle" />
                <CredBadge label="Water Safety Instructor" status="pending" />
              </View>
            </Card>
          </View>

          {/* ── right · the Offer total card + submit ─────────────── */}
          <View style={styles.sideCol}>
            <Card radius={radii.xl} padding={22} style={styles.offerCard}>
              <View style={styles.offerTop}>
                <Text style={styles.offerEyebrow}>Offer · to {JOB.parent}</Text>
                <View style={[styles.offerPill, negotiable ? styles.offerPillNeg : styles.offerPillFixed]}>
                  <Text style={[styles.offerPillText, { color: negotiable ? colors.brand : colors.ink2 }]}>
                    {negotiable ? 'Negotiable' : 'Fixed rate'}
                  </Text>
                </View>
              </View>

              <Text style={styles.offerTotal}>{money(total)}</Text>
              <Text style={styles.offerTotalLabel}>Estimated total</Text>

              <View style={styles.offerGrid}>
                <OfferRow label="When" value="Tue & Thu · 3:30–5:00 PM" />
                <OfferRow label="Rate" value={`${money(rateNum)} / hr`} />
                <OfferRow label="Scope" value={JOB.scope} />
              </View>

              <View style={styles.offerDivider} />

              <Pressable onPress={() => go('/opportunities')} style={styles.submitBtn}>
                <Text style={styles.submitText}>Submit application</Text>
                <Icon name="arrow-right" size={18} color={colors.inkInv} />
              </Pressable>
            </Card>

            <View style={styles.note}>
              <Icon name="lock" size={18} color={colors.brand} />
              <Text style={styles.noteText}>
                Your contact info stays hidden until the Parent awards the Job. Payment is collected through Our
                Haven once each session ends.
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function OfferRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.offerRow}>
      <Text style={styles.offerRowLabel}>{label}</Text>
      <Text style={styles.offerRowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flex: { flex: 1 },
  flexMin: { flex: 1, minWidth: 0 },

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  mainCol: { flexGrow: 1.6, flexBasis: 560, minWidth: 360, gap: 18 },
  sideCol: { flexGrow: 1, flexBasis: 320, minWidth: 280, gap: 16 },

  // job recap
  recap: { ...shadow.e1, gap: 12 },
  recapTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recapPosted: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },
  recapTitle: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: colors.ink },
  recapMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  recapMeta: { fontFamily: fonts.regular, fontSize: 13.5, color: colors.ink2 },
  recapDivider: { height: 1, backgroundColor: colors.hairline },
  recapFoot: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  recapParent: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  recapRating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  recapRatingText: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2 },
  recapBudget: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },
  recapBudgetHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },

  // composer
  composer: { ...shadow.e1 },
  composerHead: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  composerSub: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 20, color: colors.ink2, marginTop: 6, maxWidth: 540 },

  fieldLabel: {
    fontFamily: fonts.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink2,
    marginTop: 24,
    marginBottom: 10,
  },
  fieldLabelInline: { marginTop: 0, marginBottom: 0 },

  rateRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14 },
  rateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 58,
    minWidth: 200,
    paddingHorizontal: 20,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceAlt,
  },
  rateCurrency: { fontFamily: fonts.bold, fontSize: 20, color: colors.ink2 },
  rateInput: { flexGrow: 1, minWidth: 60, fontFamily: fonts.bold, fontSize: 24, color: colors.ink, padding: 0, fontVariant: ['tabular-nums'] },
  rateUnit: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  hintText: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18 },
  toggleTitle: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink },
  toggleSub: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink2, marginTop: 2 },

  msgHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 10 },
  counter: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink3 },
  msgInput: { minHeight: 120, borderRadius: radii.lg, backgroundColor: colors.surfaceAlt, padding: 16, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.ink },

  credHint: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: -4, marginBottom: 12 },
  creds: { gap: 8, alignItems: 'flex-start' },

  // offer card (right)
  offerCard: { ...shadow.e1, borderWidth: 1, borderColor: colors.hairline },
  offerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  offerEyebrow: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2 },
  offerPill: { height: 24, paddingHorizontal: 10, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  offerPillNeg: { backgroundColor: colors.brandSoft },
  offerPillFixed: { backgroundColor: colors.surfaceAlt },
  offerPillText: { fontFamily: fonts.semibold, fontSize: 11 },
  offerTotal: { fontFamily: fonts.bold, fontSize: 40, letterSpacing: -1.2, color: colors.ink, textAlign: 'center', marginTop: 14, fontVariant: ['tabular-nums'] },
  offerTotalLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, textAlign: 'center', marginTop: 2, marginBottom: 16 },

  offerGrid: { gap: 10 },
  offerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 },
  offerRowLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2 },
  offerRowValue: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.ink, textAlign: 'right' },

  offerDivider: { height: 1, backgroundColor: colors.hairline, marginVertical: 18 },

  submitBtn: { height: 52, borderRadius: radii.pill, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  noteText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },
});
