import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import type { Insertable } from 'kysely';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
import type { BookingSeriesTable, BookingsTable } from '../../../../apps/backend/src/db/schema.ts';
// Cross-tree, Deno-clean domain modules (ADR-0019; explicit-`.ts`). Awarding an
// Application drives THREE state machines in lockstep (CONTEXT § Application):
// application (parent-award / auto-decline), job (award → awarded), and offer
// (counterparty-accept). The Booking(s) are materialised from the JOB's schedule
// (parent-authoritative) + the accepted Offer's Agreed Rate via the Deno-clean
// booking-lifecycle leaves — one Booking born `requested` per one-off, or a
// stateless Series + one occurrence per recurring date (ADR-0014 §5).
import {
  expandRecurrence,
  initialBookingState,
  materialiseMultiDayOneOff,
  materialiseSeries,
  type BookingSlot,
  type RecurrenceRule,
} from '../../../../packages/domain/src/booking-lifecycle/index.ts';
import {
  countsAgainstJobCap,
  transitionApplication,
  type ApplicationState,
} from '../../../../packages/domain/src/application-lifecycle/index.ts';
import { transitionJob } from '../../../../packages/domain/src/job-lifecycle/index.ts';
import {
  canCounter,
  defaultValidUntil,
  transitionOffer,
  type Offer,
  type OfferSchedule,
  type OfferState,
} from '../../../../packages/domain/src/offer-lifecycle/index.ts';
import {
  deriveAccessDecision,
  type StripeSubscriptionStatus,
} from '../../../../packages/domain/src/parent-subscription/index.ts';
import { calculatePricing } from '../../../../packages/domain/src/pricing/index.ts';
import { scanScopeNote } from '../../../../packages/domain/src/disintermediation/index.ts';

/**
 * Applications review + Award (OH-210) — CONTEXT.md § Application / § Job /
 * § Booking / § Offer; PRD-0001 v1.7 stories 88–92; ADR-0014/0016/0017.
 *
 *   GET  /v1/jobs/{jobId}/applications         the Parent's Applications on a Job
 *   GET  /v1/applications/{applicationId}      one Application (caregiver + Offer)
 *   POST /v1/applications/{applicationId}/award    award → Booking `requested`/Series
 *   POST /v1/applications/{applicationId}/decline  decline this Application
 *   POST /v1/applications/{applicationId}/counter  Parent counter-Offer (negotiable-gated)
 *
 * The Parent-facing review side of the Posted-Job → Application → Offer chain. The
 * Caregiver-facing apply side (which CREATES Applications + their first Offer) is
 * OH-218/OH-219; until it lands there are no live Applications to review, so these
 * routes are exercised by seeded fixtures.
 *
 * APPLICATION ↔ OFFER CONTRACT (defined here; OH-219 conforms): a posted-Job
 * Application (`applications`, origin `posted`) has a companion **message thread**
 * anchored to the Job — `message_threads` with `job_id = application.job_id` and
 * `provider_id = application.provider_id`. The negotiation Offers live on that
 * thread, **job-anchored** (`offers.job_id = application.job_id`). The Application's
 * **current/live Offer** is the newest Offer on that thread; the Parent awards by
 * accepting the caregiver's current pending Offer.
 *
 * AWARD (story 90; ADR-0014 §5): confirming the (MOCK, Phase-0) payment method
 * transitions the Application → `awarded` + the Job → `awarded`, auto-declines
 * every other open Application (story 91), and materialises the Booking(s) —
 * `requested` (posted-Job birth state; the Caregiver has 24h to accept) — one per
 * one-off date, or a stateless Booking Series + one occurrence per recurring date.
 * The Booking carries the JOB's child detail + service address (parent set them at
 * compose — v1.6 moved child capture off Award) and the OFFER's Agreed Rate.
 *
 * KNOWN HOLES (flagged, not blocking):
 *   - Real Stripe authorize-at-booking (ADR-0001) is deferred — payment is mocked,
 *     matching the OH-203 NULL-payment consultation posture.
 *   - The 24h `requested`→`expired` sweep lands with the Caregiver accept/decline
 *     surface (no `request_expires_at` column yet; the domain side-effect is emitted).
 *   - Auto-declined / declined caregivers are NOT notified: the notification
 *     catalog (OH-194) has no `application_declined` kind and the caregiver
 *     deep-link surface is OH-218. Only the awarded caregiver (`job_awarded`) is
 *     enqueued. The auto-decline STATE change (story 91 core) is applied.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('ApplicationError');

const CategoryEnum = z.enum(['babysitter', 'tutor', 'nanny']);
const ApplicationStateEnum = z.enum([
  'submitted',
  'countered',
  'awarded',
  'declined',
  'withdrawn',
  'expired',
]);

/** A single concrete session slot (minutes-from-midnight window on a calendar day). */
const SlotSchema = z
  .object({
    date: z.string(),
    startMin: z.number().int(),
    endMin: z.number().int(),
  })
  .openapi('ApplicationOfferSlot');

