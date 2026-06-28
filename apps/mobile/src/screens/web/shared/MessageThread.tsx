/**
 * MessageThreadWeb — one open 1:1 conversation on desktop web (shared by Parent
 * and supply roles). Content-only: the route dispatcher wraps this in the
 * role-aware shell (<ParentWebShell active="messages"> for parents,
 * <WebShell role={role} active="messages"> for caregiver/provider).
 *
 * Ported from the Claude Design web project (parent-web/pw-messaging.jsx PWInbox)
 * and the native shared MessageThread: the conversation list lives on the Messages
 * tab, so this route renders a single comfortable thread column (ThreadHeader +
 * collapsible encrypted/redaction banner + message bubbles + composer) beside a
 * right context rail with the anchored booking, the counterpart quick-card, and a
 * safety note (the design's JobContextPanel). RN primitives only (renders via
 * RN-web); the surrounding shell ScrollView handles scrolling.
 */
import { useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { CategoryChip } from '@/components/ui/CategoryChip';
import { RatingValue } from '@/components/ui/StarRating';
import { StatusPill } from '@/components/ui/StatusPill';
import { WebPageHeader } from '@/components/web/WebShell';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

export function MessageThreadWeb() {
  const router = useRouter();
  const go = (r: string) => router.push(r as never);
  const [bannerOpen, setBannerOpen] = useState(true);
  const [draft, setDraft] = useState('');

  return (
    <View>
      <WebPageHeader greet="Messages" title="Conversation" actions={['bell']} />

      <View style={styles.body}>
        <View style={styles.layout}>
          {/* ── left · the open thread ──────────────────────────── */}
          <View style={styles.mainCol}>
            <Card radius={28} padding={0} style={styles.threadCard}>
              {/* header */}
              <View style={styles.threadHead}>
                <Pressable onPress={() => go('/messages')} style={styles.backBtn} accessibilityLabel="Back to messages">
                  <Icon name="chevron-left" size={18} color={colors.ink} />
                </Pressable>
                <Avatar label="Maya Okafor" tone="catTutor" size="lg" online />
                <View style={styles.flexMin}>
                  <Text style={styles.headName} numberOfLines={1}>
                    Maya Okafor
                  </Text>
                  <View style={styles.statusRow}>
                    <View style={styles.onlineDot} />
                    <Text style={styles.online}>Online · Tutor</Text>
                  </View>
                </View>
                <Pressable onPress={() => go('/consult')} style={styles.callBtn}>
                  <Icon name="video" size={15} color={colors.ink} />
                  <Text style={styles.callBtnText}>Video call</Text>
                </Pressable>
              </View>

              {/* collapsible encryption / redaction banner */}
              <Pressable onPress={() => setBannerOpen((v) => !v)} accessibilityRole="button" style={styles.banner}>
                <Icon name="lock" size={16} color={colors.brand} />
                <View style={styles.flexMin}>
                  <Text style={styles.bannerTitle}>Encrypted &amp; monitored</Text>
                  {bannerOpen ? (
                    <Text style={styles.bannerSub}>
                      Messages are end-to-end encrypted. Sharing contact info — phone numbers and emails — is automatically
                      redacted to keep you on-platform.
                    </Text>
                  ) : null}
                </View>
                <Icon name={bannerOpen ? 'chevron-down' : 'chevron-right'} size={16} color={colors.ink3} />
              </Pressable>

              {/* transcript */}
              <View style={styles.transcript}>
                <Text style={styles.dayMarker}>Today · earlier</Text>

                <Bubble from="them">
                  Hi Adjei! I&rsquo;m confirmed for Anika&rsquo;s Wednesday morning session. Want me to bring the workbook?
                </Bubble>

                <Bubble from="me">Yes please! Should I send the address again?</Bubble>

                {/* received with an inline redaction pill */}
                <View style={[styles.bubble, styles.them]}>
                  <Text style={styles.themText}>
                    No need — already saved. If anything comes up text me at{' '}
                    <Text style={styles.redactPill}> █ phone hidden </Text> — I&rsquo;ll bring everything.
                  </Text>
                </View>

                <Bubble from="me">Perfect. See you Wednesday.</Bubble>
              </View>

              {/* composer */}
              <View style={styles.composer}>
                <Pressable style={styles.composerIcon} accessibilityLabel="Attach">
                  <Icon name="paperclip" size={20} color={colors.ink2} />
                </Pressable>
                <View style={styles.inputPill}>
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Message Maya…"
                    placeholderTextColor={colors.ink3}
                    style={styles.input}
                  />
                </View>
                <Pressable style={styles.sendBtn} accessibilityLabel="Send">
                  <Icon name="send" size={18} color={colors.inkInv} />
                </Pressable>
              </View>
            </Card>
          </View>

          {/* ── right · context rail ────────────────────────────── */}
          <View style={styles.sideCol}>
            {/* anchored booking */}
            <View>
              <Text style={styles.railLabel}>Anchored booking</Text>
              <Card radius={radii.xl} padding={18} style={styles.railCard}>
                <CategoryChip category="Tutor" />
                <Text style={styles.railTitle}>Anika&rsquo;s Wednesday session</Text>
                <Text style={styles.railSub}>Wed · 9:15 AM · Math review · 1 hr</Text>
                <View style={styles.railRow}>
                  <StatusPill state="accepted" />
                  <Pressable onPress={() => go('/booking-detail')}>
                    <Text style={styles.railLink}>View booking</Text>
                  </Pressable>
                </View>
              </Card>
            </View>

            {/* counterpart quick-card */}
            <View>
              <Text style={styles.railLabel}>Caregiver</Text>
              <Card radius={radii.xl} padding={18} style={styles.railCard}>
                <View style={styles.provRow}>
                  <Avatar label="Maya Okafor" tone="catTutor" size="md" />
                  <View style={styles.flexMin}>
                    <Text style={styles.provName} numberOfLines={1}>
                      Maya Okafor
                    </Text>
                    <RatingValue value={4.9} count={87} size={13} style={styles.provRating} />
                  </View>
                </View>
                <View style={styles.badgeRow}>
                  <Badge kind="verified" />
                  <Badge kind="toprated" />
                </View>
                <Pressable onPress={() => go('/provider-detail')} style={styles.profileBtn}>
                  <Text style={styles.profileBtnText}>View full profile</Text>
                </Pressable>
              </Card>
            </View>

            {/* safety note */}
            <View style={styles.safety}>
              <Icon name="shield" size={18} color={colors.success} />
              <Text style={styles.safetyText}>
                Keep it on Our Haven. Off-platform contact removes your booking &amp; payment protection.
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function Bubble({ from, children }: { from: 'me' | 'them'; children: ReactNode }) {
  const me = from === 'me';
  return (
    <View style={[styles.bubble, me ? styles.me : styles.them]}>
      <Text style={me ? styles.meText : styles.themText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flexMin: { flex: 1, minWidth: 0 },

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },
  mainCol: { flexGrow: 1.6, flexBasis: 520, minWidth: 360, maxWidth: 760 },
  sideCol: { flexGrow: 1, flexBasis: 300, minWidth: 280, gap: 16 },

  // thread card
  threadCard: { overflow: 'hidden' },
  threadHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 22,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headName: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  onlineDot: { width: 6, height: 6, borderRadius: radii.pill, backgroundColor: colors.success },
  online: { fontFamily: fonts.medium, fontSize: 12, color: colors.success },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 38,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  callBtnText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginHorizontal: 22, marginTop: 18, padding: 13, borderRadius: radii.md, backgroundColor: colors.brandSoft },
  bannerTitle: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  bannerSub: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink2, marginTop: 3 },

  transcript: { gap: 12, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 18 },
  dayMarker: { alignSelf: 'center', fontFamily: fonts.medium, fontSize: 11.5, color: colors.ink3 },
  bubble: { maxWidth: '78%', paddingVertical: 11, paddingHorizontal: 15 },
  me: {
    alignSelf: 'flex-end',
    backgroundColor: colors.brand,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: 8,
  },
  them: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: radii.xl,
  },
  meText: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 21, color: colors.inkInv },
  themText: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 22, color: colors.ink },
  redactPill: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink2, backgroundColor: colors.surface },

  composer: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: colors.hairline },
  composerIcon: { width: 44, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  inputPill: { flex: 1, height: 46, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, paddingHorizontal: 18, justifyContent: 'center' },
  input: { fontFamily: fonts.regular, fontSize: 14.5, color: colors.ink, padding: 0 },
  sendBtn: { width: 46, height: 46, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },

  // right rail
  railLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 10 },
  railCard: { ...shadow.e1 },
  railTitle: { fontFamily: fonts.bold, fontSize: 15.5, lineHeight: 21, color: colors.ink, marginTop: 11 },
  railSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 6 },
  railRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 },
  railLink: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.brand },

  provRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  provName: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.ink },
  provRating: { marginTop: 3 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  profileBtn: {
    height: 42,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  profileBtnText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },

  safety: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  safetyText: { flex: 1, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink2 },
});
