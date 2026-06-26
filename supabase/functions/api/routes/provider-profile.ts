import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import { SPECIALTIES, type Specialty } from '../auth/taxonomy.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
// Cross-tree, Deno-clean domain modules (ADR-0019; the explicit-`.ts` pattern
// caregiver-profile.ts / provider-credentials.ts use). Neither module carries a
// runtime `@our-haven/*` import, so both deploy unchanged on Deno. The handler
// composes the two: provider-profile owns rate/specialty/credential-status; the
// slot scheduler owns the consultation-slot lifecycle.
import {
  deriveCredentialStatus,
  sanitisePerSessionRateCents,
  validateSpecialty,
  type ClinicalCredentialFacts,
} from '../../../../packages/domain/src/provider-profile/index.ts';
import {
  createSlot,
  findSlotConflicts,
  isBookable,
  withdrawSlot,
  type ConsultationSlot,
  type SlotState,
} from '../../../../packages/domain/src/provider-slot-scheduler/index.ts';

/**
 * Provider (clinical tier) profile builder (OH-189) — PRD-0001 v1.7 stories 46,
 * 48; ADR-0011.
 *
 * The Provider analogue of the Caregiver profile builder (OH-188). Three things:
 *
 *   GET   /v1/providers/me/clinical-profile            read the editable profile
 *   PATCH /v1/providers/me/clinical-profile            update it (partial)
 *   GET   /v1/providers/me/consultation-slots          list published slots
 *   POST  /v1/providers/me/consultation-slots          publish a bookable slot
 *   DELETE/v1/providers/me/consultation-slots/{slotId} withdraw an open slot
 *
 *   1. **Specialty + per-session display Rate** — `providers.specialty` (drives
 *      discovery + license-board resolution) and `provider_profiles
 *      .published_rate_cents` (display-only; Provider payment is off-platform).
 *   2. **Consultation-slot publishing** — concrete dated windows persisted in
 *      `provider_slots`, born `open` (bookable). The M2.7 scheduler consumes the
 *      open slots; overlap is rejected at publish time (domain
 *      `findSlotConflicts`).
 *   3. **License / insurance / credential status** — a read-only projection of
 *      the OH-184/185/186 verification facts (`provider_verifications` +
 *      `specialist_credentials`), collapsed by the domain to one badge. The
 *      upload + admin-decision flow itself lives in provider-credentials.ts.
 *
 * A distinct path from the Caregiver `/providers/me/profile` (which is
 * caregiver-role-gated) — the two profiles have different shapes, so they are
 * separate resources rather than one polymorphic endpoint. Provider-role-gated;
 * nothing here gates activation.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('ProviderProfileError');

const SpecialtyEnum = z.enum(SPECIALTIES);
const SlotStateEnum = z.enum(['open', 'held', 'released']);
const DocStatusEnum = z.enum(['verified', 'uploaded', 'missing']);

/* ── schemas ────────────────────────────────────────────────────────────────── */

const CredentialStatusSchema = z
  .object({
    /** Collapsed badge — `verified` only when every clinical gate is cleared. */
    overall: z.enum(['verified', 'in-review', 'rejected', 'unverified']),
    license: DocStatusEnum,
    insurance: DocStatusEnum,
    screening: z.enum(['passed', 'pending']),
    /** Whether the public (Parent-facing) profile shows the "Verified" badge. */
    publiclyVerified: z.boolean(),
  })
  .openapi('ProviderCredentialStatus');

const ClinicalProfileResponse = z
  .object({
    providerId: z.string(),
    specialty: SpecialtyEnum.nullable(),
    residentState: z.string(),
    displayName: z.string().nullable(),
    headline: z.string().nullable(),
    bio: z.string().nullable(),
    /** Display-only per-session Rate, integer cents. Provider payment is off-platform. */
    perSessionRateCents: z.number().int().nullable(),
    credentialStatus: CredentialStatusSchema,
    /** How many of this Provider's published slots are currently bookable (open). */
    bookableSlotCount: z.number().int(),
  })
  .openapi('ProviderClinicalProfile');

const ClinicalProfilePatchRequest = z
  .object({
    displayName: z.string().max(80).nullable().optional(),
    headline: z.string().max(120).nullable().optional(),
    bio: z.string().max(600).nullable().optional(),
    specialty: SpecialtyEnum.optional(),
    perSessionRateCents: z.number().int().min(0).nullable().optional(),
  })
  .openapi('ProviderClinicalProfilePatchRequest');

