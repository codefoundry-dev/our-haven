/**
 * Job detail + applicant review (Parent) — OH-210; PRD stories 88–92. The live
 * surface behind the My Jobs hub: a Job summary (with Edit / Close for a still-open
 * Job) and its Applications, each an inline "application detail" card — caregiver
 * summary + badges + the live Offer + proposal + a status pill + actions:
 *   • Award   → confirm payment (AwardSheet) → Booking `requested` / Series
 *   • Counter → propose a new rate (CounterSheet); hidden for a non-negotiable Caregiver
 *   • Decline / Message / View profile
 *
 * Awarding auto-declines the other Applications (server, story 91). Design:
 * screens/jobs.jsx ScreenJobDetail + screens/offer.jsx (made live from the OH-209 mock).
 */
import { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppBar } from '@/components/AppBar';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { CategoryChip, CATEGORY_TONE } from '@/components/ui/CategoryChip';
import { RatingValue } from '@/components/ui/StarRating';
import { AwardSheet } from '@/components/parent/AwardSheet';
import { CounterSheet } from '@/components/parent/CounterSheet';
import {
  ApiError,
  closeJob,
  counterApplication,
  declineApplication,
  type CounterApplicationBody,
  type JobApplication,
  type MyJob,
} from '@/api/client';
import { formatMoney } from '@/lib/offerCopy';
import {
  applicationStatusStyle,
  categoryChip,
  jobScheduleLabel,
  jobStatusStyle,
  useJobDetail,
} from '@/lib/jobsHub';
import { colors, fonts, radii, shadow } from '@/theme/tokens';

type Sort = 'recent' | 'price' | 'rating';
const SORT_LABEL: Record<Sort, string> = { recent: 'Newest first', price: 'Lowest price', rating: 'Top rated' };
const SORT_CYCLE: Sort[] = ['recent', 'price', 'rating'];

function isActionable(state: JobApplication['state']): boolean {
  return state === 'submitted' || state === 'countered';
}

