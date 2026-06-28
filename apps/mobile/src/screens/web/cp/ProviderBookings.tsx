/**
 * ProviderBookingsWeb — clinical Provider consultation requests (web only).
 *
 * Faithful port of the Claude Design web project cp-web/cp-booking-requests.jsx
 * (CPClinicalRequests). Slot-pick consultation requests from the public profile:
 * a pending-request queue (left) + a full review pane (right) with
 * Accept / Reschedule / Decline, plus decline-reason and reschedule modals.
 * No payout (fees collected off-platform). Content-only: the route dispatcher
 * wraps this in <WebShell>. RN primitives only (renders via RN-web).
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Icon, type IconName } from '@/components/Icon';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { WebPageHeader } from '@/components/web/WebShell';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

interface ConsultReq {
  id: string;
  parent: string;
  initials: string;
  rating: string;
  child: string;
  title: string;
  when: string;
  dur: string;
  format: string;
  spec: string;
  slotNote: string;
  expires: string;
  reason: string;
}

const REQUESTS: ConsultReq[] = [
  {
    id: 'OH-C-5T19D',
    parent: 'Chen family',
    initials: 'CF',
    rating: '4.9',
    child: 'Liu · age 8',
    title: 'Initial OT screen',
    when: 'Tue, May 19 · 3:30 PM',
    dur: '30 min',
    format: 'Video consult',
    spec: 'Occupational therapy',
    slotNote: 'Picked your 3:30 PM open slot',
    expires: '10h',
    reason: 'Fine-motor & handwriting concerns flagged by school — would like an initial screen before deciding on a therapy block.',
  },
  {
    id: 'OH-C-2H77K',
    parent: 'Delgado family',
    initials: 'DF',
    rating: '5.0',
    child: 'Mateo · age 6',
    title: 'Follow-up consultation',
    when: 'Wed, May 20 · 9:00 AM',
    dur: '45 min',
    format: 'Video consult',
    spec: 'Occupational therapy',
    slotNote: 'Picked your 9:00 AM open slot',
    expires: '1 day',
    reason: 'Follow-up after the sensory-processing assessment — want to review the home program and next steps.',
  },
];

const DECLINE_REASONS = ['Slot no longer available', 'Outside my specialty', 'Need intake info first', 'Not the right fit', 'Other'];
const RESCHEDULE_SLOTS = ['Tue, May 19 · 1:00 PM', 'Wed, May 20 · 9:00 AM', 'Thu, May 21 · 3:30 PM'];

type Status = 'pending' | 'accepted' | 'declined';
type Modal = null | 'decline' | 'reschedule';

const TABS = ['Requests', 'Accepted', 'Past'] as const;
type Tab = (typeof TABS)[number];

function Tile({ icon, label, value, sub }: { icon: IconName; label: string; value: string; sub?: string }) {
  return (
    <View style={styles.tile}>
      <View style={styles.tileIcon}>
        <Icon name={icon} size={17} color={colors.ink} />
      </View>
      <View style={styles.flexMin}>
        <Text style={styles.tileLabel}>{label}</Text>
        <Text style={styles.tileValue}>{value}</Text>
        {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

export function ProviderBookingsWeb() {
  const router = useRouter();
  const go = (r: string) => router.push(r as never);

  const [tab, setTab] = useState<Tab>('Requests');
  const [sel, setSel] = useState(REQUESTS[0].id);
  const [statusMap, setStatusMap] = useState<Record<string, Status>>({});
  const [modal, setModal] = useState<Modal>(null);
  const [reason, setReason] = useState<string | null>(null);

  const r = useMemo(() => REQUESTS.find((x) => x.id === sel) ?? REQUESTS[0], [sel]);
  const status = statusMap[sel] ?? 'pending';
  const setStatus = (s: Status) => setStatusMap((m) => ({ ...m, [sel]: s }));
  const pendingCount = REQUESTS.filter((x) => (statusMap[x.id] ?? 'pending') === 'pending').length;

  const tabLabels: Record<Tab, string> = {
    Requests: `Requests · ${pendingCount}`,
    Accepted: 'Accepted',
    Past: 'Past',
  };

  return (
    <View style={styles.root}>
      <WebPageHeader greet="Provider · Dr. Camille Ramos" title="Consultation requests" actions={['bell', 'message']} />

      <View style={styles.body}>
        {/* sub-tabs */}
        <View style={styles.tabRow}>
          <View style={styles.tabBar}>
            {TABS.map((t) => {
              const on = t === tab;
              return (
                <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, on ? styles.tabOn : null]}>
                  <Text style={[styles.tabText, { color: on ? colors.inkInv : colors.ink2 }]}>{tabLabels[t]}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.tabMeta}>Families book an open slot from your profile — accept to confirm the consultation.</Text>
        </View>

        <View style={styles.layout}>
          {/* ── queue ─────────────────────────────────────────────── */}
          <View style={styles.queue}>
            {REQUESTS.map((q) => {
              const st = statusMap[q.id] ?? 'pending';
              const on = q.id === sel;
              return (
                <Pressable
                  key={q.id}
                  onPress={() => setSel(q.id)}
                  style={[styles.qCard, on ? styles.qCardOn : null, st === 'declined' ? styles.qDeclined : null]}
                >
                  <View style={styles.qTop}>
                    <View style={styles.clinBadge}>
                      <Icon name="video" size={13} color={colors.brand} />
                      <Text style={styles.clinBadgeText}>Consultation request</Text>
                    </View>
                    <View style={styles.qStatus}>
                      {st === 'pending' ? (
                        <>
                          <Icon name="clock" size={12} color={colors.warning} />
                          <Text style={[styles.qStatusText, { color: colors.warning }]}>{q.expires} left</Text>
                        </>
                      ) : (
                        <Text style={[styles.qStatusText, { color: st === 'accepted' ? colors.success : colors.ink3 }]}>
                          {st === 'accepted' ? 'Accepted' : 'Declined'}
                        </Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.qWho}>
                    <Avatar label={q.initials} size="md" tone="catSpec" />
                    <View style={styles.flexMin}>
                      <Text style={styles.qName}>{q.parent}</Text>
                      <Text style={styles.qTitle} numberOfLines={1}>{q.title}</Text>
                    </View>
                  </View>
                  <Text style={styles.qWhen}>{q.when} · {q.dur}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── review pane ───────────────────────────────────────── */}
          <View style={styles.pane}>
            {status === 'accepted' ? (
              <ResultPane kind="accepted" req={r} onReset={() => setStatus('pending')} onSchedule={() => go('/schedule')} />
            ) : status === 'declined' ? (
              <ResultPane kind="declined" req={r} reason={reason} onReset={() => { setStatus('pending'); setReason(null); }} />
            ) : (
              <>
                {/* header */}
                <View style={styles.paneHead}>
                  <View style={styles.paneHeadTop}>
                    <View style={styles.newPill}>
                      <Text style={styles.newPillText}>New request</Text>
                    </View>
                    <View style={styles.clinBadgeLg}>
                      <Icon name="video" size={14} color={colors.brand} />
                      <Text style={styles.clinBadgeTextLg}>Consultation request</Text>
                    </View>
                    <Text style={styles.mono}>{r.id}</Text>
                    <View style={styles.flex} />
                    <View style={styles.respondRow}>
                      <Icon name="clock" size={15} color={colors.warning} />
                      <Text style={styles.respondText}>Respond within {r.expires}</Text>
                    </View>
                  </View>
                  <View style={styles.paneTitleRow}>
                    <View style={styles.flexMin}>
                      <Text style={styles.paneTitle}>{r.title}</Text>
                      <Text style={styles.paneSub}>{r.when} · {r.dur} · {r.format}</Text>
                    </View>
                    <View style={styles.paneParent}>
                      <Avatar label={r.initials} size="lg" tone="catSpec" />
                      <View>
                        <Text style={styles.paneParentName}>{r.parent}</Text>
                        <View style={styles.paneParentMeta}>
                          <Icon name="star" size={12} color={colors.ink} />
                          <Text style={styles.paneParentMetaText}>{r.rating} · {r.child}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                </View>

                {/* body */}
                <View style={styles.paneBody}>
                  <View style={styles.tileGrid}>
                    <Tile icon="clock" label="WHEN" value={r.when} sub={`${r.dur} · ${r.format}`} />
                    <Tile icon="calendar" label="SLOT" value={r.slotNote} sub="From your profile" />
                    <Tile icon="person" label="CHILD" value={r.child} sub="Shared by family" />
                    <Tile icon="briefcase" label="SPECIALTY" value={r.spec} sub="Your listed practice" />
                  </View>

                  {/* reason */}
                  <View style={styles.reasonCard}>
                    <Icon name="shield" size={17} color={colors.info} />
                    <View style={styles.flexMin}>
                      <Text style={styles.reasonLabel}>Reason from {r.parent} · view-only</Text>
                      <Text style={styles.reasonText}>{r.reason}</Text>
                    </View>
                  </View>

                  {/* fee — off-platform */}
                  <View style={styles.feeCard}>
                    <View style={styles.feeLeft}>
                      <Text style={styles.feeLabel}>Consultation fee</Text>
                      <Text style={styles.feeAmount}>$120</Text>
                      <Text style={styles.feeSub}>per session · display only</Text>
                    </View>
                    <View style={styles.feeRight}>
                      <Icon name="info" size={16} color={colors.ink2} />
                      <Text style={styles.feeNote}>
                        Clinical fees are handled directly with the family — Our Haven doesn&rsquo;t process this payment. Accepting confirms the consultation onto your schedule.
                      </Text>
                    </View>
                  </View>

                  {/* actions */}
                  <View style={styles.actions}>
                    <Pressable onPress={() => setStatus('accepted')} style={styles.acceptBtn}>
                      <Icon name="check" size={18} color={colors.inkInv} />
                      <Text style={styles.acceptText}>Accept consultation</Text>
                    </Pressable>
                    <Pressable onPress={() => setModal('reschedule')} style={styles.outlineInk}>
                      <Text style={styles.outlineInkText}>Reschedule</Text>
                    </Pressable>
                    <Pressable onPress={() => setModal('decline')} style={styles.outlineDanger}>
                      <Text style={styles.outlineDangerText}>Decline</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.actionsNote}>Reschedule proposes another open slot · declining frees the slot for others.</Text>
                </View>
              </>
            )}
          </View>
        </View>
      </View>

      {/* ── modal: decline / reschedule ──────────────────────────── */}
      {modal ? (
        <View style={styles.overlay}>
          <Pressable style={styles.backdrop} onPress={() => setModal(null)} />
          <View style={[styles.modalCard, { maxWidth: modal === 'reschedule' ? 540 : 480 }]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>{modal === 'reschedule' ? 'Propose another slot' : 'Decline this request?'}</Text>
              <Pressable onPress={() => setModal(null)} style={styles.modalClose}>
                <Icon name="x" size={16} color={colors.ink2} />
              </Pressable>
            </View>

            {modal === 'reschedule' ? (
              <>
                <Text style={styles.modalBody}>
                  Pick one of your open slots to offer {r.parent} instead. They&rsquo;ll get a new request to confirm.
                </Text>
                <View style={styles.slotList}>
                  {RESCHEDULE_SLOTS.map((s, i) => (
                    <Pressable key={s} style={[styles.slotRow, i === 0 ? styles.slotRowOn : null]}>
                      <Text style={styles.slotRowText}>{s}</Text>
                      {i === 0 ? <Icon name="check" size={16} color={colors.brand} /> : null}
                    </Pressable>
                  ))}
                </View>
                <View style={styles.modalActions}>
                  <Pressable onPress={() => setModal(null)} style={styles.modalCancel}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={() => setModal(null)} style={[styles.modalPrimary, styles.modalPrimaryWide]}>
                    <Text style={styles.modalPrimaryText}>Send new slot</Text>
                    <Icon name="arrow-right" size={17} color={colors.inkInv} />
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalBody}>
                  Let {r.parent} know why (optional). Declining frees this slot for other families.
                </Text>
                <View style={styles.reasonChips}>
                  {DECLINE_REASONS.map((rs) => {
                    const on = reason === rs;
                    return (
                      <Pressable key={rs} onPress={() => setReason(rs)} style={[styles.reasonChip, on ? styles.reasonChipOn : null]}>
                        {on ? <Icon name="check" size={13} color={colors.inkInv} /> : null}
                        <Text style={[styles.reasonChipText, { color: on ? colors.inkInv : colors.ink2 }]}>{rs}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.modalActions}>
                  <Pressable onPress={() => setModal(null)} style={styles.modalCancel}>
                    <Text style={styles.modalCancelText}>Keep request</Text>
                  </Pressable>
                  <Pressable onPress={() => { setModal(null); setStatus('declined'); }} style={styles.modalDanger}>
                    <Text style={styles.modalDangerText}>Decline request</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ResultPane({
  kind,
  req,
  reason,
  onReset,
  onSchedule,
}: {
  kind: 'accepted' | 'declined';
  req: ConsultReq;
  reason?: string | null;
  onReset: () => void;
  onSchedule?: () => void;
}) {
  const accepted = kind === 'accepted';
  return (
    <View style={styles.result}>
      <View style={[styles.resultIcon, { backgroundColor: accepted ? 'rgba(47,122,77,0.14)' : colors.surfaceAlt }]}>
        <Icon name={accepted ? 'check-circle' : 'x'} size={accepted ? 48 : 42} color={accepted ? colors.success : colors.ink2} />
      </View>
      <Text style={styles.resultTitle}>{accepted ? 'Consultation confirmed' : 'Request declined'}</Text>
      <Text style={styles.resultText}>
        {accepted
          ? `${req.parent} has been notified — it's now on your schedule for ${req.when}. Clinical fees are handled directly with the family.`
          : `We let ${req.parent} know you can't take this one${reason ? ` — “${reason}”` : ''}. The slot is freed for other families and it won't affect your response rate.`}
      </Text>
      <View style={styles.resultActions}>
        <Pressable onPress={onReset} style={styles.resultUndo}>
          <Text style={styles.resultUndoText}>{accepted ? 'Undo' : 'Back to request'}</Text>
        </Pressable>
        {accepted ? (
          <Pressable onPress={onSchedule} style={styles.resultPrimary}>
            <Text style={styles.resultPrimaryText}>View on schedule</Text>
            <Icon name="arrow-right" size={16} color={colors.inkInv} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative' },
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flex: { flex: 1 },
  flexMin: { flex: 1, minWidth: 0 },
  mono: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink3, letterSpacing: 0.4 },

  // tabs
  tabRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 },
  tabBar: { flexDirection: 'row', backgroundColor: colors.surface, padding: 4, borderRadius: radii.pill, ...shadow.e1 },
  tab: { height: 38, paddingHorizontal: 20, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.ink },
  tabText: { fontFamily: fonts.semibold, fontSize: 13.5 },
  tabMeta: { flex: 1, minWidth: 240, fontFamily: fonts.regular, fontSize: 13, color: colors.ink2, textAlign: 'right' },

  layout: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' },

  // queue
  queue: { flexGrow: 1, flexBasis: 340, minWidth: 300, maxWidth: 380, gap: 12 },
  qCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: 16, borderWidth: 2, borderColor: 'transparent', ...shadow.e1 },
  qCardOn: { borderColor: colors.brand },
  qDeclined: { opacity: 0.62 },
  qTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  qStatus: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5 },
  qStatusText: { fontFamily: fonts.bold, fontSize: 11.5 },
  qWho: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  qName: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  qTitle: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 1 },
  qWhen: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 12 },

  clinBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 24, paddingHorizontal: 11, borderRadius: radii.pill, backgroundColor: colors.brandSoft },
  clinBadgeText: { fontFamily: fonts.bold, fontSize: 11.5, color: colors.brand },

  // review pane
  pane: { flexGrow: 2.4, flexBasis: 520, minWidth: 360, backgroundColor: colors.surface, borderRadius: 28, overflow: 'hidden', minHeight: 560, ...shadow.e1 },
  paneHead: { paddingHorizontal: 30, paddingTop: 26, paddingBottom: 22, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  paneHeadTop: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  newPill: { height: 26, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: 'rgba(255,216,77,0.4)', alignItems: 'center', justifyContent: 'center' },
  newPillText: { fontFamily: fonts.bold, fontSize: 11.5, letterSpacing: 0.3, textTransform: 'uppercase', color: colors.ink },
  clinBadgeLg: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 28, paddingHorizontal: 13, borderRadius: radii.pill, backgroundColor: colors.brandSoft },
  clinBadgeTextLg: { fontFamily: fonts.bold, fontSize: 12.5, color: colors.brand },
  respondRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  respondText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.warning },

  paneTitleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginTop: 16, flexWrap: 'wrap' },
  paneTitle: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 32, letterSpacing: -0.6, color: colors.ink },
  paneSub: { fontFamily: fonts.regular, fontSize: 14.5, color: colors.ink2, marginTop: 5 },
  paneParent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  paneParentName: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  paneParentMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  paneParentMetaText: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2 },

  paneBody: { paddingHorizontal: 30, paddingVertical: 24, gap: 16 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '46%', minWidth: 200, flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.surfaceAlt, borderRadius: radii.sm, paddingVertical: 14, paddingHorizontal: 16 },
  tileIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2 },
  tileValue: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink, marginTop: 3 },
  tileSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 1 },

  reasonCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: radii.md, backgroundColor: colors.surfaceAlt },
  reasonLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.info },
  reasonText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink, marginTop: 5 },

  feeCard: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 24, padding: 22, borderRadius: radii.lg, backgroundColor: colors.brandSoft },
  feeLeft: { minWidth: 150 },
  feeLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.brand },
  feeAmount: { fontFamily: fonts.mono, fontSize: 34, lineHeight: 38, color: colors.ink, letterSpacing: -1, marginTop: 4, fontVariant: ['tabular-nums'] },
  feeSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2, marginTop: 2 },
  feeRight: { flex: 1, minWidth: 220, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  feeNote: { flex: 1, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.ink2 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  acceptBtn: { flexGrow: 2, flexBasis: 240, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: radii.pill, backgroundColor: colors.brand },
  acceptText: { fontFamily: fonts.bold, fontSize: 15, color: colors.inkInv },
  outlineInk: { flexGrow: 1, flexBasis: 130, height: 54, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  outlineInkText: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink },
  outlineDanger: { flexGrow: 1, flexBasis: 130, height: 54, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.danger, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  outlineDangerText: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.danger },
  actionsNote: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink3, textAlign: 'center' },

  // result pane
  result: { minHeight: 560, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 40 },
  resultIcon: { width: 92, height: 92, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  resultTitle: { fontFamily: fonts.bold, fontSize: 30, letterSpacing: -0.6, color: colors.ink, marginTop: 24, textAlign: 'center' },
  resultText: { fontFamily: fonts.regular, fontSize: 15.5, lineHeight: 23, color: colors.ink2, marginTop: 10, textAlign: 'center', maxWidth: 420 },
  resultActions: { flexDirection: 'row', gap: 12, marginTop: 28 },
  resultUndo: { height: 50, paddingHorizontal: 22, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  resultUndoText: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.ink2 },
  resultPrimary: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 50, paddingHorizontal: 24, borderRadius: radii.pill, backgroundColor: colors.brand },
  resultPrimaryText: { fontFamily: fonts.semibold, fontSize: 14.5, color: colors.inkInv },

  // modal
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 20 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(22,21,19,0.5)' },
  modalCard: { width: '100%', backgroundColor: colors.surface, borderRadius: 28, padding: 30, ...shadow.e3 },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  modalTitle: { fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.4, color: colors.ink },
  modalClose: { width: 36, height: 36, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  modalBody: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, marginBottom: 18 },

  slotList: { gap: 10, marginBottom: 18 },
  slotRow: { height: 54, borderRadius: radii.sm, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, borderWidth: 1.5, borderColor: 'transparent' },
  slotRowOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  slotRowText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },

  reasonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 22 },
  reasonChip: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 42, paddingHorizontal: 16, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.surface },
  reasonChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  reasonChipText: { fontFamily: fonts.semibold, fontSize: 13.5 },

  modalActions: { flexDirection: 'row', gap: 12 },
  modalCancel: { flex: 1, height: 52, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink2 },
  modalPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: radii.pill, backgroundColor: colors.brand },
  modalPrimaryWide: { flex: 2 },
  modalPrimaryText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
  modalDanger: { flex: 1, height: 52, borderRadius: radii.pill, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  modalDangerText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkInv },
});
