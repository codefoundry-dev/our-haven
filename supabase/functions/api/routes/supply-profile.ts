import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
import { areaLabelForZip, resolveZipCentroid } from '../geo/zip-centroids.ts';
// Reuse the SINGLE listability definition + its row shapes from the search route
// so the profile-detail surface can never disagree with search about who is
// publicly visible (a paused / unverified / unsubscribed supply member must 404
// here exactly as it is omitted from search).
import { isListable, type ProviderSubRow, type VerificationRow } from './search.ts';
// Cross-tree, Deno-clean domain/shared modules (ADR-0019; the explicit-`.ts`
// pattern search.ts / caregiver-profile.ts use). Each carries NO runtime
// `@our-haven/*` import, so it deploys unchanged on Deno.
import {
  fromRateCents,
  type CategoryRate,
} from '../../../../packages/domain/src/caregiver-profile/index.ts';
// The clinical credential-status projection (OH-189) — the Provider-facing badge
// OH-202 deferred. Reused here so the Parent profile view collapses the
// license/insurance/screening facts exactly as the Provider's own builder does.
import {
  deriveCredentialStatus,
  type ClinicalCredentialFacts,
} from '../../../../packages/domain/src/provider-profile/index.ts';
import {
  ctasForRole,
  haversineMiles,
  type GeoPoint,
} from '../../../../packages/domain/src/search/index.ts';
import { projectPublicSupplyRating } from '../../../../packages/domain/src/rating-reveal/index.ts';
import {
  CAREGIVER_CATEGORIES,
  SPECIALTIES,
} from '../../../../packages/shared/src/provider-taxonomy.ts';
import {
  AGE_BANDS,
  SAFETY_BEHAVIORS,
  normaliseAgeBands,
  normaliseSafetyBehaviors,
} from '../../../../packages/shared/src/safety-behaviors.ts';
import {
  renderAvailabilitySummary,
  type AvailabilityGrid,
} from '../../../../packages/shared/src/availability.ts';

/**
 * Parent-facing supply profile detail (OH-202) — CONTEXT.md § Profiles; PRD-0001
 * v1.7 stories 23, 37.
 *
 *   GET /v1/supply/{providerId}   one listable Caregiver/Provider's public profile
 *
 * The destination of a Search result tap: the full Parent-facing profile of a
 * single supply member — identity + headline + bio + photo, per-category Rate(s)
 * (the multi-category "also offers …" story) with the derived "from $X" teaser,
 * the weekly Availability grid + summary, ages-served + behaviour-comfort,
 * languages + specialty tags, the role badges (verified / FCCH / tax-credit),
 * **APPROVED Credentials only** (pending/rejected are never surfaced publicly —
 * the asymmetry caregiver-profile.ts documents), and the **public Ratings** with
 * text reviews (the asymmetric supply-side reveal — rating-reveal
 * `projectPublicSupplyRating`). The response also carries the role-appropriate
 * CTAs the client wires (Caregiver → Message / Book; Provider →
 * Book-a-consultation).
 *
 * Visibility mirrors Search exactly (shared `isListable`): a paused, unverified,
 * unscreened, rejected, or (Provider) unsubscribed supply member 404s — the
 * profile surface never reveals supply that search would not return. The optional
 * `zip` query is the viewer's search origin; when it (and the candidate's ZIP)
 * resolve to a centroid, `distanceMiles` is returned, else null.
 *
 * SCOPE: the Caregiver profile is fully populated (OH-202). The Provider profile
 * is now complete too (OH-203): the `providerCredential` clinical badge (the
 * license/insurance/screening collapse) and the open `consultationSlots` the
 * Parent books are returned here; the booking mutation itself lives in
 * consultation-bookings.ts. The Message / Book CTAs are navigation; the
 * Subscription paywall UI is OH-204 (the booking mutation enforces the gate
 * server-side), and the real messaging thread is OH-205.
 *
 * KNOWN HOLE (flagged, not blocking — same as Search): Ratings have no
 * persistence yet, so `projectPublicSupplyRating` is fed an empty exchange list
 * → `rating` is `{ average: null, count: 0, reviews: [] }`. The reveal projection
 * is wired through now so the capture story only has to supply the rows.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('SupplyProfileError');

/* ── enums ──────────────────────────────────────────────────────────────────── */

