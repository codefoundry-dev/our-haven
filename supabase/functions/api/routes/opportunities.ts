import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import type { Insertable } from 'kysely';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
import type {
  ApplicationsTable,
  MessageThreadsTable,
  OffersTable,
} from '../../../../apps/backend/src/db/schema.ts';
import { areaLabelForZip, resolveZipCentroid } from '../geo/zip-centroids.ts';
// Cross-tree, Deno-clean domain/shared modules (ADR-0019; the explicit-`.ts`
// pattern search.ts / caregiver-profile.ts use). Each carries NO runtime
// `@our-haven/*` import, so it deploys unchanged on Deno:
//   - search (haversine crow-flies distance kernel + GeoPoint),
//   - search-ranking (the proximity/recency component scorers — the jobs feed
//     reuses two of the three hybrid terms; a Job has no rating term),
//   - application-quota (the 30/mo cap math — cap + period key),
//   - application-lifecycle (`countsAgainstJobCap` for the applicant count).
import { haversineMiles, type GeoPoint } from '../../../../packages/domain/src/search/index.ts';
import {
  DEFAULT_SEARCH_RADIUS_MILES,
  proximityScore,
  recencyScore,
} from '../../../../packages/domain/src/search-ranking/index.ts';
import {
  effectiveCap,
  periodKey,
  type CaregiverApplicationCounter,
} from '../../../../packages/domain/src/application-quota/index.ts';
import {
  countsAgainstJobCap,
  initialApplicationState,
  transitionApplication,
  type ApplicationState,
} from '../../../../packages/domain/src/application-lifecycle/index.ts';
// The first Offer reuses the offers-route compose recipe (OH-206): the Deno-clean
// Pricing leaf for `computed_total` + the OH-180 disintermediation detector for
// the free-text `scope_note`/`proposal` + the 72h default validity helper.
import { defaultValidUntil } from '../../../../packages/domain/src/offer-lifecycle/index.ts';
import { scanScopeNote } from '../../../../packages/domain/src/disintermediation/index.ts';
import { calculatePricing } from '../../../../packages/domain/src/pricing/index.ts';
import {
  CAREGIVER_CATEGORIES,
  isCaregiverCategory,
} from '../../../../packages/shared/src/provider-taxonomy.ts';
import { SAFETY_BEHAVIORS } from '../../../../packages/shared/src/safety-behaviors.ts';

/**
 * Caregiver Opportunities (OH-218) — CONTEXT.md § Job / § Application; PRD-0001
 * v1.7 stories 95, 96, 122; ADR-0014 (concrete schedule), ADR-0015/ADR-0016
 * (disclose-or-none child bundle), ADR-0011 (Caregiver-only Applications).
 *
 *   GET  /v1/opportunities                    open posted Jobs across MY categories (feed)
 *   GET  /v1/opportunities/{jobId}            one Job's detail (in-category or applied-to)
 *   POST /v1/opportunities/{jobId}/apply      file an Application + first Offer (OH-219)
 *   POST /v1/opportunities/{jobId}/withdraw   withdraw my Application before award/decline (OH-219)
 *   GET  /v1/applications                     MY Applications (date-groupable) + N/30 quota
 *
 * The Caregiver-facing READ side of the Posted-Job chain — the mirror of the
 * Parent's My Jobs hub (routes/jobs.ts). A verified in-category Caregiver browses
 * the open Jobs whose Category is one they offer (`providers.categories`), ranked
 * by recency + distance, filterable by one-off/recurring + a single Category. The
 * feed and the Job detail carry the disclosed child bundle (count + ages + the
 * Parent-disclosed Safety-Behaviors subset) and an APPROXIMATE distance from the
 * Caregiver's ZIP — but never the street: the exact address is reveal-at-accept
 * (enforced at the Offer/Booking layer, OH-206/207 `revealExact`), and a
 * Caregiver never reaches an accepted state within this read surface, so `line1`/
 * `line2` are simply never projected here.
 *
 * APPLY / WITHDRAW (OH-219): filing an Application atomically creates the
 * `applications` row (`submitted`) + a companion job-anchored `message_threads`
 * row + the Caregiver's first `offers` row (`pending`, job-anchored) — the exact
 * read shape routes/applications.ts (OH-210) awards against. Filing is gated on
 * Verification cleared (`screening_passed_at`), the per-Job 15-cap, the 30/month
 * cap, and one-Application-per-Job (unique index). The free-text `proposal` +
 * Offer `scope_note` are redacted at write (T&S queue via `message_flags`). No
 * 402 — an Application/Offer is Caregiver-sent (only Parent sends are gated).
 * Withdraw runs the `caregiver-withdraw` transition (submitted/countered →
 * withdrawn), sealing the live pending Offer; it frees a per-Job cap slot but does
 * NOT refund the monthly allowance (CONTEXT: filing "consumes" one).
 *
 * The quota `used` is DERIVED (a COUNT of this-month Applications) rather than a
 * persisted counter; an admin cap override (application-quota `applyAdminOverride`)
 * has no storage yet, so `adminOverrideCap` is null. Cap enforcement is
 * best-effort under concurrency (the reads precede the insert); the one-per-Job
 * unique index is the only hard guarantee.
 *
 * RANKING: `0.6·proximity + 0.4·recency` over the survivors (a Job has no rating
 * term, so the OH-180 hybrid's third weight is dropped and the remaining two are
 * renormalised). Proximity reuses `proximityScore` (1 at the Caregiver's ZIP,
 * linearly to 0 at the radius) and recency reuses `recencyScore` (1 fresh, 0 at
 * 7 days). Like Search (routes/search.ts), an unresolved ZIP degrades gracefully:
 * distance is treated as 0 for the proximity term (neutral-to-favourable) but the
 * DISPLAYED `distanceMiles` stays null unless BOTH ZIPs resolve to a centroid.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('OpportunityError');

const CategoryEnum = z.enum(CAREGIVER_CATEGORIES);
const SafetyBehaviorEnum = z.enum(SAFETY_BEHAVIORS);
const ScheduleKindEnum = z.enum(['one-off', 'recurring']);
const JobStateEnum = z.enum(['draft', 'open', 'awarded', 'expired', 'cancelled', 'closed']);
const ApplicationStateEnum = z.enum([
  'submitted',
  'countered',
  'awarded',
  'declined',
  'withdrawn',
  'expired',
]);

/** Recency + distance ranking weights (renormalised OH-180 hybrid, no rating term). */
const OPPORTUNITY_WEIGHTS = { proximity: 0.6, recency: 0.4 } as const;