/** The caregiver's live Offer on an Application, from the Parent's perspective. */
const OfferSummarySchema = z
  .object({
    id: z.string(),
    status: z.enum(['pending', 'accepted', 'countered', 'declined', 'expired', 'withdrawn']),
    sender: z.enum(['parent', 'caregiver']),
    proposedRateCents: z.number().int(),
    scopeMinutes: z.number().int(),
    perChildSurchargeCents: z.number().int(),
    computedTotalCents: z.number().int(),
    scopeNote: z.string(),
    scopeNoteRedacted: z.boolean(),
    /** The caregiver's negotiation setting — the client hides Counter when false. */
    negotiable: z.boolean(),
    scheduleKind: z.enum(['one-off', 'multi-day', 'recurring']),
    slots: z.array(SlotSchema),
    validUntil: z.string(),
    supersedesOfferId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('ApplicationOffer');

/** A compact caregiver identity for the review list / detail (story 88/89). The
 *  full public profile is one tap away (GET /v1/supply/{id}, OH-202). */
const CaregiverSummarySchema = z
  .object({
    providerId: z.string(),
    name: z.string().nullable(),
    /** Published hourly Rate for the Job's category, integer cents (null if unset). */
    publishedRateCents: z.number().int().nullable(),
    negotiable: z.boolean(),
    /** Verification badge: the background check has cleared (screening passed). */
    backgroundChecked: z.boolean(),
    /** Public Rating aggregate — cold-start hole (no persistence yet, OH-202). */
    ratingAverage: z.number().nullable(),
    ratingCount: z.number().int(),
  })
  .openapi('ApplicationCaregiver');

const ApplicationSchema = z
  .object({
    id: z.string(),
    jobId: z.string(),
    category: CategoryEnum,
    state: ApplicationStateEnum,
    /** The caregiver's free-text proposal (null for Direct-Message Applications). */
    proposal: z.string().nullable(),
    createdAt: z.string(),
    caregiver: CaregiverSummarySchema,
    offer: OfferSummarySchema.nullable(),
  })
  .openapi('Application');

const ApplicationListResponse = z
  .object({ applications: z.array(ApplicationSchema) })
  .openapi('ApplicationList');

/** MOCK payment confirmation (OH-210 Phase 0) — no real charge/authorize. */
const AwardRequest = z
  .object({
    /** An optional (mock) saved payment-method id the Parent confirmed at Award. */
    paymentMethodId: z.string().optional(),
  })
  .openapi('AwardRequest');

const AwardResponse = z
  .object({
    applicationId: z.string(),
    jobId: z.string(),
    state: z.literal('awarded'),
    /** The materialised Booking id(s) — one per one-off/occurrence, `requested`. */
    bookingIds: z.array(z.string()),
    /** The Booking Series id for a recurring award, else null. */
    seriesId: z.string().nullable(),
  })
  .openapi('AwardResult');

const DeclineResponse = z
  .object({ applicationId: z.string(), state: z.literal('declined') })
  .openapi('DeclineApplicationResult');

/** A Parent counter revises the RATE (and optional note) only — the schedule is
 *  the Parent-set Job schedule (a counter is a negotiation of price, not dates). */
const CounterRequest = z
  .object({
    proposedRateCents: z.number().int().min(0).max(100_000_000),
    scopeNote: z.string().max(280).optional(),
  })
  .openapi('CounterApplicationRequest');

const CounterResponse = z
  .object({
    applicationId: z.string(),
    state: z.literal('countered'),
    offer: OfferSummarySchema,
  })
  .openapi('CounterApplicationResult');

const JobIdParam = z.object({
  jobId: z.string().uuid().openapi({ param: { name: 'jobId', in: 'path' } }),
});
const ApplicationIdParam = z.object({
  applicationId: z.string().uuid().openapi({ param: { name: 'applicationId', in: 'path' } }),
});

/* ── row shapes ─────────────────────────────────────────────────────────────── */

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
  updated_at: Date | string;
}

interface JobRow {
  id: string;
  parent_uid: string;
  origin: 'posted' | 'direct-message';
  state: 'draft' | 'open' | 'awarded' | 'expired' | 'cancelled' | 'closed';
  category: 'babysitter' | 'tutor' | 'nanny';
  description: string;
  schedule_kind: 'one-off' | 'recurring' | null;
  slots: BookingSlot[] | null;
  recurrence: RecurrenceRule | null;
  child_count: number | null;
  child_ages: number[] | null;
  safety_behaviors: string[] | null;
  service_address_line1: string | null;
  service_address_line2: string | null;
  service_city: string | null;
  service_state: string | null;
  service_postal_code: string | null;
}

interface ThreadRow {
  id: string;
  parent_uid: string;
  supply_uid: string;
  provider_id: string;
  job_id: string | null;
}

interface OfferRow {
  id: string;
  thread_id: string;
  sender_uid: string;
  sender: 'parent' | 'caregiver';
  status: OfferState;
  category: 'babysitter' | 'tutor' | 'nanny';
  proposed_rate_cents: number;
  scope_minutes: number;
  per_child_surcharge_cents: number;
  computed_total_cents: number;
  scope_note: string;
  scope_note_redacted: boolean;
  negotiable: boolean;
  valid_until: Date | string;
  child_count: number;
  child_ages: number[];
  safety_behaviors: string[];
  service_address_line1: string | null;
  service_address_line2: string | null;
  service_city: string | null;
  service_state: string | null;
  service_postal_code: string | null;
  schedule_kind: 'one-off' | 'multi-day' | 'recurring';
  slots: BookingSlot[];
  recurrence: unknown | null;
  supersedes_offer_id: string | null;
  job_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const JOB_COLUMNS = [
  'id',
  'parent_uid',
  'origin',
  'state',
  'category',
  'description',
  'schedule_kind',
  'slots',
  'recurrence',
  'child_count',
  'child_ages',
  'safety_behaviors',
  'service_address_line1',
  'service_address_line2',
  'service_city',
  'service_state',
  'service_postal_code',
] as const;

const OFFER_COLUMNS = [
  'id',
  'thread_id',
  'sender_uid',
  'sender',
  'status',
  'category',
  'proposed_rate_cents',
  'scope_minutes',
  'per_child_surcharge_cents',
  'computed_total_cents',
  'scope_note',
  'scope_note_redacted',
  'negotiable',
  'valid_until',
  'child_count',
  'child_ages',
  'safety_behaviors',
  'service_address_line1',
  'service_address_line2',
  'service_city',
  'service_state',
  'service_postal_code',
  'schedule_kind',
  'slots',
  'recurrence',
  'supersedes_offer_id',
  'job_id',
  'created_at',
  'updated_at',
] as const;

/* ── helpers ────────────────────────────────────────────────────────────────── */

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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

async function loadApplicationById(db: Db, id: string): Promise<ApplicationRow | null> {
  const row = await db
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
      'updated_at',
    ])
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? (row as unknown as ApplicationRow) : null;
}

