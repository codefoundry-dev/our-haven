import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import type { Insertable } from 'kysely';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
import type { JobsTable } from '../../../../apps/backend/src/db/schema.ts';
// Cross-tree, Deno-clean domain leaves (ADR-0019; explicit-`.ts`). `job-compose`
// (OH-209) validates the compose payload + fans a multi-day one-off out into one
// Job per date; `job-lifecycle` owns the draft→open publish transition;
// `expandRecurrence` (booking-lifecycle) counts a recurring rule's occurrences;
// the Parent gate is the paywall's `deriveAccessDecision` (OH-193).
import { expandRecurrence } from '../../../../packages/domain/src/booking-lifecycle/index.ts';
import { transitionJob, type Job } from '../../../../packages/domain/src/job-lifecycle/index.ts';
import {
  countsAgainstJobCap,
  type ApplicationState,
} from '../../../../packages/domain/src/application-lifecycle/index.ts';
import {
  planJobPosts,
  type JobComposeInput,
} from '../../../../packages/domain/src/job-compose/index.ts';
import {
  deriveAccessDecision,
  type StripeSubscriptionStatus,
} from '../../../../packages/domain/src/parent-subscription/index.ts';
import { SAFETY_BEHAVIORS } from '../../../../packages/shared/src/safety-behaviors.ts';
import { insertDisputeRecord } from '../services/disputes.ts';

/**
 * Posted Jobs (OH-209 + OH-210) — CONTEXT.md § Job; PRD-0001 v1.7 stories 84–92,
 * 128; ADR-0014 (concrete schedule), ADR-0016 (disclose-or-none + timestamped consent).
 *
 *   POST  /v1/jobs             compose + PUBLISH a posted Job (multi-day → one Job per date)
 *   GET   /v1/jobs             the Parent's own posted Jobs + actionable Application count (OH-210)
 *   GET   /v1/jobs/{jobId}     one of the Parent's Jobs (OH-210)
 *   PATCH /v1/jobs/{jobId}     edit a still-`open` Job in place (OH-210)
 *   POST  /v1/jobs/{jobId}/close  close a `draft`/`open` Job — withdraws its open Applications (OH-210)
 *
 * The read/edit/close surface (OH-210) powers the Parent's **My Jobs hub** (Open /
 * Awarded / Past / Drafts) + Job detail. Only `posted`-origin Jobs surface here;
 * Direct-Message Jobs are plumbing (neither party sees a Job UI). Awarding a Job
 * lives on the Application (routes/applications.ts) — awarding is accepting a
 * caregiver's Application Offer, which is richer than a plain Job transition.
 *
 * A Parent composes a Job (Category + ZIP + scope + concrete schedule + child
 * count/ages + disclosed Safety-Behaviors subset + service address + optional
 * budget hint) and publishes it; verified in-category Caregivers apply (a later
 * discovery ticket). Draft autosave/resume is CLIENT-side (the composer stashes
 * to storage) — a Job row only exists once published, so this endpoint creates
 * the row(s) born `draft` and transitions them to `open` in one step.
 *
 * GATE (ADR/CONTEXT § Subscription): publishing is Parent-Subscription-gated
 * (402) — the same gate the paywall reads (`deriveAccessDecision`, active|trialing).
 * Composing a draft is ungated (client-side); the gate fires on PUBLISH.
 *
 * FAN-OUT (ADR-0014 §A1): a one-off single date posts one Job; a multi-day
 * one-off posts one one-off Job PER DATE (the deliberate asymmetry vs the
 * Book-request path); a recurring rule posts one Job carrying the un-expanded
 * rule (its Booking Series only materialises at award).
 *
 * CONSENT (ADR-0016 §6): the timestamped compose disclosure consent covering the
 * child-detail bundle is server-stamped at publish from the client's explicit
 * acknowledgement (`disclosureConsent: true`) — refused (400) without it.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z.object({ error: z.string(), reason: z.string().optional() }).openapi('JobError');

const CategoryEnum = z.enum(['babysitter', 'tutor', 'nanny']);
const SafetyBehaviorEnum = z.enum(SAFETY_BEHAVIORS);

/** A single concrete session slot (minutes-from-midnight window on a calendar day). */
const SlotInput = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    startMin: z.number().int().min(0).max(1440),
    endMin: z.number().int().min(0).max(1440),
  })
  .refine((s) => s.startMin < s.endMin, { message: 'startMin must be before endMin' })
  .openapi('JobSlot');

