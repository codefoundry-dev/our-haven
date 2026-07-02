/**
 * Caregiver Opportunities helpers + data hooks (OH-218) — the READ side of the
 * Posted-Job chain, the mirror of jobsHub.ts (OH-210). Pure formatting + light
 * fetch hooks shared by the native Opportunities / Job-detail screens and the web
 * two-pane, so the feed, Job detail, My Applications, and the monthly quota render
 * the same live data with no drift.
 *
 * READ-ONLY: filing an Application (write) + the caps are the composer, OH-219.
 */
import { useEffect, useState } from 'react';

import {
  ApiError,
  getCaregiverProfile,
  getMyApplications,
  getOpportunities,
  getOpportunity,
  type ApplicationQuota,
  type MyApplication,
  type Opportunity,
  type OpportunityCategory,
  type OpportunityLocation,
} from '@/api/client';

/* ── formatting ─────────────────────────────────────────────────────────────── */

/** "Posted just now" / "Posted 2h ago" / "Posted yesterday" / "Posted Aug 1". */
export function postedAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 2) return 'Posted just now';
  if (min < 60) return `Posted ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Posted ${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'Posted yesterday';
  if (day < 7) return `Posted ${day}d ago`;
  return `Posted ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/** Coarse area + approximate distance, e.g. "Austin, TX · 1.8 mi away". Null when unknown. */
export function distanceLabel(location: OpportunityLocation): string | null {
  const parts: string[] = [];
  if (location.areaLabel) parts.push(location.areaLabel);
  if (location.distanceMiles != null) parts.push(`${location.distanceMiles} mi away`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The disclosed child bundle as one line, e.g. "2 children · ages 4, 7" (AwardSheet idiom). */
export function childSummary(childCount: number | null, childAges: number[]): string | null {
  if (childCount == null) return null;
  const noun = childCount === 1 ? 'child' : 'children';
  const ages = childAges.length > 0 ? ` · ages ${childAges.join(', ')}` : '';
  return `${childCount} ${noun}${ages}`;
}

/** Advisory hourly budget hint, e.g. "$32 / hr". Null when the Parent set none. */
export function budgetLabel(budgetHintCents: number | null): string | null {
  if (budgetHintCents == null) return null;
  return `$${Math.round(budgetHintCents / 100)} / hr`;
}

/**
 * Billable hours for ONE session of a Job — the summed slot windows for a one-off,
 * or a single occurrence's window for a recurring Job. Drives the apply composer's
 * live "estimated per-session total" (mirrors the Edge's `offerScheduleFromJob`).
 */
export function opportunityHours(job: Opportunity): number {
  if (job.scheduleKind === 'recurring' && job.recurrence) {
    return Math.max(0, job.recurrence.endMin - job.recurrence.startMin) / 60;
  }
  return job.slots.reduce((sum, s) => sum + Math.max(0, s.endMin - s.startMin), 0) / 60;
}

/** Friendly copy for the apply/withdraw gate the Edge returned (ApiError.code). */
const APPLY_ERROR_COPY: Record<string, string> = {
  verification_not_cleared: 'Your background check must clear before you can apply.',
  job_not_open: 'This Job is no longer open.',
  job_not_found: 'This Job is no longer available.',
  already_applied: 'You’ve already applied to this Job.',
  job_application_cap_reached: 'This Job has reached its 15-application limit.',
  monthly_cap_reached: 'You’ve used all 30 of your applications this month.',
  rate_not_published: 'Publish your rate for this category before applying.',
  job_incomplete: 'This Job is missing details and can’t be applied to yet.',
  invalid_schedule: 'This Job’s schedule looks invalid.',
  not_withdrawable: 'This application can no longer be withdrawn.',
};

export function applyErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    return (e.code && APPLY_ERROR_COPY[e.code]) || e.message;
  }
  return 'Something went wrong. Please try again.';
}

/* ── date grouping (My Applications) ──────────────────────────────────────────── */

export interface ApplicationSection {
  title: string;
  items: MyApplication[];
}

const WEEK_MS = 7 * 86_400_000;

/** Group the Caregiver's Applications into "This week" / "Earlier" by filing date. */
export function groupApplications(applications: MyApplication[]): ApplicationSection[] {
  const now = Date.now();
  const thisWeek: MyApplication[] = [];
  const earlier: MyApplication[] = [];
  for (const a of applications) {
    const t = new Date(a.createdAt).getTime();
    if (!Number.isNaN(t) && now - t < WEEK_MS) thisWeek.push(a);
    else earlier.push(a);
  }
  const sections: ApplicationSection[] = [];
  if (thisWeek.length > 0) sections.push({ title: 'This week', items: thisWeek });
  if (earlier.length > 0) sections.push({ title: 'Earlier', items: earlier });
  return sections;
}

/* ── data hooks ───────────────────────────────────────────────────────────────── */

export interface OpportunityFilters {
  category?: OpportunityCategory;
  schedule?: 'one-off' | 'recurring';
}

export interface UseOpportunitiesResult {
  jobs: Opportunity[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * The open-Jobs feed across the Caregiver's categories (recency + distance
 * ranked). `enabled` gates the fetch so an un-activated Caregiver (who sees the
 * pre-activation empty state instead) never hits the endpoint.
 */
export function useOpportunities(filters: OpportunityFilters = {}, enabled = true): UseOpportunitiesResult {
  const { category, schedule } = filters;
  const [tick, setTick] = useState(0);
  const [jobs, setJobs] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getOpportunities({ category, schedule })
      .then((res) => {
        if (cancelled) return;
        setJobs(res);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'We couldn’t load Opportunities.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category, schedule, enabled, tick]);

  return { jobs, loading, error, refetch: () => setTick((t) => t + 1) };
}

export interface UseOpportunityDetailResult {
  job: Opportunity | null;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  refetch: () => void;
}

/** One open Job's detail (in-category, or one the Caregiver has applied to). */
export function useOpportunityDetail(jobId: string | null): UseOpportunityDetailResult {
  const [tick, setTick] = useState(0);
  const [job, setJob] = useState<Opportunity | null>(null);
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
    getOpportunity(jobId)
      .then((j) => {
        if (cancelled) return;
        setJob(j);
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

  return { job, loading, error, notFound, refetch: () => setTick((t) => t + 1) };
}

export interface UseMyApplicationsResult {
  applications: MyApplication[];
  quota: ApplicationQuota | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/** The Caregiver's own Applications (newest first) + the monthly N/30 quota. */
export function useMyApplications(enabled = true): UseMyApplicationsResult {
  const [tick, setTick] = useState(0);
  const [applications, setApplications] = useState<MyApplication[]>([]);
  const [quota, setQuota] = useState<ApplicationQuota | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMyApplications()
      .then((res) => {
        if (cancelled) return;
        setApplications(res.applications);
        setQuota(res.quota);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'We couldn’t load your applications.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, tick]);

  return { applications, quota, loading, error, refetch: () => setTick((t) => t + 1) };
}

/**
 * The categories the Caregiver offers (from their profile) — drives the feed's
 * category filter, which shows only when 2+ categories are offered (story 96).
 * Degrades to [] on error (the filter simply hides).
 */
export function useOfferedCategories(enabled = true): OpportunityCategory[] {
  const [categories, setCategories] = useState<OpportunityCategory[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getCaregiverProfile()
      .then((p) => {
        if (!cancelled) setCategories(p.categories);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return categories;
}