/** Load the Job an Application belongs to and authorise the caller as its Parent. */
async function loadOwnedJob(db: Db, jobId: string, uid: string): Promise<JobRow | null> {
  const row = (await db
    .selectFrom('jobs')
    .select(JOB_COLUMNS)
    .where('id', '=', jobId)
    .executeTakeFirst()) as JobRow | undefined;
  if (!row || row.parent_uid !== uid || row.origin !== 'posted') return null;
  return row;
}

/** The newest Offer on an Application's negotiation thread (its live Offer), plus
 *  the thread. Returns `offer: null` when the caregiver has not offered yet. */
async function loadCurrentOffer(
  db: Db,
  jobId: string,
  providerId: string,
): Promise<{ thread: ThreadRow | null; offer: OfferRow | null }> {
  const thread = (await db
    .selectFrom('message_threads')
    .select(['id', 'parent_uid', 'supply_uid', 'provider_id', 'job_id'])
    .where('job_id', '=', jobId)
    .where('provider_id', '=', providerId)
    .executeTakeFirst()) as ThreadRow | undefined;
  if (!thread) return { thread: null, offer: null };
  const offers = (await db
    .selectFrom('offers')
    .select(OFFER_COLUMNS)
    .where('thread_id', '=', thread.id)
    .orderBy('created_at', 'desc')
    .execute()) as unknown as OfferRow[];
  return { thread, offer: offers[0] ?? null };
}

interface CaregiverSummary {
  providerId: string;
  name: string | null;
  publishedRateCents: number | null;
  negotiable: boolean;
  backgroundChecked: boolean;
  ratingAverage: number | null;
  ratingCount: number;
}

/**
 * Batch-load the compact caregiver summary for a set of provider ids (identity =
 * `providers.id`; ADR-0011). Rating is a cold-start hole (no persistence yet —
 * same as OH-202): `average: null, count: 0`.
 */
async function loadCaregiverSummaries(
  db: Db,
  providerIds: readonly string[],
  category: 'babysitter' | 'tutor' | 'nanny',
): Promise<Map<string, CaregiverSummary>> {
  const out = new Map<string, CaregiverSummary>();
  if (providerIds.length === 0) return out;
  const ids = providerIds as string[];
  const [profiles, rates, verifs] = await Promise.all([
    db
      .selectFrom('provider_profiles')
      .select(['provider_id', 'display_name', 'negotiable'])
      .where('provider_id', 'in', ids)
      .execute() as Promise<
      { provider_id: string; display_name: string | null; negotiable: boolean | null }[]
    >,
    db
      .selectFrom('provider_category_rates')
      .select(['provider_id', 'published_rate_cents'])
      .where('provider_id', 'in', ids)
      .where('category', '=', category)
      .execute() as Promise<{ provider_id: string; published_rate_cents: number | null }[]>,
    db
      .selectFrom('provider_verifications')
      .select(['provider_id', 'screening_passed_at'])
      .where('provider_id', 'in', ids)
      .execute() as Promise<{ provider_id: string; screening_passed_at: Date | string | null }[]>,
  ]);
  const profileBy = new Map(profiles.map((p) => [p.provider_id, p]));
  const rateBy = new Map(rates.map((r) => [r.provider_id, r]));
  const verifBy = new Map(verifs.map((v) => [v.provider_id, v]));
  for (const providerId of new Set(ids)) {
    const profile = profileBy.get(providerId);
    out.set(providerId, {
      providerId,
      name: profile?.display_name ?? null,
      publishedRateCents: rateBy.get(providerId)?.published_rate_cents ?? null,
      negotiable: profile?.negotiable ?? true,
      backgroundChecked: verifBy.get(providerId)?.screening_passed_at != null,
      ratingAverage: null,
      ratingCount: 0,
    });
  }
  return out;
}

