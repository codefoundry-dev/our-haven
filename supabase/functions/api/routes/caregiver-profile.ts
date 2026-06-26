import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import { CAREGIVER_CATEGORIES, type CaregiverCategory } from '../auth/taxonomy.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
// Cross-tree, Deno-clean domain/shared modules (ADR-0019; the same explicit-`.ts`
// pattern caregiver-badges.ts uses). All three carry no runtime `@our-haven/*`
// import, so they deploy unchanged on Deno.
import {
  fromRateCents,
  normaliseProfileTags,
  PROFILE_TAG_MAX_COUNT,
  PROFILE_TAG_MAX_LEN,
  validateCategoryRates,
  type CategoryRate,
} from '../../../../packages/domain/src/caregiver-profile/index.ts';
import {
  CREDENTIAL_TYPES,
  caregiverFacingStatusLabel,
  clinicalTitleMatches,
  hasClinicalTitleConflict,
  reviewCredential,
  type CredentialReviewState,
  type CredentialType,
} from '../../../../packages/domain/src/credentials/index.ts';
import {
  AGE_BANDS,
  SAFETY_BEHAVIORS,
  normaliseAgeBands,
  normaliseSafetyBehaviors,
} from '../../../../packages/shared/src/safety-behaviors.ts';
import {
  AVAILABILITY_NOTE_MAX_CHARS,
  normaliseAvailabilityGrid,
  type AvailabilityGrid,
} from '../../../../packages/shared/src/availability.ts';

/**
 * Caregiver profile builder (OH-188) — ADR-0015 / ADR-0016 / ADR-0017.
 *
 * The unified Caregiver-editable profile (CONTEXT.md § Rate / § negotiable /
 * § Ages served & behaviour-comfort / § Credentials):
 *
 *   GET   /v1/providers/me/profile                 read the full editable profile
 *   PATCH /v1/providers/me/profile                 update it (partial)
 *   POST  /v1/providers/me/credentials             add a Credential (→ pending)
 *   DELETE/v1/providers/me/credentials/{id}        remove a Credential
 *   GET   /v1/admin/providers/{id}/credentials     admin — list for review
 *   POST  /v1/admin/providers/{id}/credentials/{credentialId}/decision  approve|reject
 *
 * Persistence (OH-188 migration):
 *   - per-category Published Rate (+ Babysitter/Nanny per-child surcharge) →
 *     `provider_category_rates`,
 *   - person-level `negotiable` / `ages_served` / `behaviour_comfort` +
 *     availability + identity → `provider_profiles`,
 *   - the Credentials umbrella → `caregiver_credentials` (born `pending`, hidden
 *     from the public profile until an admin approves it).
 *
 * Nothing here gates activation — Credentials and the profile are search-/
 * discoverability surfaces, decoupled from `provider_verifications`. Taxonomy
 * membership for ages/behaviour is enforced here (zod enum + domain normalise),
 * NOT in the DB, so swapping Ci'erro's final Safety-Behaviors list (M2.10) needs
 * no migration.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('CaregiverProfileError');

const CategoryEnum = z.enum(CAREGIVER_CATEGORIES);
const AgeBandEnum = z.enum(AGE_BANDS);
const SafetyBehaviorEnum = z.enum(SAFETY_BEHAVIORS);
const CredentialTypeEnum = z.enum(CREDENTIAL_TYPES);
const ReviewStateEnum = z.enum(['pending', 'approved', 'rejected']);

/* ── schemas ────────────────────────────────────────────────────────────────── */

const CategoryRateSchema = z
  .object({
    category: CategoryEnum,
    publishedRateCents: z.number().int().min(0),
    /** Babysitter / Nanny only; null for Tutor and for an unset surcharge. */
    perChildSurchargeCents: z.number().int().min(0).nullable(),
  })
  .openapi('CaregiverCategoryRate');

const AvailabilityGridSchema = z
  .record(z.string(), z.record(z.string(), z.boolean()))
  .openapi('CaregiverAvailabilityGrid');

const CredentialSchema = z
  .object({
    id: z.string().uuid(),
    type: CredentialTypeEnum,
    label: z.string(),
    review: ReviewStateEnum,
    /** Caregiver-facing copy: "Pending review" / "Approved" / "Not approved". */
    statusLabel: z.string(),
    rejectionReason: z.string().nullable(),
    /** Whether a `title` reads as a licensed clinical role (admin-assist flag). */
    clinicalFlag: z.boolean(),
  })
  .openapi('CaregiverCredential');

