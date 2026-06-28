/**
 * ParentBookingsWeb — the Parent's bookings on desktop web. Content-only: the
 * dispatcher wraps this in <ParentWebShell active="bookings">.
 *
 * Ported from the Claude Design web project (parent-web/pw-bookings.jsx) and the
 * native Parent Bookings: a two-pane desktop layout — left is an
 * Upcoming/Past/Disputes TabStrip over a selectable booking list (a recurring
 * Series plus one-off sessions); right is the detail panel for the selected
 * booking with a pricing breakdown and actions. RN primitives only.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { WebPageHeader } from '@/components/web/ParentWebShell';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { CategoryChip, type Category } from '@/components/ui/CategoryChip';
import { PricingSummary } from '@/components/ui/PricingSummary';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { StatusPill, type BookingState } from '@/components/ui/StatusPill';
import { TabStrip } from '@/components/ui/TabStrip';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

const TABS = ['Upcoming', 'Past', 'Disputes'] as const;
type Tab = (typeof TABS)[number];

interface BookingItem {
  id: string;
  cat: Category;
  tone: ColorToken;
  prov: string;
  title: string;
  when: string;
  state: BookingState;
  label: string;
  recurring?: boolean;
  sessions?: { date: string; time: string; state: BookingState; label: string }[];
}

const BOOKINGS: BookingItem[] = [
  {
    id: 'series',
    cat: 'Nanny',
    tone: 'catNanny',
    prov: 'Rosa Delgado',
    title: 'Tuesdays & Thursdays with Rosa',
    when: 'Tue & Thu · 3:30–5:00 PM · through Jul 2',
    state: 'requested',
    label: 'Awaiting Provider',
    recurring: true,
    sessions: [
      { date: 'Tue, May 26', time: '3:30–5:00 PM · ~1.5h', state: 'requested', label: 'Awaiting Provider' },
      { date: 'Thu, May 28', time: '3:30–5:00 PM · ~1.5h', state: 'requested', label: 'Awaiting Provider' },
    ],
  },
  {
    id: 'lina',
    cat: 'Babysitter',
    tone: 'catBaby',
    prov: 'Lina Park',
    title: 'After-school sitter · Anika',
    when: 'Wed, May 10 · 3:00–4:00 PM',
    state: 'accepted',
    label: 'Accepted',
  },
  {
    id: 'maya',
    cat: 'Tutor',
    tone: 'catTutor',
    prov: 'Maya Okafor',
    title: 'Math · 4th grade · Anika',
    when: 'Wed, May 10 · 4:30–5:30 PM',
    state: 'awaiting-confirmation',
    label: 'Confirm hours',
  },
];

export function ParentBookingsWeb() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Upcoming');
  const [selected, setSelected] = useState<string>('series');
  const go = (route: string) => router.push(route as never);

  const active = BOOKINGS.find((b) => b.id === selected) ?? BOOKINGS[0];

  return (
    <View>
      <WebPageHeader greet="Your schedule" title="Bookings" actions={['calendar', 'bell']} />

      <View style={styles.body}>
        <TabStrip tabs={TABS} value={tab} onChange={setTab} style={styles.tabs} />

        {tab === 'Upcoming' ? (
          <View style={styles.columns}>
            {/* ── left: list ──────────────────────────────── */}
            <View style={styles.list}>
              {BOOKINGS.map((b) => {
                const on = b.id === selected;
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => setSelected(b.id)}
                    style={({ pressed }) => [styles.row, on && styles.rowActive, { opacity: pressed ? 0.96 : 1 }]}
                  >
                    <View style={[styles.rowTone, { backgroundColor: b.tone }]}>
                      <Icon name={b.recurring ? 'calendar' : 'clock'} size={18} color={colors.ink} />
                    </View>
                    <View style={styles.flexMin}>
                      <View style={styles.rowTop}>
                        <CategoryChip category={b.cat} />
                        {b.recurring ? (
                          <View style={styles.seriesTag}>
                            <Text style={styles.seriesTagText}>Series · 12</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {b.title}
                      </Text>
                      <Text style={styles.rowWhen} numberOfLines={1}>
                        {b.when}
                      </Text>
                    </View>
                    <StatusPill state={b.state} label={b.label} />
                  </Pressable>
                );
              })}
            </View>

            {/* ── right: detail ──────────────────────────── */}
            <View style={styles.detail}>
              <View style={styles.detailHead}>
                <CategoryChip category={active.cat} />
                <StatusPill state={active.state} label={active.label} />
              </View>
              <Text style={styles.detailTitle}>{active.title}</Text>
              <Text style={styles.detailWhen}>{active.when}</Text>

              <View style={styles.provRow}>
                <Avatar label={active.prov} size="md" tone={active.tone} />
                <View style={styles.flexMin}>
                  <Text style={styles.provName}>{active.prov}</Text>
                  <Text style={styles.provRole}>{active.cat}</Text>
                </View>
                <Pressable onPress={() => go('/message-thread')} style={styles.iconBtn}>
                  <Icon name="message" size={18} color={colors.ink} />
                </Pressable>
              </View>

              {active.recurring && active.sessions ? (
                <View style={styles.sessions}>
                  <Text style={styles.sessionsLabel}>Next sessions</Text>
                  {active.sessions.map((s, i) => (
                    <View key={i} style={[styles.sessionRow, i > 0 && styles.sessionDivider]}>
                      <View style={styles.sessionIcon}>
                        <Icon name="clock" size={14} color={colors.ink} />
                      </View>
                      <View style={styles.flexMin}>
                        <Text style={styles.sessionDate}>{s.date}</Text>
                        <Text style={styles.sessionTime}>{s.time}</Text>
                      </View>
                      <StatusPill state={s.state} label={s.label} />
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={styles.priceCard}>
                <PricingSummary
                  lines={[
                    { label: 'Session rate', value: '$28/hr', helper: '1.5 hours · 1 child' },
                    { label: 'Service fee', value: '$5.60', muted: true },
                  ]}
                  total={{ label: 'Per session', value: '$47.60' }}
                />
              </View>

              <PrimaryButton onPress={() => go('/booking-detail')} style={styles.detailCta}>
                View booking
              </PrimaryButton>
              <Pressable onPress={() => go('/messages')} style={({ pressed }) => [styles.detailGhost, { opacity: pressed ? 0.9 : 1 }]}>
                <Text style={styles.detailGhostText}>Message {active.prov.split(' ')[0]}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Icon name={tab === 'Disputes' ? 'shield' : 'receipt'} size={26} color={colors.brand} />
            </View>
            <Text style={styles.emptyTitle}>{tab === 'Disputes' ? 'No disputes' : 'No past bookings'}</Text>
            <Text style={styles.emptySub}>
              {tab === 'Disputes' ? 'Reported issues will appear here.' : 'Your completed bookings will appear here.'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flexMin: { flex: 1, minWidth: 0 },
  tabs: { maxWidth: 360 },

  columns: { flexDirection: 'row', gap: 24, marginTop: 22, flexWrap: 'wrap', alignItems: 'flex-start' },
  list: { flex: 1, minWidth: 380, gap: 12 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 20, padding: 14, borderWidth: 1.5, borderColor: 'transparent', ...shadow.e1 },
  rowActive: { borderColor: colors.brand },
  rowTone: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seriesTag: { height: 24, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  seriesTagText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.ink2 },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, marginTop: 8 },
  rowWhen: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 2 },

  detail: { width: 360, backgroundColor: colors.surface, borderRadius: 24, padding: 20, ...shadow.e2 },
  detailHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailTitle: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 24, letterSpacing: -0.4, color: colors.ink, marginTop: 14 },
  detailWhen: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, marginTop: 4 },

  provRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.hairline },
  provName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  provRole: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 1 },
  iconBtn: { width: 40, height: 40, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },

  sessions: { marginTop: 18 },
  sessionsLabel: { fontFamily: fonts.semibold, fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink3, marginBottom: 6 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  sessionDivider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  sessionIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  sessionDate: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  sessionTime: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink2, marginTop: 1 },

  priceCard: { marginTop: 18, padding: 14, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },

  detailCta: { marginTop: 18, height: 52 },
  detailGhost: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  detailGhostText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },

  empty: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: radii.lg, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, textAlign: 'center', maxWidth: 280 },
});
