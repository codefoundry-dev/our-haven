import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import type { Insertable } from 'kysely';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
import type {
  ApplicationsTable,
  BookingSeriesTable,
  BookingsTable,
  JobsTable,
} from '../../../../apps/backend/src/db/schema.ts';
// Cross-tree, Deno-clean domain modules (ADR-0019; explicit-`.ts`). The Offer
// STATE MACHINE (offer-lifecycle/index.ts) is Deno-clean (OH-206 split its pricing
// helper into ./total.ts); the `computed_total` is derived from the Deno-clean
// Pricing leaf directly (the same six-line passthrough as `computeOfferTotal`).
// Redaction is the OH-180 detector (scope_note only — numerics bypass); the
// Parent gate is the paywall's `deriveAccessDecision` (OH-193).
// The Deno-clean booking-lifecycle LEAF (no runtime relative imports) supplies
// the slot-expansion + id/slot validation for the OH-207 materialisation. The
// `direct-message-materialisation` domain module encodes the same accept
// contract but carries runtime relative imports (booking-lifecycle + pricing),
// so it is the Node-side spec — NOT Edge-importable (ADR-0019; the same reason
// offers uses the Pricing leaf directly rather than offer-lifecycle/total.ts).
import {
  expandRecurrence,
  materialiseMultiDayOneOff,
  materialiseSeries,
  type BookingSlot,
  type RecurrenceRule,
} from '../../../../packages/domain/src/booking-lifecycle/index.ts';
import { scanScopeNote } from '../../../../packages/domain/src/disintermediation/index.ts';
import {
  canCounter,
  canDeleteOffer,
  canEditOffer,
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
import {
  normaliseSafetyBehaviors,
  SAFETY_BEHAVIORS,
} from '../../../../packages/shared/src/safety-behaviors.ts';

/**
 * Offers / Book-requests (OH-206) — CONTEXT.md § Offer; PRD-0001 v1.7 stories 24,
 * 25, 103–107, 112, 125, 128, 133; ADR-0014/0016/0017.
 *
 *   POST   /v1/threads/{threadId}/offers    compose + send a structured Offer
 *   GET    /v1/threads/{threadId}/offers    a thread's Offers (merged into the transcript)
 *   PATCH  /v1/offers/{offerId}             sender edits a still-pending Offer in place (OH-208)
 *   DELETE /v1/offers/{offerId}             sender hard-deletes a still-pending Offer (OH-208)
 *   POST   /v1/offers/{offerId}/accept      counterparty accepts (status → accepted)
 *   POST   /v1/offers/{offerId}/counter     counterparty counters (opens a successor Offer)
 *   POST   /v1/offers/{offerId}/decline     counterparty declines
 *   POST   /v1/offers/{offerId}/withdraw    sender withdraws
 *
 * An Offer rides inside a Direct-Message thread (Caregiver-only — ADR-0011) and
 * renders as an inline Offer bubble. The pure Offer state machine (OH-179) owns
 * the transition rules — including the ADR-0017 gate that refuses `countered`
 * when the Caregiver is non-negotiable. This handler persists the snapshot + the
 * child-detail/disclosure/address bundle (which the pure OfferShape does not
 * carry) and runs the transitions.
 *
 * REDACTION: only the free-text `scope_note` passes through the detector
 * (`scanScopeNote`); structured numerics bypass it (CONTEXT § Offer). A trip
 * stores the REDACTED note on the participant-readable Offer row and queues the
 * UNREDACTED original to `message_flags` (offer_id) — the same T&S surface as
 * messages (story 109).
 *
 * GATE: a PARENT compose / accept / counter is Parent-Subscription-gated (402) —
 * each commits the Parent to (or proposes) a Booking. Caregiver actions and a
 * Parent decline / withdraw are never gated.
 *
 * MATERIALISATION (OH-207): accepting a Direct-Message (thread-anchored) Offer
 * atomically materialises the Job + single Application + Booking(s) — all born
 * in their post-award state — and rebinds the thread + the Offer from `thread_id`
 * to the new `job_id`, in one `db.transaction()`. Withdrawing an already-accepted
 * Offer cascade-cancels every Booking it materialised (resolved by `offer_id`).
 * The Booking(s) follow the Offer schedule: one-off → one, multi-day → one per
 * slot (no Series), recurring → a stateless Series + one Booking per occurrence.
 *
 * EDIT / DELETE (OH-208; PRD story 131): a sender may revise (PATCH) or hard-delete
 * (DELETE) their OWN Offer while it is still `pending` — the pre-engagement window
 * before the counterparty has acted (`canEditOffer` / `canDeleteOffer`). An edit
 * re-runs the full compose pipeline (rate/surcharge re-snapshot, total recompute,
 * scope_note redaction + T&S flag refresh, 72h validity re-armed) WITHOUT changing
 * the Offer's state; a delete removes the row (its T&S flag cascades) as though it
 * were never sent. Neither is valid once the Offer leaves `pending` — an accepted
 * Offer must be withdrawn (which cascade-cancels its Bookings), never edited/deleted.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('OfferError');

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
  .openapi('OfferSlot');

const ServiceAddressInput = z
  .object({
    line1: z.string().max(120).nullish(),
    line2: z.string().max(120).nullish(),
    city: z.string().max(80).nullish(),
    state: z.string().regex(/^[A-Z]{2}$/).nullish(),
    postalCode: z.string().regex(/^\d{5}$/).nullish(),
  })
  .openapi('OfferServiceAddress');

/**
 * The schedule on a composed Offer. OH-206 ships one-off (a single date) +
 * multi-day (several hand-picked dates → one bundled card; ADR-0014 §A1).
 * Recurring (Booking Series) is representable in the schema but not composed
 * here — the recurrence editor is a follow-up (the Edge 400s on `recurring`).
 */
const ScheduleInput = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('one-off'), slot: SlotInput }),
    z.object({ kind: z.literal('multi-day'), slots: z.array(SlotInput).min(1).max(31) }),
  ])
  .openapi('OfferSchedule');