function toOfferSummary(row: OfferRow): z.infer<typeof OfferSummarySchema> {
  return {
    id: row.id,
    status: row.status,
    sender: row.sender,
    proposedRateCents: row.proposed_rate_cents,
    scopeMinutes: row.scope_minutes,
    perChildSurchargeCents: row.per_child_surcharge_cents,
    computedTotalCents: row.computed_total_cents,
    scopeNote: row.scope_note,
    scopeNoteRedacted: row.scope_note_redacted,
    negotiable: row.negotiable,
    scheduleKind: row.schedule_kind,
    slots: row.slots ?? [],
    validUntil: toIso(row.valid_until),
    supersedesOfferId: row.supersedes_offer_id,
    createdAt: toIso(row.created_at),
  };
}

/** Build the domain Offer the pure state machine transitions (state, anchor,
 *  negotiable, valid_until drive the transitions). */
function rowToDomainOffer(row: OfferRow): Offer {
  let schedule: OfferSchedule;
  if (row.schedule_kind === 'multi-day') {
    schedule = { kind: 'multi-day', slots: row.slots };
  } else if (row.schedule_kind === 'recurring') {
    schedule = { kind: 'recurring', rule: row.recurrence as RecurrenceRule };
  } else {
    schedule = { kind: 'one-off', slot: row.slots[0]! };
  }
  return {
    proposedRate: row.proposed_rate_cents,
    scopeType: 'hourly',
    scopeQuantity: row.scope_minutes / 60,
    scopeNote: row.scope_note,
    childCount: row.child_count,
    category: row.category,
    perChildSurchargeSnapshot: row.per_child_surcharge_cents,
    computedTotal: row.computed_total_cents,
    validUntil: new Date(row.valid_until),
    sender: row.sender,
    negotiable: row.negotiable,
    anchor: row.job_id ? { kind: 'job', jobId: row.job_id } : { kind: 'thread', threadId: row.thread_id },
    schedule,
    state: row.status,
  };
}

/* ── OH-210: Award → Booking(s) `requested` / Booking Series plan ─────────────── */

interface AwardPlan {
  series: Insertable<BookingSeriesTable> | null;
  bookings: Insertable<BookingsTable>[];
}
type AwardOutcome = { ok: true; plan: AwardPlan } | { ok: false; reason: string };

/**
 * Build the Booking(s) an award materialises, from the JOB's schedule (the Parent
 * set the concrete dates at compose — parent-authoritative) + the accepted Offer's
 * Agreed Rate + the JOB's child detail / service address. Bookings are born
 * `requested` (posted-Job birth state; the Caregiver has 24h to accept). A
 * recurring Job yields a stateless Series + one occurrence per date; a one-off Job
 * yields exactly one Booking (no Series). Any validation failure returns
 * `{ ok: false }` with NO partial plan.
 */
function buildAward(job: JobRow, application: ApplicationRow, offer: OfferRow, now: Date): AwardOutcome {
  const parentUid = job.parent_uid;
  const caregiverId = application.provider_id;
  const category = job.category;
  const agreedRate = offer.proposed_rate_cents;
  const perChildSurcharge = offer.per_child_surcharge_cents ?? 0;
  // Child detail + address are the JOB's (compose captured them; v1.6 moved child
  // entry off Award). A posted Job always carries child_count (completeness CHECK).
  const childCount = job.child_count ?? 1;
  const childAges = job.child_ages ?? [];
  // Posted-Job birth state — `requested` (the Caregiver must accept within 24h).
  const bookingState = initialBookingState({ kind: 'caregiver', origin: 'posted-job' });

  interface Occurrence {
    id: string;
    slot: BookingSlot;
    seriesId: string | null;
    durationHours: number;
  }
  let occurrences: Occurrence[];
  let seriesRow: Insertable<BookingSeriesTable> | null = null;

  if (job.schedule_kind === 'recurring') {
    const rule = job.recurrence;
    if (!rule) return { ok: false, reason: 'recurring job is missing its recurrence rule' };
    const expanded = expandRecurrence(rule);
    if (!expanded.ok) return { ok: false, reason: expanded.reason };
    const seriesId = crypto.randomUUID();
    const occurrenceIds = expanded.slots.map(() => crypto.randomUUID());
    const m = materialiseSeries({
      seriesId,
      parentId: parentUid,
      caregiverId,
      category,
      origin: 'posted-job',
      agreedRate,
      rule,
      occurrenceIds,
      offerId: offer.id,
    });
    if (!m.ok) return { ok: false, reason: m.reason };
    seriesRow = {
      id: seriesId,
      job_id: job.id,
      parent_uid: parentUid,
      provider_id: caregiverId,
      category,
      rule: { ...rule, weekdays: [...rule.weekdays] },
      agreed_rate_cents: agreedRate,
      offer_id: offer.id,
    };
    occurrences = m.occurrences.map((o) => ({
      id: o.id,
      slot: o.slot,
      seriesId: o.seriesId,
      durationHours: o.schedule.durationHours,
    }));
  } else {
    const slots = job.slots ?? [];
    if (slots.length === 0) return { ok: false, reason: 'one-off job is missing its slot' };
    const bookingIds = slots.map(() => crypto.randomUUID());
    const m = materialiseMultiDayOneOff({
      parentId: parentUid,
      caregiverId,
      category,
      origin: 'posted-job',
      agreedRate,
      slots,
      bookingIds,
      offerId: offer.id,
    });
    if (!m.ok) return { ok: false, reason: m.reason };
    occurrences = m.bookings.map((o) => ({
      id: o.id,
      slot: o.slot,
      seriesId: o.seriesId,
      durationHours: o.schedule.durationHours,
    }));
  }

  let bookings: Insertable<BookingsTable>[];
  try {
    bookings = occurrences.map((o) => ({
      id: o.id,
      kind: 'caregiver',
      state: bookingState, // 'requested'
      parent_uid: parentUid,
      provider_id: caregiverId,
      slot_id: null,
      rate_cents: null,
      auto_complete_at: null,
      scheduled_date: o.slot.date,
      start_min: o.slot.startMin,
      end_min: o.slot.endMin,
      origin: 'posted-job',
      job_id: job.id,
      application_id: application.id,
      offer_id: offer.id,
      series_id: o.seriesId,
      agreed_rate_cents: agreedRate,
      computed_total_cents: calculatePricing({
        agreedRateCents: agreedRate,
        hours: o.durationHours,
        childCount,
        perChildSurchargeCents: perChildSurcharge,
        commissionBp: 0,
        category,
      }).parentChargeCents,
      category,
      child_count: childCount,
      child_ages: childAges,
      service_address_line1: job.service_address_line1,
      service_address_line2: job.service_address_line2,
      service_city: job.service_city,
      service_state: job.service_state,
      service_postal_code: job.service_postal_code,
      // `requested`, not yet accepted — the reveal-at-accept address is snapshotted
      // now but `accepted_at` stays null until the Caregiver accepts.
      accepted_at: null,
      updated_at: now,
    }));
  } catch (e) {
    return { ok: false, reason: `invalid award pricing: ${(e as Error).message}` };
  }

  return { ok: true, plan: { series: seriesRow, bookings } };
}