/** An anchored weekly recurrence rule (ADR-0014 §4). `weekdays` are 0=Sun..6=Sat. */
const RecurrenceInput = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startMin: z.number().int().min(0).max(1440),
    endMin: z.number().int().min(0).max(1440),
  })
  .refine((r) => r.startMin < r.endMin, { message: 'startMin must be before endMin' })
  .refine((r) => r.endDate >= r.startDate, { message: 'endDate must not precede startDate' })
  .openapi('JobRecurrence');

/**
 * The posted-Job schedule (ADR-0014). A Job cannot BE multi-day: a multi-day
 * one-off is fanned out into one one-off Job per date (§A1). `one-off` here is a
 * single date; `multi-day` is the compose-time bundle that fans out; `recurring`
 * is an anchored rule (composed here — OH-209 is the first recurring composer).
 */
const ScheduleInput = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('one-off'), slot: SlotInput }),
    z.object({ kind: z.literal('multi-day'), slots: z.array(SlotInput).min(1).max(31) }),
    z.object({ kind: z.literal('recurring'), rule: RecurrenceInput }),
  ])
  .openapi('JobSchedule');

/** ZIP is the required location anchor; the street is optional (reveal-at-accept). */
const ServiceAddressInput = z
  .object({
    line1: z.string().max(120).nullish(),
    line2: z.string().max(120).nullish(),
    city: z.string().max(80).nullish(),
    state: z.string().regex(/^[A-Z]{2}$/).nullish(),
    postalCode: z.string().regex(/^\d{5}$/, 'a 5-digit ZIP is required'),
  })
  .openapi('JobServiceAddress');

const CreateJobRequest = z
  .object({
    category: CategoryEnum,
    /** Scope free-text (persisted as the Job description). */
    description: z.string().min(1).max(2000),
    childCount: z.number().int().min(1).max(12),
    /** One integer age (years, 0–17) per child — length must equal childCount. */
    childAges: z.array(z.number().int().min(0).max(17)).max(12),
    /** The parent-disclosed Safety-Behaviors subset. REQUIRED (no default): the
     *  explicit disclose-or-none choice (ADR-0016). `[]` = disclose none. */
    safetyBehaviors: z.array(SafetyBehaviorEnum),
    serviceAddress: ServiceAddressInput,
    /** Optional advisory hourly-rate hint, integer cents. */
    budgetHintCents: z.number().int().min(0).nullish(),
    /** Explicit acknowledgement of the compose disclosure warning (ADR-0016 §6).
     *  Server-stamped to `disclosure_consent_at` at publish; must be true. */
    disclosureConsent: z.boolean(),
    schedule: ScheduleInput,
  })
  .openapi('CreateJobRequest');

const JobServiceAddressOut = z.object({
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
});