const ComposeOfferRequest = z
  .object({
    category: CategoryEnum,
    /** The proposed hourly rate, integer cents. LOCKED to the Caregiver's published
     *  per-category Rate when the Caregiver is non-negotiable + a Parent is sending
     *  (ADR-0017) — a client value is overridden, never trusted, in that case. */
    proposedRateCents: z.number().int().min(0).max(100_000_000),
    childCount: z.number().int().min(1).max(12),
    /** One integer age (years, 0–17) per child — length must equal `childCount`. */
    childAges: z.array(z.number().int().min(0).max(17)).max(12),
    /** The parent-disclosed Safety-Behaviors subset. REQUIRED (no default): the
     *  explicit disclose-or-none choice (ADR-0016 / story 133). `[]` = disclose none. */
    safetyBehaviors: z.array(SafetyBehaviorEnum),
    serviceAddress: ServiceAddressInput.nullish(),
    scopeNote: z.string().max(280).optional(),
    schedule: ScheduleInput,
  })
  .openapi('ComposeOfferRequest');

/** A counter revises rate / schedule / scope_note only; the child-detail bundle,
 *  category, and address are inherited from the superseded Offer (story 105). */
const CounterOfferRequest = z
  .object({
    proposedRateCents: z.number().int().min(0).max(100_000_000),
    scopeNote: z.string().max(280).optional(),
    schedule: ScheduleInput,
  })
  .openapi('CounterOfferRequest');

const OfferServiceAddressOut = z.object({
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
});