/**
 * The per-Job Application cap (ADR-0006 §7; CONTEXT § Job) — a Job stops accepting
 * Applications at 15 (Parent UX protection). `countsAgainstJobCap` selects which
 * Application states count toward it (submitted + countered; a withdrawn one frees
 * a slot). Mirrors the mobile feed's `JOB_APPLICATION_CAP`.
 */
const JOB_APPLICATION_CAP = 15;

/* ── request/response schemas ─────────────────────────────────────────────────── */

const OpportunityQuery = z.object({
  category: z.string().optional().openapi({
    param: { name: 'category', in: 'query' },
    description:
      'Restrict the feed to a single Caregiver Category (babysitter|tutor|nanny). Must be one the Caregiver offers, else the feed is empty. Omit to span all of the Caregiver\'s categories.',
  }),
  schedule: ScheduleKindEnum.optional().openapi({
    param: { name: 'schedule', in: 'query' },
    description: 'Filter by schedule kind — one-off or recurring. Omit for both.',
  }),
  radiusMiles: z.coerce.number().positive().max(500).optional().openapi({
    param: { name: 'radiusMiles', in: 'query' },
    description: `Optional hard distance cut in miles (also the proximity normalisation radius; default ${DEFAULT_SEARCH_RADIUS_MILES}). Applied only to Jobs whose ZIP resolves to a centroid.`,
  }),
  limit: z.coerce.number().int().min(1).max(100).default(60).openapi({
    param: { name: 'limit', in: 'query' },
    description: 'Max results (the top-ranked page). Default 60.',
  }),
});

const JobIdParam = z.object({
  jobId: z.string().uuid().openapi({ param: { name: 'jobId', in: 'path' } }),
});

/**
 * The Application composer body (OH-219; PRD story 98). A free-text `proposal`
 * (pitch) + the first Offer's terms. `proposedRateCents` is optional — it defaults
 * to the Caregiver's published per-category Rate, and is IGNORED (locked to
 * published) when the Caregiver is non-negotiable (ADR-0017). `scopeNote` is the
 * Offer's optional ≤280-char note. The schedule + child bundle are the Job's (the
 * Parent set them at compose) — the Caregiver only proposes a rate + prose.
 */
const ApplyRequest = z
  .object({
    proposal: z.string().min(1).max(2000),
    proposedRateCents: z.number().int().min(0).max(100_000_000).optional(),
    scopeNote: z.string().max(280).optional(),
  })
  .openapi('ApplyToJobRequest');

/** A concrete session slot (minutes-from-midnight window on a calendar day). */
const SlotSchema = z
  .object({
    date: z.string(),
    startMin: z.number().int(),
    endMin: z.number().int(),
  })
  .openapi('OpportunitySlot');

/** An anchored weekly recurrence rule (ADR-0014 §4). `weekdays` 0=Sun..6=Sat. */
const RecurrenceSchema = z
  .object({
    startDate: z.string(),
    endDate: z.string(),
    weekdays: z.array(z.number().int()),
    startMin: z.number().int(),
    endMin: z.number().int(),
  })
  .openapi('OpportunityRecurrence');

/**
 * The Job's location as shown to a browsing Caregiver — coarse area + APPROXIMATE
 * crow-flies distance from the Caregiver's ZIP. Deliberately carries NO street
 * (`line1`/`line2`): the exact address is reveal-at-accept (OH-206/207). City /
 * state / ZIP mirror what the Offer bubble already shows a Caregiver pre-accept.
 */
const OpportunityLocation = z
  .object({
    city: z.string().nullable(),
    state: z.string().nullable(),
    postalCode: z.string().nullable(),
    /** Coarse area label ("City, ST"), or null when the ZIP doesn't resolve. */
    areaLabel: z.string().nullable(),
    /** Crow-flies miles from the Caregiver's ZIP, or null when distance is unknown. */
    distanceMiles: z.number().nullable(),
  })
  .openapi('OpportunityLocation');

const OpportunitySchema = z
  .object({
    id: z.string(),
    category: CategoryEnum,
    description: z.string(),
    scheduleKind: ScheduleKindEnum.nullable(),
    slots: z.array(SlotSchema),
    recurrence: RecurrenceSchema.nullable(),
    childCount: z.number().int().nullable(),
    childAges: z.array(z.number().int()),
    /** The Parent-disclosed Safety-Behaviors subset ([] = disclosed none). */
    safetyBehaviors: z.array(SafetyBehaviorEnum),
    budgetHintCents: z.number().int().nullable(),
    location: OpportunityLocation,
    /** Actionable Applications already on this Job (submitted + countered) — competition. */
    applicantCount: z.number().int(),
    /** The Caregiver's own Application state on this Job, or null if not applied. */
    myApplicationState: ApplicationStateEnum.nullable(),
    createdAt: z.string(),
  })
  .openapi('Opportunity');

const OpportunityListResponse = z
  .object({ jobs: z.array(OpportunitySchema) })
  .openapi('OpportunityList');

/** The Job summary carried alongside one of the Caregiver's own Applications. */
const ApplicationJobSummary = z
  .object({
    id: z.string(),
    category: CategoryEnum,
    description: z.string(),
    state: JobStateEnum,
    scheduleKind: ScheduleKindEnum.nullable(),
    slots: z.array(SlotSchema),
    recurrence: RecurrenceSchema.nullable(),
    childCount: z.number().int().nullable(),
    childAges: z.array(z.number().int()),
    location: OpportunityLocation,
    budgetHintCents: z.number().int().nullable(),
  })
  .openapi('MyApplicationJob');

