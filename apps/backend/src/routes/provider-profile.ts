import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { findHomeChildcareLicenseBoard } from '@our-haven/domain';
import {
  AVAILABILITY_BANDS,
  AVAILABILITY_DAYS,
  AVAILABILITY_NOTE_MAX_CHARS,
  CAREGIVER_CATEGORIES,
  normaliseAvailabilityGrid,
  SUPPLY_ROLES,
  US_STATES_50_PLUS_DC,
  type AvailabilityBand,
  type AvailabilityDay,
  type AvailabilityGrid,
  type CaregiverCategory,
  type SupplyRole,
  type UsState,
} from '@our-haven/shared';

/**
 * Provider profile editor surface (OH-109) — backs the supply onboarding +
 * profile + availability pages (any supply role: caregiver | provider).
 *
 * Conditional fields:
 *   - per_child_surcharge_cents → Babysitter / Nanny only (PRD story 47).
 *   - w10_tax_credit_friendly   → Babysitter / Nanny only (PRD § CDCTC).
 *
 * Tutor + Provider (clinical) Bookings are single-child, so a multi-child
 * surcharge is not meaningful. Providers publish a per-session rate; Caregivers
 * an hourly rate — the unit is implied by `role` and rendered on the client.
 */

const AvailabilityBandFlags = z
  .object({
    morning: z.boolean().optional(),
    afternoon: z.boolean().optional(),
    evening: z.boolean().optional(),
  })
  .strict();

const AvailabilityGridSchema = z
  .object({
    mon: AvailabilityBandFlags.optional(),
    tue: AvailabilityBandFlags.optional(),
    wed: AvailabilityBandFlags.optional(),
    thu: AvailabilityBandFlags.optional(),
    fri: AvailabilityBandFlags.optional(),
    sat: AvailabilityBandFlags.optional(),
    sun: AvailabilityBandFlags.optional(),
  })
  .strict();

const StateRegisteredHomeChildcareBadgeSchema = z.object({
  state: z.enum(US_STATES_50_PLUS_DC),
  agencyName: z.string(),
  programName: z.string(),
  verifiedAt: z.iso.datetime(),
});

const ProfileResponse = z.object({
  providerId: z.uuid(),
  role: z.enum(SUPPLY_ROLES),
  categories: z.array(z.enum(CAREGIVER_CATEGORIES)).nullable(),
  specialty: z.enum(['slp', 'ot', 'aba', 'psychology', 'other']).nullable(),
  displayName: z.string().nullable(),
  headline: z.string().nullable(),
  bio: z.string().nullable(),
  languages: z.array(z.string()),
  specialtyTags: z.array(z.string()),
  photoObjectPath: z.string().nullable(),
  publishedRateCents: z.number().int().nullable(),
  perChildSurchargeCents: z.number().int().nullable(),
  availabilityGrid: AvailabilityGridSchema,
  availabilityNote: z.string().nullable(),
  paused: z.boolean(),
  w10TaxCreditFriendly: z.boolean(),
  rateUnit: z.enum(['hour', 'session']),
  multiChildSurchargeEligible: z.boolean(),
  w10Eligible: z.boolean(),
  /**
   * Optional "State-registered home childcare" badge (OH-108). Present only
   * when a Babysitter / Nanny Caregiver has uploaded a state home-childcare
   * registration certificate AND admin recorded a `verified` decision. The
   * `state` + agency labels come from the upload-time state, so they keep
   * naming the right agency even if the Provider later moves.
   */
  stateRegisteredHomeChildcareBadge: StateRegisteredHomeChildcareBadgeSchema.nullable(),
});

const ProfilePatchRequest = z
  .object({
    displayName: z.string().min(1).max(80).nullable().optional(),
    headline: z.string().min(1).max(120).nullable().optional(),
    bio: z.string().min(1).max(600).nullable().optional(),
    languages: z.array(z.string().min(1).max(40)).max(10).optional(),
    specialtyTags: z.array(z.string().min(1).max(40)).max(20).optional(),
    photoObjectPath: z.string().min(1).max(512).nullable().optional(),
    publishedRateCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
    perChildSurchargeCents: z.number().int().min(0).max(100_000).nullable().optional(),
    availabilityGrid: AvailabilityGridSchema.optional(),
    availabilityNote: z.string().max(AVAILABILITY_NOTE_MAX_CHARS).nullable().optional(),
    paused: z.boolean().optional(),
    w10TaxCreditFriendly: z.boolean().optional(),
  })
  .strict();

const ErrorResponse = z.object({
  error: z.string(),
  reason: z.string().optional(),
});

interface ProviderRow {
  id: string;
  uid: string;
  role: 'caregiver' | 'provider';
  categories: string[] | null;
  specialty: string | null;
}