const OfferSchema = z
  .object({
    id: z.string(),
    threadId: z.string(),
    senderUid: z.string(),
    sender: z.enum(['parent', 'caregiver']),
    status: z.enum(['pending', 'accepted', 'countered', 'declined', 'expired', 'withdrawn']),
    category: CategoryEnum,
    proposedRateCents: z.number().int(),
    scopeMinutes: z.number().int(),
    perChildSurchargeCents: z.number().int(),
    computedTotalCents: z.number().int(),
    scopeNote: z.string(),
    scopeNoteRedacted: z.boolean(),
    /** The involved Caregiver's negotiation setting at send time — the client hides
     *  the Counter pill when false (ADR-0017). */
    negotiable: z.boolean(),
    validUntil: z.string(),
    childCount: z.number().int(),
    childAges: z.array(z.number().int()),
    safetyBehaviors: z.array(z.string()),
    /** Exact `line1/line2` are null for the Caregiver until they Accept (story 124);
     *  the Parent (sender) always sees the full address. Null on Caregiver-sent Offers. */
    serviceAddress: OfferServiceAddressOut.nullable(),
    scheduleKind: z.enum(['one-off', 'multi-day', 'recurring']),
    slots: z.array(SlotInput),
    supersedesOfferId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Offer');

const OfferListResponse = z.object({ offers: z.array(OfferSchema) }).openapi('OfferList');

/** DELETE ack — the deleted Offer leaves no row to return (OH-208). */
const DeletedResponse = z.object({ deleted: z.literal(true) }).openapi('OfferDeleted');

const ThreadIdParam = z.object({
  threadId: z.string().uuid().openapi({ param: { name: 'threadId', in: 'path' } }),
});
const OfferIdParam = z.object({
  offerId: z.string().uuid().openapi({ param: { name: 'offerId', in: 'path' } }),
});

/* ── row shapes + helpers ───────────────────────────────────────────────────── */

interface ThreadRow {
  id: string;
  parent_uid: string;
  supply_uid: string;
  provider_id: string;
  job_id: string | null;
}

interface SlotRow {
  date: string;
  startMin: number;
  endMin: number;
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
  slots: SlotRow[];
  recurrence: unknown | null;
  supersedes_offer_id: string | null;
  job_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

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

type ActorSide = 'parent' | 'caregiver';

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function viewerSide(thread: ThreadRow, uid: string): ActorSide | null {
  if (uid === thread.parent_uid) return 'parent';
  if (uid === thread.supply_uid) return 'caregiver';
  return null;
}

/** The slots a schedule carries (a one-off is a single-slot list). */
function scheduleSlots(schedule: z.infer<typeof ScheduleInput>): SlotRow[] {
  return schedule.kind === 'one-off' ? [schedule.slot] : [...schedule.slots];
}

function totalMinutes(slots: readonly SlotRow[]): number {
  return slots.reduce((sum, s) => sum + (s.endMin - s.startMin), 0);
}

/** Build the domain Offer the pure state machine transitions (it reads state,
 *  anchor, negotiable, valid_until — the rest is carried for type-fidelity). */
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

/**
 * Project an Offer row to the wire DTO for a given viewer. The exact street
 * address (`line1`/`line2`) is hidden from the Caregiver until the Offer is
 * `accepted` (story 124); the Parent sender always sees the full address.
 */
function toOfferDTO(row: OfferRow, viewer: ActorSide): z.infer<typeof OfferSchema> {
  const hasAddress =
    row.service_address_line1 !== null ||
    row.service_city !== null ||
    row.service_state !== null ||
    row.service_postal_code !== null;
  const revealExact = viewer === 'parent' || row.status === 'accepted';
  const serviceAddress = hasAddress
    ? {
        line1: revealExact ? row.service_address_line1 : null,
        line2: revealExact ? row.service_address_line2 : null,
        city: row.service_city,
        state: row.service_state,
        postalCode: row.service_postal_code,
      }
    : null;

  return {
    id: row.id,
    threadId: row.thread_id,
    senderUid: row.sender_uid,
    sender: row.sender,
    status: row.status,
    category: row.category,
    proposedRateCents: row.proposed_rate_cents,
    scopeMinutes: row.scope_minutes,
    perChildSurchargeCents: row.per_child_surcharge_cents,
    computedTotalCents: row.computed_total_cents,
    scopeNote: row.scope_note,
    scopeNoteRedacted: row.scope_note_redacted,
    negotiable: row.negotiable,
    validUntil: toIso(row.valid_until),
    childCount: row.child_count,
    childAges: row.child_ages ?? [],
    safetyBehaviors: row.safety_behaviors ?? [],
    serviceAddress,
    scheduleKind: row.schedule_kind,
    slots: row.slots ?? [],
    supersedesOfferId: row.supersedes_offer_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/** Short inbox preview for an Offer's latest activity. */
function offerPreview(verb: string, slots: readonly SlotRow[], totalCents: number): string {
  const n = slots.length;
  const dates = n === 1 ? '1 date' : `${n} dates`;
  return `${verb} · ${dates} · $${Math.round(totalCents / 100)}`;
}

async function loadThreadById(db: Db, threadId: string): Promise<ThreadRow | null> {
  const row = await db
    .selectFrom('message_threads')
    .select(['id', 'parent_uid', 'supply_uid', 'provider_id', 'job_id'])
    .where('id', '=', threadId)
    .executeTakeFirst();
  return row ? (row as unknown as ThreadRow) : null;
}

async function loadOfferById(db: Db, offerId: string): Promise<OfferRow | null> {
  const row = await db
    .selectFrom('offers')
    .select(OFFER_COLUMNS)
    .where('id', '=', offerId)
    .executeTakeFirst();
  return row ? (row as unknown as OfferRow) : null;
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

interface RateSnapshot {
  publishedRateCents: number;
  perChildSurchargeCents: number;
  negotiable: boolean;
}

/**
 * Load the Caregiver's snapshot inputs for a category: published Rate +
 * per-child surcharge (Tutor → 0) + the person-level `negotiable` flag. Returns
 * null when the Caregiver does not offer the category (an invalid compose).
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

/** computed_total via the Pricing leaf — the pre-commission parent charge. */
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

/* ── route definitions ──────────────────────────────────────────────────────── */

const composeOfferRoute = createRoute({
  method: 'post',
  path: '/threads/{threadId}/offers',
  tags: ['offers'],
  summary: 'Compose + send a structured Offer / Book-request — OH-206',
  description:
    "Sends a structured Offer into a thread the caller participates in. A Parent send is Parent-Subscription-gated (402). The Safety-Behaviors disclosure is REQUIRED (disclose a subset or explicitly none — ADR-0016). When the Caregiver is non-negotiable, a Parent's rate is locked to the published per-category Rate (ADR-0017). The free-text scope_note is redacted at write time. 400 on an invalid schedule (recurring not yet composable), child-detail, or a category the Caregiver doesn't offer. 404 if the thread isn't the caller's.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'caregiver'] })] as const,
  request: { params: ThreadIdParam, body: { content: json(ComposeOfferRequest), required: true } },
  responses: {
    201: { description: 'The created Offer', content: json(OfferSchema) },
    400: { description: 'Invalid Offer', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    402: { description: 'No active Parent Subscription', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Thread not found (or not the caller\'s)', content: json(ErrorResponse) },
  },
});

const listOffersRoute = createRoute({
  method: 'get',
  path: '/threads/{threadId}/offers',
  tags: ['offers'],
  summary: "A thread's Offers (merged into the transcript) — OH-206",
  description:
    "Returns a thread's Offers (oldest first) for a participant. The exact service address is withheld from the Caregiver until an Offer is accepted. 404 if the thread isn't the caller's.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'caregiver'] })] as const,
  request: { params: ThreadIdParam },
  responses: {
    200: { description: "The thread's Offers", content: json(OfferListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Thread not found (or not the caller\'s)', content: json(ErrorResponse) },
  },
});

const transitionResponses = {
  200: { description: 'The updated Offer', content: json(OfferSchema) },
  400: { description: 'Invalid transition input', content: json(ErrorResponse) },
  401: { description: 'Unauthenticated', content: json(ErrorResponse) },
  402: { description: 'No active Parent Subscription', content: json(ErrorResponse) },
  403: { description: 'Wrong role', content: json(ErrorResponse) },
  404: { description: 'Offer not found (or not the caller\'s)', content: json(ErrorResponse) },
  409: { description: 'Transition not allowed from the Offer\'s current state', content: json(ErrorResponse) },
} as const;

const editOfferRoute = createRoute({
  method: 'patch',
  path: '/offers/{offerId}',
  tags: ['offers'],
  summary: 'Edit a still-pending Offer / Book-request — OH-208',
  description:
    "The sender revises their own still-pending Offer in place (schedule / rate / child-detail / disclosure / address / note). The rate + per-child surcharge are re-snapshotted from the Caregiver's current profile, the total is recomputed, the scope_note is re-redacted (its T&S flag refreshed), and the 72h validity is re-armed — the Offer stays pending. A Parent edit is Parent-Subscription-gated (402). 409 if the caller isn't the sender or the Offer is no longer pending. 400 on invalid child-detail / schedule / an unavailable category.",
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'caregiver'] })] as const,
  request: { params: OfferIdParam, body: { content: json(ComposeOfferRequest), required: true } },
  responses: transitionResponses,
});

const deleteOfferRoute = createRoute({
  method: 'delete',
  path: '/offers/{offerId}',
  tags: ['offers'],
  summary: 'Delete a still-pending Offer / Book-request — OH-208',
  description:
    'The sender hard-deletes their own still-pending Offer, removing it from the transcript as though never sent (its Trust & Safety flag, if any, cascades away). Never gated. 409 if the caller isn\'t the sender or the Offer is no longer pending (an accepted Offer must be withdrawn instead, which cascade-cancels its Bookings).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'caregiver'] })] as const,
  request: { params: OfferIdParam },
  responses: {
    200: { description: 'The Offer was deleted', content: json(DeletedResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: "Offer not found (or not the caller's)", content: json(ErrorResponse) },
    409: { description: 'Not the sender, or the Offer is no longer pending', content: json(ErrorResponse) },
  },
});

const acceptOfferRoute = createRoute({
  method: 'post',
  path: '/offers/{offerId}/accept',
  tags: ['offers'],
  summary: 'Accept an Offer (status → accepted) — OH-207',
  description:
    'The counterparty accepts a pending Offer. A Parent accept is Parent-Subscription-gated. Accepting a Direct-Message Book-request atomically materialises the Job + Application + Booking(s) (born accepted) and rebinds the thread to the new Job. 409 if the Offer is not pending or has expired.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'caregiver'] })] as const,
  request: { params: OfferIdParam },
  responses: transitionResponses,
});

const counterOfferRoute = createRoute({
  method: 'post',
  path: '/offers/{offerId}/counter',
  tags: ['offers'],
  summary: 'Counter an Offer (opens a successor) — OH-206',
  description:
    'The counterparty counters a pending Offer with revised rate / schedule / note, opening a fresh pending successor Offer (child detail, category, and address inherited). Refused (409) when the Caregiver is non-negotiable (ADR-0017). A Parent counter is gated.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'caregiver'] })] as const,
  request: { params: OfferIdParam, body: { content: json(CounterOfferRequest), required: true } },
  responses: transitionResponses,
});

const declineOfferRoute = createRoute({
  method: 'post',
  path: '/offers/{offerId}/decline',
  tags: ['offers'],
  summary: 'Decline an Offer — OH-206',
  description: 'The counterparty declines a pending Offer (status → declined). Never gated.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'caregiver'] })] as const,
  request: { params: OfferIdParam },
  responses: transitionResponses,
});

const withdrawOfferRoute = createRoute({
  method: 'post',
  path: '/offers/{offerId}/withdraw',
  tags: ['offers'],
  summary: 'Withdraw an Offer — OH-207',
  description:
    'The sender withdraws their own Offer (status → withdrawn) from pending or accepted. Withdrawing an already-accepted Offer cascade-cancels every Booking it materialised (resolved by offer_id). Never gated.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent', 'caregiver'] })] as const,
  request: { params: OfferIdParam },
  responses: transitionResponses,
});

/* ── handlers ───────────────────────────────────────────────────────────────── */

export function registerOfferRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(composeOfferRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { threadId } = c.req.valid('param');
    const input = c.req.valid('json');

    const thread = await loadThreadById(db, threadId);
    const side = thread ? viewerSide(thread, principal.uid) : null;
    if (!thread || !side) return c.json({ error: 'thread_not_found' }, 404);

    // A Parent compose commits a Book-request → Subscription-gated (402).
    if (side === 'parent' && !(await parentEntitled(db, principal.uid))) {
      return c.json(
        { error: 'subscription_required', reason: 'an active Parent Subscription is required to send a booking request' },
        402,
      );
    }

    // Child detail: one age per child; Tutor is single-child (CONTEXT § Rate).
    if (input.childAges.length !== input.childCount) {
      return c.json({ error: 'invalid_child_detail', reason: 'childAges length must equal childCount' }, 400);
    }
    if (input.category === 'tutor' && input.childCount !== 1) {
      return c.json({ error: 'invalid_child_detail', reason: 'a tutor booking is single-child (childCount must be 1)' }, 400);
    }

    const slots = scheduleSlots(input.schedule);
    const scopeMinutes = totalMinutes(slots);
    if (scopeMinutes <= 0) {
      return c.json({ error: 'invalid_schedule', reason: 'the schedule has no billable time' }, 400);
    }

    // Snapshot the Caregiver's Rate + surcharge + negotiable for this category.
    const snap = await loadRateSnapshot(db, thread.provider_id, input.category);
    if (!snap) {
      return c.json({ error: 'category_unavailable', reason: 'the caregiver does not offer this category' }, 400);
    }

    // ADR-0017: a non-negotiable Caregiver's rate is locked for a Parent sender —
    // the Parent can't propose a haggled number; it auto-computes from published.
    const proposedRateCents =
      side === 'parent' && !snap.negotiable ? snap.publishedRateCents : input.proposedRateCents;

    const computedTotalCents = computeTotalCents({
      proposedRateCents,
      scopeMinutes,
      childCount: input.childCount,
      perChildSurchargeCents: snap.perChildSurchargeCents,
      category: input.category,
    });

    // Disclosed subset → canonical taxonomy order (unknowns dropped). [] = none.
    const safetyBehaviors = normaliseSafetyBehaviors(input.safetyBehaviors);

    // Redaction: scope_note only; numerics bypass (CONTEXT § Offer).
    const rawNote = (input.scopeNote ?? '').trim();
    const scan = scanScopeNote(rawNote);
    const now = new Date();

    // Service address is the Parent's; ignore any address on a Caregiver-sent Offer.
    const addr = side === 'parent' ? (input.serviceAddress ?? null) : null;

    const created = await db.transaction().execute(async (trx) => {
      const offer = (await trx
        .insertInto('offers')
        .values({
          thread_id: threadId,
          sender_uid: principal.uid,
          sender: side,
          status: 'pending',
          category: input.category,
          proposed_rate_cents: proposedRateCents,
          scope_minutes: scopeMinutes,
          per_child_surcharge_cents: snap.perChildSurchargeCents,
          computed_total_cents: computedTotalCents,
          scope_note: scan.redacted,
          scope_note_redacted: scan.flagged,
          negotiable: snap.negotiable,
          valid_until: defaultValidUntil(now),
          child_count: input.childCount,
          child_ages: input.childAges,
          safety_behaviors: safetyBehaviors,
          service_address_line1: addr?.line1 ?? null,
          service_address_line2: addr?.line2 ?? null,
          service_city: addr?.city ?? null,
          service_state: addr?.state ?? null,
          service_postal_code: addr?.postalCode ?? null,
          schedule_kind: input.schedule.kind,
          slots,
          recurrence: null,
          updated_at: now,
        })
        .returning(OFFER_COLUMNS)
        .executeTakeFirstOrThrow()) as unknown as OfferRow;

      if (scan.flagged) {
        await trx
          .insertInto('message_flags')
          .values({
            offer_id: offer.id,
            thread_id: threadId,
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
          last_message_preview: offerPreview('Booking request', slots, computedTotalCents),
          last_message_redacted: false,
        })
        .where('id', '=', threadId)
        .execute();

      // Notify the Caregiver a direct Book-request arrived (`booking_request_received`,
      // SMS-mandatory — the single most critical notification). Only a Parent-sent
      // opening Offer; a Caregiver-sent Offer has no matrix kind (in-app Realtime
      // carries it). Deduped per Offer id so a re-sent request fires exactly once.
      if (side === 'parent') {
        await trx
          .insertInto('notification_outbox')
          .values({
            recipient_uid: thread.supply_uid,
            event_type: 'booking_request_received',
            payload: { threadId },
            dedupe_key: `booking_request_received:${offer.id}`,
          })
          .onConflict((oc) => oc.column('dedupe_key').doNothing())
          .execute();
      }

      return offer;
    });

    return c.json(toOfferDTO(created, side), 201);
  });

  app.openapi(listOffersRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { threadId } = c.req.valid('param');

    const thread = await loadThreadById(db, threadId);
    const side = thread ? viewerSide(thread, principal.uid) : null;
    if (!thread || !side) return c.json({ error: 'thread_not_found' }, 404);

    const rows = (await db
      .selectFrom('offers')
      .select(OFFER_COLUMNS)
      .where('thread_id', '=', threadId)
      .orderBy('created_at', 'asc')
      .execute()) as unknown as OfferRow[];

    return c.json({ offers: rows.map((r) => toOfferDTO(r, side)) }, 200);
  });

  app.openapi(editOfferRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { offerId } = c.req.valid('param');
    const input = c.req.valid('json');

    const ctx = await loadActableOffer(db, offerId, principal.uid);
    if ('error' in ctx) return c.json(ctx.error, ctx.status);
    const { offer, thread, side } = ctx;

    // Edit is sender-initiated, and only while pending (canEditOffer).
    if (side !== offer.sender) {
      return c.json({ error: 'not_sender', reason: 'only the sender can edit their Offer' }, 409);
    }
    if (!canEditOffer(rowToDomainOffer(offer))) {
      return c.json(
        { error: 'not_editable', reason: 'only a pending offer can be edited' },
        409,
      );
    }
    // A Parent edit re-commits a Book-request → Subscription-gated (402), like compose.
    if (side === 'parent' && !(await parentEntitled(db, principal.uid))) {
      return c.json(
        { error: 'subscription_required', reason: 'an active Parent Subscription is required to edit a booking request' },
        402,
      );
    }

    // Same validation + snapshot pipeline as compose (the edit re-derives everything).
    if (input.childAges.length !== input.childCount) {
      return c.json({ error: 'invalid_child_detail', reason: 'childAges length must equal childCount' }, 400);
    }
    if (input.category === 'tutor' && input.childCount !== 1) {
      return c.json({ error: 'invalid_child_detail', reason: 'a tutor booking is single-child (childCount must be 1)' }, 400);
    }

    const slots = scheduleSlots(input.schedule);
    const scopeMinutes = totalMinutes(slots);
    if (scopeMinutes <= 0) {
      return c.json({ error: 'invalid_schedule', reason: 'the schedule has no billable time' }, 400);
    }

    const snap = await loadRateSnapshot(db, thread.provider_id, input.category);
    if (!snap) {
      return c.json({ error: 'category_unavailable', reason: 'the caregiver does not offer this category' }, 400);
    }

    // ADR-0017 rate-lock re-applied on edit (the Caregiver may have flipped negotiable).
    const proposedRateCents =
      side === 'parent' && !snap.negotiable ? snap.publishedRateCents : input.proposedRateCents;

    const computedTotalCents = computeTotalCents({
      proposedRateCents,
      scopeMinutes,
      childCount: input.childCount,
      perChildSurchargeCents: snap.perChildSurchargeCents,
      category: input.category,
    });

    const safetyBehaviors = normaliseSafetyBehaviors(input.safetyBehaviors);
    const rawNote = (input.scopeNote ?? '').trim();
    const scan = scanScopeNote(rawNote);
    const now = new Date();
    const addr = side === 'parent' ? (input.serviceAddress ?? null) : null;

    const updated = await db.transaction().execute(async (trx) => {
      // Refresh the T&S queue for this Offer: clear the prior flag (if any) so a
      // now-clean note leaves no stale flag, then re-queue if the new note trips.
      await trx.deleteFrom('message_flags').where('offer_id', '=', offer.id).execute();

      const row = (await trx
        .updateTable('offers')
        .set({
          category: input.category,
          proposed_rate_cents: proposedRateCents,
          scope_minutes: scopeMinutes,
          per_child_surcharge_cents: snap.perChildSurchargeCents,
          computed_total_cents: computedTotalCents,
          scope_note: scan.redacted,
          scope_note_redacted: scan.flagged,
          negotiable: snap.negotiable,
          valid_until: defaultValidUntil(now),
          child_count: input.childCount,
          child_ages: input.childAges,
          safety_behaviors: safetyBehaviors,
          service_address_line1: addr?.line1 ?? null,
          service_address_line2: addr?.line2 ?? null,
          service_city: addr?.city ?? null,
          service_state: addr?.state ?? null,
          service_postal_code: addr?.postalCode ?? null,
          schedule_kind: input.schedule.kind,
          slots,
          recurrence: null,
          updated_at: now,
        })
        .where('id', '=', offer.id)
        .returning(OFFER_COLUMNS)
        .executeTakeFirstOrThrow()) as unknown as OfferRow;

      if (scan.flagged) {
        await trx
          .insertInto('message_flags')
          .values({
            offer_id: offer.id,
            thread_id: offer.thread_id,
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
          last_message_preview: offerPreview('Booking request updated', slots, computedTotalCents),
          last_message_redacted: false,
        })
        .where('id', '=', offer.thread_id)
        .execute();

      return row;
    });

    return c.json(toOfferDTO(updated, side), 200);
  });

  app.openapi(deleteOfferRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { offerId } = c.req.valid('param');

    const ctx = await loadActableOffer(db, offerId, principal.uid);
    if ('error' in ctx) return c.json(ctx.error, ctx.status);
    const { offer, side } = ctx;

    // Delete is sender-initiated, and only while pending (canDeleteOffer). An
    // accepted Offer has materialised Bookings — it must be withdrawn, not deleted.
    if (side !== offer.sender) {
      return c.json({ error: 'not_sender', reason: 'only the sender can delete their Offer' }, 409);
    }
    if (!canDeleteOffer(rowToDomainOffer(offer))) {
      return c.json(
        { error: 'not_deletable', reason: 'only a pending offer can be deleted; withdraw an accepted offer instead' },
        409,
      );
    }

    const now = new Date();
    await db.transaction().execute(async (trx) => {
      // message_flags.offer_id is ON DELETE CASCADE, so any queued T&S row for this
      // Offer clears with it (offers migration OH-206).
      await trx.deleteFrom('offers').where('id', '=', offer.id).execute();

      await trx
        .updateTable('message_threads')
        .set({
          last_message_at: now,
          last_message_preview: 'Booking request removed',
          last_message_redacted: false,
        })
        .where('id', '=', offer.thread_id)
        .execute();
    });

    return c.json({ deleted: true } as const, 200);
  });

  app.openapi(acceptOfferRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { offerId } = c.req.valid('param');

    const ctx = await loadActableOffer(db, offerId, principal.uid);
    if ('error' in ctx) return c.json(ctx.error, ctx.status);
    const { offer, thread, side } = ctx;

    // Only the counterparty accepts; a Parent accept is gated (commits a Booking).
    if (side === offer.sender) {
      return c.json({ error: 'not_counterparty', reason: 'only the counterparty can accept' }, 409);
    }
    if (side === 'parent' && !(await parentEntitled(db, principal.uid))) {
      return c.json(
        { error: 'subscription_required', reason: 'an active Parent Subscription is required to accept' },
        402,
      );
    }

    const now = new Date();
    const domainOffer = rowToDomainOffer(offer);
    const res = transitionOffer(domainOffer, { type: 'counterparty-accept', now });
    if (!res.ok) return c.json({ error: 'invalid_transition', reason: res.reason }, 409);

    // A Posted-Job (job-anchored) Offer's accept takes no materialisation — its
    // Job already exists (that accept path is a later ticket); just flip status.
    // Every OH-206 Offer is Direct-Message (thread-anchored), so the branch below
    // is the live path today.
    if (domainOffer.anchor.kind !== 'thread') {
      const updated = await updateOfferStatus(db, offer, 'accepted', now, 'Booking request accepted');
      return c.json(toOfferDTO(updated, side), 200);
    }

    // OH-207: atomically materialise the Job + Application + Booking(s) and rebind
    // the thread + Offer from thread_id → the new job_id. A plan failure (e.g. an
    // invalid recurrence rule or Offer pricing) refuses BEFORE any TX is opened.
    const mat = buildDirectMessageMaterialisation(offer, thread, now);
    if (!mat.ok) return c.json({ error: 'materialisation_failed', reason: mat.reason }, 409);
    const { plan } = mat;

    const updated = await db.transaction().execute(async (trx) => {
      await trx.insertInto('jobs').values(plan.job).execute();
      await trx.insertInto('applications').values(plan.application).execute();
      if (plan.series) await trx.insertInto('booking_series').values(plan.series).execute();
      if (plan.bookings.length > 0) await trx.insertInto('bookings').values(plan.bookings).execute();

      const row = (await trx
        .updateTable('offers')
        .set({ status: 'accepted', job_id: plan.jobId, updated_at: now })
        .where('id', '=', offer.id)
        .returning(OFFER_COLUMNS)
        .executeTakeFirstOrThrow()) as unknown as OfferRow;

      await trx
        .updateTable('message_threads')
        .set({
          job_id: plan.jobId,
          last_message_at: now,
          last_message_preview: offerPreview(
            'Booking request accepted',
            offer.slots,
            offer.computed_total_cents,
          ),
          last_message_redacted: false,
        })
        .where('id', '=', thread.id)
        .execute();

      return row;
    });

    return c.json(toOfferDTO(updated, side), 200);
  });

  app.openapi(declineOfferRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { offerId } = c.req.valid('param');

    const ctx = await loadActableOffer(db, offerId, principal.uid);
    if ('error' in ctx) return c.json(ctx.error, ctx.status);
    const { offer, side } = ctx;

    if (side === offer.sender) {
      return c.json({ error: 'not_counterparty', reason: 'only the counterparty can decline' }, 409);
    }

    const now = new Date();
    const res = transitionOffer(rowToDomainOffer(offer), { type: 'counterparty-decline', now });
    if (!res.ok) return c.json({ error: 'invalid_transition', reason: res.reason }, 409);

    const updated = await updateOfferStatus(db, offer, 'declined', now, 'Booking request declined');
    return c.json(toOfferDTO(updated, side), 200);
  });

  app.openapi(withdrawOfferRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { offerId } = c.req.valid('param');

    const ctx = await loadActableOffer(db, offerId, principal.uid);
    if ('error' in ctx) return c.json(ctx.error, ctx.status);
    const { offer, side } = ctx;

    // Withdraw is sender-initiated.
    if (side !== offer.sender) {
      return c.json({ error: 'not_sender', reason: 'only the sender can withdraw their Offer' }, 409);
    }

    const now = new Date();
    const res = transitionOffer(rowToDomainOffer(offer), { type: 'sender-withdraw', now });
    if (!res.ok) return c.json({ error: 'invalid_transition', reason: res.reason }, 409);

    // OH-207: withdrawing an already-ACCEPTED Offer cascade-cancels every Booking
    // it materialised (the domain emits `cascade-cancel-materialised-bookings`;
    // resolved here by offer_id — ADR-0014 amended). A pending withdraw has no
    // Bookings, so this is skipped.
    const cascade = res.sideEffects.some(
      (e) => e.type === 'cascade-cancel-materialised-bookings',
    );

    const updated = await db.transaction().execute(async (trx) => {
      if (cascade) {
        await trx
          .updateTable('bookings')
          .set({ state: 'cancelled', updated_at: now })
          .where('offer_id', '=', offer.id)
          // Only still-live occurrences flip — a completed/disputed Booking is settled.
          .where('state', 'in', ['requested', 'accepted', 'in-progress', 'awaiting-confirmation'])
          .execute();
      }

      const row = (await trx
        .updateTable('offers')
        .set({ status: 'withdrawn', updated_at: now })
        .where('id', '=', offer.id)
        .returning(OFFER_COLUMNS)
        .executeTakeFirstOrThrow()) as unknown as OfferRow;

      await trx
        .updateTable('message_threads')
        .set({
          last_message_at: now,
          last_message_preview: 'Booking request withdrawn',
          last_message_redacted: false,
        })
        .where('id', '=', offer.thread_id)
        .execute();

      return row;
    });

    return c.json(toOfferDTO(updated, side), 200);
  });

  app.openapi(counterOfferRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { offerId } = c.req.valid('param');
    const input = c.req.valid('json');

    const ctx = await loadActableOffer(db, offerId, principal.uid);
    if ('error' in ctx) return c.json(ctx.error, ctx.status);
    const { offer, thread, side } = ctx;

    if (side === offer.sender) {
      return c.json({ error: 'not_counterparty', reason: 'only the counterparty can counter' }, 409);
    }
    // ADR-0017 gate (also enforced in the domain transition below): no Counter
    // against a non-negotiable Caregiver.
    if (!canCounter(rowToDomainOffer(offer))) {
      return c.json(
        { error: 'counter_unavailable', reason: 'this Offer cannot be countered (non-negotiable or not pending)' },
        409,
      );
    }
    if (side === 'parent' && !(await parentEntitled(db, principal.uid))) {
      return c.json(
        { error: 'subscription_required', reason: 'an active Parent Subscription is required to counter' },
        402,
      );
    }

    const now = new Date();
    const res = transitionOffer(rowToDomainOffer(offer), { type: 'counterparty-counter', now });
    if (!res.ok) return c.json({ error: 'invalid_transition', reason: res.reason }, 409);

    const slots = scheduleSlots(input.schedule);
    const scopeMinutes = totalMinutes(slots);
    if (scopeMinutes <= 0) {
      return c.json({ error: 'invalid_schedule', reason: 'the schedule has no billable time' }, 400);
    }

    // Re-snapshot the surcharge for the inherited category (a counter may cross a
    // profile change; snapshotInvariantsHold permits a fresh snapshot). Rate is
    // the counter-sender's new number — locked to published only when a Parent
    // counters a non-negotiable Caregiver (here canCounter already guaranteed
    // negotiable, so no lock path is reachable).
    const snap = await loadRateSnapshot(db, thread.provider_id, offer.category);
    const perChildSurchargeCents = snap?.perChildSurchargeCents ?? offer.per_child_surcharge_cents;
    const negotiable = snap?.negotiable ?? offer.negotiable;
    const computedTotalCents = computeTotalCents({
      proposedRateCents: input.proposedRateCents,
      scopeMinutes,
      childCount: offer.child_count,
      perChildSurchargeCents,
      category: offer.category,
    });

    const rawNote = (input.scopeNote ?? '').trim();
    const scan = scanScopeNote(rawNote);

    const successor = await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('offers')
        .set({ status: 'countered', updated_at: now })
        .where('id', '=', offer.id)
        .execute();

      const next = (await trx
        .insertInto('offers')
        .values({
          thread_id: offer.thread_id,
          sender_uid: principal.uid,
          sender: side,
          status: 'pending',
          category: offer.category,
          proposed_rate_cents: input.proposedRateCents,
          scope_minutes: scopeMinutes,
          per_child_surcharge_cents: perChildSurchargeCents,
          computed_total_cents: computedTotalCents,
          scope_note: scan.redacted,
          scope_note_redacted: scan.flagged,
          negotiable,
          valid_until: defaultValidUntil(now),
          // Inherit the child-detail + address bundle from the superseded Offer.
          child_count: offer.child_count,
          child_ages: offer.child_ages,
          safety_behaviors: offer.safety_behaviors,
          service_address_line1: offer.service_address_line1,
          service_address_line2: offer.service_address_line2,
          service_city: offer.service_city,
          service_state: offer.service_state,
          service_postal_code: offer.service_postal_code,
          schedule_kind: input.schedule.kind,
          slots,
          recurrence: null,
          supersedes_offer_id: offer.id,
          updated_at: now,
        })
        .returning(OFFER_COLUMNS)
        .executeTakeFirstOrThrow()) as unknown as OfferRow;

      if (scan.flagged) {
        await trx
          .insertInto('message_flags')
          .values({
            offer_id: next.id,
            thread_id: offer.thread_id,
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
          last_message_preview: offerPreview('Counter-offer', slots, computedTotalCents),
          last_message_redacted: false,
        })
        .where('id', '=', offer.thread_id)
        .execute();

      // Notify the counter recipient — the OTHER party (`counter_offer_received`).
      const counterRecipient = side === 'parent' ? thread.supply_uid : thread.parent_uid;
      await trx
        .insertInto('notification_outbox')
        .values({
          recipient_uid: counterRecipient,
          event_type: 'counter_offer_received',
          payload: { threadId: offer.thread_id },
          dedupe_key: `counter_offer_received:${next.id}`,
        })
        .onConflict((oc) => oc.column('dedupe_key').doNothing())
        .execute();

      return next;
    });

    return c.json(toOfferDTO(successor, side), 200);
  });
}