const ConsultationSlotSchema = z
  .object({
    id: z.string(),
    /** Calendar day, ISO `YYYY-MM-DD`. */
    date: z.string(),
    /** Window start/end, minutes-since-midnight (0..1440). */
    startMin: z.number().int(),
    endMin: z.number().int(),
    state: SlotStateEnum,
    /** Whether the slot can be booked right now (only `open` slots are bookable). */
    bookable: z.boolean(),
  })
  .openapi('ConsultationSlot');

const SlotListResponse = z
  .object({ slots: z.array(ConsultationSlotSchema) })
  .openapi('ConsultationSlotList');

const SlotCreateRequest = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
    startMin: z.number().int().min(0).max(1439),
    endMin: z.number().int().min(1).max(1440),
  })
  .openapi('ConsultationSlotCreateRequest');

const SlotIdParam = z.object({
  slotId: z.string().uuid().openapi({ param: { name: 'slotId', in: 'path' } }),
});

/* ── row shapes + helpers ───────────────────────────────────────────────────── */

interface ProviderRow {
  id: string;
  uid: string;
  role: 'caregiver' | 'provider';
  specialty: string | null;
  state: string;
}

interface ProfileRow {
  display_name: string | null;
  headline: string | null;
  bio: string | null;
  published_rate_cents: number | null;
}

interface VerificationRow {
  license_verified_at: Date | string | null;
  insurance_verified_at: Date | string | null;
  screening_passed_at: Date | string | null;
  rejected_at: Date | string | null;
}

interface SpecialistRow {
  decision: 'verified' | 'rejected' | null;
  license_doc_object_path: string | null;
  insurance_doc_object_path: string | null;
}

interface SlotRow {
  id: string;
  slot_date: Date | string;
  start_min: number;
  end_min: number;
  state: SlotState;
  held_by_booking_id: string | null;
}

function toDateStr(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

async function loadProviderByUid(db: Db, uid: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'specialty', 'state'])
    .where('uid', '=', uid)
    .executeTakeFirst();
  return row ? (row as ProviderRow) : null;
}

async function ensureProfileRow(db: Db, providerId: string): Promise<void> {
  const existing = await db
    .selectFrom('provider_profiles')
    .select(['provider_id'])
    .where('provider_id', '=', providerId)
    .executeTakeFirst();
  if (!existing) {
    await db.insertInto('provider_profiles').values({ provider_id: providerId }).execute();
  }
}

/** Map a persisted slot row to the API/domain ConsultationSlot shape. */
function toSlot(row: SlotRow): ConsultationSlot {
  return {
    id: row.id,
    date: toDateStr(row.slot_date),
    startMin: row.start_min,
    endMin: row.end_min,
    state: row.state,
    heldByBookingId: row.held_by_booking_id,
  };
}

function slotView(row: SlotRow) {
  const slot = toSlot(row);
  return { ...slot, bookable: isBookable(slot) };
}

/** Assemble the editable clinical profile from the persisted rows. */
async function buildProfile(db: Db, provider: ProviderRow) {
  const profile = (await db
    .selectFrom('provider_profiles')
    .select(['display_name', 'headline', 'bio', 'published_rate_cents'])
    .where('provider_id', '=', provider.id)
    .executeTakeFirst()) as ProfileRow | undefined;

  const verif = (await db
    .selectFrom('provider_verifications')
    .select(['license_verified_at', 'insurance_verified_at', 'screening_passed_at', 'rejected_at'])
    .where('provider_id', '=', provider.id)
    .executeTakeFirst()) as VerificationRow | undefined;

  const spec = (await db
    .selectFrom('specialist_credentials')
    .select(['decision', 'license_doc_object_path', 'insurance_doc_object_path'])
    .where('provider_id', '=', provider.id)
    .executeTakeFirst()) as SpecialistRow | undefined;

  const openSlots = await db
    .selectFrom('provider_slots')
    .select(['id'])
    .where('provider_id', '=', provider.id)
    .where('state', '=', 'open')
    .execute();

  const facts: ClinicalCredentialFacts = {
    licenseVerified: verif?.license_verified_at != null,
    insuranceVerified: verif?.insurance_verified_at != null,
    screeningPassed: verif?.screening_passed_at != null,
    rejected: verif?.rejected_at != null || spec?.decision === 'rejected',
    licenseUploaded: spec?.license_doc_object_path != null,
    insuranceUploaded: spec?.insurance_doc_object_path != null,
  };

  return {
    providerId: provider.id,
    specialty: (provider.specialty as Specialty | null) ?? null,
    residentState: provider.state,
    displayName: profile?.display_name ?? null,
    headline: profile?.headline ?? null,
    bio: profile?.bio ?? null,
    perSessionRateCents: profile?.published_rate_cents ?? null,
    credentialStatus: deriveCredentialStatus(facts),
    bookableSlotCount: openSlots.length,
  };
}