const ProfileResponse = z
  .object({
    providerId: z.string(),
    categories: z.array(CategoryEnum),
    displayName: z.string().nullable(),
    headline: z.string().nullable(),
    bio: z.string().nullable(),
    /** 5-digit US ZIP (search proximity + display). Null until set. */
    zip: z.string().nullable(),
    /** Whole years of childcare/tutoring experience (0–75). Null until set. */
    yearsExperience: z.number().int().nullable(),
    /** Free-text languages the Caregiver speaks (e.g. "English", "Spanish"). */
    languages: z.array(z.string()),
    /** Free-text specialty tags (e.g. "Math", "Test prep"). */
    specialties: z.array(z.string()),
    /** Storage key of the profile photo (avatar/<uid>/<uuid>), or null. */
    photoObjectPath: z.string().nullable(),
    /** Public URL of the profile photo derived from photoObjectPath, or null. */
    photoUrl: z.string().nullable(),
    categoryRates: z.array(CategoryRateSchema),
    /** Lowest Published Rate across categories — the "from $X" teaser. Null if unpriced. */
    fromRateCents: z.number().int().nullable(),
    availabilityGrid: AvailabilityGridSchema,
    availabilityNote: z.string().nullable(),
    paused: z.boolean(),
    negotiable: z.boolean(),
    agesServed: z.array(AgeBandEnum),
    behaviourComfort: z.array(SafetyBehaviorEnum),
    credentials: z.array(CredentialSchema),
  })
  .openapi('CaregiverProfile');

const ProfilePatchRequest = z
  .object({
    displayName: z.string().max(80).nullable().optional(),
    headline: z.string().max(120).nullable().optional(),
    bio: z.string().max(600).nullable().optional(),
    /** 5-digit US ZIP, or null to clear it. */
    zip: z
      .string()
      .regex(/^\d{5}$/, 'expected a 5-digit US ZIP')
      .nullable()
      .optional(),
    /** Whole years of experience (0–75), or null to clear it. */
    yearsExperience: z.number().int().min(0).max(75).nullable().optional(),
    /** Replaces the full languages list; trimmed/de-duped/capped server-side. */
    languages: z.array(z.string().max(PROFILE_TAG_MAX_LEN)).max(PROFILE_TAG_MAX_COUNT).optional(),
    /** Replaces the full specialties list; trimmed/de-duped/capped server-side. */
    specialties: z.array(z.string().max(PROFILE_TAG_MAX_LEN)).max(PROFILE_TAG_MAX_COUNT).optional(),
    /** Confirmed avatar Storage key (avatar/<uid>/<uuid>), or null to clear the photo. */
    photoObjectPath: z.string().nullable().optional(),
    /** Replaces the FULL set of per-category Rates when present. */
    categoryRates: z.array(CategoryRateSchema).optional(),
    availabilityGrid: AvailabilityGridSchema.optional(),
    availabilityNote: z.string().max(AVAILABILITY_NOTE_MAX_CHARS).nullable().optional(),
    paused: z.boolean().optional(),
    negotiable: z.boolean().optional(),
    agesServed: z.array(AgeBandEnum).optional(),
    behaviourComfort: z.array(SafetyBehaviorEnum).optional(),
  })
  .openapi('CaregiverProfilePatchRequest');

const CredentialCreateRequest = z
  .object({
    type: CredentialTypeEnum,
    label: z.string().min(1).max(120),
  })
  .openapi('CaregiverCredentialCreateRequest');

const CredentialCreateResponse = z
  .object({ credential: CredentialSchema })
  .openapi('CaregiverCredentialCreateResponse');

const AdminCredentialSchema = CredentialSchema.extend({
  providerId: z.string(),
  /** The clinical terms detected in the label, for the admin to explain a rejection. */
  clinicalMatches: z.array(z.string()),
}).openapi('AdminCaregiverCredential');

const AdminCredentialListResponse = z
  .object({ providerId: z.string(), credentials: z.array(AdminCredentialSchema) })
  .openapi('AdminCaregiverCredentialList');