const ApplicationListItem = z
  .object({
    id: z.string(),
    state: ApplicationStateEnum,
    origin: z.enum(['posted', 'direct-message']),
    proposal: z.string().nullable(),
    acceptedOfferId: z.string().nullable(),
    awardedAt: z.string().nullable(),
    createdAt: z.string(),
    job: ApplicationJobSummary,
  })
  .openapi('MyApplicationItem');

/** The Caregiver's monthly Application quota (ADR-0006 §7; Caregiver-only ADR-0011). */
const QuotaSchema = z
  .object({
    /** Applications filed in the current calendar month (UTC). */
    used: z.number().int(),
    /** Effective monthly cap (default 30; an admin override would raise it — OH-219). */
    cap: z.number().int(),
    /** Applications the Caregiver may still file this month (never negative). */
    remaining: z.number().int(),
    /** The YYYY-MM period this count applies to. */
    periodYearMonth: z.string(),
  })
  .openapi('MyApplicationQuota');

const ApplicationListResponse = z
  .object({
    applications: z.array(ApplicationListItem),
    quota: QuotaSchema,
  })
  .openapi('MyApplicationList');

/* ── row shapes ───────────────────────────────────────────────────────────────── */

interface OpportunityRow {
  id: string;
  category: 'babysitter' | 'tutor' | 'nanny';
  description: string;
  state: 'draft' | 'open' | 'awarded' | 'expired' | 'cancelled' | 'closed';
  schedule_kind: 'one-off' | 'recurring' | null;
  slots: { date: string; startMin: number; endMin: number }[] | null;
  recurrence: z.infer<typeof RecurrenceSchema> | null;
  child_count: number | null;
  child_ages: number[] | null;
  safety_behaviors: string[] | null;
  budget_hint_cents: number | null;
  service_city: string | null;
  service_state: string | null;
  service_postal_code: string | null;
  created_at: Date | string;
}

interface ApplicationRow {
  id: string;
  job_id: string;
  provider_id: string;
  origin: 'posted' | 'direct-message';
  state: ApplicationState;
  accepted_offer_id: string | null;
  proposal: string | null;
  awarded_at: Date | string | null;
  created_at: Date | string;
}

interface ProviderRow {
  id: string;
  categories: string[] | null;
}

/** The Job columns the Caregiver read surface projects (no street columns). */
const OPPORTUNITY_COLUMNS = [
  'id',
  'category',
  'description',
  'state',
  'schedule_kind',
  'slots',
  'recurrence',
  'child_count',
  'child_ages',
  'safety_behaviors',
  'budget_hint_cents',
  'service_city',
  'service_state',
  'service_postal_code',
  'created_at',
] as const;

/* ── helpers ──────────────────────────────────────────────────────────────────── */

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The caller's supply row (id + offered categories). Null when unclaimed. */
async function loadProviderByUid(db: Db, uid: string): Promise<ProviderRow | null> {
  const row = (await db
    .selectFrom('providers')
    .select(['id', 'categories'])
    .where('uid', '=', uid)
    .executeTakeFirst()) as ProviderRow | undefined;
  return row ?? null;
}

/** Resolve the Caregiver's own ZIP centroid (the distance origin), or null. */
async function loadCaregiverPoint(db: Db, providerId: string): Promise<GeoPoint | null> {
  const prof = (await db
    .selectFrom('provider_profiles')
    .select(['zip'])
    .where('provider_id', '=', providerId)
    .executeTakeFirst()) as { zip: string | null } | undefined;
  return resolveZipCentroid(prof?.zip ?? null);
}

/**
 * The applicant count (actionable: submitted + countered) per Job AND the
 * caller's own Application state per Job — one query over the feed's Job ids.
 */
async function loadApplicationFacts(
  db: Db,
  jobIds: readonly string[],
  myProviderId: string,
): Promise<{ applicantCount: Map<string, number>; myState: Map<string, ApplicationState> }> {
  const applicantCount = new Map<string, number>();
  const myState = new Map<string, ApplicationState>();
  if (jobIds.length === 0) return { applicantCount, myState };
  const rows = (await db
    .selectFrom('applications')
    .select(['job_id', 'provider_id', 'state'])
    .where('job_id', 'in', jobIds as string[])
    .execute()) as { job_id: string; provider_id: string; state: ApplicationState }[];
  for (const r of rows) {
    if (countsAgainstJobCap(r.state)) {
      applicantCount.set(r.job_id, (applicantCount.get(r.job_id) ?? 0) + 1);
    }
    if (r.provider_id === myProviderId) myState.set(r.job_id, r.state);
  }
  return { applicantCount, myState };
}

/** Project a Job row's location for a browsing Caregiver (approx distance, no street). */
function toLocation(row: OpportunityRow, caregiverPoint: GeoPoint | null): z.infer<typeof OpportunityLocation> {
  const jobPoint = resolveZipCentroid(row.service_postal_code);
  const distanceMiles =
    caregiverPoint && jobPoint ? round1(haversineMiles(caregiverPoint, jobPoint)) : null;
  return {
    city: row.service_city,
    state: row.service_state,
    postalCode: row.service_postal_code,
    areaLabel: areaLabelForZip(row.service_postal_code),
    distanceMiles,
  };
}

function toOpportunityDTO(
  row: OpportunityRow,
  caregiverPoint: GeoPoint | null,
  applicantCount: number,
  myApplicationState: ApplicationState | null,
): z.infer<typeof OpportunitySchema> {
  return {
    id: row.id,
    category: row.category,
    description: row.description,
    scheduleKind: row.schedule_kind,
    slots: row.slots ?? [],
    recurrence: row.recurrence,
    childCount: row.child_count,
    childAges: row.child_ages ?? [],
    // Values are taxonomy-validated on the Parent write path (compose disclosure);
    // narrow the raw string[] at the boundary (mirrors search.ts's enum'd facets).
    safetyBehaviors: (row.safety_behaviors ?? []) as z.infer<typeof SafetyBehaviorEnum>[],
    budgetHintCents: row.budget_hint_cents,
    location: toLocation(row, caregiverPoint),
    applicantCount,
    myApplicationState,
    createdAt: toIso(row.created_at),
  };
}