interface HomeChildcareRegistrationRow {
  state_at_upload: string | null;
  decision: 'verified' | 'rejected' | null;
  decision_at: Date | null;
}

interface BadgeShape {
  state: UsState;
  agencyName: string;
  programName: string;
  verifiedAt: string;
}

function badgeFromRegistration(row: HomeChildcareRegistrationRow | null): BadgeShape | null {
  if (!row || row.decision !== 'verified' || !row.state_at_upload || !row.decision_at) return null;
  const state = row.state_at_upload as UsState;
  const board = findHomeChildcareLicenseBoard(state);
  if (!board) return null;
  const at = row.decision_at instanceof Date ? row.decision_at : new Date(row.decision_at);
  return {
    state,
    agencyName: board.agencyName,
    programName: board.programName,
    verifiedAt: at.toISOString(),
  };
}

interface ProfileRow {
  provider_id: string;
  display_name: string | null;
  headline: string | null;
  bio: string | null;
  languages: string[];
  specialty_tags: string[];
  photo_object_path: string | null;
  published_rate_cents: number | null;
  per_child_surcharge_cents: number | null;
  availability_grid: AvailabilityGrid;
  availability_note: string | null;
  paused: boolean;
  w10_tax_credit_friendly: boolean;
}

/** Babysitter / Nanny Caregivers are the only multi-child (per-child surcharge + W-10) eligible supply. */
function isMultiChildCaregiver(provider: ProviderRow): boolean {
  const cats = provider.categories ?? [];
  return provider.role === 'caregiver' && (cats.includes('babysitter') || cats.includes('nanny'));
}

function rateUnitFor(role: 'caregiver' | 'provider'): 'hour' | 'session' {
  return role === 'provider' ? 'session' : 'hour';
}

function toResponse(
  provider: ProviderRow,
  row: ProfileRow,
  registration: HomeChildcareRegistrationRow | null,
) {
  const eligible = isMultiChildCaregiver(provider);
  return {
    providerId: provider.id,
    role: provider.role as SupplyRole,
    categories: provider.categories as CaregiverCategory[] | null,
    specialty: provider.specialty as 'slp' | 'ot' | 'aba' | 'psychology' | 'other' | null,
    displayName: row.display_name,
    headline: row.headline,
    bio: row.bio,
    languages: row.languages ?? [],
    specialtyTags: row.specialty_tags ?? [],
    photoObjectPath: row.photo_object_path,
    publishedRateCents: row.published_rate_cents,
    perChildSurchargeCents: row.per_child_surcharge_cents,
    availabilityGrid: row.availability_grid ?? {},
    availabilityNote: row.availability_note,
    paused: row.paused,
    w10TaxCreditFriendly: row.w10_tax_credit_friendly,
    rateUnit: rateUnitFor(provider.role),
    multiChildSurchargeEligible: eligible,
    w10Eligible: eligible,
    stateRegisteredHomeChildcareBadge: eligible ? badgeFromRegistration(registration) : null,
  };
}

type PatchBody = z.infer<typeof ProfilePatchRequest>;

interface CategoryGateError {
  error: string;
  reason: string;
}

function checkCategoryGates(provider: ProviderRow, body: PatchBody): CategoryGateError | null {
  const eligible = isMultiChildCaregiver(provider);
  if (!eligible) {
    if (body.perChildSurchargeCents !== undefined && body.perChildSurchargeCents !== null) {
      return {
        error: 'per_child_surcharge_not_eligible',
        reason: 'per-child surcharge is only available for Babysitter and Nanny caregivers',
      };
    }
    if (body.w10TaxCreditFriendly === true) {
      return {
        error: 'w10_not_eligible',
        reason: 'W-10 tax-credit-friendly badge is only available for Babysitter and Nanny caregivers',
      };
    }
  }
  return null;
}

function emptyProfileRow(providerId: string): ProfileRow {
  return {
    provider_id: providerId,
    display_name: null,
    headline: null,
    bio: null,
    languages: [],
    specialty_tags: [],
    photo_object_path: null,
    published_rate_cents: null,
    per_child_surcharge_cents: null,
    availability_grid: {},
    availability_note: null,
    paused: false,
    w10_tax_credit_friendly: false,
  };
}

function gridToStorage(grid: AvailabilityGrid): AvailabilityGrid {
  return normaliseAvailabilityGrid(grid);
}