const JobSchema = z
  .object({
    id: z.string(),
    origin: z.enum(['posted', 'direct-message']),
    state: z.enum(['draft', 'open', 'awarded', 'expired', 'cancelled', 'closed']),
    category: CategoryEnum,
    description: z.string(),
    childCount: z.number().int().nullable(),
    childAges: z.array(z.number().int()),
    safetyBehaviors: z.array(z.string()),
    scheduleKind: z.enum(['one-off', 'recurring']).nullable(),
    slots: z.array(SlotInput),
    recurrence: RecurrenceInput.nullable(),
    serviceAddress: JobServiceAddressOut.nullable(),
    budgetHintCents: z.number().int().nullable(),
    disclosureConsentAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('Job');

/** A publish fans out into one or more Jobs (multi-day → one per date). */
const CreateJobResponse = z.object({ jobs: z.array(JobSchema) }).openapi('CreateJobResult');

/**
 * A Job in the Parent's My Jobs hub / detail (OH-210) — the full Job DTO plus the
 * actionable Application count (`submitted` + `countered`) that drives the "N/15"
 * pill (only these two states count against the 15-cap; ADR-0006 §7).
 */
const JobListItemSchema = JobSchema.extend({
  applicationCount: z.number().int(),
}).openapi('JobListItem');

const JobListResponse = z.object({ jobs: z.array(JobListItemSchema) }).openapi('JobList');

const JobIdParam = z.object({
  jobId: z.string().uuid().openapi({ param: { name: 'jobId', in: 'path' } }),
});

/* ── row shape + helpers ─────────────────────────────────────────────────────── */

interface JobRow {
  id: string;
  origin: 'posted' | 'direct-message';
  state: 'draft' | 'open' | 'awarded' | 'expired' | 'cancelled' | 'closed';
  category: 'babysitter' | 'tutor' | 'nanny';
  description: string;
  child_count: number | null;
  child_ages: number[] | null;
  safety_behaviors: string[] | null;
  schedule_kind: 'one-off' | 'recurring' | null;
  slots: { date: string; startMin: number; endMin: number }[] | null;
  recurrence: z.infer<typeof RecurrenceInput> | null;
  service_address_line1: string | null;
  service_address_line2: string | null;
  service_city: string | null;
  service_state: string | null;
  service_postal_code: string | null;
  budget_hint_cents: number | null;
  disclosure_consent_at: Date | string | null;
  created_at: Date | string;
}

const JOB_COLUMNS = [
  'id',
  'origin',
  'state',
  'category',
  'description',
  'child_count',
  'child_ages',
  'safety_behaviors',
  'schedule_kind',
  'slots',
  'recurrence',
  'service_address_line1',
  'service_address_line2',
  'service_city',
  'service_state',
  'service_postal_code',
  'budget_hint_cents',
  'disclosure_consent_at',
  'created_at',
] as const;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** The Parent owns the Job, so the full service address is always revealed here. */
/** Interpret a slot's wall-clock (date + minute) as a UTC instant — the same
 *  tz-agnostic convention Bookings use (OH-203). */
function slotStartUtc(date: string, startMin: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, startMin, 0, 0));
}

/**
 * The instant a posted Job stops being awardable — its EARLIEST scheduled service
 * start (OH-223 job-expiry; drives job_expiring_48h / job_expired_no_award). A
 * one-off (incl. a multi-day one-off already fanned to one Job per date): the slot
 * start. Recurring: the first occurrence on/after the rule's startDate whose
 * weekday matches, bounded by endDate. `null` when neither yields a date (the Job
 * then carries no expiry timer).
 */
function jobExpiresAt(post: {
  slots?: readonly { date: string; startMin: number; endMin: number }[] | null;
  recurrence?: { startDate: string; endDate: string; weekdays: readonly number[]; startMin: number } | null;
}): Date | null {
  const slots = post.slots ?? [];
  if (slots.length > 0) {
    return slots
      .map((s) => slotStartUtc(s.date, s.startMin))
      .reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
  }
  const r = post.recurrence;
  if (!r) return null;
  const endMs = Date.parse(`${r.endDate}T00:00:00.000Z`);
  for (let t = Date.parse(`${r.startDate}T00:00:00.000Z`); t <= endMs; t += 86_400_000) {
    if (r.weekdays.includes(new Date(t).getUTCDay())) {
      return slotStartUtc(new Date(t).toISOString().slice(0, 10), r.startMin);
    }
  }
  return null;
}