const RoleEnum = z.enum(['caregiver', 'provider']);
const CategoryEnum = z.enum(CAREGIVER_CATEGORIES);
const SpecialtyEnum = z.enum(SPECIALTIES);
const AgeBandEnum = z.enum(AGE_BANDS);
const SafetyBehaviorEnum = z.enum(SAFETY_BEHAVIORS);
const CtaEnum = z.enum(['message', 'book', 'book-consultation']);

/* ── response schema ────────────────────────────────────────────────────────── */

const CategoryRateSchema = z
  .object({
    category: CategoryEnum,
    publishedRateCents: z.number().int().min(0),
    /** Babysitter / Nanny only; null for Tutor and for an unset surcharge. */
    perChildSurchargeCents: z.number().int().min(0).nullable(),
  })
  .openapi('SupplyProfileCategoryRate');

const AvailabilityGridSchema = z
  .record(z.string(), z.record(z.string(), z.boolean()))
  .openapi('SupplyProfileAvailabilityGrid');

/** A publicly-visible (admin-approved) Credential — pending/rejected omitted. */
const CredentialSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    label: z.string(),
  })
  .openapi('SupplyProfileCredential');

/** A bookable (open) consultation slot — the Provider slot-pick (OH-203). */
const ConsultationSlotSchema = z
  .object({
    id: z.string(),
    /** Calendar day, ISO `YYYY-MM-DD`. */
    date: z.string(),
    /** Window start/end, minutes-since-midnight (0..1440). */
    startMin: z.number().int(),
    endMin: z.number().int(),
  })
  .openapi('SupplyProfileConsultationSlot');

/**
 * The Provider's Parent-facing clinical credential display (OH-203) — the badge
 * OH-202 deferred. A read-only collapse of the license/insurance/screening facts;
 * null for Caregivers (their public Credentials are the approved-only
 * `credentials` list above).
 */
const ProviderCredentialSchema = z
  .object({
    /** Collapsed badge — `verified` only when every clinical gate is cleared. */
    overall: z.enum(['verified', 'in-review', 'rejected', 'unverified']),
    licenseVerified: z.boolean(),
    insuranceVerified: z.boolean(),
    screeningPassed: z.boolean(),
    /** Whether to show the public "Verified" badge (overall === 'verified'). */
    publiclyVerified: z.boolean(),
  })
  .openapi('SupplyProfileProviderCredential');

/** The public supply-side rating display (aggregate + count + full text). */
const RatingSchema = z
  .object({
    /** Mean stars across revealed, non-withheld Parent→supply ratings, or null. */
    average: z.number().nullable(),
    count: z.number().int(),
    reviews: z.array(z.object({ stars: z.number().int(), text: z.string().nullable() })),
  })
  .openapi('SupplyProfileRating');

const SupplyProfileResponse = z
  .object({
    id: z.string(),
    role: RoleEnum,
    /** Preview/grouping bucket: a Caregiver category or 'provider'. */
    categoryKey: z.string(),
    displayName: z.string().nullable(),
    headline: z.string().nullable(),
    bio: z.string().nullable(),
    photoUrl: z.string().nullable(),
    zip: z.string().nullable(),
    /** Coarse "City, ST" area label; safe to show without an exact ZIP. */
    areaLabel: z.string().nullable(),
    /** Crow-flies miles from the viewer's `zip`, or null when distance is unknown. */
    distanceMiles: z.number().nullable(),
    fromRateCents: z.number().int().nullable(),
    negotiable: z.boolean(),
    yearsExperience: z.number().int().nullable(),
    languages: z.array(z.string()),
    /** Free-text specialty tags (e.g. "Math", "Test prep"). */
    specialtyTags: z.array(z.string()),
    /** Caregiver categories (babysitter|tutor|nanny); empty for Providers. */
    categories: z.array(CategoryEnum),
    /** Provider specialty / license type; null for Caregivers. */
    specialty: SpecialtyEnum.nullable(),
    categoryRates: z.array(CategoryRateSchema),
    agesServed: z.array(AgeBandEnum),
    behaviourComfort: z.array(SafetyBehaviorEnum),
    taxCreditFriendly: z.boolean(),
    fcchBadge: z.boolean(),
    availabilityGrid: AvailabilityGridSchema,
    availabilityNote: z.string().nullable(),
    /** Rendered one-line Availability summary (e.g. "Weekdays, afternoons"). */
    availabilitySummary: z.string().nullable(),
    credentials: z.array(CredentialSchema),
    /** Provider clinical credential badge (OH-203); null for Caregivers. */
    providerCredential: ProviderCredentialSchema.nullable(),
    /** Open (bookable) consultation slots — Providers only; empty for Caregivers. */
    consultationSlots: z.array(ConsultationSlotSchema),
    rating: RatingSchema,
    /** Role-appropriate actions: Caregiver → message+book; Provider → book-consultation. */
    ctas: z.array(CtaEnum),
  })
  .openapi('SupplyProfile');