/* ── route definitions ──────────────────────────────────────────────────────── */

const listApplicationsRoute = createRoute({
  method: 'get',
  path: '/jobs/{jobId}/applications',
  tags: ['applications'],
  summary: "A Job's Applications (Parent review list) — OH-210",
  description:
    "Returns the Applications on one of the caller's posted Jobs (newest first), each with a compact caregiver summary + the caregiver's live Offer + a status pill. The client sorts (recent / rating / price). Bio + Preferences reveal on engagement (an Application is filed). 404 when the Job is not the caller's.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: JobIdParam },
  responses: {
    200: { description: "The Job's Applications", content: json(ApplicationListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Job not found (or not the caller's)", content: json(ErrorResponse) },
  },
});

const getApplicationRoute = createRoute({
  method: 'get',
  path: '/applications/{applicationId}',
  tags: ['applications'],
  summary: 'One Application (caregiver + live Offer) — OH-210',
  description:
    "Returns a single Application on one of the caller's Jobs: the caregiver summary, their proposal, and the live Offer with its `negotiable` flag (the client shows Counter only when negotiable). 404 when the Application's Job is not the caller's.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: ApplicationIdParam },
  responses: {
    200: { description: 'The Application', content: json(ApplicationSchema) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Application not found (or not the caller's)", content: json(ErrorResponse) },
  },
});

const awardRoute = createRoute({
  method: 'post',
  path: '/applications/{applicationId}/award',
  tags: ['applications'],
  summary: 'Award a Job to a Caregiver → Booking `requested` / Series — OH-210',
  description:
    "Awards the Job to this Application's Caregiver by accepting their live Offer: the Application → `awarded`, the Job → `awarded`, every other open Application auto-declines (story 91), and the Booking(s) materialise `requested` — one per one-off date, or a Booking Series + one occurrence per recurring date. Payment is a MOCK confirmation (Phase 0). Parent-Subscription-gated (402). 409 when the Job is not open, the Application is not awardable, or there is no acceptable caregiver Offer; 404 when the Application is not the caller's.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: ApplicationIdParam, body: { content: json(AwardRequest), required: false } },
  responses: {
    200: { description: 'The award result', content: json(AwardResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    402: { description: 'No active Parent Subscription', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Application not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Not awardable from the current state', content: json(ErrorResponse) },
  },
});

const declineApplicationRoute = createRoute({
  method: 'post',
  path: '/applications/{applicationId}/decline',
  tags: ['applications'],
  summary: 'Decline an Application — OH-210',
  description:
    "Declines an Application on one of the caller's Jobs (state → declined); the caregiver's live pending Offer is declined with it. Never gated. 409 when the Application is already terminal; 404 when it is not the caller's.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: ApplicationIdParam },
  responses: {
    200: { description: 'The declined Application', content: json(DeclineResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Application not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Not declinable from the current state', content: json(ErrorResponse) },
  },
});

const counterApplicationRoute = createRoute({
  method: 'post',
  path: '/applications/{applicationId}/counter',
  tags: ['applications'],
  summary: "Counter a Caregiver's Application Offer — OH-210",
  description:
    "Opens a Parent counter-Offer on an Application (revised rate + optional note; the Parent-set Job schedule is unchanged), moving the Application → `countered` and the caregiver's Offer → `countered`, with a fresh pending successor Offer linked via `supersedes`. Refused (409) when the caregiver is non-negotiable (ADR-0017). Parent-Subscription-gated (402). 404 when the Application is not the caller's.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: ApplicationIdParam, body: { content: json(CounterRequest), required: true } },
  responses: {
    200: { description: 'The successor Offer', content: json(CounterResponse) },
    400: { description: 'Invalid counter', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    402: { description: 'No active Parent Subscription', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Application not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Not counterable (non-negotiable, not pending, or awaiting the caregiver)', content: json(ErrorResponse) },
  },
});

/* ── handlers ───────────────────────────────────────────────────────────────── */

export function registerApplicationRoutes(app: OpenAPIHono<AppEnv>): void {
  // ── GET /v1/jobs/{jobId}/applications ───────────────────────────────────────
  app.openapi(listApplicationsRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { jobId } = c.req.valid('param');

    const job = await loadOwnedJob(db, jobId, principal.uid);
    if (!job) return c.json({ error: 'job_not_found' }, 404);

    const apps = (await db
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
        'updated_at',
      ])
      .where('job_id', '=', jobId)
      .orderBy('created_at', 'desc')
      .execute()) as unknown as ApplicationRow[];

    if (apps.length === 0) return c.json({ applications: [] }, 200);

    // Batch the caregiver summaries + the live Offer per applicant thread.
    const providerIds = [...new Set(apps.map((a) => a.provider_id))];
    const [caregivers, threads, offers] = await Promise.all([
      loadCaregiverSummaries(db, providerIds, job.category),
      db
        .selectFrom('message_threads')
        .select(['id', 'parent_uid', 'supply_uid', 'provider_id', 'job_id'])
        .where('job_id', '=', jobId)
        .execute() as Promise<ThreadRow[]>,
      db
        .selectFrom('offers')
        .select(OFFER_COLUMNS)
        .where('job_id', '=', jobId)
        .orderBy('created_at', 'desc')
        .execute() as unknown as Promise<OfferRow[]>,
    ]);
    const threadByProvider = new Map(threads.map((t) => [t.provider_id, t]));
    // offers are newest-first, so the FIRST seen per thread is the live one.
    const liveOfferByThread = new Map<string, OfferRow>();
    for (const o of offers) if (!liveOfferByThread.has(o.thread_id)) liveOfferByThread.set(o.thread_id, o);

    const applications = apps.map((a) => {
      const thread = threadByProvider.get(a.provider_id);
      const offer = thread ? (liveOfferByThread.get(thread.id) ?? null) : null;
      const caregiver = caregivers.get(a.provider_id) ?? {
        providerId: a.provider_id,
        name: null,
        publishedRateCents: null,
        negotiable: true,
        backgroundChecked: false,
        ratingAverage: null,
        ratingCount: 0,
      };
      return {
        id: a.id,
        jobId: a.job_id,
        category: job.category,
        state: a.state,
        proposal: a.proposal,
        createdAt: toIso(a.created_at),
        caregiver,
        offer: offer ? toOfferSummary(offer) : null,
      };
    });

    return c.json({ applications }, 200);
  });

  // ── GET /v1/applications/{applicationId} ────────────────────────────────────
  app.openapi(getApplicationRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { applicationId } = c.req.valid('param');

    const application = await loadApplicationById(db, applicationId);
    if (!application) return c.json({ error: 'application_not_found' }, 404);
    const job = await loadOwnedJob(db, application.job_id, principal.uid);
    if (!job) return c.json({ error: 'application_not_found' }, 404);

    const [caregivers, { offer }] = await Promise.all([
      loadCaregiverSummaries(db, [application.provider_id], job.category),
      loadCurrentOffer(db, job.id, application.provider_id),
    ]);
    const caregiver = caregivers.get(application.provider_id) ?? {
      providerId: application.provider_id,
      name: null,
      publishedRateCents: null,
      negotiable: true,
      backgroundChecked: false,
      ratingAverage: null,
      ratingCount: 0,
    };

    return c.json(
      {
        id: application.id,
        jobId: application.job_id,
        category: job.category,
        state: application.state,
        proposal: application.proposal,
        createdAt: toIso(application.created_at),
        caregiver,
        offer: offer ? toOfferSummary(offer) : null,
      },
      200,
    );
  });

  // ── POST /v1/applications/{applicationId}/award ─────────────────────────────
  app.openapi(awardRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { applicationId } = c.req.valid('param');

    const application = await loadApplicationById(db, applicationId);
    if (!application) return c.json({ error: 'application_not_found' }, 404);
    const job = await loadOwnedJob(db, application.job_id, principal.uid);
    if (!job) return c.json({ error: 'application_not_found' }, 404);

    // GATE: awarding commits a Booking → Parent-Subscription-gated (402).
    if (!(await parentEntitled(db, principal.uid))) {
      return c.json(
        { error: 'subscription_required', reason: 'an active Parent Subscription is required to award a Job' },
        402,
      );
    }

    // Domain legality — Application `parent-award` + Job `award` (both must be legal
    // before any write; a partial award must never leave a half-transitioned Job).
    const appRes = transitionApplication({ origin: 'posted', state: application.state }, { type: 'parent-award' });
    if (!appRes.ok) return c.json({ error: 'not_awardable', reason: appRes.reason }, 409);
    const jobRes = transitionJob({ origin: 'posted', state: job.state }, { type: 'award' });
    if (!jobRes.ok) return c.json({ error: 'not_awardable', reason: jobRes.reason }, 409);

    // The caregiver's live Offer is the one being accepted — it must be a pending
    // caregiver Offer (the Parent cannot award their own outstanding counter).
    const { offer } = await loadCurrentOffer(db, job.id, application.provider_id);
    if (!offer) return c.json({ error: 'no_offer', reason: 'this application has no caregiver offer to award' }, 409);
    if (offer.sender !== 'caregiver') {
      return c.json({ error: 'awaiting_caregiver', reason: 'awaiting the caregiver\'s response to your counter' }, 409);
    }
    const now = new Date();
    const offerRes = transitionOffer(rowToDomainOffer(offer), { type: 'counterparty-accept', now });
    if (!offerRes.ok) return c.json({ error: 'offer_not_acceptable', reason: offerRes.reason }, 409);

    // Materialise the Booking(s) from the JOB schedule + OFFER rate (refuse before
    // opening any transaction on an invalid plan — e.g. a bad recurrence rule).
    const award = buildAward(job, application, offer, now);
    if (!award.ok) return c.json({ error: 'award_failed', reason: award.reason }, 409);
    const { plan } = award;

    // Resolve the awarded caregiver's uid for the `job_awarded` notification.
    const caregiver = (await db
      .selectFrom('providers')
      .select(['uid'])
      .where('id', '=', application.provider_id)
      .executeTakeFirst()) as { uid: string } | undefined;

    await db.transaction().execute(async (trx) => {
      if (plan.series) await trx.insertInto('booking_series').values(plan.series).execute();
      if (plan.bookings.length > 0) await trx.insertInto('bookings').values(plan.bookings).execute();

      // Offer → accepted (the Parent accepted the caregiver's proposal).
      await trx
        .updateTable('offers')
        .set({ status: 'accepted', updated_at: now })
        .where('id', '=', offer.id)
        .execute();

      // Application → awarded, on the accepted Offer.
      await trx
        .updateTable('applications')
        .set({ state: 'awarded', accepted_offer_id: offer.id, awarded_at: now, updated_at: now })
        .where('id', '=', application.id)
        .execute();

      // Job → awarded (provider_id stamped to the winning Caregiver).
      await trx
        .updateTable('jobs')
        .set({ state: jobRes.next, provider_id: application.provider_id, awarded_at: now, updated_at: now })
        .where('id', '=', job.id)
        .execute();

      // Auto-decline every OTHER still-open Application on the Job (story 91).
      await trx
        .updateTable('applications')
        .set({ state: 'declined', updated_at: now })
        .where('job_id', '=', job.id)
        .where('id', '!=', application.id)
        .where('state', 'in', ['submitted', 'countered'])
        .execute();

      // Notify the awarded Caregiver (`job_awarded`, SMS-mandatory). The losing
      // caregivers are auto-declined above but not yet notified (no catalog kind).
      if (caregiver?.uid && plan.bookings[0]) {
        await trx
          .insertInto('notification_outbox')
          .values({
            recipient_uid: caregiver.uid,
            event_type: 'job_awarded',
            payload: {
              bookingId: plan.bookings[0].id as string,
              jobId: job.id,
              jobTitle: job.description.slice(0, 80),
            },
            dedupe_key: `job_awarded:${application.id}`,
          })
          .onConflict((oc) => oc.column('dedupe_key').doNothing())
          .execute();
      }
    });

    return c.json(
      {
        applicationId: application.id,
        jobId: job.id,
        state: 'awarded' as const,
        bookingIds: plan.bookings.map((b) => b.id as string),
        seriesId: plan.series ? (plan.series.id as string) : null,
      },
      200,
    );
  });

  // ── POST /v1/applications/{applicationId}/decline ───────────────────────────
  app.openapi(declineApplicationRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { applicationId } = c.req.valid('param');

    const application = await loadApplicationById(db, applicationId);
    if (!application) return c.json({ error: 'application_not_found' }, 404);
    const job = await loadOwnedJob(db, application.job_id, principal.uid);
    if (!job) return c.json({ error: 'application_not_found' }, 404);

    const res = transitionApplication({ origin: 'posted', state: application.state }, { type: 'parent-decline' });
    if (!res.ok) return c.json({ error: 'not_declinable', reason: res.reason }, 409);

    const now = new Date();
    const { offer } = await loadCurrentOffer(db, job.id, application.provider_id);

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('applications')
        .set({ state: 'declined', updated_at: now })
        .where('id', '=', application.id)
        .execute();
      // The caregiver's live pending Offer is declined with the Application.
      if (offer && offer.status === 'pending') {
        await trx
          .updateTable('offers')
          .set({ status: 'declined', updated_at: now })
          .where('id', '=', offer.id)
          .execute();
      }
    });

    return c.json({ applicationId: application.id, state: 'declined' as const }, 200);
  });

  // ── POST /v1/applications/{applicationId}/counter ───────────────────────────
  app.openapi(counterApplicationRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { applicationId } = c.req.valid('param');
    const input = c.req.valid('json');

    const application = await loadApplicationById(db, applicationId);
    if (!application) return c.json({ error: 'application_not_found' }, 404);
    const job = await loadOwnedJob(db, application.job_id, principal.uid);
    if (!job) return c.json({ error: 'application_not_found' }, 404);

    const { thread, offer } = await loadCurrentOffer(db, job.id, application.provider_id);
    if (!thread || !offer) {
      return c.json({ error: 'no_offer', reason: 'this application has no caregiver offer to counter' }, 409);
    }
    // The Parent counters the caregiver's Offer — it must be theirs (pending) to
    // counter (a Parent cannot counter their own outstanding counter).
    if (offer.sender !== 'caregiver') {
      return c.json({ error: 'awaiting_caregiver', reason: 'awaiting the caregiver\'s response to your counter' }, 409);
    }
    // ADR-0017 gate (also enforced in transitionOffer below): no Counter against a
    // non-negotiable Caregiver / a non-pending Offer.
    if (!canCounter(rowToDomainOffer(offer))) {
      return c.json(
        { error: 'counter_unavailable', reason: 'this offer cannot be countered (non-negotiable or not pending)' },
        409,
      );
    }
    // Counter re-commits the Parent to a (revised) Booking → gated (402).
    if (!(await parentEntitled(db, principal.uid))) {
      return c.json(
        { error: 'subscription_required', reason: 'an active Parent Subscription is required to counter' },
        402,
      );
    }

    const now = new Date();
    const appRes = transitionApplication({ origin: 'posted', state: application.state }, { type: 'parent-counter' });
    if (!appRes.ok) return c.json({ error: 'not_counterable', reason: appRes.reason }, 409);
    const offerRes = transitionOffer(rowToDomainOffer(offer), { type: 'counterparty-counter', now });
    if (!offerRes.ok) return c.json({ error: 'counter_unavailable', reason: offerRes.reason }, 409);

    // The successor keeps the Parent-set schedule (a counter negotiates price, not
    // dates); the total is recomputed on the new rate against the JOB's child count.
    const scopeMinutes = offer.scope_minutes;
    const perChildSurcharge = offer.per_child_surcharge_cents;
    const childCount = job.child_count ?? offer.child_count;
    let computedTotalCents: number;
    try {
      computedTotalCents = calculatePricing({
        agreedRateCents: input.proposedRateCents,
        hours: scopeMinutes / 60,
        childCount,
        perChildSurchargeCents: perChildSurcharge,
        commissionBp: 0,
        category: job.category,
      }).parentChargeCents;
    } catch (e) {
      return c.json({ error: 'invalid_counter', reason: (e as Error).message }, 400);
    }

    const rawNote = (input.scopeNote ?? '').trim();
    const scan = scanScopeNote(rawNote);

    const successor = await db.transaction().execute(async (trx) => {
      // Predecessor Offer → countered; Application → countered.
      await trx.updateTable('offers').set({ status: 'countered', updated_at: now }).where('id', '=', offer.id).execute();
      await trx
        .updateTable('applications')
        .set({ state: 'countered', updated_at: now })
        .where('id', '=', application.id)
        .execute();

      const next = (await trx
        .insertInto('offers')
        .values({
          thread_id: thread.id,
          sender_uid: principal.uid,
          sender: 'parent',
          status: 'pending',
          category: job.category,
          proposed_rate_cents: input.proposedRateCents,
          scope_minutes: scopeMinutes,
          per_child_surcharge_cents: perChildSurcharge,
          computed_total_cents: computedTotalCents,
          scope_note: scan.redacted,
          scope_note_redacted: scan.flagged,
          negotiable: offer.negotiable,
          valid_until: defaultValidUntil(now),
          // Child detail + address are the JOB's (parent-authoritative); schedule
          // is inherited unchanged from the superseded Offer (mirrors the Job).
          child_count: job.child_count ?? offer.child_count,
          child_ages: (job.child_ages ?? offer.child_ages) as number[],
          safety_behaviors: (job.safety_behaviors ?? offer.safety_behaviors) as string[],
          service_address_line1: job.service_address_line1,
          service_address_line2: job.service_address_line2,
          service_city: job.service_city,
          service_state: job.service_state,
          service_postal_code: job.service_postal_code,
          schedule_kind: offer.schedule_kind,
          slots: offer.slots,
          recurrence: (offer.recurrence ?? null) as never,
          supersedes_offer_id: offer.id,
          job_id: job.id,
          updated_at: now,
        })
        .returning(OFFER_COLUMNS)
        .executeTakeFirstOrThrow()) as unknown as OfferRow;

      if (scan.flagged) {
        await trx
          .insertInto('message_flags')
          .values({
            offer_id: next.id,
            thread_id: thread.id,
            sender_uid: principal.uid,
            categories: [...scan.categories],
            original_body: rawNote,
            matches: scan.matches.map((m) => ({
              category: m.category,
              value: m.value,
              start: m.start,
              end: m.end,
            })),
          })
          .execute();
      }

      await trx
        .updateTable('message_threads')
        .set({
          last_message_at: now,
          last_message_preview: `Counter-offer · $${Math.round(computedTotalCents / 100)}`,
          last_message_redacted: false,
        })
        .where('id', '=', thread.id)
        .execute();

      // Notify the Caregiver of the counter (`counter_offer_received`).
      await trx
        .insertInto('notification_outbox')
        .values({
          recipient_uid: thread.supply_uid,
          event_type: 'counter_offer_received',
          payload: { threadId: thread.id, jobId: job.id },
          dedupe_key: `counter_offer_received:${next.id}`,
        })
        .onConflict((oc) => oc.column('dedupe_key').doNothing())
        .execute();

      return next;
    });

    return c.json(
      { applicationId: application.id, state: 'countered' as const, offer: toOfferSummary(successor) },
      200,
    );
  });
}