const AdminCredentialDecisionRequest = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().max(2000).optional(),
  })
  .openapi('AdminCaregiverCredentialDecisionRequest');

const ProviderIdParam = z.object({
  providerId: z.string().uuid().openapi({ param: { name: 'providerId', in: 'path' } }),
});
const CredentialIdParam = z.object({
  credentialId: z.string().uuid().openapi({ param: { name: 'credentialId', in: 'path' } }),
});

/* ── row shapes + helpers ───────────────────────────────────────────────────── */

interface ProviderRow {
  id: string;
  uid: string;
  role: 'caregiver' | 'provider';
  categories: string[] | null;
  specialty: string | null;
  state: string;
}

interface ProfileRow {
  display_name: string | null;
  headline: string | null;
  bio: string | null;
  zip: string | null;
  years_experience: number | null;
  languages: string[];
  specialty_tags: string[];
  photo_object_path: string | null;
  availability_grid: AvailabilityGrid;
  availability_note: string | null;
  paused: boolean;
  negotiable: boolean;
  ages_served: string[];
  behaviour_comfort: string[];
}

/** Public URL for an avatars-bucket object key, or null when no photo is set. */
function photoUrlFor(supabaseUrl: string, bucket: string, objectPath: string | null): string | null {
  if (!objectPath) return null;
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${objectPath}`;
}

interface CategoryRateRow {
  category: string;
  published_rate_cents: number;
  per_child_surcharge_cents: number | null;
}

interface CredentialRow {
  id: string;
  provider_id: string;
  type: CredentialType;
  label: string;
  review_state: CredentialReviewState;
  rejection_reason: string | null;
}

async function loadProviderByUid(db: Db, uid: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'categories', 'specialty', 'state'])
    .where('uid', '=', uid)
    .executeTakeFirst();
  return row ? (row as ProviderRow) : null;
}

async function loadProviderById(db: Db, providerId: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'categories', 'specialty', 'state'])
    .where('id', '=', providerId)
    .executeTakeFirst();
  return row ? (row as ProviderRow) : null;
}

function credentialView(row: CredentialRow) {
  return {
    id: row.id,
    type: row.type,
    label: row.label,
    review: row.review_state,
    statusLabel: caregiverFacingStatusLabel(row.review_state),
    rejectionReason: row.rejection_reason,
    clinicalFlag: hasClinicalTitleConflict({ type: row.type, label: row.label }),
  };
}

/** Assemble the full profile response from the persisted rows. */
async function buildProfile(
  db: Db,
  storage: { SUPABASE_URL: string; AVATAR_BUCKET: string },
  provider: ProviderRow,
) {
  const profile = (await db
    .selectFrom('provider_profiles')
    .select([
      'display_name',
      'headline',
      'bio',
      'zip',
      'years_experience',
      'languages',
      'specialty_tags',
      'photo_object_path',
      'availability_grid',
      'availability_note',
      'paused',
      'negotiable',
      'ages_served',
      'behaviour_comfort',
    ])
    .where('provider_id', '=', provider.id)
    .executeTakeFirst()) as ProfileRow | undefined;

  const rateRows = (await db
    .selectFrom('provider_category_rates')
    .select(['category', 'published_rate_cents', 'per_child_surcharge_cents'])
    .where('provider_id', '=', provider.id)
    .execute()) as CategoryRateRow[];

  const categoryRates: CategoryRate[] = rateRows.map((r) => ({
    category: r.category as CaregiverCategory,
    publishedRateCents: r.published_rate_cents,
    perChildSurchargeCents: r.per_child_surcharge_cents,
  }));

  const credentialRows = (await db
    .selectFrom('caregiver_credentials')
    .select(['id', 'provider_id', 'type', 'label', 'review_state', 'rejection_reason'])
    .where('provider_id', '=', provider.id)
    .orderBy('created_at', 'asc')
    .execute()) as CredentialRow[];

  return {
    providerId: provider.id,
    categories: (provider.categories ?? []) as CaregiverCategory[],
    displayName: profile?.display_name ?? null,
    headline: profile?.headline ?? null,
    bio: profile?.bio ?? null,
    zip: profile?.zip ?? null,
    yearsExperience: profile?.years_experience ?? null,
    languages: profile?.languages ?? [],
    specialties: profile?.specialty_tags ?? [],
    photoObjectPath: profile?.photo_object_path ?? null,
    photoUrl: photoUrlFor(storage.SUPABASE_URL, storage.AVATAR_BUCKET, profile?.photo_object_path ?? null),
    categoryRates,
    fromRateCents: fromRateCents(categoryRates),
    availabilityGrid: (profile?.availability_grid ?? {}) as AvailabilityGrid,
    availabilityNote: profile?.availability_note ?? null,
    paused: profile?.paused ?? false,
    negotiable: profile?.negotiable ?? true,
    agesServed: normaliseAgeBands(profile?.ages_served ?? []),
    behaviourComfort: normaliseSafetyBehaviors(profile?.behaviour_comfort ?? []),
    credentials: credentialRows.map(credentialView),
  };
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

/* ── route definitions ──────────────────────────────────────────────────────── */

const getProfileRoute = createRoute({
  method: 'get',
  path: '/providers/me/profile',
  tags: ['profile'],
  summary: "Read the authenticated Caregiver's editable profile",
  description:
    'Returns the unified Caregiver profile: identity, per-category Published Rates (+ surcharge) with the derived "from $X" teaser, availability grid/note/paused, the negotiable toggle, ages-served + behaviour-comfort, and Credentials (each with its caregiver-facing status — pending Credentials are visible to the Caregiver here but hidden on the public Parent view).',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  responses: {
    200: { description: 'The editable profile', content: json(ProfileResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (provider / parent / admin)', content: json(ErrorResponse) },
    404: { description: 'Supply (caregiver) row not found', content: json(ErrorResponse) },
  },
});

const patchProfileRoute = createRoute({
  method: 'patch',
  path: '/providers/me/profile',
  tags: ['profile'],
  summary: "Update the authenticated Caregiver's profile (partial)",
  description:
    'Partial update — only the supplied fields change. `categoryRates`, when present, replaces the FULL set of per-category Rates (each must be one of the Caregiver\'s own categories; a per-child surcharge is rejected for Tutor — Babysitter/Nanny only). `agesServed` / `behaviourComfort` are validated against the shared age-band / Safety-Behaviors taxonomy. Availability note is capped at 200 chars.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { body: { content: json(ProfilePatchRequest), required: true } },
  responses: {
    200: { description: 'The updated profile', content: json(ProfileResponse) },
    400: { description: 'Invalid rates / fields', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Supply (caregiver) row not found', content: json(ErrorResponse) },
  },
});

const addCredentialRoute = createRoute({
  method: 'post',
  path: '/providers/me/credentials',
  tags: ['profile'],
  summary: 'Add a Caregiver Credential (title / certification / training)',
  description:
    'Creates a Credential in `pending` review — hidden from the public profile until an admin approves it. A `title` that reads as a licensed clinical role is accepted but flagged (`clinicalFlag`) so the UI can warn it may be rejected (protecting the Caregiver/Provider line). Never gates activation.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { body: { content: json(CredentialCreateRequest), required: true } },
  responses: {
    201: { description: 'Credential created (pending)', content: json(CredentialCreateResponse) },
    400: { description: 'Invalid credential', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Supply (caregiver) row not found', content: json(ErrorResponse) },
  },
});

const deleteCredentialRoute = createRoute({
  method: 'delete',
  path: '/providers/me/credentials/{credentialId}',
  tags: ['profile'],
  summary: 'Remove one of the authenticated Caregiver\'s Credentials',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['caregiver'] })] as const,
  request: { params: CredentialIdParam },
  responses: {
    200: { description: 'Credential removed', content: json(z.object({ deleted: z.literal(true) })) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role', content: json(ErrorResponse) },
    404: { description: 'Credential not found (or not owned)', content: json(ErrorResponse) },
  },
});

const adminListCredentialsRoute = createRoute({
  method: 'get',
  path: '/admin/providers/{providerId}/credentials',
  tags: ['admin', 'profile'],
  summary: "Admin — list a Caregiver's Credentials for review",
  description:
    'Returns every Credential with its review state, the clinical-title flag, and the detected clinical terms (`clinicalMatches`) so the admin can explain a rejection. Admin role requires aal2 + TOTP.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['admin'] })] as const,
  request: { params: ProviderIdParam },
  responses: {
    200: { description: 'Credentials for review', content: json(AdminCredentialListResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Not an admin / TOTP required', content: json(ErrorResponse) },
    404: { description: 'Caregiver not found', content: json(ErrorResponse) },
  },
});

const adminDecideCredentialRoute = createRoute({
  method: 'post',
  path: '/admin/providers/{providerId}/credentials/{credentialId}/decision',
  tags: ['admin', 'profile'],
  summary: 'Admin — approve or reject a Caregiver Credential',
  description:
    'Applies an admin review decision. Only a `pending` Credential can be decided (approved / rejected are terminal in v1 — resubmission is the path to re-review). On approve the Credential becomes publicly visible; on reject it carries the reason. Decoupled from the Verification state machine.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['admin'] })] as const,
  request: {
    params: ProviderIdParam.merge(CredentialIdParam),
    body: { content: json(AdminCredentialDecisionRequest), required: true },
  },
  responses: {
    200: { description: 'Decision recorded', content: json(AdminCredentialSchema) },
    400: { description: 'Invalid request', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Not an admin / TOTP required', content: json(ErrorResponse) },
    404: { description: 'Caregiver / credential not found', content: json(ErrorResponse) },
    409: { description: 'Credential is not pending', content: json(ErrorResponse) },
  },
});

/* ── handlers ───────────────────────────────────────────────────────────────── */

export function registerCaregiverProfileRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(getProfileRoute, async (c) => {
    const { db, env } = c.var.deps;
    const principal = c.get('principal')!;

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) {
      return c.json(
        { error: 'provider_not_found', reason: 'claim a supply role first (POST /v1/auth/role-claim)' },
        404,
      );
    }
    return c.json(await buildProfile(db, env, provider), 200);
  });

  app.openapi(patchProfileRoute, async (c) => {
    const { db, env } = c.var.deps;
    const principal = c.get('principal')!;
    const patch = c.req.valid('json');

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    // A confirmed avatar must be in THIS uid's namespace — the only path the
    // client could have been issued a signed upload URL for (uploads route).
    if (patch.photoObjectPath != null && !patch.photoObjectPath.startsWith(`avatar/${principal.uid}/`)) {
      return c.json({ error: 'invalid_photo_path', reason: 'photoObjectPath is not an owned avatar object' }, 400);
    }

    // Validate the per-category Rates against the Caregiver's own categories
    // BEFORE any write (surcharge eligibility, ownership, dedupe — domain rule).
    let validatedRates: CategoryRate[] | null = null;
    if (patch.categoryRates !== undefined) {
      const result = validateCategoryRates(
        patch.categoryRates,
        (provider.categories ?? []) as CaregiverCategory[],
      );
      if (!result.ok) return c.json({ error: 'invalid_category_rates', reason: result.reason }, 400);
      validatedRates = result.rates;
    }

    await ensureProfileRow(db, provider.id);

    // Build the provider_profiles patch from only the supplied fields.
    const now = new Date();
    const set: Record<string, unknown> = { updated_at: now };
    if (patch.displayName !== undefined) set.display_name = patch.displayName;
    if (patch.headline !== undefined) set.headline = patch.headline;
    if (patch.bio !== undefined) set.bio = patch.bio;
    if (patch.zip !== undefined) set.zip = patch.zip;
    if (patch.yearsExperience !== undefined) set.years_experience = patch.yearsExperience;
    if (patch.languages !== undefined) set.languages = normaliseProfileTags(patch.languages);
    if (patch.specialties !== undefined) set.specialty_tags = normaliseProfileTags(patch.specialties);
    if (patch.photoObjectPath !== undefined) set.photo_object_path = patch.photoObjectPath;
    if (patch.availabilityGrid !== undefined) {
      set.availability_grid = normaliseAvailabilityGrid(patch.availabilityGrid as AvailabilityGrid);
    }
    if (patch.availabilityNote !== undefined) set.availability_note = patch.availabilityNote;
    if (patch.paused !== undefined) set.paused = patch.paused;
    if (patch.negotiable !== undefined) set.negotiable = patch.negotiable;
    if (patch.agesServed !== undefined) set.ages_served = normaliseAgeBands(patch.agesServed);
    if (patch.behaviourComfort !== undefined) {
      set.behaviour_comfort = normaliseSafetyBehaviors(patch.behaviourComfort);
    }
    await db.updateTable('provider_profiles').set(set).where('provider_id', '=', provider.id).execute();

    // Replace the full per-category Rate set when supplied, atomically.
    if (validatedRates !== null) {
      const rates = validatedRates;
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('provider_category_rates').where('provider_id', '=', provider.id).execute();
        if (rates.length > 0) {
          await trx
            .insertInto('provider_category_rates')
            .values(
              rates.map((r) => ({
                provider_id: provider.id,
                category: r.category,
                published_rate_cents: r.publishedRateCents,
                per_child_surcharge_cents: r.perChildSurchargeCents,
                updated_at: now,
              })),
            )
            .execute();
        }
      });
    }

    return c.json(await buildProfile(db, env, provider), 200);
  });

  app.openapi(addCredentialRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { type, label } = c.req.valid('json');

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    const inserted = (await db
      .insertInto('caregiver_credentials')
      .values({ provider_id: provider.id, type, label, review_state: 'pending' })
      .returning(['id', 'provider_id', 'type', 'label', 'review_state', 'rejection_reason'])
      .executeTakeFirstOrThrow()) as CredentialRow;

    return c.json({ credential: credentialView(inserted) }, 201);
  });

  app.openapi(deleteCredentialRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { credentialId } = c.req.valid('param');

    const provider = await loadProviderByUid(db, principal.uid);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    const existing = await db
      .selectFrom('caregiver_credentials')
      .select(['id'])
      .where('id', '=', credentialId)
      .where('provider_id', '=', provider.id)
      .executeTakeFirst();
    if (!existing) return c.json({ error: 'credential_not_found' }, 404);

    await db
      .deleteFrom('caregiver_credentials')
      .where('id', '=', credentialId)
      .where('provider_id', '=', provider.id)
      .execute();
    return c.json({ deleted: true as const }, 200);
  });

  app.openapi(adminListCredentialsRoute, async (c) => {
    const { db } = c.var.deps;
    const { providerId } = c.req.valid('param');

    const provider = await loadProviderById(db, providerId);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    const rows = (await db
      .selectFrom('caregiver_credentials')
      .select(['id', 'provider_id', 'type', 'label', 'review_state', 'rejection_reason'])
      .where('provider_id', '=', providerId)
      .orderBy('created_at', 'asc')
      .execute()) as CredentialRow[];

    return c.json(
      {
        providerId,
        credentials: rows.map((r) => ({
          ...credentialView(r),
          providerId: r.provider_id,
          clinicalMatches: r.type === 'title' ? [...clinicalTitleMatches(r.label)] : [],
        })),
      },
      200,
    );
  });

  app.openapi(adminDecideCredentialRoute, async (c) => {
    const { db } = c.var.deps;
    const principal = c.get('principal')!;
    const { providerId, credentialId } = c.req.valid('param');
    const { decision, reason } = c.req.valid('json');

    const provider = await loadProviderById(db, providerId);
    if (!provider) return c.json({ error: 'provider_not_found' }, 404);

    const row = (await db
      .selectFrom('caregiver_credentials')
      .select(['id', 'provider_id', 'type', 'label', 'review_state', 'rejection_reason'])
      .where('id', '=', credentialId)
      .where('provider_id', '=', providerId)
      .executeTakeFirst()) as CredentialRow | undefined;
    if (!row) return c.json({ error: 'credential_not_found' }, 404);

    const result = reviewCredential(row.review_state, {
      type: decision === 'approve' ? 'admin-approve' : 'admin-reject',
      reason,
    });
    if (!result.ok) return c.json({ error: 'credential_not_pending', reason: result.reason }, 409);

    const updated = (await db
      .updateTable('caregiver_credentials')
      .set({ review_state: result.next, rejection_reason: result.rejectionReason, updated_at: new Date() })
      .where('id', '=', credentialId)
      .where('provider_id', '=', providerId)
      .returning(['id', 'provider_id', 'type', 'label', 'review_state', 'rejection_reason'])
      .executeTakeFirstOrThrow()) as CredentialRow;

    return c.json(
      {
        ...credentialView(updated),
        providerId: updated.provider_id,
        clinicalMatches: updated.type === 'title' ? [...clinicalTitleMatches(updated.label)] : [],
      },
      200,
    );
  });
}