function toJobDTO(row: JobRow): z.infer<typeof JobSchema> {
  const hasAddress =
    row.service_address_line1 !== null ||
    row.service_city !== null ||
    row.service_state !== null ||
    row.service_postal_code !== null;
  return {
    id: row.id,
    origin: row.origin,
    state: row.state,
    category: row.category,
    description: row.description,
    childCount: row.child_count,
    childAges: row.child_ages ?? [],
    safetyBehaviors: row.safety_behaviors ?? [],
    scheduleKind: row.schedule_kind,
    slots: row.slots ?? [],
    recurrence: row.recurrence,
    serviceAddress: hasAddress
      ? {
          line1: row.service_address_line1,
          line2: row.service_address_line2,
          city: row.service_city,
          state: row.service_state,
          postalCode: row.service_postal_code,
        }
      : null,
    budgetHintCents: row.budget_hint_cents,
    disclosureConsentAt: row.disclosure_consent_at ? toIso(row.disclosure_consent_at) : null,
    createdAt: toIso(row.created_at),
  };
}

/** The same Subscription gate the paywall reads (OH-193): entitled iff active|trialing. */
async function parentEntitled(db: Db, uid: string): Promise<boolean> {
  const sub = (await db
    .selectFrom('parent_subscriptions')
    .select(['status'])
    .where('uid', '=', uid)
    .executeTakeFirst()) as { status: StripeSubscriptionStatus | null } | undefined;
  return deriveAccessDecision({ status: sub?.status ?? null }).entitled;
}

/**
 * The actionable Application count per Job (OH-210) — only `submitted` +
 * `countered` count against the 15-cap and drive the Parent's "N/15" pill
 * (`countsAgainstJobCap`; the storage layer owns the count). One query for the
 * whole hub; grouped in-memory.
 */
async function actionableCounts(db: Db, jobIds: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (jobIds.length === 0) return counts;
  const rows = (await db
    .selectFrom('applications')
    .select(['job_id', 'state'])
    .where('job_id', 'in', jobIds as string[])
    .execute()) as { job_id: string; state: ApplicationState }[];
  for (const r of rows) {
    if (countsAgainstJobCap(r.state)) counts.set(r.job_id, (counts.get(r.job_id) ?? 0) + 1);
  }
  return counts;
}

/** Load one of the caller's Jobs by id (owner + posted-origin only). 404 → null. */
async function loadOwnedJob(db: Db, jobId: string, uid: string): Promise<JobRow | null> {
  const row = (await db
    .selectFrom('jobs')
    .select([...JOB_COLUMNS, 'parent_uid'])
    .where('id', '=', jobId)
    .executeTakeFirst()) as (JobRow & { parent_uid: string }) | undefined;
  // 404 (never 403) when it is not the caller's / not a posted Job — never reveal
  // another Parent's Job, and Direct-Message Jobs have no Parent Job UI.
  if (!row || row.parent_uid !== uid || row.origin !== 'posted') return null;
  return row;
}

/* ── route definition ─────────────────────────────────────────────────────────── */