/* ── route definitions ──────────────────────────────────────────────────────── */

const getProfileRoute = createRoute({
  method: 'get',
  path: '/providers/me/clinical-profile',
  tags: ['profile'],
  summary: "Read the authenticated Provider's editable clinical profile",
  description:
    'Returns the Provider profile: specialty, the per-session display Rate (display-only — Provider payment is off-platform), identity (display name / headline / bio), the read-only license/insurance/screening credential-status badge, and the count of currently-bookable consultation slots. Caregivers are rejected by the provider-only role guard (403).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['provider'] })] as const,
  responses: {
    200: { description: 'The editable clinical profile', content: json(ClinicalProfileResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (caregiver / parent / admin)', content: json(ErrorResponse) },
    404: { description: 'Supply (provider) row not found', content: json(ErrorResponse) },
  },
});

const patchProfileRoute = createRoute({
  method: 'patch',
  path: '/providers/me/clinical-profile',
  tags: ['profile'],
  summary: "Update the authenticated Provider's clinical profile (partial)",
  description:
    'Partial update — only the supplied fields change. `specialty` (one of slp/ot/aba/psychology/other) writes through to the providers row (it drives the license-board resolution). `perSessionRateCents` is the display-only per-session Rate in integer cents, or null to clear it.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['provider'] })] as const,
  request: { body: { content: json(ClinicalProfilePatchRequest), required: true } },
  responses: {
    200: { description: 'The updated clinical profile', content: json(ClinicalProfileResponse) },
    400: { description: 'Invalid specialty / rate', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Supply (provider) row not found', content: json(ErrorResponse) },
  },
});

const listSlotsRoute = createRoute({
  method: 'get',
  path: '/providers/me/consultation-slots',
  tags: ['profile'],
  summary: "List the authenticated Provider's published consultation slots",
  description:
    'Returns the Provider\'s active consultation slots (open + held; withdrawn/released ones are omitted), each with its bookable flag. Open slots are what the M2.7 scheduler surfaces to Parents.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['provider'] })] as const,
  responses: {
    200: { description: 'The published slots', content: json(SlotListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Supply (provider) row not found', content: json(ErrorResponse) },
  },
});

const createSlotRoute = createRoute({
  method: 'post',
  path: '/providers/me/consultation-slots',
  tags: ['profile'],
  summary: 'Publish a bookable consultation slot',
  description:
    'Lists a new consultation window (born `open`, immediately bookable). The date must be YYYY-MM-DD and the window 0 ≤ startMin < endMin ≤ 1440. Rejected with 409 if it overlaps an existing active slot on the same day (a Provider cannot double-book a window).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['provider'] })] as const,
  request: { body: { content: json(SlotCreateRequest), required: true } },
  responses: {
    201: { description: 'Slot published', content: json(ConsultationSlotSchema) },
    400: { description: 'Invalid date / window', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Supply (provider) row not found', content: json(ErrorResponse) },
    409: { description: 'Overlaps an existing slot', content: json(ErrorResponse) },
  },
});

const withdrawSlotRoute = createRoute({
  method: 'delete',
  path: '/providers/me/consultation-slots/{slotId}',
  tags: ['profile'],
  summary: 'Withdraw an open consultation slot',
  description:
    'Un-publishes an open slot (open → released). A held slot (a Parent has booked it) cannot be withdrawn — cancel the consultation Booking first, which releases it (409).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['provider'] })] as const,
  request: { params: SlotIdParam },
  responses: {
    200: { description: 'Slot withdrawn', content: json(z.object({ withdrawn: z.literal(true) })) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Slot not found (or not owned)', content: json(ErrorResponse) },
    409: { description: 'Slot is held — cancel the booking first', content: json(ErrorResponse) },
  },
});

/* ── handlers ───────────────────────────────────────────────────────────────── */

export function registerProviderProfileRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(getProfileRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) {
      return c.json(
        { error: 'provider_not_found', reason: 'claim a supply role first (POST /v1/auth/role-claim)' },
        404,
      );
    }
    return c.json(await buildProfile(db, provider), 200);
  });

  app.openapi(patchProfileRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const patch = c.req.valid('json');

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    // Validate specialty + rate BEFORE any write (domain rules; zod already
    // narrows the shapes, the domain keeps the canonical guard one place).
    if (patch.specialty !== undefined) {
      const res = validateSpecialty(patch.specialty);
      if (!res.ok) return c.json({ error: 'invalid_specialty', reason: res.reason }, 400);
    }
    let rateCents: number | null | undefined;
    if (patch.perSessionRateCents !== undefined) {
      const res = sanitisePerSessionRateCents(patch.perSessionRateCents);
      if (!res.ok) return c.json({ error: 'invalid_rate', reason: res.reason }, 400);
      rateCents = res.cents;
    }

    const now = new Date();

    if (patch.specialty !== undefined) {
      await db
        .updateTable('providers')
        .set({ specialty: patch.specialty, updated_at: now })
        .where('id', '=', provider.id)
        .execute();
      provider.specialty = patch.specialty;
    }

    await ensureProfileRow(db, provider.id);

    const set: Record<string, unknown> = { updated_at: now };
    if (patch.displayName !== undefined) set.display_name = patch.displayName;
    if (patch.headline !== undefined) set.headline = patch.headline;
    if (patch.bio !== undefined) set.bio = patch.bio;
    if (rateCents !== undefined) set.published_rate_cents = rateCents;
    await db.updateTable('provider_profiles').set(set).where('provider_id', '=', provider.id).execute();

    return c.json(await buildProfile(db, provider), 200);
  });

  app.openapi(listSlotsRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    const rows = (await db
      .selectFrom('provider_slots')
      .select(['id', 'slot_date', 'start_min', 'end_min', 'state', 'held_by_booking_id'])
      .where('provider_id', '=', provider.id)
      .where('state', '!=', 'released')
      .orderBy('slot_date', 'asc')
      .orderBy('start_min', 'asc')
      .execute()) as SlotRow[];

    return c.json({ slots: rows.map(slotView) }, 200);
  });

  app.openapi(createSlotRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { date, startMin, endMin } = c.req.valid('json');

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    // Domain validation (date + window) — refuses bad input the zod schema can't
    // express (e.g. a non-existent calendar date like 2026-02-30).
    const candidate = createSlot({ id: 'candidate', date, startMin, endMin });
    if (!candidate.ok) return c.json({ error: 'invalid_slot', reason: candidate.reason }, 400);

    // Overlap guard against this Provider's active slots (open + held).
    const activeRows = (await db
      .selectFrom('provider_slots')
      .select(['id', 'slot_date', 'start_min', 'end_min', 'state', 'held_by_booking_id'])
      .where('provider_id', '=', provider.id)
      .where('state', '!=', 'released')
      .execute()) as SlotRow[];
    const conflicts = findSlotConflicts(candidate.slot, activeRows.map(toSlot));
    if (conflicts.length > 0) {
      return c.json(
        { error: 'slot_overlap', reason: 'this window overlaps an existing slot on the same day' },
        409,
      );
    }

    const inserted = (await db
      .insertInto('provider_slots')
      .values({ provider_id: provider.id, slot_date: date, start_min: startMin, end_min: endMin, state: 'open' })
      .returning(['id', 'slot_date', 'start_min', 'end_min', 'state', 'held_by_booking_id'])
      .executeTakeFirstOrThrow()) as SlotRow;

    return c.json(slotView(inserted), 201);
  });

  app.openapi(withdrawSlotRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { slotId } = c.req.valid('param');

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    const row = (await db
      .selectFrom('provider_slots')
      .select(['id', 'slot_date', 'start_min', 'end_min', 'state', 'held_by_booking_id'])
      .where('id', '=', slotId)
      .where('provider_id', '=', provider.id)
      .executeTakeFirst()) as SlotRow | undefined;
    if (!row) return c.json({ error: 'slot_not_found' }, 404);

    const result = withdrawSlot(toSlot(row));
    if (!result.ok) return c.json({ error: 'slot_held', reason: result.reason }, 409);

    await db
      .updateTable('provider_slots')
      .set({ state: 'released', held_by_booking_id: null, updated_at: new Date() })
      .where('id', '=', slotId)
      .where('provider_id', '=', provider.id)
      .execute();

    return c.json({ withdrawn: true as const }, 200);
  });
}