function toJobSummaryDTO(
  row: OpportunityRow,
  caregiverPoint: GeoPoint | null,
): z.infer<typeof ApplicationJobSummary> {
  return {
    id: row.id,
    category: row.category,
    description: row.description,
    state: row.state,
    scheduleKind: row.schedule_kind,
    slots: row.slots ?? [],
    recurrence: row.recurrence,
    childCount: row.child_count,
    childAges: row.child_ages ?? [],
    location: toLocation(row, caregiverPoint),
    budgetHintCents: row.budget_hint_cents,
  };
}

/**
 * Recency + distance score for one Job. Mirrors Search's graceful ZIP
 * degradation: an unresolved ZIP → distance 0 for the proximity term (the
 * DISPLAYED distance stays null). `radiusMiles` normalises the proximity term.
 */
function scoreOpportunity(
  row: OpportunityRow,
  caregiverPoint: GeoPoint | null,
  now: Date,
  radiusMiles: number,
): number {
  const jobPoint = resolveZipCentroid(row.service_postal_code);
  const distanceMiles = caregiverPoint && jobPoint ? haversineMiles(caregiverPoint, jobPoint) : 0;
  const proximity = proximityScore(distanceMiles, radiusMiles);
  const recency = recencyScore(toDate(row.created_at), now);
  return OPPORTUNITY_WEIGHTS.proximity * proximity + OPPORTUNITY_WEIGHTS.recency * recency;
}

/* ── apply/withdraw helpers (OH-219) ──────────────────────────────────────────── */

/** The Job columns the apply handler reads — the read-surface projection plus the
 *  owning Parent + origin (needed for the companion thread + posted-Job guard). */
const APPLY_JOB_COLUMNS = [...OPPORTUNITY_COLUMNS, 'parent_uid', 'origin'] as const;

type ApplyJobRow = OpportunityRow & { parent_uid: string; origin: 'posted' | 'direct-message' };

interface RateSnapshot {
  publishedRateCents: number;
  perChildSurchargeCents: number;
  negotiable: boolean;
}

/**
 * The Caregiver's snapshot inputs for a category: published Rate + per-child
 * surcharge (Tutor → 0) + the person-level `negotiable` flag. Null when the
 * Caregiver has not published a Rate for the category (mirrors offers.ts
 * `loadRateSnapshot` — the same compose input the first Offer needs).
 */
async function loadRateSnapshot(
  db: Db,
  providerId: string,
  category: 'babysitter' | 'tutor' | 'nanny',
): Promise<RateSnapshot | null> {
  const [rate, profile] = await Promise.all([
    db
      .selectFrom('provider_category_rates')
      .select(['published_rate_cents', 'per_child_surcharge_cents'])
      .where('provider_id', '=', providerId)
      .where('category', '=', category)
      .executeTakeFirst() as Promise<
      { published_rate_cents: number; per_child_surcharge_cents: number | null } | undefined
    >,
    db
      .selectFrom('provider_profiles')
      .select(['negotiable'])
      .where('provider_id', '=', providerId)
      .executeTakeFirst() as Promise<{ negotiable: boolean | null } | undefined>,
  ]);
  if (!rate) return null;
  return {
    publishedRateCents: rate.published_rate_cents,
    perChildSurchargeCents: category === 'tutor' ? 0 : (rate.per_child_surcharge_cents ?? 0),
    negotiable: profile?.negotiable ?? true,
  };
}

/** computed_total via the Pricing leaf — the pre-commission parent charge (the same
 *  six-line passthrough offers.ts `computeTotalCents` uses; commissionBp 0). */
function computeTotalCents(args: {
  proposedRateCents: number;
  scopeMinutes: number;
  childCount: number;
  perChildSurchargeCents: number;
  category: 'babysitter' | 'tutor' | 'nanny';
}): number {
  return calculatePricing({
    agreedRateCents: args.proposedRateCents,
    hours: args.scopeMinutes / 60,
    childCount: args.childCount,
    perChildSurchargeCents: args.perChildSurchargeCents,
    commissionBp: 0,
    category: args.category,
  }).parentChargeCents;
}

/**
 * The first Offer's schedule snapshot, mirrored from the Job (parent-authoritative:
 * the OH-210 award materialises Bookings from the JOB schedule, not the Offer). A
 * one-off Job's slot(s) → `scopeMinutes` = summed window; a recurring Job → one
 * occurrence's window (the per-session snapshot the Offer bubble shows).
 */
function offerScheduleFromJob(job: ApplyJobRow): {
  scheduleKind: 'one-off' | 'recurring';
  slots: { date: string; startMin: number; endMin: number }[];
  recurrence: z.infer<typeof RecurrenceSchema> | null;
  scopeMinutes: number;
} {
  if (job.schedule_kind === 'recurring') {
    const r = job.recurrence;
    return {
      scheduleKind: 'recurring',
      slots: [],
      recurrence: r,
      scopeMinutes: r ? Math.max(0, r.endMin - r.startMin) : 0,
    };
  }
  const slots = job.slots ?? [];
  const scopeMinutes = slots.reduce((sum, s) => sum + Math.max(0, s.endMin - s.startMin), 0);
  return { scheduleKind: 'one-off', slots, recurrence: null, scopeMinutes };
}

/**
 * The Caregiver's Verification gate — filing an Application requires `cleared`
 * (CONTEXT § Application). Cleared = Checkr screening passed AND not terminated,
 * the same predicate caregiver-connect.ts gates payout onboarding on and
 * applications.ts surfaces as `backgroundChecked`.
 */