/* ── shared transition plumbing ─────────────────────────────────────────────── */

type ActableOffer =
  | { offer: OfferRow; thread: ThreadRow; side: ActorSide }
  | { error: { error: string; reason?: string }; status: 404 };

/** Load an Offer + its thread and authorise the caller as a participant (404
 *  otherwise — never reveal another's Offer). */
async function loadActableOffer(db: Db, offerId: string, uid: string): Promise<ActableOffer> {
  const offer = await loadOfferById(db, offerId);
  if (!offer) return { error: { error: 'offer_not_found' }, status: 404 };
  const thread = await loadThreadById(db, offer.thread_id);
  const side = thread ? viewerSide(thread, uid) : null;
  if (!thread || !side) return { error: { error: 'offer_not_found' }, status: 404 };
  return { offer, thread, side };
}

/* ── OH-207: Direct-Message accept → atomic Job/Application/Booking plan ──────── */

/** The row bundle the accept handler INSERTs in one TX (dependency order:
 *  job → application → series? → bookings). Built purely from the accepted Offer
 *  row + its thread, so the handler opens NO transaction on a plan failure. */
interface MaterialisationPlan {
  jobId: string;
  job: Insertable<JobsTable>;
  application: Insertable<ApplicationsTable>;
  series: Insertable<BookingSeriesTable> | null;
  bookings: Insertable<BookingsTable>[];
}