export const providerProfileRoutes: FastifyPluginAsyncZod = async (app) => {
  async function loadProvider(uid: string): Promise<ProviderRow | null> {
    const row = await app.deps.db
      .selectFrom('providers')
      .select(['id', 'uid', 'role', 'categories', 'specialty'])
      .where('uid', '=', uid)
      .executeTakeFirst();
    return row ? (row as ProviderRow) : null;
  }

  async function loadOrCreateProfile(providerId: string): Promise<ProfileRow> {
    const existing = await app.deps.db
      .selectFrom('provider_profiles')
      .selectAll()
      .where('provider_id', '=', providerId)
      .executeTakeFirst();
    if (existing) return existing as ProfileRow;

    const inserted = await app.deps.db
      .insertInto('provider_profiles')
      .values({ provider_id: providerId })
      .returningAll()
      .executeTakeFirstOrThrow();
    return inserted as ProfileRow;
  }

  async function loadHomeChildcareRegistration(
    providerId: string,
  ): Promise<HomeChildcareRegistrationRow | null> {
    const row = await app.deps.db
      .selectFrom('provider_home_childcare_registrations')
      .select(['state_at_upload', 'decision', 'decision_at'])
      .where('provider_id', '=', providerId)
      .executeTakeFirst();
    return row ? (row as HomeChildcareRegistrationRow) : null;
  }

  app.get(
    '/providers/me/profile',
    {
      preHandler: app.requireAuth({ roles: ['caregiver', 'provider'] }),
      schema: {
        tags: ['providers'],
        summary: "Read the authenticated supply account's public-profile editor state",
        description:
          'Returns the profile fields edited on the supply onboarding surface — published rate, optional per-child surcharge (Babysitter/Nanny only), availability summary grid + note + paused flag, W-10 self-attestation toggle, bio, languages, specialty tags, photo. Creates an empty row on first read so the editor always has a target.',
        security: [{ supabaseAccessToken: [] }],
        response: {
          200: ProfileResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const provider = await loadProvider(principal.uid);
      if (!provider) {
        reply.code(404);
        return { error: 'provider_not_found', reason: 'create a supply row first (POST /v1/providers)' };
      }
      const row = await loadOrCreateProfile(provider.id);
      const registration = await loadHomeChildcareRegistration(provider.id);
      return toResponse(provider, row, registration);
    },
  );

  app.patch(
    '/providers/me/profile',
    {
      preHandler: app.requireAuth({ roles: ['caregiver', 'provider'] }),
      schema: {
        tags: ['providers'],
        summary: "Update the authenticated supply account's public-profile editor state",
        description:
          'Partial update — any field omitted is left untouched. Per-child surcharge and W-10 toggle are rejected with 400 unless the account is a Babysitter or Nanny (role=caregiver + categories includes babysitter|nanny). Availability grid is normalised: only true cells are persisted.',
        security: [{ supabaseAccessToken: [] }],
        body: ProfilePatchRequest,
        response: {
          200: ProfileResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal!;
      const provider = await loadProvider(principal.uid);
      if (!provider) {
        reply.code(404);
        return { error: 'provider_not_found', reason: 'create a supply row first (POST /v1/providers)' };
      }

      const body = req.body;
      const gateErr = checkCategoryGates(provider, body);
      if (gateErr) {
        reply.code(400);
        return gateErr;
      }

      await loadOrCreateProfile(provider.id);

      const updates: Record<string, unknown> = { updated_at: new Date() };
      if (body.displayName !== undefined) updates.display_name = body.displayName;
      if (body.headline !== undefined) updates.headline = body.headline;
      if (body.bio !== undefined) updates.bio = body.bio;
      if (body.languages !== undefined) updates.languages = body.languages;
      if (body.specialtyTags !== undefined) updates.specialty_tags = body.specialtyTags;
      if (body.photoObjectPath !== undefined) updates.photo_object_path = body.photoObjectPath;
      if (body.publishedRateCents !== undefined) updates.published_rate_cents = body.publishedRateCents;
      if (body.perChildSurchargeCents !== undefined)
        updates.per_child_surcharge_cents = body.perChildSurchargeCents;
      if (body.availabilityGrid !== undefined)
        updates.availability_grid = gridToStorage(body.availabilityGrid as AvailabilityGrid);
      if (body.availabilityNote !== undefined) updates.availability_note = body.availabilityNote;
      if (body.paused !== undefined) updates.paused = body.paused;
      if (body.w10TaxCreditFriendly !== undefined)
        updates.w10_tax_credit_friendly = body.w10TaxCreditFriendly;

      const updated = await app.deps.db
        .updateTable('provider_profiles')
        .set(updates)
        .where('provider_id', '=', provider.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      const registration = await loadHomeChildcareRegistration(provider.id);
      return toResponse(provider, updated as ProfileRow, registration);
    },
  );
};

// Re-exports for tests that want the union types without re-deriving from Zod.
export type ProviderProfilePatch = z.infer<typeof ProfilePatchRequest>;
export type ProviderProfileResponse = z.infer<typeof ProfileResponse>;
export { AVAILABILITY_BANDS, AVAILABILITY_DAYS, type AvailabilityBand, type AvailabilityDay };