export default function JobApplicantsScreen() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const { job, applications, loading, error, notFound, refetch } = useJobDetail(jobId ?? null);

  const [sort, setSort] = useState<Sort>('recent');
  const [awardApp, setAwardApp] = useState<JobApplication | null>(null);
  const [counterApp, setCounterApp] = useState<JobApplication | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const arr = [...applications];
    if (sort === 'price') {
      arr.sort((a, b) => (a.offer?.computedTotalCents ?? Infinity) - (b.offer?.computedTotalCents ?? Infinity));
    } else if (sort === 'rating') {
      arr.sort((a, b) => (b.caregiver.ratingAverage ?? -1) - (a.caregiver.ratingAverage ?? -1));
    }
    return arr; // 'recent' → server already returns newest-first
  }, [applications, sort]);

  const openApplicants = applications.filter((a) => isActionable(a.state)).length;

  if (loading) {
    return (
      <Screen edges={['top']} contentStyle={styles.centered}>
        <ActivityIndicator color={colors.brand} />
      </Screen>
    );
  }
  if (notFound || error || !job) {
    return (
      <Screen edges={['top']} contentStyle={styles.centered}>
        <Text style={styles.errorTitle}>{notFound ? 'Job unavailable' : 'Something went wrong'}</Text>
        <Text style={styles.errorSub}>
          {notFound ? 'This Job is no longer available.' : 'We couldn’t load this Job.'}
        </Text>
        <View style={styles.errorActions}>
          {!notFound ? (
            <Pressable onPress={refetch} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.back()} style={styles.retryGhost}>
            <Text style={styles.retryGhostText}>Back</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  const status = jobStatusStyle(job.state);
  const editable = job.state === 'open' || job.state === 'draft';

  const doClose = async () => {
    setClosing(true);
    setActionError(null);
    try {
      await closeJob(job.id);
      setConfirmClose(false);
      refetch();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not close the Job.');
    } finally {
      setClosing(false);
    }
  };

  const doDecline = async (app: JobApplication) => {
    setBusyId(app.id);
    setActionError(null);
    try {
      await declineApplication(app.id);
      refetch();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not decline.');
    } finally {
      setBusyId(null);
    }
  };

  const doCounter = async (body: CounterApplicationBody) => {
    if (!counterApp) return;
    await counterApplication(counterApp.id, body);
    refetch();
  };

  const message = (app: JobApplication) =>
    router.push({ pathname: '/message-thread', params: { id: app.caregiver.providerId, name: app.caregiver.name ?? '' } });
  const viewProfile = (app: JobApplication) =>
    router.push({ pathname: '/provider-detail', params: { id: app.caregiver.providerId } });

  return (
    <Screen edges={['top']} scroll contentStyle={styles.content}>
      <AppBar title="Applicants" onBack={() => router.back()} />

      {/* Job summary */}
      <View style={styles.summary}>
        <View style={styles.summaryTop}>
          <CategoryChip category={categoryChip(job.category)} />
          <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
            <Text style={[styles.statusText, { color: status.fg }]}>
              {status.label}
              {job.state === 'open' ? ` · ${job.applicationCount}/15 applied` : ''}
            </Text>
          </View>
        </View>
        <Text style={styles.jobTitle}>{job.description}</Text>
        <Text style={styles.jobMeta}>{jobScheduleLabel(job)}</Text>

        {editable ? (
          <View style={styles.manageRow}>
            <Pressable
              onPress={() => router.push({ pathname: '/post-job', params: { jobId: job.id } })}
              style={({ pressed }) => [styles.manageBtn, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Icon name="edit" size={15} color={colors.ink} />
              <Text style={styles.manageText}>Edit</Text>
            </Pressable>
            <Pressable
              onPress={() => setConfirmClose(true)}
              style={({ pressed }) => [styles.manageBtn, styles.manageDanger, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Icon name="x" size={15} color={colors.danger} />
              <Text style={[styles.manageText, { color: colors.danger }]}>Close</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {actionError ? <Text style={styles.bannerError}>{actionError}</Text> : null}

      {/* Applications */}
      <View style={styles.listHead}>
        <Text style={styles.listHeadTitle}>
          {applications.length} {applications.length === 1 ? 'Application' : 'Applications'}
        </Text>
        {applications.length > 1 ? (
          <Pressable
            onPress={() => setSort((s) => SORT_CYCLE[(SORT_CYCLE.indexOf(s) + 1) % SORT_CYCLE.length]!)}
            style={styles.sort}
          >
            <Text style={styles.sortText}>{SORT_LABEL[sort]}</Text>
            <Icon name="chevron-down" size={12} color={colors.ink} />
          </Pressable>
        ) : null}
      </View>

      {applications.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No applications yet</Text>
          <Text style={styles.emptySub}>
            {job.state === 'open'
              ? 'Verified Caregivers in this category can apply. You’ll be notified as they do.'
              : 'This Job didn’t receive any applications.'}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {sorted.map((a) => (
            <ApplicantCard
              key={a.id}
              app={a}
              busy={busyId === a.id}
              onAward={() => setAwardApp(a)}
              onCounter={() => setCounterApp(a)}
              onDecline={() => doDecline(a)}
              onMessage={() => message(a)}
              onViewProfile={() => viewProfile(a)}
            />
          ))}
        </View>
      )}

      {/* Award confirmation */}
      <AwardSheet
        visible={awardApp != null}
        job={job}
        application={awardApp}
        onClose={() => setAwardApp(null)}
        onAwarded={() => {
          setAwardApp(null);
          refetch();
        }}
      />

      {/* Counter composer */}
      <CounterSheet
        visible={counterApp != null}
        offer={counterApp?.offer ?? null}
        onClose={() => setCounterApp(null)}
        onSubmit={doCounter}
      />

      {/* Close confirmation (story 92) */}
      <Modal visible={confirmClose} transparent animationType="fade" onRequestClose={() => setConfirmClose(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Close this Job?</Text>
            <Text style={styles.modalBody}>
              {openApplicants > 0
                ? `This withdraws ${openApplicants} open ${openApplicants === 1 ? 'application' : 'applications'} and stops new ones. This can’t be undone.`
                : 'This stops the Job from accepting applications. This can’t be undone.'}
            </Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setConfirmClose(false)} style={[styles.modalBtn, styles.modalGhost]}>
                <Text style={styles.modalGhostText}>Keep open</Text>
              </Pressable>
              <Pressable onPress={doClose} disabled={closing} style={[styles.modalBtn, styles.modalDanger]}>
                {closing ? (
                  <ActivityIndicator color={colors.inkInv} />
                ) : (
                  <Text style={styles.modalDangerText}>Close Job</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function ApplicantCard({
  app,
  busy,
  onAward,
  onCounter,
  onDecline,
  onMessage,
  onViewProfile,
}: {
  app: JobApplication;
  busy: boolean;
  onAward: () => void;
  onCounter: () => void;
  onDecline: () => void;
  onMessage: () => void;
  onViewProfile: () => void;
}) {
  const c = app.caregiver;
  const tone = CATEGORY_TONE[categoryChip(app.category)];
  const status = applicationStatusStyle(app.state);
  const actionable = isActionable(app.state);
  const showCounter = actionable && c.negotiable && app.offer != null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Avatar label={c.name ?? 'Caregiver'} tone={tone} size="md" />
        <Pressable onPress={onViewProfile} style={styles.flexMin}>
          <Text style={styles.name} numberOfLines={1}>
            {c.name ?? 'Caregiver'}
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.category}>{categoryChip(app.category)}</Text>
            {c.ratingCount > 0 ? (
              <>
                <Text style={styles.dot}>·</Text>
                <RatingValue value={c.ratingAverage ?? 0} count={c.ratingCount} size={13} />
              </>
            ) : (
              <>
                <Text style={styles.dot}>·</Text>
                <Text style={styles.newText}>New</Text>
              </>
            )}
          </View>
        </Pressable>
        <View style={[styles.appStatusPill, { backgroundColor: status.bg }]}>
          <Text style={[styles.appStatusText, { color: status.fg }]}>{status.label}</Text>
        </View>
      </View>

      {c.backgroundChecked ? (
        <View style={styles.badges}>
          <Badge kind="verified" />
        </View>
      ) : null}

      {app.offer ? (
        <View style={styles.priceBox}>
          <Text style={styles.priceTotal}>{formatMoney(app.offer.computedTotalCents)} total</Text>
          <Text style={styles.priceSub}>
            {formatMoney(app.offer.proposedRateCents)}/hr × {Math.round((app.offer.scopeMinutes / 60) * 10) / 10}h
            {app.offer.sender === 'parent' ? ' · your counter' : ''}
          </Text>
        </View>
      ) : (
        <Text style={styles.noOffer}>No offer yet.</Text>
      )}

      {app.proposal ? <Text style={styles.proposal}>{app.proposal}</Text> : null}

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={onMessage}
          style={({ pressed }) => [styles.btn, styles.btnGhost, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Icon name="message" size={15} color={colors.ink} />
          <Text style={styles.btnGhostText}>Message</Text>
        </Pressable>
        {actionable && app.offer ? (
          <Pressable
            accessibilityRole="button"
            onPress={onAward}
            style={({ pressed }) => [styles.btn, styles.btnPrimary, { opacity: pressed ? 0.9 : 1 }]}
          >
            <Icon name="check" size={15} color={colors.inkInv} />
            <Text style={styles.btnPrimaryText}>Award</Text>
          </Pressable>
        ) : null}
      </View>
      {actionable ? (
        <View style={styles.actionsSecondary}>
          {showCounter ? (
            <Pressable onPress={onCounter} style={({ pressed }) => [styles.linkBtn, { opacity: pressed ? 0.7 : 1 }]}>
              <Text style={styles.linkText}>Counter</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onDecline}
            disabled={busy}
            style={({ pressed }) => [styles.linkBtn, { opacity: pressed || busy ? 0.6 : 1 }]}
          >
            <Text style={[styles.linkText, { color: colors.danger }]}>{busy ? 'Declining…' : 'Decline'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  errorTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink, textAlign: 'center' },
  errorSub: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, textAlign: 'center' },
  errorActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  retry: { height: 44, paddingHorizontal: 20, borderRadius: radii.pill, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  retryText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkInv },
  retryGhost: { height: 44, paddingHorizontal: 20, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  retryGhostText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },

  summary: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 18, marginTop: 8, ...shadow.e1 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusPill: { height: 24, paddingHorizontal: 10, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  statusText: { fontFamily: fonts.semibold, fontSize: 12 },
  jobTitle: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, letterSpacing: -0.3, color: colors.ink, marginTop: 12 },
  jobMeta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink2, marginTop: 6 },
  manageRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  manageDanger: { borderColor: 'rgba(178,58,47,0.4)' },
  manageText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  bannerError: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 12, textAlign: 'center' },

  listHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 26, marginBottom: 12 },
  listHeadTitle: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.4, color: colors.ink },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 30, paddingHorizontal: 10, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt },
  sortText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },

  emptyBox: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 24, alignItems: 'center', gap: 8, ...shadow.e1 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2, textAlign: 'center' },

  list: { gap: 12 },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 16, ...shadow.e1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flexMin: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  category: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2 },
  dot: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },
  newText: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink3 },
  appStatusPill: { height: 24, paddingHorizontal: 10, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  appStatusText: { fontFamily: fonts.semibold, fontSize: 11.5 },

  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },

  priceBox: { marginTop: 12, backgroundColor: colors.surfaceAlt, borderRadius: radii.sm, paddingVertical: 10, paddingHorizontal: 14 },
  priceTotal: { fontFamily: fonts.bold, fontSize: 17, letterSpacing: -0.3, color: colors.ink, fontVariant: ['tabular-nums'] },
  priceSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink2, marginTop: 2 },
  noOffer: { fontFamily: fonts.regular, fontSize: 13, color: colors.ink3, marginTop: 12 },

  proposal: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink2, marginTop: 12 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, height: 44, borderRadius: radii.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnGhost: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.ink },
  btnGhostText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  btnPrimary: { backgroundColor: colors.brand },
  btnPrimaryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },
  actionsSecondary: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18, marginTop: 12 },
  linkBtn: { paddingVertical: 4 },
  linkText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },

  modalScrim: { flex: 1, backgroundColor: 'rgba(22,21,19,0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  modalCard: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radii.xl, padding: 22, ...shadow.e2 },
  modalTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  modalBody: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, marginTop: 10 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  modalBtn: { flex: 1, height: 48, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  modalGhost: { borderWidth: 1.5, borderColor: colors.ink },
  modalGhostText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  modalDanger: { backgroundColor: colors.danger },
  modalDangerText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkInv },
});