type MaterialisationOutcome =
  | { ok: true; plan: MaterialisationPlan }
  | { ok: false; reason: string };

/**
 * Build the atomic materialisation for a Direct-Message Book-request accept
 * (OH-207; CONTEXT § Job / § Application / § Booking, ADR-0014). Orchestrates the
 * Deno-clean leaves — booking-lifecycle's `materialiseMultiDayOneOff` /
 * `materialiseSeries` (slot expansion + id/slot validation) and the Pricing
 * calculator (per-Booking parent-charge snapshot) — mirroring the pure
 * `direct-message-materialisation` domain module (which is not Edge-importable).
 *
 * Supply identity is `providers.id` (`thread.provider_id`); the Parent is the
 * thread's `parent_uid`. Every materialised row carries the accepted Offer's id
 * so a later sender-withdraw cascade-cancels them. Any validation failure returns
 * `{ ok: false }` with NO partial plan.
 */
function buildDirectMessageMaterialisation(
  offer: OfferRow,
  thread: ThreadRow,
  now: Date,
): MaterialisationOutcome {
  const domain = rowToDomainOffer(offer);
  const parentUid = thread.parent_uid;
  const caregiverId = thread.provider_id;
  const category = offer.category;
  const agreedRate = offer.proposed_rate_cents;

  const jobId = crypto.randomUUID();
  const applicationId = crypto.randomUUID();

  interface Occurrence {
    id: string;
    slot: BookingSlot;
    seriesId: string | null;
    durationHours: number;
  }
  let occurrences: Occurrence[];
  let seriesRow: Insertable<BookingSeriesTable> | null = null;

  if (domain.schedule.kind === 'recurring') {
    const rule: RecurrenceRule = domain.schedule.rule;
    const expanded = expandRecurrence(rule);
    if (!expanded.ok) return { ok: false, reason: expanded.reason };
    const seriesId = crypto.randomUUID();
    const occurrenceIds = expanded.slots.map(() => crypto.randomUUID());
    const m = materialiseSeries({
      seriesId,
      parentId: parentUid,
      caregiverId,
      category,
      origin: 'direct-message',
      agreedRate,
      rule,
      occurrenceIds,
      offerId: offer.id,
    });
    if (!m.ok) return { ok: false, reason: m.reason };
    seriesRow = {
      id: seriesId,
      job_id: jobId,
      parent_uid: parentUid,
      provider_id: caregiverId,
      category,
      // The domain rule's `weekdays` is readonly; the jsonb column is a plain
      // array — copy it into the mutable OfferRecurrenceRow shape.
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
    const slots = domain.schedule.kind === 'one-off' ? [domain.schedule.slot] : domain.schedule.slots;
    const bookingIds = slots.map(() => crypto.randomUUID());
    const m = materialiseMultiDayOneOff({
      parentId: parentUid,
      caregiverId,
      category,
      origin: 'direct-message',
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

  // Per-Booking parent charge via the Pricing leaf (throws on caller-bug Offer
  // pricing, e.g. a Tutor with >1 child — surface as a refusal, never a 500).
  let bookings: Insertable<BookingsTable>[];
  try {
    bookings = occurrences.map((o) => ({
      id: o.id,
      kind: 'caregiver',
      state: 'accepted',
      parent_uid: parentUid,
      provider_id: caregiverId,
      slot_id: null,
      rate_cents: null,
      auto_complete_at: null,
      scheduled_date: o.slot.date,
      start_min: o.slot.startMin,
      end_min: o.slot.endMin,
      origin: 'direct-message',
      job_id: jobId,
      application_id: applicationId,
      offer_id: offer.id,
      series_id: o.seriesId,
      agreed_rate_cents: agreedRate,
      computed_total_cents: calculatePricing({
        agreedRateCents: agreedRate,
        hours: o.durationHours,
        childCount: offer.child_count,
        perChildSurchargeCents: offer.per_child_surcharge_cents,
        commissionBp: 0,
        category,
      }).parentChargeCents,
      // Snapshot for adjust-time re-pricing (OH-212) — see buildBookingBase.
      per_child_surcharge_cents: offer.per_child_surcharge_cents,
      category,
      child_count: offer.child_count,
      child_ages: offer.child_ages ?? [],
      service_address_line1: offer.service_address_line1,
      service_address_line2: offer.service_address_line2,
      service_city: offer.service_city,
      service_state: offer.service_state,
      service_postal_code: offer.service_postal_code,
      accepted_at: now,
      updated_at: now,
    }));
  } catch (e) {
    return { ok: false, reason: `invalid offer pricing: ${(e as Error).message}` };
  }

  return {
    ok: true,
    plan: {
      jobId,
      job: {
        id: jobId,
        origin: 'direct-message',
        state: 'awarded',
        parent_uid: parentUid,
        provider_id: caregiverId,
        category,
        // Direct-Message Jobs have no composer step (plumbing — neither party sees
        // a Job UI); a short marker records where the conversation lived.
        description: `[direct-message ${thread.id}]`,
        awarded_at: now,
        updated_at: now,
      },
      application: {
        id: applicationId,
        job_id: jobId,
        provider_id: caregiverId,
        origin: 'direct-message',
        state: 'awarded',
        accepted_offer_id: offer.id,
        proposal: null,
        awarded_at: now,
        updated_at: now,
      },
      series: seriesRow,
      bookings,
    },
  };
}

/** Persist a status flip + bump the thread preview, returning the updated row. */
async function updateOfferStatus(
  db: Db,
  offer: OfferRow,
  status: OfferState,
  now: Date,
  preview: string,
): Promise<OfferRow> {
  const updated = await db.transaction().execute(async (trx) => {
    const row = (await trx
      .updateTable('offers')
      .set({ status, updated_at: now })
      .where('id', '=', offer.id)
      .returning(OFFER_COLUMNS)
      .executeTakeFirstOrThrow()) as unknown as OfferRow;
    await trx
      .updateTable('message_threads')
      .set({ last_message_at: now, last_message_preview: preview, last_message_redacted: false })
      .where('id', '=', offer.thread_id)
      .execute();
    return row;
  });
  return updated;
}
