/**
 * ParentJobsWeb — the Parent's posted Jobs + applicant review on desktop web
 * (OH-210; PRD stories 88–92). Content-only: the dispatcher wraps this in
 * <ParentWebShell>. A two-pane layout — left is the selectable list of the
 * Parent's Jobs (bucketed by state); right is the selected Job's summary (with
 * Edit / Close) and its Application cards with the live Offer + Award / Counter /
 * Decline / Message actions. Made live from the OH-209 mock; RN primitives only.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { WebPageHeader } from '@/components/web/ParentWebShell';
import { Icon } from '@/components/Icon';
import { Avatar, AvatarGroup } from '@/components/ui/Avatar';
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
  jobBucket,
  jobScheduleLabel,
  jobStatusStyle,
  useJobDetail,
  useMyJobs,
} from '@/lib/jobsHub';
import { colors, fonts, radii, shadow, type ColorToken } from '@/theme/tokens';

const APP_TONES: ColorToken[] = ['catTutor', 'catBaby', 'catNanny'];

export function ParentJobsWeb() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const { jobs, loading, refetch: refetchJobs } = useMyJobs();
  const [selected, setSelected] = useState<string | null>(jobId ?? null);

  // Default the selection to the deep-linked Job, else the first open Job, else
  // the first Job — once the list loads.
  useEffect(() => {
    if (selected && jobs.some((j) => j.id === selected)) return;
    if (jobs.length === 0) return;
    const open = jobs.find((j) => j.state === 'open');
    setSelected((jobId && jobs.some((j) => j.id === jobId) ? jobId : (open ?? jobs[0])?.id) ?? null);
  }, [jobs, jobId, selected]);

  return (
    <View>
      <WebPageHeader greet="Your postings" title="Jobs" primary="Post a Job" onPrimary={() => router.push('/post-job')} />

      <View style={styles.body}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : jobs.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>No Jobs yet</Text>
            <Text style={styles.emptySub}>Post a Job — verified Caregivers apply to you.</Text>
          </View>
        ) : (
          <View style={styles.columns}>
            {/* ── left: posted jobs ───────────────────────── */}
            <View style={styles.list}>
              <Text style={styles.listLabel}>Your Jobs · {jobs.length}</Text>
              {jobs.map((j) => (
                <JobRow key={j.id} job={j} on={j.id === selected} onPress={() => setSelected(j.id)} />
              ))}
            </View>

            {/* ── right: selected job + applicants ───────── */}
            <View style={styles.detail}>
              {selected ? (
                <JobDetailPane jobId={selected} onJobsChanged={refetchJobs} />
              ) : (
                <View style={styles.centered}>
                  <Text style={styles.emptySub}>Select a Job to review its applicants.</Text>
                </View>
              )}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function JobRow({ job, on, onPress }: { job: MyJob; on: boolean; onPress: () => void }) {
  const status = jobStatusStyle(job.state);
  const isOpen = job.state === 'open';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.jobRow, on && styles.jobRowActive, { opacity: pressed ? 0.96 : 1 }]}
    >
      <View style={styles.jobTop}>
        <CategoryChip category={categoryChip(job.category)} />
        <View style={[styles.pill, { backgroundColor: status.bg }]}>
          <Text style={[styles.pillText, { color: status.fg }]}>
            {status.label}
            {isOpen ? ` · ${job.applicationCount}/15` : ''}
          </Text>
        </View>
      </View>
      <Text style={styles.jobRowTitle} numberOfLines={2}>
        {job.description}
      </Text>
      <View style={styles.jobBottom}>
        {isOpen && job.applicationCount > 0 ? (
          <AvatarGroup
            items={Array.from({ length: Math.min(job.applicationCount, 4) }, (_, k) => ({ tone: APP_TONES[k % APP_TONES.length] }))}
          />
        ) : (
          <Text style={styles.jobDays}>{jobBucket(job.state) === 'past' ? 'Closed' : jobScheduleLabel(job)}</Text>
        )}
      </View>
    </Pressable>
  );
}