const createJobRoute = createRoute({
  method: 'post',
  path: '/jobs',
  tags: ['jobs'],
  summary: 'Compose + publish a posted Job — OH-209',
  description:
    'A Parent publishes a posted Job open to verified in-category Caregivers. Publishing is Parent-Subscription-gated (402). The Safety-Behaviors disclosure is REQUIRED (disclose a subset or explicitly none) and the compose disclosure consent must be acknowledged (ADR-0016). A multi-day one-off fans out into one one-off Job per date; a recurring rule posts a single Job (ADR-0014). 400 on an invalid schedule / child detail / a recurrence that generates no dates.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { body: { content: json(CreateJobRequest), required: true } },
  responses: {
    201: { description: 'The published Job(s)', content: json(CreateJobResponse) },
    400: { description: 'Invalid Job', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    402: { description: 'No active Parent Subscription', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
  },
});

const listJobsRoute = createRoute({
  method: 'get',
  path: '/jobs',
  tags: ['jobs'],
  summary: "The Parent's posted Jobs (My Jobs hub) — OH-210",
  description:
    "Returns the caller's own posted Jobs (newest first), each with its actionable Application count (submitted + countered). The client buckets by state into Open / Awarded / Past / Drafts. Direct-Message Jobs are excluded (plumbing).",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  responses: {
    200: { description: "The Parent's Jobs", content: json(JobListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
  },
});

const getJobRoute = createRoute({
  method: 'get',
  path: '/jobs/{jobId}',
  tags: ['jobs'],
  summary: "One of the Parent's Jobs (Job detail) — OH-210",
  description:
    "Returns a single posted Job the caller owns, plus its actionable Application count. 404 when the Job is unknown, not the caller's, or a Direct-Message Job.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: JobIdParam },
  responses: {
    200: { description: 'The Job', content: json(JobListItemSchema) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Job not found (or not the caller's)", content: json(ErrorResponse) },
  },
});

const editJobRoute = createRoute({
  method: 'patch',
  path: '/jobs/{jobId}',
  tags: ['jobs'],
  summary: 'Edit a still-open Job in place — OH-210',
  description:
    'Revises a Job the caller owns while it is still `open` (before any award), re-running the full compose pipeline (schedule / child detail / disclosure / address). Editing is Parent-Subscription-gated (402) and re-stamps the disclosure consent. A multi-day schedule is rejected (that is a compose-time fan-out, not an edit target). 409 when the Job is not `open`; 404 when it is not the caller\'s.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: JobIdParam, body: { content: json(CreateJobRequest), required: true } },
  responses: {
    200: { description: 'The updated Job', content: json(JobListItemSchema) },
    400: { description: 'Invalid Job', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    402: { description: 'No active Parent Subscription', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Job not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Job is no longer editable (not open)', content: json(ErrorResponse) },
  },
});

const closeJobRoute = createRoute({
  method: 'post',
  path: '/jobs/{jobId}/close',
  tags: ['jobs'],
  summary: 'Close a Job — withdraws its open Applications — OH-210',
  description:
    'Closes (parent-cancels) a `draft`/`open` Job the caller owns. Closing an `open` Job withdraws every still-open Application on it (they transition to `expired`). Never re-gated. 409 when the Job is already awarded/closed/expired/cancelled; 404 when it is not the caller\'s.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: JobIdParam },
  responses: {
    200: { description: 'The closed Job', content: json(JobListItemSchema) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Job not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Job cannot be closed from its current state', content: json(ErrorResponse) },
  },
});

const JobDisputeRequest = z
  .object({
    reason: z.enum(['overcharged', 'no-show', 'safety', 'quality', 'other']),
    details: z.string().max(1000).optional(),
  })
  .openapi('JobDisputeRequest');

const JobDisputeResponse = z
  .object({
    jobId: z.string(),
    /** Always true — a past-Job dispute is an admin escalation (no money on a Job). */
    escalation: z.literal(true),
  })
  .openapi('JobDispute');

const disputeJobRoute = createRoute({
  method: 'post',
  path: '/jobs/{jobId}/dispute',
  tags: ['jobs'],
  summary: 'Dispute a past Job (charge/billing) — admin escalation — OH-213',
  description:
    "Files a charge/billing complaint against one of the caller's posted Jobs (`Job.dispute`, ADR-0013 amended / PRD story 132). A Job carries no on-platform money, so this is purely an admin-escalation record — it never moves money. Same reason chip + free text as the Booking dispute. 404 when the Job is not the caller's.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: JobIdParam, body: { content: json(JobDisputeRequest), required: true } },
  responses: {
    200: { description: 'Dispute filed', content: json(JobDisputeResponse) },
    400: { description: 'Invalid dispute', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Job not found (or not the caller's)", content: json(ErrorResponse) },
  },
});

/* ── handler ──────────────────────────────────────────────────────────────────── */

export function registerJobRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(createJobRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const input = c.req.valid('json');

    // GATE: publishing a Job is Parent-Subscription-gated (402). The gate fires
    // on PUBLISH — composing a draft is client-side + ungated (CONTEXT § Subscription).
    if (!(await parentEntitled(db, principal.uid))) {
      return c.json(
        { error: 'subscription_required', reason: 'an active Parent Subscription is required to post a Job' },
        402,
      );
    }

    // CONSENT (ADR-0016 §6): the disclosure warning must be acknowledged; the
    // timestamp is server-authoritative (stamped now, not trusted from the client).
    if (input.disclosureConsent !== true) {
      return c.json(
        { error: 'consent_required', reason: 'the Safety-Behaviors disclosure consent must be acknowledged' },
        400,
      );
    }
    const now = new Date();
    const disclosureConsentAt = now.toISOString();

    // A recurring rule must generate at least one concrete occurrence (ADR-0014 §4).
    if (input.schedule.kind === 'recurring') {
      const expanded = expandRecurrence(input.schedule.rule);
      if (!expanded.ok || expanded.slots.length === 0) {
        return c.json(
          { error: 'invalid_schedule', reason: 'the recurrence generates no dates in its range' },
          400,
        );
      }
    }

    // Validate + fan out into concrete posted-Job specs (domain, OH-209).
    const composeInput: JobComposeInput = {
      category: input.category,
      description: input.description,
      childCount: input.childCount,
      childAges: input.childAges,
      safetyBehaviors: input.safetyBehaviors,
      serviceAddress: {
        line1: input.serviceAddress.line1 ?? null,
        line2: input.serviceAddress.line2 ?? null,
        city: input.serviceAddress.city ?? null,
        state: input.serviceAddress.state ?? null,
        postalCode: input.serviceAddress.postalCode,
      },
      budgetHintCents: input.budgetHintCents ?? null,
      disclosureConsentAt,
      schedule: input.schedule,
    };
    const plan = planJobPosts(composeInput);
    if (!plan.ok) {
      return c.json({ error: 'invalid_job', reason: plan.reason }, 400);
    }

    // Honour the Job state machine: each Job is born `draft`, then published to
    // `open` (job-lifecycle). transitionJob asserts the transition is legal +
    // yields the canonical next state (the notify-caregivers / 14d-expiry
    // side-effects belong to the discovery + scheduler layers).
    const draft: Job = { origin: 'posted', state: 'draft' };
    const published = transitionJob(draft, { type: 'publish' });
    if (!published.ok) {
      return c.json({ error: 'invalid_job', reason: published.reason }, 400);
    }

    const rows: Insertable<JobsTable>[] = plan.posts.map((post) => ({
      origin: 'posted',
      state: published.next, // 'open'
      parent_uid: principal.uid,
      provider_id: null,
      category: post.category,
      description: post.description,
      awarded_at: null,
      schedule_kind: post.scheduleKind,
      slots: post.slots as { date: string; startMin: number; endMin: number }[],
      recurrence: post.recurrence
        ? { ...post.recurrence, weekdays: [...post.recurrence.weekdays] }
        : null,
      child_count: post.childCount,
      child_ages: post.childAges as number[],
      safety_behaviors: post.safetyBehaviors as string[],
      disclosure_consent_at: disclosureConsentAt,
      service_address_line1: post.serviceAddress.line1 ?? null,
      service_address_line2: post.serviceAddress.line2 ?? null,
      service_city: post.serviceAddress.city ?? null,
      service_state: post.serviceAddress.state ?? null,
      service_postal_code: post.serviceAddress.postalCode,
      budget_hint_cents: post.budgetHintCents,
      // The awardable-until instant (OH-223) — earliest scheduled service start.
      expires_at: jobExpiresAt(post),
      updated_at: now,
    }));

    const created = (await db
      .insertInto('jobs')
      .values(rows)
      .returning(JOB_COLUMNS)
      .execute()) as unknown as JobRow[];

    return c.json({ jobs: created.map(toJobDTO) }, 201);
  });

  // ── GET /v1/jobs — the Parent's My Jobs hub (OH-210) ────────────────────────
  app.openapi(listJobsRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;

    const rows = (await db
      .selectFrom('jobs')
      .select(JOB_COLUMNS)
      .where('parent_uid', '=', principal.uid)
      .where('origin', '=', 'posted')
      .orderBy('created_at', 'desc')
      .execute()) as unknown as JobRow[];

    const counts = await actionableCounts(db, rows.map((r) => r.id));
    const jobs = rows.map((r) => ({ ...toJobDTO(r), applicationCount: counts.get(r.id) ?? 0 }));
    return c.json({ jobs }, 200);
  });

  // ── GET /v1/jobs/{jobId} — Job detail (OH-210) ──────────────────────────────
  app.openapi(getJobRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { jobId } = c.req.valid('param');

    const row = await loadOwnedJob(db, jobId, principal.uid);
    if (!row) return c.json({ error: 'job_not_found' }, 404);

    const counts = await actionableCounts(db, [row.id]);
    return c.json({ ...toJobDTO(row), applicationCount: counts.get(row.id) ?? 0 }, 200);
  });

  // ── PATCH /v1/jobs/{jobId} — edit a still-open Job (OH-210) ──────────────────
  app.openapi(editJobRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { jobId } = c.req.valid('param');
    const input = c.req.valid('json');

    const row = await loadOwnedJob(db, jobId, principal.uid);
    if (!row) return c.json({ error: 'job_not_found' }, 404);
    // Editable only before any award (CONTEXT § Job — draft/open are pre-award;
    // drafts live client-side, so a persisted editable Job is `open`).
    if (row.state !== 'open' && row.state !== 'draft') {
      return c.json({ error: 'not_editable', reason: `a ${row.state} job cannot be edited` }, 409);
    }
    // Editing re-commits the Job → Parent-Subscription-gated (402), like publish.
    if (!(await parentEntitled(db, principal.uid))) {
      return c.json(
        { error: 'subscription_required', reason: 'an active Parent Subscription is required to edit a Job' },
        402,
      );
    }
    if (input.disclosureConsent !== true) {
      return c.json(
        { error: 'consent_required', reason: 'the Safety-Behaviors disclosure consent must be acknowledged' },
        400,
      );
    }
    // A multi-day schedule fans out into several Jobs (compose only) — it is not a
    // valid shape for editing ONE existing Job in place (ADR-0014 §A1).
    if (input.schedule.kind === 'multi-day') {
      return c.json(
        { error: 'invalid_schedule', reason: 'a multi-day schedule cannot be applied to a single Job (post separate Jobs)' },
        400,
      );
    }
    if (input.schedule.kind === 'recurring') {
      const expanded = expandRecurrence(input.schedule.rule);
      if (!expanded.ok || expanded.slots.length === 0) {
        return c.json({ error: 'invalid_schedule', reason: 'the recurrence generates no dates in its range' }, 400);
      }
    }

    const now = new Date();
    const disclosureConsentAt = now.toISOString();
    const composeInput: JobComposeInput = {
      category: input.category,
      description: input.description,
      childCount: input.childCount,
      childAges: input.childAges,
      safetyBehaviors: input.safetyBehaviors,
      serviceAddress: {
        line1: input.serviceAddress.line1 ?? null,
        line2: input.serviceAddress.line2 ?? null,
        city: input.serviceAddress.city ?? null,
        state: input.serviceAddress.state ?? null,
        postalCode: input.serviceAddress.postalCode,
      },
      budgetHintCents: input.budgetHintCents ?? null,
      disclosureConsentAt,
      schedule: input.schedule,
    };
    const plan = planJobPosts(composeInput);
    // A one-off single date + recurring both yield exactly one post; multi-day was
    // already rejected above, so `posts[0]` is the (only) revised spec.
    if (!plan.ok || plan.posts.length !== 1) {
      return c.json({ error: 'invalid_job', reason: plan.ok ? 'edit must resolve to a single Job' : plan.reason }, 400);
    }
    const post = plan.posts[0]!;

    const updated = (await db
      .updateTable('jobs')
      .set({
        category: post.category,
        description: post.description,
        schedule_kind: post.scheduleKind,
        slots: post.slots as { date: string; startMin: number; endMin: number }[],
        recurrence: post.recurrence
          ? { ...post.recurrence, weekdays: [...post.recurrence.weekdays] }
          : null,
        child_count: post.childCount,
        child_ages: post.childAges as number[],
        safety_behaviors: post.safetyBehaviors as string[],
        disclosure_consent_at: disclosureConsentAt,
        service_address_line1: post.serviceAddress.line1 ?? null,
        service_address_line2: post.serviceAddress.line2 ?? null,
        service_city: post.serviceAddress.city ?? null,
        service_state: post.serviceAddress.state ?? null,
        service_postal_code: post.serviceAddress.postalCode,
        budget_hint_cents: post.budgetHintCents,
        updated_at: now,
      })
      .where('id', '=', row.id)
      .returning(JOB_COLUMNS)
      .executeTakeFirstOrThrow()) as unknown as JobRow;

    const counts = await actionableCounts(db, [row.id]);
    return c.json({ ...toJobDTO(updated), applicationCount: counts.get(row.id) ?? 0 }, 200);
  });

  // ── POST /v1/jobs/{jobId}/close — close + withdraw Applications (OH-210) ─────
  app.openapi(closeJobRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { jobId } = c.req.valid('param');

    const row = await loadOwnedJob(db, jobId, principal.uid);
    if (!row) return c.json({ error: 'job_not_found' }, 404);

    // The Job state machine owns the legality (parent-cancel valid from draft/open).
    const res = transitionJob({ origin: 'posted', state: row.state }, { type: 'parent-cancel' });
    if (!res.ok) return c.json({ error: 'cannot_close', reason: res.reason }, 409);

    const now = new Date();
    const updated = await db.transaction().execute(async (trx) => {
      const job = (await trx
        .updateTable('jobs')
        .set({ state: res.next, updated_at: now }) // 'cancelled'
        .where('id', '=', row.id)
        .returning(JOB_COLUMNS)
        .executeTakeFirstOrThrow()) as unknown as JobRow;

      // Withdraw every still-open Application (mark-applications-expired side
      // effect; story 92). Terminal Applications are untouched. Applicant
      // notifications are a deferred hole (no `application_declined` kind yet).
      await trx
        .updateTable('applications')
        .set({ state: 'expired', updated_at: now })
        .where('job_id', '=', row.id)
        .where('state', 'in', ['submitted', 'countered'])
        .execute();

      return job;
    });

    // All open Applications were just withdrawn, so the actionable count is 0.
    return c.json({ ...toJobDTO(updated), applicationCount: 0 }, 200);
  });

  // ── POST /v1/jobs/{jobId}/dispute ───────────────────────────────────────────
  app.openapi(disputeJobRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { jobId } = c.req.valid('param');
    const { reason, details } = c.req.valid('json');

    const row = await loadOwnedJob(db, jobId, principal.uid);
    if (!row) return c.json({ error: 'job_not_found' }, 404);

    // A Job carries no on-platform money — the dispute is an admin-escalation
    // record only (never a money movement). Idempotent per open dispute.
    await db.transaction().execute(async (trx) => {
      await insertDisputeRecord(trx, {
        subjectType: 'job',
        subjectId: row.id,
        filedByUid: principal.uid,
        reason,
        details,
        inWindow: false,
        holdApplied: false,
      });
    });

    return c.json({ jobId: row.id, escalation: true as const }, 200);
  });
}
