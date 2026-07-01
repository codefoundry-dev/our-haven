/**
 * My Jobs hub helpers + data hooks (OH-210). Pure formatting + light fetch hooks
 * shared by the native My Jobs / Job-detail screens and the web two-pane, so the
 * hub / detail / award surfaces render the same live data with no drift.
 *
 * A Job's concrete schedule (ADR-0014) renders as a one-line label; the hub
 * buckets Jobs by state into Open / Awarded / Past / Drafts; an Application's
 * state renders as a coloured status pill.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  getApplication,
  getJob,
  getJobApplications,
  getJobs,
  type JobApplication,
  type MyJob,
} from '@/api/client';
import { formatMoney, formatOfferDate, formatWindow } from '@/lib/offerCopy';
import type { Category } from '@/components/ui/CategoryChip';
import { colors } from '@/theme/tokens';

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** API category key → the pastel CategoryChip label. */
export function categoryChip(category: MyJob['category']): Category {
  if (category === 'nanny') return 'Nanny';
  if (category === 'tutor') return 'Tutor';
  return 'Babysitter';
}

/**
 * A Job's concrete schedule as one line (ADR-0014). One-off → date + window
 * (multi-date → "N dates"); recurring → weekdays + window + end date.
 */
export function jobScheduleLabel(job: Pick<MyJob, 'scheduleKind' | 'slots' | 'recurrence'>): string {
  if (job.scheduleKind === 'recurring' && job.recurrence) {
    const r = job.recurrence;
    const days = [...r.weekdays].sort((a, b) => a - b).map((w) => WEEKDAY_ABBR[w]).join(' & ');
    return `${days} · ${formatWindow(r.startMin, r.endMin)} · through ${formatOfferDate(r.endDate)}`;
  }
  const slots = job.slots ?? [];
  if (slots.length === 0) return 'No date set';
  if (slots.length === 1) {
    const s = slots[0]!;
    return `${formatOfferDate(s.date)} · ${formatWindow(s.startMin, s.endMin)}`;
  }
  const first = slots[0]!;
  return `${slots.length} dates · from ${formatOfferDate(first.date)}`;
}

export type JobBucket = 'open' | 'awarded' | 'past' | 'drafts';

/** Which My-Jobs-hub section a Job falls into. */
export function jobBucket(state: MyJob['state']): JobBucket {
  if (state === 'draft') return 'drafts';
  if (state === 'open') return 'open';
  if (state === 'awarded') return 'awarded';
  return 'past'; // expired | cancelled | closed
}

export interface JobStatusStyle {
  label: string;
  bg: string;
  fg: string;
}

/** The Job-state pill copy + colours for the hub / detail header. */
export function jobStatusStyle(state: MyJob['state']): JobStatusStyle {
  switch (state) {
    case 'open':
      return { label: 'Open', bg: 'rgba(58,111,168,0.12)', fg: colors.info };
    case 'awarded':
      return { label: 'Awarded', bg: 'rgba(47,122,77,0.12)', fg: colors.success };
    case 'draft':
      return { label: 'Draft', bg: colors.surfaceAlt, fg: colors.ink2 };
    case 'closed':
      return { label: 'Closed', bg: colors.surfaceAlt, fg: colors.ink2 };
    case 'cancelled':
      return { label: 'Closed', bg: colors.surfaceAlt, fg: colors.ink2 };
    case 'expired':
      return { label: 'Expired', bg: colors.surfaceAlt, fg: colors.ink2 };
  }
}

/** An Application-state pill's copy + colours (the applicant status pill; story 88). */
export function applicationStatusStyle(state: JobApplication['state']): JobStatusStyle {
  switch (state) {
    case 'submitted':
      return { label: 'New', bg: 'rgba(58,111,168,0.12)', fg: colors.info };
    case 'countered':
      return { label: 'Countered', bg: 'rgba(201,122,42,0.12)', fg: colors.warning };
    case 'awarded':
      return { label: 'Awarded', bg: 'rgba(47,122,77,0.12)', fg: colors.success };
    case 'declined':
      return { label: 'Declined', bg: colors.surfaceAlt, fg: colors.ink2 };
    case 'withdrawn':
      return { label: 'Withdrawn', bg: colors.surfaceAlt, fg: colors.ink2 };
    case 'expired':
      return { label: 'Expired', bg: colors.surfaceAlt, fg: colors.ink2 };
  }
}

/** The caregiver's proposed-total line for an Application card (offer snapshot). */
export function offerTotalLabel(offer: JobApplication['offer']): string | null {
  if (!offer) return null;
  return formatMoney(offer.computedTotalCents);
}

/* ── data hooks ───────────────────────────────────────────────────────────── */

export interface UseJobsResult {
  jobs: MyJob[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/** The Parent's posted Jobs for the My Jobs hub (client buckets by state). */
export function useMyJobs(): UseJobsResult {
  const [tick, setTick] = useState(0);
  const [jobs, setJobs] = useState<MyJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getJobs()
      .then((res) => {
        if (cancelled) return;
        setJobs(res);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'We couldn’t load your Jobs.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { jobs, loading, error, refetch: () => setTick((t) => t + 1) };
}

export interface UseJobDetailResult {
  job: MyJob | null;
  applications: JobApplication[];
  loading: boolean;
  error: string | null;
  notFound: boolean;
  refetch: () => void;
}

/**
 * One Job + its Applications for the Job-detail / applicant-review screen. A 404
 * on the Job is surfaced as `notFound` (a dedicated empty state).
 */
export function useJobDetail(jobId: string | null): UseJobDetailResult {
  const [tick, setTick] = useState(0);
  const [job, setJob] = useState<MyJob | null>(null);
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!jobId) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    Promise.all([getJob(jobId), getJobApplications(jobId)])
      .then(([j, apps]) => {
        if (cancelled) return;
        setJob(j);
        setApplications(apps);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setError(e instanceof ApiError ? e.message : 'We couldn’t load this Job.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, tick]);

  return { job, applications, loading, error, notFound, refetch: () => setTick((t) => t + 1) };
}

/** Re-fetch a single Application (used to refresh a card after an action). */
export function useApplicationRefetch(): (id: string) => Promise<JobApplication | null> {
  return useCallback(async (id: string) => {
    try {
      return await getApplication(id);
    } catch {
      return null;
    }
  }, []);
}