function JobDetailPane({ jobId, onJobsChanged }: { jobId: string; onJobsChanged: () => void }) {
  const router = useRouter();
  const { job, applications, loading, error, notFound, refetch } = useJobDetail(jobId);
  const [awardApp, setAwardApp] = useState<JobApplication | null>(null);
  const [counterApp, setCounterApp] = useState<JobApplication | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const openApplicants = applications.filter((a) => a.state === 'submitted' || a.state === 'countered').length;

  const refetchAll = () => {
    refetch();
    onJobsChanged();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (notFound || error || !job) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptySub}>{notFound ? 'This Job is no longer available.' : 'We couldn’t load this Job.'}</Text>
      </View>
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
      refetchAll();
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
      refetchAll();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not decline.');
    } finally {
      setBusyId(null);
    }
  };

  const doCounter = async (body: CounterApplicationBody) => {
    if (!counterApp) return;
    await counterApplication(counterApp.id, body);
    refetchAll();
  };

  return (
    <View>
      <View style={styles.summary}>
        <View style={styles.summaryTop}>
          <CategoryChip category={categoryChip(job.category)} />
          <View style={[styles.pill, { backgroundColor: status.bg }]}>
            <Text style={[styles.pillText, { color: status.fg }]}>
              {status.label}
              {job.state === 'open' ? ` · ${job.applicationCount}/15 applied` : ''}
            </Text>
          </View>
        </View>
        <Text style={styles.summaryTitle}>{job.description}</Text>
        <Text style={styles.summaryMeta}>{jobScheduleLabel(job)}</Text>
        {editable ? (
          <View style={styles.manageRow}>
            <Pressable
              onPress={() => router.push({ pathname: '/post-job', params: { jobId: job.id } })}
              style={({ pressed }) => [styles.manageBtn, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Icon name="edit" size={14} color={colors.ink} />
              <Text style={styles.manageText}>Edit</Text>
            </Pressable>
            <Pressable
              onPress={() => setConfirmClose(true)}
              style={({ pressed }) => [styles.manageBtn, styles.manageDanger, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Icon name="x" size={14} color={colors.danger} />
              <Text style={[styles.manageText, { color: colors.danger }]}>Close</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {actionError ? <Text style={styles.bannerError}>{actionError}</Text> : null}

      <View style={styles.listHead}>
        <Text style={styles.listHeadTitle}>
          {applications.length} {applications.length === 1 ? 'Application' : 'Applications'}
        </Text>
      </View>

      {applications.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyBoxTitle}>No applications yet</Text>
          <Text style={styles.emptySub}>
            {job.state === 'open' ? 'You’ll see Caregivers here as they apply.' : 'This Job received no applications.'}
          </Text>
        </View>
      ) : (
        <View style={styles.applicants}>
          {applications.map((a) => (
            <WebApplicantCard
              key={a.id}
              app={a}
              busy={busyId === a.id}
              onAward={() => setAwardApp(a)}
              onCounter={() => setCounterApp(a)}
              onDecline={() => doDecline(a)}
              onMessage={() =>
                router.push({ pathname: '/message-thread', params: { id: a.caregiver.providerId, name: a.caregiver.name ?? '' } })
              }
              onViewProfile={() => router.push({ pathname: '/provider-detail', params: { id: a.caregiver.providerId } })}
            />
          ))}
        </View>
      )}

      <AwardSheet
        visible={awardApp != null}
        job={job}
        application={awardApp}
        onClose={() => setAwardApp(null)}
        onAwarded={() => {
          setAwardApp(null);
          refetchAll();
        }}
      />
      <CounterSheet
        visible={counterApp != null}
        offer={counterApp?.offer ?? null}
        onClose={() => setCounterApp(null)}
        onSubmit={doCounter}
      />

      <Modal visible={confirmClose} transparent animationType="fade" onRequestClose={() => setConfirmClose(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Close this Job?</Text>
            <Text style={styles.modalBody}>
              {openApplicants > 0
                ? `This withdraws ${openApplicants} open ${openApplicants === 1 ? 'application' : 'applications'} and stops new ones.`
                : 'This stops the Job from accepting applications.'}
            </Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setConfirmClose(false)} style={[styles.modalBtn, styles.modalGhost]}>
                <Text style={styles.modalGhostText}>Keep open</Text>
              </Pressable>
              <Pressable onPress={doClose} disabled={closing} style={[styles.modalBtn, styles.modalDanger]}>
                {closing ? <ActivityIndicator color={colors.inkInv} /> : <Text style={styles.modalDangerText}>Close Job</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function WebApplicantCard({
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
  const status = applicationStatusStyle(app.state);
  const actionable = app.state === 'submitted' || app.state === 'countered';
  const showCounter = actionable && c.negotiable && app.offer != null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Avatar label={c.name ?? 'Caregiver'} tone={CATEGORY_TONE[categoryChip(app.category)]} size="md" />
        <Pressable style={styles.flexMin} onPress={onViewProfile}>
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
        {app.offer ? (
          <View style={styles.priceBox}>
            <Text style={styles.priceTotal}>{formatMoney(app.offer.computedTotalCents)}</Text>
            <Text style={styles.priceSub}>{formatMoney(app.offer.proposedRateCents)}/hr</Text>
          </View>
        ) : (
          <View style={[styles.pill, { backgroundColor: status.bg }]}>
            <Text style={[styles.pillText, { color: status.fg }]}>{status.label}</Text>
          </View>
        )}
      </View>

      <View style={styles.badgeRow}>
        {c.backgroundChecked ? <Badge kind="verified" /> : null}
        <View style={[styles.pill, { backgroundColor: status.bg }]}>
          <Text style={[styles.pillText, { color: status.fg }]}>{status.label}</Text>
        </View>
      </View>

      {app.proposal ? <Text style={styles.proposal}>{app.proposal}</Text> : null}

      <View style={styles.actions}>
        <Pressable onPress={onMessage} style={({ pressed }) => [styles.btn, styles.btnGhost, { opacity: pressed ? 0.85 : 1 }]}>
          <Icon name="message" size={15} color={colors.ink} />
          <Text style={styles.btnGhostText}>Message</Text>
        </Pressable>
        {showCounter ? (
          <Pressable onPress={onCounter} style={({ pressed }) => [styles.btn, styles.btnGhost, { opacity: pressed ? 0.85 : 1 }]}>
            <Text style={styles.btnGhostText}>Counter</Text>
          </Pressable>
        ) : null}
        {actionable ? (
          <Pressable
            onPress={onDecline}
            disabled={busy}
            style={({ pressed }) => [styles.btn, styles.btnGhost, { opacity: pressed || busy ? 0.6 : 1 }]}
          >
            <Text style={[styles.btnGhostText, { color: colors.danger }]}>{busy ? 'Declining…' : 'Decline'}</Text>
          </Pressable>
        ) : null}
        {actionable && app.offer ? (
          <Pressable onPress={onAward} style={({ pressed }) => [styles.btn, styles.btnPrimary, { opacity: pressed ? 0.9 : 1 }]}>
            <Icon name="check" size={15} color={colors.inkInv} />
            <Text style={styles.btnPrimaryText}>Award</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 36, paddingBottom: 48, maxWidth: 1180 },
  flexMin: { flex: 1, minWidth: 0 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 8 },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  emptySub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, textAlign: 'center' },
  columns: { flexDirection: 'row', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' },

  list: { width: 320, gap: 12 },
  listLabel: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.ink2, marginBottom: 2 },
  jobRow: { backgroundColor: colors.surface, borderRadius: 20, padding: 16, gap: 12, borderWidth: 1.5, borderColor: 'transparent', ...shadow.e1 },
  jobRowActive: { borderColor: colors.brand },
  jobTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobRowTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.ink },
  jobBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobDays: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink3 },

  pill: { height: 24, paddingHorizontal: 10, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontFamily: fonts.semibold, fontSize: 11.5 },

  detail: { flex: 1, minWidth: 420 },
  summary: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 20, ...shadow.e1 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryTitle: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: colors.ink, marginTop: 14 },
  summaryMeta: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: colors.ink2, marginTop: 6 },
  manageRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  manageBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 16, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.surface },
  manageDanger: { borderColor: 'rgba(178,58,47,0.4)' },
  manageText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },

  bannerError: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger, marginTop: 12 },

  listHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 26, marginBottom: 14 },
  listHeadTitle: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.4, color: colors.ink },

  emptyBox: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 28, alignItems: 'center', gap: 8, ...shadow.e1 },
  emptyBoxTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },

  applicants: { gap: 14 },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 18, ...shadow.e1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  category: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.ink2 },
  dot: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3 },
  newText: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink3 },
  priceBox: { alignItems: 'flex-end' },
  priceTotal: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: -0.3, color: colors.ink, fontVariant: ['tabular-nums'] },
  priceSub: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.ink2, marginTop: 1 },

  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 14 },
  proposal: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: colors.ink2, marginTop: 12 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 16, flexWrap: 'wrap' },
  btn: { height: 44, paddingHorizontal: 18, borderRadius: radii.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  btnGhost: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.ink },
  btnGhostText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  btnPrimary: { backgroundColor: colors.brand },
  btnPrimaryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.inkInv },

  modalScrim: { flex: 1, backgroundColor: 'rgba(22,21,19,0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  modalCard: { width: '100%', maxWidth: 400, backgroundColor: colors.surface, borderRadius: radii.xl, padding: 24, ...shadow.e2 },
  modalTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  modalBody: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink2, marginTop: 10 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  modalBtn: { flex: 1, height: 48, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  modalGhost: { borderWidth: 1.5, borderColor: colors.ink },
  modalGhostText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  modalDanger: { backgroundColor: colors.danger },
  modalDangerText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkInv },
});