async function loadCaregiverCleared(db: Db, providerId: string): Promise<boolean> {
  const v = (await db
    .selectFrom('provider_verifications')
    .select(['screening_passed_at', 'rejected_at'])
    .where('provider_id', '=', providerId)
    .executeTakeFirst()) as
    | { screening_passed_at: Date | string | null; rejected_at: Date | string | null }
    | undefined;
  return v?.screening_passed_at != null && v.rejected_at == null;
}

/** Project a persisted Application row + its Job into the My-Applications item DTO. */
function toApplicationItem(
  app: Pick<
    ApplicationRow,
    'id' | 'state' | 'origin' | 'proposal' | 'accepted_offer_id' | 'awarded_at' | 'created_at'
  >,
  job: OpportunityRow,
  caregiverPoint: GeoPoint | null,
): z.infer<typeof ApplicationListItem> {
  return {
    id: app.id,
    state: app.state,
    origin: app.origin,
    proposal: app.proposal,
    acceptedOfferId: app.accepted_offer_id,
    awardedAt: app.awarded_at ? toIso(app.awarded_at) : null,
    createdAt: toIso(app.created_at),
    job: toJobSummaryDTO(job, caregiverPoint),
  };
}

/* ── route definitions ────────────────────────────────────────────────────────── */

const listOpportunitiesRoute = createRoute({
  method: 'get',
  path: '/opportunities',
  tags: ['opportunities'],
  summary: 'Open posted Jobs across my categories (Opportunities feed) — OH-218',
  description:
    "Returns the open posted Jobs whose Category is one the authenticated Caregiver offers, ranked by recency + distance (from the Caregiver's ZIP), filterable by one-off/recurring and a single Category. Each carries the disclosed child bundle + an approximate distance; the exact street address is never included (reveal-at-accept). 404 when the caller has not claimed a supply role.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { query: OpportunityQuery },
  responses: {
    200: { description: 'The ranked Opportunities feed', content: json(OpportunityListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (parent / provider / admin)', content: json(ErrorResponse) },
    404: { description: 'Supply (caregiver) row not found', content: json(ErrorResponse) },
  },
});

const getOpportunityRoute = createRoute({
  method: 'get',
  path: '/opportunities/{jobId}',
  tags: ['opportunities'],
  summary: 'One open Job\'s detail — OH-218',
  description:
    "Returns one posted Job's detail for a browsing Caregiver — the disclosed child bundle (count + ages + Safety-Behaviors subset), schedule, budget hint, and approximate distance. The exact street is never included. 404 unless the Job is a posted Job in one of the Caregiver's categories OR one they have applied to.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { params: JobIdParam },
  responses: {
    200: { description: 'The Job detail', content: json(OpportunitySchema) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Job not found (or not visible to this Caregiver)', content: json(ErrorResponse) },
  },
});

const listApplicationsRoute = createRoute({
  method: 'get',
  path: '/applications',
  tags: ['opportunities'],
  summary: 'My Applications + monthly quota — OH-218',
  description:
    "Returns the authenticated Caregiver's own posted-Job Applications (newest first; the client date-groups), each with a Job summary, plus the monthly Application quota (used / cap / remaining for this calendar month). The quota `used` is derived from a COUNT of this month's Applications; OH-219 owns the authoritative counter + enforcement.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  responses: {
    200: { description: 'My Applications + quota', content: json(ApplicationListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Supply (caregiver) row not found', content: json(ErrorResponse) },
  },
});

const applyRoute = createRoute({
  method: 'post',
  path: '/opportunities/{jobId}/apply',
  tags: ['opportunities'],
  summary: 'File an Application + first Offer on an open Job — OH-219',
  description:
    "The authenticated Caregiver files an Application on an open posted Job in one of their categories: a free-text proposal + a first caregiver Offer (rate defaults to the published per-category Rate; locked to it when non-negotiable — ADR-0017). Atomically creates the Application (`submitted`), a companion job-anchored thread, and the first Offer (`pending`). Gated on Verification `cleared` (403), the per-Job 15-cap + the 30/month cap (409), and one Application per Job (409 on a repeat). The proposal + Offer note are redacted at write. Never Subscription-gated (Caregiver-sent).",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { params: JobIdParam, body: { content: json(ApplyRequest), required: true } },
  responses: {
    201: { description: 'The filed Application', content: json(ApplicationListItem) },
    400: { description: 'Invalid body / the Job schedule has no billable time', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role, or Verification not cleared', content: json(ErrorResponse) },
    404: { description: 'Supply row / Job not found (or not in one of your categories)', content: json(ErrorResponse) },
    409: {
      description: 'Job not open, already applied, a cap was reached, or no published Rate',
      content: json(ErrorResponse),
    },
  },
});

const withdrawApplicationRoute = createRoute({
  method: 'post',
  path: '/opportunities/{jobId}/withdraw',
  tags: ['opportunities'],
  summary: 'Withdraw my Application on a Job — OH-219',
  description:
    "The Caregiver withdraws their own still-open Application (submitted / countered → withdrawn) before the Parent awards or declines, sealing the live pending Offer. Frees a per-Job 15-cap slot; does NOT refund the monthly allowance (filing consumes one). 409 if the Application is already terminal (awarded / declined / withdrawn / expired).",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { params: JobIdParam },
  responses: {
    200: { description: 'The withdrawn Application', content: json(ApplicationListItem) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Supply row / Application not found', content: json(ErrorResponse) },
    409: { description: 'Application is no longer withdrawable (terminal state)', content: json(ErrorResponse) },
  },
});

/* ── handlers ─────────────────────────────────────────────────────────────────── */

export function registerOpportunityRoutes(app: OpenAPIHono<AppEnv>): void {
  // ── GET /v1/opportunities — the Opportunities feed ──────────────────────────
  app.openapi(listOpportunitiesRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const q = c.req.valid('query');

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) {
      return c.json(
        { error: 'provider_not_found', reason: 'claim a supply role first (POST /v1/auth/role-claim)' },
        404,
      );
    }

    // The categories the Caregiver offers bound the feed. An explicit `category`
    // filter narrows to one — but only if it is one of theirs (else empty feed).
    const myCategories = (provider.categories ?? []).filter(isCaregiverCategory);
    let categories = myCategories;
    if (q.category !== undefined) {
      const wanted = q.category;
      categories = isCaregiverCategory(wanted) && myCategories.includes(wanted) ? [wanted] : [];
    }
    if (categories.length === 0) return c.json({ jobs: [] }, 200);

    const caregiverPoint = await loadCaregiverPoint(db, provider.id);

    let query = db
      .selectFrom('jobs')
      .select(OPPORTUNITY_COLUMNS)
      .where('state', '=', 'open')
      .where('origin', '=', 'posted')
      .where('category', 'in', categories as ('babysitter' | 'tutor' | 'nanny')[]);
    if (q.schedule !== undefined) query = query.where('schedule_kind', '=', q.schedule);
    const rows = (await query.orderBy('created_at', 'desc').execute()) as unknown as OpportunityRow[];

    if (rows.length === 0) return c.json({ jobs: [] }, 200);

    // Rank recency + distance over the survivors, then take the top page. The SQL
    // pre-sort (created_at desc) is the stable tie-break for equal scores.
    const now = new Date();
    const radiusMiles = q.radiusMiles ?? DEFAULT_SEARCH_RADIUS_MILES;
    const ranked = rows
      .map((row, index) => ({ row, index, score: scoreOpportunity(row, caregiverPoint, now, radiusMiles) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((x) => x.row);

    // Optional hard radius cut — only for Jobs whose ZIP resolves (parity with
    // Search: an unresolved ZIP is never distance-filtered out).
    const withinRadius =
      q.radiusMiles !== undefined && caregiverPoint
        ? ranked.filter((row) => {
            const jobPoint = resolveZipCentroid(row.service_postal_code);
            if (!jobPoint) return true;
            return haversineMiles(caregiverPoint, jobPoint) <= radiusMiles;
          })
        : ranked;

    const page = withinRadius.slice(0, q.limit);
    const { applicantCount, myState } = await loadApplicationFacts(
      db,
      page.map((r) => r.id),
      provider.id,
    );
    const jobs = page.map((row) =>
      toOpportunityDTO(row, caregiverPoint, applicantCount.get(row.id) ?? 0, myState.get(row.id) ?? null),
    );
    return c.json({ jobs }, 200);
  });

  // ── GET /v1/opportunities/{jobId} — Job detail ──────────────────────────────
  app.openapi(getOpportunityRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { jobId } = c.req.valid('param');

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    const row = (await db
      .selectFrom('jobs')
      .select([...OPPORTUNITY_COLUMNS, 'origin'])
      .where('id', '=', jobId)
      .executeTakeFirst()) as (OpportunityRow & { origin: 'posted' | 'direct-message' }) | undefined;
    // Only posted Jobs surface to a Caregiver (Direct-Message Jobs are plumbing).
    if (!row || row.origin !== 'posted') return c.json({ error: 'job_not_found' }, 404);

    const { applicantCount, myState } = await loadApplicationFacts(db, [row.id], provider.id);
    // Visible iff the Job is in one of the Caregiver's categories OR they have
    // applied to it (My Applications tap-through) — never cross-category probing.
    const myCategories = (provider.categories ?? []).filter(isCaregiverCategory);
    const inCategory = myCategories.includes(row.category);
    const hasApplied = myState.has(row.id);
    if (!inCategory && !hasApplied) return c.json({ error: 'job_not_found' }, 404);

    const caregiverPoint = await loadCaregiverPoint(db, provider.id);
    return c.json(
      toOpportunityDTO(row, caregiverPoint, applicantCount.get(row.id) ?? 0, myState.get(row.id) ?? null),
      200,
    );
  });

  // ── GET /v1/applications — My Applications + quota ──────────────────────────
  app.openapi(listApplicationsRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    const appRows = (await db
      .selectFrom('applications')
      .select([
        'id',
        'job_id',
        'provider_id',
        'origin',
        'state',
        'accepted_offer_id',
        'proposal',
        'awarded_at',
        'created_at',
      ])
      .where('provider_id', '=', provider.id)
      .where('origin', '=', 'posted')
      .orderBy('created_at', 'desc')
      .execute()) as unknown as ApplicationRow[];

    // Join each Application to its Job summary (one query for all referenced Jobs).
    const jobIds = [...new Set(appRows.map((r) => r.job_id))];
    const jobRows =
      jobIds.length > 0
        ? ((await db
            .selectFrom('jobs')
            .select(OPPORTUNITY_COLUMNS)
            .where('id', 'in', jobIds)
            .execute()) as unknown as OpportunityRow[])
        : [];
    const jobById = new Map(jobRows.map((r) => [r.id, r]));
    const caregiverPoint = await loadCaregiverPoint(db, provider.id);

    const applications = appRows
      .map((a) => {
        const job = jobById.get(a.job_id);
        if (!job) return null; // orphaned reference — skip defensively
        return {
          id: a.id,
          state: a.state,
          origin: a.origin,
          proposal: a.proposal,
          acceptedOfferId: a.accepted_offer_id,
          awardedAt: a.awarded_at ? toIso(a.awarded_at) : null,
          createdAt: toIso(a.created_at),
          job: toJobSummaryDTO(job, caregiverPoint),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // Quota (derived): count THIS month's Applications (UTC calendar month). The
    // cap comes from the pure quota module (default 30; an admin override raises
    // it — OH-219). remaining is clamped ≥ 0.
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const used = appRows.filter((a) => toDate(a.created_at) >= monthStart).length;
    const counter: CaregiverApplicationCounter = {
      count: used,
      periodYearMonth: periodKey(now),
      adminOverrideCap: null,
    };
    const cap = effectiveCap(counter); // DEFAULT_MONTHLY_APPLICATION_CAP unless overridden
    const quota = {
      used,
      cap,
      remaining: Math.max(0, cap - used),
      periodYearMonth: counter.periodYearMonth,
    };

    return c.json({ applications, quota }, 200);
  });

  // ── POST /v1/opportunities/{jobId}/apply — file an Application + first Offer ──
  app.openapi(applyRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { jobId } = c.req.valid('param');
    const input = c.req.valid('json');

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) {
      return c.json(
        { error: 'provider_not_found', reason: 'claim a supply role first (POST /v1/auth/role-claim)' },
        404,
      );
    }

    // Filing requires Verification `cleared` (CONTEXT § Application).
    if (!(await loadCaregiverCleared(db, provider.id))) {
      return c.json(
        { error: 'verification_not_cleared', reason: 'your background check must clear before you can apply' },
        403,
      );
    }

    // Only an OPEN posted Job in one of the Caregiver's categories is applicable.
    const job = (await db
      .selectFrom('jobs')
      .select(APPLY_JOB_COLUMNS)
      .where('id', '=', jobId)
      .executeTakeFirst()) as unknown as ApplyJobRow | undefined;
    if (!job || job.origin !== 'posted') return c.json({ error: 'job_not_found' }, 404);
    const myCategories = (provider.categories ?? []).filter(isCaregiverCategory);
    if (!myCategories.includes(job.category)) return c.json({ error: 'job_not_found' }, 404);
    if (job.state !== 'open') {
      return c.json({ error: 'job_not_open', reason: `this job is ${job.state}, not open` }, 409);
    }

    // The Offer's child bundle mirrors the Job's (the Offer CHECK requires
    // cardinality(child_ages) = child_count ≥ 1; OH-209 guarantees it — guard
    // defensively so a malformed Job is a clean 409, not a CHECK-violation 500).
    const childAges = job.child_ages ?? [];
    const childCount = job.child_count ?? childAges.length;
    if (childCount < 1 || childAges.length !== childCount) {
      return c.json({ error: 'job_incomplete', reason: 'the job is missing its child detail' }, 409);
    }

    // Snapshot the Caregiver's Rate + surcharge + negotiable for the Job's category.
    const snap = await loadRateSnapshot(db, provider.id, job.category);
    if (!snap) {
      return c.json(
        { error: 'rate_not_published', reason: `publish your ${job.category} rate before applying` },
        409,
      );
    }
    // ADR-0017: a non-negotiable Caregiver's Offers lock to the published Rate.
    const proposedRateCents = snap.negotiable
      ? (input.proposedRateCents ?? snap.publishedRateCents)
      : snap.publishedRateCents;

    const { scheduleKind, slots, recurrence, scopeMinutes } = offerScheduleFromJob(job);
    if (scopeMinutes <= 0) {
      return c.json({ error: 'invalid_schedule', reason: 'the job schedule has no billable time' }, 400);
    }
    const computedTotalCents = computeTotalCents({
      proposedRateCents,
      scopeMinutes,
      childCount,
      perChildSurchargeCents: snap.perChildSurchargeCents,
      category: job.category,
    });

    // Redact BOTH free-texts (CONTEXT § Message) — the proposal + the Offer note.
    const rawProposal = input.proposal.trim();
    const proposalScan = scanScopeNote(rawProposal);
    const rawNote = (input.scopeNote ?? '').trim();
    const noteScan = scanScopeNote(rawNote);

    // Cap pre-checks (best-effort; the unique index is the hard one-per-Job guard).
    // Both sets are small (bounded by the 15/30 caps), so count in memory reusing
    // the domain `countsAgainstJobCap` predicate.
    const now = new Date();
    const jobAppRows = (await db
      .selectFrom('applications')
      .select(['state'])
      .where('job_id', '=', job.id)
      .execute()) as { state: ApplicationState }[];
    if (jobAppRows.filter((r) => countsAgainstJobCap(r.state)).length >= JOB_APPLICATION_CAP) {
      return c.json(
        { error: 'job_application_cap_reached', reason: `this job has reached its ${JOB_APPLICATION_CAP}-application cap` },
        409,
      );
    }

    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthlyRows = (await db
      .selectFrom('applications')
      .select(['id'])
      .where('provider_id', '=', provider.id)
      .where('origin', '=', 'posted')
      .where('created_at', '>=', monthStart)
      .execute()) as { id: string }[];
    const counter: CaregiverApplicationCounter = {
      count: monthlyRows.length,
      periodYearMonth: periodKey(now),
      adminOverrideCap: null,
    };
    const cap = effectiveCap(counter);
    if (monthlyRows.length >= cap) {
      return c.json(
        { error: 'monthly_cap_reached', reason: `you have used all ${cap} applications for ${counter.periodYearMonth}` },
        409,
      );
    }

    // Friendly duplicate check (the unique index is the race-safe backstop below).
    const existing = await db
      .selectFrom('applications')
      .select(['id'])
      .where('job_id', '=', job.id)
      .where('provider_id', '=', provider.id)
      .executeTakeFirst();
    if (existing) return c.json({ error: 'already_applied' }, 409);

    // Atomic: companion job-anchored thread → first Offer (pending) → Application
    // (submitted) + any T&S flags. Exactly the OH-210 read contract.
    try {
      const created = await db.transaction().execute(async (trx) => {
        const thread = (await trx
          .insertInto('message_threads')
          .values({
            parent_uid: job.parent_uid,
            supply_uid: principal.uid,
            provider_id: provider.id,
            supply_role: 'caregiver',
            job_id: job.id,
            last_message_at: now,
            last_message_preview: 'New application',
            last_message_redacted: false,
          })
          .returning(['id'])
          .executeTakeFirstOrThrow()) as { id: string };

        const offer = (await trx
          .insertInto('offers')
          .values({
            thread_id: thread.id,
            sender_uid: principal.uid,
            sender: 'caregiver',
            status: 'pending',
            category: job.category,
            proposed_rate_cents: proposedRateCents,
            scope_minutes: scopeMinutes,
            per_child_surcharge_cents: snap.perChildSurchargeCents,
            computed_total_cents: computedTotalCents,
            scope_note: noteScan.redacted,
            scope_note_redacted: noteScan.flagged,
            negotiable: snap.negotiable,
            valid_until: defaultValidUntil(now),
            child_count: childCount,
            child_ages: childAges,
            safety_behaviors: job.safety_behaviors ?? [],
            service_address_line1: null,
            service_address_line2: null,
            service_city: null,
            service_state: null,
            service_postal_code: null,
            schedule_kind: scheduleKind,
            slots,
            recurrence,
            // Job-anchored (OH-210 contract) — the award reads the JOB schedule.
            job_id: job.id,
            updated_at: now,
          })
          .returning(['id'])
          .executeTakeFirstOrThrow()) as { id: string };

        const application = (await trx
          .insertInto('applications')
          .values({
            job_id: job.id,
            provider_id: provider.id,
            origin: 'posted',
            state: initialApplicationState({ origin: 'posted' }),
            proposal: proposalScan.redacted,
            proposal_redacted: proposalScan.flagged,
            updated_at: now,
          })
          .returning([
            'id',
            'job_id',
            'provider_id',
            'origin',
            'state',
            'accepted_offer_id',
            'proposal',
            'awarded_at',
            'created_at',
          ])
          .executeTakeFirstOrThrow()) as unknown as ApplicationRow;

        // Queue any tripped original to the T&S flag queue — the Offer note by
        // offer_id (OH-206), the proposal by application_id (OH-219).
        if (noteScan.flagged) {
          await trx
            .insertInto('message_flags')
            .values({
              offer_id: offer.id,
              thread_id: thread.id,
              sender_uid: principal.uid,
              categories: [...noteScan.categories],
              original_body: rawNote,
              matches: noteScan.matches.map((m) => ({ category: m.category, value: m.value, start: m.start, end: m.end })),
            })
            .execute();
        }
        if (proposalScan.flagged) {
          await trx
            .insertInto('message_flags')
            .values({
              application_id: application.id,
              thread_id: thread.id,
              sender_uid: principal.uid,
              categories: [...proposalScan.categories],
              original_body: rawProposal,
              matches: proposalScan.matches.map((m) => ({ category: m.category, value: m.value, start: m.start, end: m.end })),
            })
            .execute();
        }

        // Notify the Parent a new Application landed on their Job
        // (`application_received`, OH-223 — push + web_push + email, deep-links
        // to the Job detail). Deduped per Application so a retry never double-sends.
        await trx
          .insertInto('notification_outbox')
          .values({
            recipient_uid: job.parent_uid,
            event_type: 'application_received',
            payload: { jobId: job.id },
            dedupe_key: `application_received:${application.id}`,
          })
          .onConflict((oc) => oc.column('dedupe_key').doNothing())
          .execute();

        return application;
      });

      const caregiverPoint = await loadCaregiverPoint(db, provider.id);
      return c.json(toApplicationItem(created, job, caregiverPoint), 201);
    } catch (e) {
      // A concurrent double-file that slipped past the pre-check trips the unique
      // (job_id, provider_id) index — surface it as a clean 409.
      if (String((e as { message?: string }).message ?? '').includes('applications_job_provider_uidx')) {
        return c.json({ error: 'already_applied' }, 409);
      }
      throw e;
    }
  });

  // ── POST /v1/opportunities/{jobId}/withdraw — withdraw my Application ─────────
  app.openapi(withdrawApplicationRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { jobId } = c.req.valid('param');

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    const appRow = (await db
      .selectFrom('applications')
      .select([
        'id',
        'job_id',
        'provider_id',
        'origin',
        'state',
        'accepted_offer_id',
        'proposal',
        'awarded_at',
        'created_at',
      ])
      .where('job_id', '=', jobId)
      .where('provider_id', '=', provider.id)
      .executeTakeFirst()) as unknown as ApplicationRow | undefined;
    if (!appRow) return c.json({ error: 'application_not_found' }, 404);

    // Domain legality — caregiver-withdraw is valid only from submitted / countered.
    const res = transitionApplication(
      { origin: appRow.origin, state: appRow.state },
      { type: 'caregiver-withdraw' },
    );
    if (!res.ok) return c.json({ error: 'not_withdrawable', reason: res.reason }, 409);

    const now = new Date();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('applications')
        .set({ state: res.next, updated_at: now })
        .where('id', '=', appRow.id)
        .execute();

      // Seal the live pending Offer on the companion (job-anchored) thread.
      const thread = (await trx
        .selectFrom('message_threads')
        .select(['id'])
        .where('job_id', '=', jobId)
        .where('provider_id', '=', provider.id)
        .executeTakeFirst()) as { id: string } | undefined;
      if (thread) {
        const liveOffer = (await trx
          .selectFrom('offers')
          .select(['id', 'status'])
          .where('thread_id', '=', thread.id)
          .orderBy('created_at', 'desc')
          .executeTakeFirst()) as { id: string; status: string } | undefined;
        if (liveOffer && liveOffer.status === 'pending') {
          await trx
            .updateTable('offers')
            .set({ status: 'withdrawn', updated_at: now })
            .where('id', '=', liveOffer.id)
            .execute();
        }
        await trx
          .updateTable('message_threads')
          .set({ last_message_at: now, last_message_preview: 'Application withdrawn', last_message_redacted: false })
          .where('id', '=', thread.id)
          .execute();
      }
    });

    const [job, caregiverPoint] = await Promise.all([
      db
        .selectFrom('jobs')
        .select(OPPORTUNITY_COLUMNS)
        .where('id', '=', jobId)
        .executeTakeFirst() as Promise<OpportunityRow | undefined>,
      loadCaregiverPoint(db, provider.id),
    ]);
    if (!job) return c.json({ error: 'application_not_found' }, 404);
    return c.json(toApplicationItem({ ...appRow, state: res.next }, job, caregiverPoint), 200);
  });
}