/* ── row shapes ─────────────────────────────────────────────────────────────── */

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
  languages: string[] | null;
  specialty_tags: string[] | null;
  photo_object_path: string | null;
  published_rate_cents: number | null;
  availability_grid: AvailabilityGrid | null;
  availability_note: string | null;
  paused: boolean | null;
  w10_tax_credit_friendly: boolean | null;
  negotiable: boolean | null;
  ages_served: string[] | null;
  behaviour_comfort: string[] | null;
}
interface RateRow {
  category: string;
  published_rate_cents: number;
  per_child_surcharge_cents: number | null;
}
interface CredentialRow {
  id: string;
  type: string;
  label: string;
  review_state: string;
}
interface SlotRow {
  id: string;
  slot_date: Date | string;
  start_min: number;
  end_min: number;
}
/** The admin's holistic clinical decision + which docs were uploaded (OH-184/186). */
interface SpecialistRow {
  decision: 'verified' | 'rejected' | null;
  license_doc_object_path: string | null;
  insurance_doc_object_path: string | null;
}

/* ── helpers ────────────────────────────────────────────────────────────────── */

function photoUrlFor(supabaseUrl: string, bucket: string, objectPath: string | null): string | null {
  if (!objectPath) return null;
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${objectPath}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function toDateStr(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

async function loadProviderById(db: Db, providerId: string): Promise<ProviderRow | null> {
  const row = await db
    .selectFrom('providers')
    .select(['id', 'uid', 'role', 'categories', 'specialty', 'state'])
    .where('id', '=', providerId)
    .executeTakeFirst();
  return row ? (row as unknown as ProviderRow) : null;
}

/* ── route ──────────────────────────────────────────────────────────────────── */

const ParamSchema = z.object({
  providerId: z.string().uuid().openapi({
    param: { name: 'providerId', in: 'path' },
    description: 'The supply (caregiver/provider) row id, as returned by Search.',
  }),
});

const QuerySchema = z.object({
  zip: z
    .string()
    .regex(/^\d{5}$/)
    .optional()
    .openapi({
      param: { name: 'zip', in: 'query' },
      description: "The viewer's 5-digit US ZIP — the origin for the displayed `distanceMiles`.",
    }),
});

const getSupplyProfileRoute = createRoute({
  method: 'get',
  path: '/supply/{providerId}',
  tags: ['search'],
  summary: 'Read one listable supply member\'s Parent-facing profile (OH-202)',
  description:
    'Returns the full public profile of a single listable Caregiver/Provider: identity, per-category Rates with the "from $X" teaser, availability, ages-served + behaviour-comfort, languages + specialty tags, badges, APPROVED Credentials only, and the public Ratings (with text reviews). For a Provider it also carries the clinical credential badge (`providerCredential`) and the open `consultationSlots` the Parent can book. 404 when the id is unknown OR the supply member is not listable (mirrors Search visibility). Parent-only.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { params: ParamSchema, query: QuerySchema },
  responses: {
    200: { description: 'The supply member\'s public profile', content: json(SupplyProfileResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (caregiver / provider / admin)', content: json(ErrorResponse) },
    404: { description: 'Not found or not listable', content: json(ErrorResponse) },
  },
});

export function registerSupplyProfileRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(getSupplyProfileRoute, async (c) => {
    const { db, env } = c.var.deps;
    const { providerId } = c.req.valid('param');
    const { zip: viewerZip } = c.req.valid('query');

    const provider = await loadProviderById(db, providerId);
    // 404 (not 403) for both unknown + not-listable: never reveal that a hidden
    // supply member exists.
    if (!provider) return c.json({ error: 'profile_not_found' }, 404);

    const [profile, ver, sub, fcch, rateRows, credentialRows, slotRows, specialist] = await Promise.all([
      db
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
          'published_rate_cents',
          'availability_grid',
          'availability_note',
          'paused',
          'w10_tax_credit_friendly',
          'negotiable',
          'ages_served',
          'behaviour_comfort',
        ])
        .where('provider_id', '=', provider.id)
        .executeTakeFirst() as Promise<unknown> as Promise<ProfileRow | undefined>,
      db
        .selectFrom('provider_verifications')
        .select([
          'provider_id',
          'phone_confirmed_at',
          'screening_passed_at',
          'license_verified_at',
          'insurance_verified_at',
          'rejected_at',
        ])
        .where('provider_id', '=', provider.id)
        .executeTakeFirst() as Promise<unknown> as Promise<VerificationRow | undefined>,
      db
        .selectFrom('provider_subscriptions')
        .select(['provider_id', 'status'])
        .where('provider_id', '=', provider.id)
        .executeTakeFirst() as Promise<unknown> as Promise<ProviderSubRow | undefined>,
      db
        .selectFrom('provider_home_childcare_registrations')
        .select(['provider_id', 'decision'])
        .where('provider_id', '=', provider.id)
        .executeTakeFirst() as Promise<unknown> as Promise<{ decision: string | null } | undefined>,
      db
        .selectFrom('provider_category_rates')
        .select(['category', 'published_rate_cents', 'per_child_surcharge_cents'])
        .where('provider_id', '=', provider.id)
        .execute() as Promise<unknown> as Promise<RateRow[]>,
      db
        .selectFrom('caregiver_credentials')
        .select(['id', 'type', 'label', 'review_state'])
        .where('provider_id', '=', provider.id)
        .orderBy('created_at', 'asc')
        .execute() as Promise<unknown> as Promise<CredentialRow[]>,
      // Open (bookable) consultation slots — the Provider slot-pick (OH-203).
      // Empty for Caregivers (they have no provider_slots rows).
      db
        .selectFrom('provider_slots')
        .select(['id', 'slot_date', 'start_min', 'end_min'])
        .where('provider_id', '=', provider.id)
        .where('state', '=', 'open')
        .orderBy('slot_date', 'asc')
        .orderBy('start_min', 'asc')
        .execute() as Promise<unknown> as Promise<SlotRow[]>,
      // The Provider's holistic clinical decision + uploaded-doc facts (OH-184/186),
      // feeding the credential-status collapse. Absent for Caregivers.
      db
        .selectFrom('specialist_credentials')
        .select(['decision', 'license_doc_object_path', 'insurance_doc_object_path'])
        .where('provider_id', '=', provider.id)
        .executeTakeFirst() as Promise<unknown> as Promise<SpecialistRow | undefined>,
    ]);

    // Not searchable yet, paused, or below the activation/listing bar → 404.
    if (!profile) return c.json({ error: 'profile_not_found' }, 404);
    if (profile.paused === true) return c.json({ error: 'profile_not_found' }, 404);
    if (!isListable(provider.role, ver, sub)) return c.json({ error: 'profile_not_found' }, 404);

    const categories = (provider.categories ?? []).filter((cat): cat is (typeof CAREGIVER_CATEGORIES)[number] =>
      (CAREGIVER_CATEGORIES as readonly string[]).includes(cat),
    );

    const categoryRates: CategoryRate[] = rateRows.map((r) => ({
      category: r.category as CategoryRate['category'],
      publishedRateCents: r.published_rate_cents,
      perChildSurchargeCents: r.per_child_surcharge_cents,
    }));

    // "from $X": Caregiver → lowest published per-category Rate; Provider → its
    // single per-session display Rate.
    const from =
      provider.role === 'caregiver' ? fromRateCents(categoryRates) : profile.published_rate_cents ?? null;

    // distance — only when BOTH the viewer's and the candidate's ZIP resolve.
    const viewerPoint: GeoPoint | null = resolveZipCentroid(viewerZip);
    const candidatePoint: GeoPoint | null = resolveZipCentroid(profile.zip);
    const distanceMiles =
      viewerPoint && candidatePoint ? round1(haversineMiles(viewerPoint, candidatePoint)) : null;

    const grid = (profile.availability_grid ?? {}) as AvailabilityGrid;

    // Public Ratings — cold start (no persistence yet): an empty exchange list
    // projects to { count: 0, averageStars: null, items: [] }. Wired through the
    // reveal projection so the capture story only supplies the rows.
    const publicRating = projectPublicSupplyRating([], new Date());

    // Open consultation slots — the Parent's slot-pick surface (OH-203). Always
    // present; non-empty only for a (listed) Provider.
    const consultationSlots = slotRows.map((s) => ({
      id: s.id,
      date: toDateStr(s.slot_date),
      startMin: s.start_min,
      endMin: s.end_min,
    }));

    // Provider clinical credential badge (OH-203) — the display OH-202 deferred.
    // Collapsed via the same domain projection the Provider's own builder uses.
    // (A listable Provider has already cleared license + insurance + screening,
    // so this surfaces the "Verified" trust badge + its breakdown.)
    let providerCredential: z.infer<typeof ProviderCredentialSchema> | null = null;
    if (provider.role === 'provider') {
      const facts: ClinicalCredentialFacts = {
        licenseVerified: ver?.license_verified_at != null,
        insuranceVerified: ver?.insurance_verified_at != null,
        screeningPassed: ver?.screening_passed_at != null,
        rejected: ver?.rejected_at != null || specialist?.decision === 'rejected',
        licenseUploaded: specialist?.license_doc_object_path != null,
        insuranceUploaded: specialist?.insurance_doc_object_path != null,
      };
      const status = deriveCredentialStatus(facts);
      providerCredential = {
        overall: status.overall,
        licenseVerified: facts.licenseVerified,
        insuranceVerified: facts.insuranceVerified,
        screeningPassed: facts.screeningPassed,
        publiclyVerified: status.publiclyVerified,
      };
    }

    const categoryKey = provider.role === 'provider' ? 'provider' : categories[0] ?? 'caregiver';

    const body = {
      id: provider.id,
      role: provider.role,
      categoryKey,
      displayName: profile.display_name ?? null,
      headline: profile.headline ?? null,
      bio: profile.bio ?? null,
      photoUrl: photoUrlFor(env.SUPABASE_URL, env.AVATAR_BUCKET, profile.photo_object_path ?? null),
      zip: profile.zip ?? null,
      areaLabel: areaLabelForZip(profile.zip),
      distanceMiles,
      fromRateCents: from,
      negotiable: profile.negotiable ?? true,
      yearsExperience: profile.years_experience ?? null,
      languages: profile.languages ?? [],
      specialtyTags: profile.specialty_tags ?? [],
      categories,
      specialty: (provider.specialty as (typeof SPECIALTIES)[number] | null) ?? null,
      categoryRates,
      agesServed: normaliseAgeBands(profile.ages_served ?? []),
      behaviourComfort: normaliseSafetyBehaviors(profile.behaviour_comfort ?? []),
      taxCreditFriendly: profile.w10_tax_credit_friendly === true,
      fcchBadge: fcch?.decision === 'verified',
      availabilityGrid: grid,
      availabilityNote: profile.availability_note ?? null,
      availabilitySummary: renderAvailabilitySummary(grid),
      // APPROVED ONLY — pending/rejected Credentials never reach the public view.
      credentials: credentialRows
        .filter((r) => r.review_state === 'approved')
        .map((r) => ({ id: r.id, type: r.type, label: r.label })),
      providerCredential,
      consultationSlots,
      rating: {
        average: publicRating.averageStars,
        count: publicRating.count,
        reviews: publicRating.items.map((i) => ({ stars: i.stars, text: i.text })),
      },
      ctas: ctasForRole(provider.role),
    } as z.infer<typeof SupplyProfileResponse>;

    return c.json(body, 200);
  });
}
