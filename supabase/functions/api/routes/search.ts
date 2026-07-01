import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';

import { requireAuth } from '../auth/middleware.ts';
import type { AppEnv } from '../context.ts';
import type { Db } from '../db/kysely.ts';
import { areaLabelForZip, resolveZipCentroid } from '../geo/zip-centroids.ts';
// Cross-tree, Deno-clean domain/shared modules (ADR-0019; the explicit-`.ts`
// pattern parent-profile.ts / caregiver-profile.ts use). Each imported module is
// import-clean for Deno: search-ranking + search + provider-slot-scheduler +
// parent-subscription carry NO runtime `@our-haven/*` import, and the shared
// modules are pure data.
//
// NB: the domain `caregiver-availability` module is deliberately NOT imported —
// it value-imports `@our-haven/shared` at runtime (not Deno-resolvable), so the
// caregiver grid ∩ window match is reimplemented below from the Deno-clean
// shared availability primitives. The provider slot ∩ window match DOES come
// from the domain (provider-slot-scheduler is self-contained).
import {
  ctasForRole,
  DEFAULT_PREVIEW_FULL_PER_CATEGORY,
  haversineMiles,
  matchesAgeBands,
  matchesBehaviourComfort,
  passesMinRating,
  passesRateCeiling,
  projectPreviewWall,
  type GeoPoint,
  type SupplyCard,
} from '../../../../packages/domain/src/search/index.ts';
import {
  DEFAULT_SEARCH_RADIUS_MILES,
  rankCandidates,
} from '../../../../packages/domain/src/search-ranking/index.ts';
import {
  intersectSlotsWithQuery,
  type ConsultationSlot,
} from '../../../../packages/domain/src/provider-slot-scheduler/index.ts';
import {
  deriveAccessDecision,
  type StripeSubscriptionStatus,
} from '../../../../packages/domain/src/parent-subscription/index.ts';
import {
  CAREGIVER_CATEGORIES,
  SPECIALTIES,
  isCaregiverCategory,
  isSpecialty,
} from '../../../../packages/shared/src/provider-taxonomy.ts';
import {
  AGE_BANDS,
  SAFETY_BEHAVIORS,
  normaliseAgeBands,
  normaliseSafetyBehaviors,
} from '../../../../packages/shared/src/safety-behaviors.ts';
import {
  AVAILABILITY_BANDS,
  BAND_CLOCK_HOURS,
  isAvailable,
  renderAvailabilitySummary,
  type AvailabilityBand,
  type AvailabilityDay,
  type AvailabilityGrid,
} from '../../../../packages/shared/src/availability.ts';

/**
 * Unified Search (OH-201) — CONTEXT.md § Search & filters; PRD-0001 v1.7 stories
 * 10–17, 121; ADR-0006 (paywall) / ADR-0011 (role split).
 *
 *   GET /v1/search   one unified surface across both supply roles
 *
 * A single search across Caregivers (babysitter / tutor / nanny) and clinical
 * Providers (by specialty). Filters: role/category/specialty, ZIP + radius
 * (default 5 mi), date/time (∩ the Caregiver weekly grid OR a Provider's open
 * consultation slots), hourly Rate ceiling, minimum Rating, Tax-credit-friendly
 * (Caregiver only), age range served (both roles), and Caregiver
 * behaviour-comfort (shared Safety-Behaviors taxonomy). Provider sub-filter:
 * license type = `specialty` (in-person vs telehealth is accepted but a no-op —
 * no backing column yet; see notes). Results are ranked by the OH-180 hybrid
 * scorer (`0.5·proximity + 0.3·rating + 0.2·recency`) and then run through the
 * blur-to-unblur PREVIEW WALL: a Parent whose Subscription is NOT active sees
 * the top 1–2 full profiles per category and the rest as blurred teaser cards;
 * an entitled Parent (active|trialing) sees everything unblurred. The blurred
 * payload carries no identifying fields (domain `toBlurred`), so the client
 * cannot un-blur without re-fetching after subscribing.
 *
 * Only ACTIVATED, LISTABLE supply is returned: not paused, phone-confirmed +
 * screening-passed + not rejected; Providers additionally license + insurance
 * verified AND an active|trialing Provider Subscription (the OH-191 listing
 * gate). Caregivers carry no Subscription gate.
 *
 * KNOWN HOLES (flagged, not blocking — wired through, degrade gracefully):
 *   - Ratings have no persistence yet (separate capture story): every candidate
 *     is unrated → `ratingAverage` 0, the rating term is neutral, and the
 *     min-Rating filter passes unrated supply (cold start — `passesMinRating`).
 *   - Recency uses `provider_profiles.updated_at` as a proxy (no `last_active_at`).
 *   - ZIP→distance uses a curated centroid set (geo/zip-centroids.ts); an
 *     unresolved ZIP keeps the candidate but un-distance-filtered/-ranked.
 *   - Provider `delivery` (in-person/telehealth) has no backing column → accepted
 *     but ignored.
 */

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

const ErrorResponse = z
  .object({ error: z.string(), reason: z.string().optional() })
  .openapi('SearchError');

/* ── query ──────────────────────────────────────────────────────────────────── */

const BoolFlag = z.enum(['true', 'false']);

const SearchQuery = z.object({
  role: z.enum(['all', 'caregiver', 'provider']).default('all').openapi({
    param: { name: 'role', in: 'query' },
    description: 'Which supply roles to search. Default both.',
  }),
  category: z.string().optional().openapi({
    param: { name: 'category', in: 'query' },
    description: 'CSV of Caregiver categories (babysitter,tutor,nanny). Caregiver results matching ANY are kept.',
  }),
  specialty: z.string().optional().openapi({
    param: { name: 'specialty', in: 'query' },
    description: 'CSV of Provider specialties / "license type" (slp,ot,aba,psychology,other).',
  }),
  zip: z
    .string()
    .regex(/^\d{5}$/)
    .optional()
    .openapi({ param: { name: 'zip', in: 'query' }, description: '5-digit US ZIP — the search origin for ZIP+radius.' }),
  radiusMiles: z.coerce.number().positive().max(500).optional().openapi({
    param: { name: 'radiusMiles', in: 'query' },
    description: `Search radius in miles (default ${DEFAULT_SEARCH_RADIUS_MILES}). Applied only to candidates whose ZIP resolves to a centroid.`,
  }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .openapi({ param: { name: 'date', in: 'query' }, description: 'ISO date for the date/time filter (with startMin+endMin).' }),
  startMin: z.coerce.number().int().min(0).max(1440).optional().openapi({
    param: { name: 'startMin', in: 'query' },
    description: 'Window start, minutes since midnight (0–1440).',
  }),
  endMin: z.coerce.number().int().min(0).max(1440).optional().openapi({
    param: { name: 'endMin', in: 'query' },
    description: 'Window end, minutes since midnight (start < end ≤ 1440).',
  }),
  maxRateCents: z.coerce.number().int().min(0).optional().openapi({
    param: { name: 'maxRateCents', in: 'query' },
    description: 'Hourly Rate ceiling in cents, matched against the "from $X" lowest published rate.',
  }),
  minRating: z.coerce.number().min(0).max(5).optional().openapi({
    param: { name: 'minRating', in: 'query' },
    description: 'Minimum star Rating (0–5). Cold start: unrated supply passes.',
  }),
  taxCreditFriendly: BoolFlag.optional().openapi({
    param: { name: 'taxCreditFriendly', in: 'query' },
    description: 'When "true", only W-10 Tax-credit-friendly Caregivers (Babysitter/Nanny).',
  }),
  agesServed: z.string().optional().openapi({
    param: { name: 'agesServed', in: 'query' },
    description: 'CSV of age bands (infant,toddler,preschool,school-age,teen). Matches on overlap.',
  }),
  behaviourComfort: z.string().optional().openapi({
    param: { name: 'behaviourComfort', in: 'query' },
    description: 'CSV of Safety-Behaviors (Caregiver behaviour-comfort). Matches on overlap.',
  }),
  delivery: z.enum(['in_person', 'telehealth']).optional().openapi({
    param: { name: 'delivery', in: 'query' },
    description: 'Provider delivery mode. Accepted but NOT YET applied (no backing column).',
  }),
  limit: z.coerce.number().int().min(1).max(100).default(60).openapi({
    param: { name: 'limit', in: 'query' },
    description: 'Max results returned (the top-ranked page). Default 60.',
  }),
});

/* ── response ───────────────────────────────────────────────────────────────── */

const CtaEnum = z.enum(['message', 'book', 'book-consultation']);
const RoleEnum = z.enum(['caregiver', 'provider']);
const CategoryEnum = z.enum(CAREGIVER_CATEGORIES);
const SpecialtyEnum = z.enum(SPECIALTIES);
const AgeBandEnum = z.enum(AGE_BANDS);
const SafetyBehaviorEnum = z.enum(SAFETY_BEHAVIORS);

const FullCard = z
  .object({
    id: z.string(),
    role: RoleEnum,
    /** The preview-wall bucket: a Caregiver category or 'provider'. */
    categoryKey: z.string(),
    displayName: z.string().nullable(),
    headline: z.string().nullable(),
    photoUrl: z.string().nullable(),
    zip: z.string().nullable(),
    /** Coarse area label ("City, ST"); blur-safe. */
    areaLabel: z.string().nullable(),
    /** Crow-flies miles from the search ZIP, or null when distance is unknown. */
    distanceMiles: z.number().nullable(),
    fromRateCents: z.number().int().nullable(),
    negotiable: z.boolean(),
    categories: z.array(CategoryEnum),
    specialty: SpecialtyEnum.nullable(),
    agesServed: z.array(AgeBandEnum),
    behaviourComfort: z.array(SafetyBehaviorEnum),
    taxCreditFriendly: z.boolean(),
    fcchBadge: z.boolean(),
    availabilitySummary: z.string().nullable(),
    ratingAverage: z.number(),
    ratingCount: z.number().int(),
    /** Role-appropriate actions: Caregiver → message+book; Provider → book-consultation. */
    ctas: z.array(CtaEnum),
  })
  .openapi('SearchResultCard');

const BlurredCardSchema = z
  .object({
    id: z.string(),
    role: RoleEnum,
    categoryKey: z.string(),
    categories: z.array(CategoryEnum),
    specialty: SpecialtyEnum.nullable(),
    areaLabel: z.string().nullable(),
    fromRateCents: z.number().int().nullable(),
    ratingAverage: z.number(),
    ratingCount: z.number().int(),
    taxCreditFriendly: z.boolean(),
    fcchBadge: z.boolean(),
    locked: z.literal(true),
  })
  .openapi('SearchBlurredCard');

const ResultItem = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('full'), card: FullCard }),
    z.object({ kind: z.literal('blurred'), card: BlurredCardSchema }),
  ])
  .openapi('SearchResultItem');

const SearchResponse = z
  .object({
    /** Whether the Parent's Subscription unlocks the full marketplace (active|trialing). */
    entitled: z.boolean(),
    /** Total matched results across the whole query (may exceed `results.length`). */
    total: z.number().int(),
    /** Full (unblurred) results in the returned page. */
    fullCount: z.number().int(),
    /** Blurred teaser results in the returned page. */
    blurredCount: z.number().int(),
    /** The top-ranked page (≤ limit), each tagged full or blurred, in rank order. */
    results: z.array(ResultItem),
  })
  .openapi('SearchResponse');

/* ── row shapes ─────────────────────────────────────────────────────────────── */

interface ProviderRow {
  id: string;
  uid: string;
  role: 'caregiver' | 'provider';
  categories: string[] | null;
  specialty: string | null;
  state: string;
  suspended_at: Date | string | null;
}
interface ProfileRow {
  provider_id: string;
  display_name: string | null;
  headline: string | null;
  zip: string | null;
  photo_object_path: string | null;
  published_rate_cents: number | null;
  availability_grid: AvailabilityGrid | null;
  availability_note: string | null;
  paused: boolean | null;
  w10_tax_credit_friendly: boolean | null;
  negotiable: boolean | null;
  ages_served: string[] | null;
  behaviour_comfort: string[] | null;
  updated_at: Date | string | null;
}
export interface VerificationRow {
  provider_id: string;
  phone_confirmed_at: Date | string | null;
  screening_passed_at: Date | string | null;
  license_verified_at: Date | string | null;
  insurance_verified_at: Date | string | null;
  rejected_at: Date | string | null;
}
interface RateRow {
  provider_id: string;
  category: string;
  published_rate_cents: number;
}
export interface ProviderSubRow {
  provider_id: string;
  status: StripeSubscriptionStatus | null;
}
interface FcchRow {
  provider_id: string;
  decision: string | null;
}
interface SlotRow {
  id: string;
  provider_id: string;
  slot_date: string;
  start_min: number;
  end_min: number;
  state: 'open' | 'held' | 'released';
  held_by_booking_id: string | null;
}

/* ── helpers ────────────────────────────────────────────────────────────────── */

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function photoUrlFor(supabaseUrl: string, bucket: string, objectPath: string | null): string | null {
  if (!objectPath) return null;
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${objectPath}`;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

function isPresent(value: Date | string | null): boolean {
  return value != null;
}

/**
 * The activation/listing bar a supply row must clear to appear in search — and,
 * by extension, to be viewable on the Parent-facing profile-detail surface
 * (supply-profile.ts reuses this so the two surfaces can never disagree about
 * who is publicly visible).
 */
export function isListable(
  role: 'caregiver' | 'provider',
  ver: VerificationRow | undefined,
  sub: ProviderSubRow | undefined,
  suspendedAt?: Date | string | null,
): boolean {
  // Suspended supply (OH-213 — 3 no-show flags) is unlistable + unbookable.
  if (isPresent(suspendedAt ?? null)) return false;
  if (!ver) return false;
  if (isPresent(ver.rejected_at)) return false;
  if (!isPresent(ver.phone_confirmed_at)) return false; // hard activation gate (OH-181)
  if (!isPresent(ver.screening_passed_at)) return false;
  if (role === 'provider') {
    if (!isPresent(ver.license_verified_at) || !isPresent(ver.insurance_verified_at)) return false;
    // Provider listing gate (OH-191): listed iff Subscription active|trialing.
    const status = sub?.status ?? null;
    if (!deriveAccessDecision({ status }).entitled) return false;
  }
  return true;
}

// ── Caregiver grid ∩ window (reimplemented from the Deno-clean shared
// availability primitives — see the import note above). Mirrors the domain
// caregiver-availability `intersectAvailabilityWithQuery` grid logic.
const JS_DAY_TO_AVAILABILITY_DAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function weekdayOfIso(date: string): AvailabilityDay | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return JS_DAY_TO_AVAILABILITY_DAY[dt.getUTCDay()]!;
}

function bandsOverlapping(startMin: number, endMin: number): AvailabilityBand[] {
  return AVAILABILITY_BANDS.filter((b) => {
    const { startHour, endHour } = BAND_CLOCK_HOURS[b];
    return startMin < endHour * 60 && endMin > startHour * 60;
  });
}

function caregiverGridMatchesWindow(
  grid: AvailabilityGrid,
  q: { date: string; startMin: number; endMin: number },
): boolean {
  const day = weekdayOfIso(q.date);
  if (!day) return false;
  return bandsOverlapping(q.startMin, q.endMin).some((b) => isAvailable(grid, day, b));
}

function toConsultationSlot(row: SlotRow): ConsultationSlot {
  return {
    id: row.id,
    date: row.slot_date,
    startMin: row.start_min,
    endMin: row.end_min,
    state: row.state,
    heldByBookingId: row.held_by_booking_id,
  };
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const arr = map.get(k);
    if (arr) arr.push(row);
    else map.set(k, [row]);
  }
  return map;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/* ── route ──────────────────────────────────────────────────────────────────── */

const searchRoute = createRoute({
  method: 'get',
  path: '/search',
  tags: ['search'],
  summary: 'Unified Search across Caregivers + Providers (filters, hybrid ranking, preview wall)',
  description:
    'Returns activated, listable supply matching the filters, ranked by the hybrid scorer, with the blur-to-unblur preview wall applied for non-entitled Parents (top 1–2 full per category, the rest blurred teasers). An entitled Parent (active|trialing Subscription) sees everything unblurred. Parent-only.',
  security: [{ supabaseAccessToken: [] }],
  middleware: [requireAuth({ roles: ['parent'] })] as const,
  request: { query: SearchQuery },
  responses: {
    200: { description: 'Ranked, preview-walled search results', content: json(SearchResponse) },
    400: { description: 'Invalid date/time window', content: json(ErrorResponse) },
    401: { description: 'Unauthenticated', content: json(ErrorResponse) },
    403: { description: 'Wrong role (caregiver / provider / admin)', content: json(ErrorResponse) },
  },
});

export function registerSearchRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(searchRoute, async (c) => {
    const { db, env } = c.var.deps;
    const principal = c.get('principal')!;
    const q = c.req.valid('query');

    // ── filters ──────────────────────────────────────────────────────────────
    const roleFilter = q.role;
    // Kept as string[] (not the narrowed enum) so the `.includes()` membership
    // checks below accept the raw row values.
    const categories: string[] = parseCsv(q.category).filter(isCaregiverCategory);
    const specialties: string[] = parseCsv(q.specialty).filter(isSpecialty);
    const agesReq = normaliseAgeBands(parseCsv(q.agesServed));
    const behavioursReq = normaliseSafetyBehaviors(parseCsv(q.behaviourComfort));
    const radiusMiles = q.radiusMiles ?? DEFAULT_SEARCH_RADIUS_MILES;
    const minRating = q.minRating ?? 0;
    const maxRateCents = q.maxRateCents ?? null;
    const wantTaxCredit = q.taxCreditFriendly === 'true';
    const searcherPoint: GeoPoint | null = resolveZipCentroid(q.zip);

    // Date/time window — present only when all three are supplied + valid.
    let availabilityQuery: { date: string; startMin: number; endMin: number } | null = null;
    if (q.date != null && q.startMin != null && q.endMin != null) {
      if (q.startMin >= q.endMin) {
        return c.json({ error: 'invalid_window', reason: 'startMin must be < endMin' }, 400);
      }
      availabilityQuery = { date: q.date, startMin: q.startMin, endMin: q.endMin };
    }

    // ── entitlement (the unblur gate) ─────────────────────────────────────────
    const subRow = await db
      .selectFrom('parent_subscriptions')
      .select(['status'])
      .where('uid', '=', principal.uid)
      .executeTakeFirst();
    const entitled = deriveAccessDecision({
      status: ((subRow?.status as StripeSubscriptionStatus | undefined) ?? null),
    }).entitled;

    // ── candidate supply rows by role ─────────────────────────────────────────
    let providersQuery = db
      .selectFrom('providers')
      .select(['id', 'uid', 'role', 'categories', 'specialty', 'state', 'suspended_at']);
    if (roleFilter !== 'all') providersQuery = providersQuery.where('role', '=', roleFilter);
    const providers = (await providersQuery.execute()) as unknown as ProviderRow[];

    if (providers.length === 0) {
      return c.json({ entitled, total: 0, fullCount: 0, blurredCount: 0, results: [] }, 200);
    }
    const ids = providers.map((p) => p.id);

    // ── load the per-id satellite rows ────────────────────────────────────────
    const [profileRows, verRows, rateRows, subRows, fcchRows] = await Promise.all([
      db
        .selectFrom('provider_profiles')
        .select([
          'provider_id',
          'display_name',
          'headline',
          'zip',
          'photo_object_path',
          'published_rate_cents',
          'availability_grid',
          'availability_note',
          'paused',
          'w10_tax_credit_friendly',
          'negotiable',
          'ages_served',
          'behaviour_comfort',
          'updated_at',
        ])
        .where('provider_id', 'in', ids)
        .execute() as Promise<unknown> as Promise<ProfileRow[]>,
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
        .where('provider_id', 'in', ids)
        .execute() as Promise<unknown> as Promise<VerificationRow[]>,
      db
        .selectFrom('provider_category_rates')
        .select(['provider_id', 'category', 'published_rate_cents'])
        .where('provider_id', 'in', ids)
        .execute() as Promise<unknown> as Promise<RateRow[]>,
      db
        .selectFrom('provider_subscriptions')
        .select(['provider_id', 'status'])
        .where('provider_id', 'in', ids)
        .execute() as Promise<unknown> as Promise<ProviderSubRow[]>,
      db
        .selectFrom('provider_home_childcare_registrations')
        .select(['provider_id', 'decision'])
        .where('provider_id', 'in', ids)
        .execute() as Promise<unknown> as Promise<FcchRow[]>,
    ]);

    // Provider consultation slots only when a date/time window is set.
    let slotRows: SlotRow[] = [];
    if (availabilityQuery) {
      slotRows = (await db
        .selectFrom('provider_slots')
        .select(['id', 'provider_id', 'slot_date', 'start_min', 'end_min', 'state', 'held_by_booking_id'])
        .where('provider_id', 'in', ids)
        .where('slot_date', '=', availabilityQuery.date)
        .where('state', '=', 'open')
        .execute()) as unknown as SlotRow[];
    }

    const profileById = new Map(profileRows.map((r) => [r.provider_id, r]));
    const verById = new Map(verRows.map((r) => [r.provider_id, r]));
    const subById = new Map(subRows.map((r) => [r.provider_id, r]));
    const fcchById = new Map(fcchRows.map((r) => [r.provider_id, r]));
    const ratesById = groupBy(rateRows, (r) => r.provider_id);
    const slotsById = groupBy(slotRows, (r) => r.provider_id);

    // ── filter + assemble cards ───────────────────────────────────────────────
    const cards: SupplyCard[] = [];
    const distanceKnownById = new Map<string, boolean>();

    for (const p of providers) {
      const prof = profileById.get(p.id);
      if (!prof) continue; // no profile row → not searchable yet
      if (prof.paused === true) continue; // paused → hidden
      if (!isListable(p.role, verById.get(p.id), subById.get(p.id), p.suspended_at)) continue;

      // category / specialty membership
      const pCategories = p.categories ?? [];
      if (p.role === 'caregiver') {
        if (categories.length > 0 && !pCategories.some((cat) => categories.includes(cat))) continue;
      } else {
        if (specialties.length > 0 && !(p.specialty != null && specialties.includes(p.specialty))) continue;
      }

      // behaviour-comfort is a Caregiver-only facet: a request excludes Providers.
      if (behavioursReq.length > 0 && p.role !== 'caregiver') continue;

      // "from $X" lowest published rate
      let fromRateCents: number | null;
      if (p.role === 'caregiver') {
        const allRates = ratesById.get(p.id) ?? [];
        const relevant = categories.length > 0 ? allRates.filter((r) => categories.includes(r.category)) : allRates;
        fromRateCents = relevant.length > 0 ? Math.min(...relevant.map((r) => r.published_rate_cents)) : null;
      } else {
        fromRateCents = prof.published_rate_cents ?? null;
      }
      if (!passesRateCeiling(fromRateCents, maxRateCents)) continue;

      // tax-credit-friendly (Caregiver only)
      if (wantTaxCredit && !(prof.w10_tax_credit_friendly === true)) continue;

      const agesServed = normaliseAgeBands(prof.ages_served ?? []);
      if (!matchesAgeBands(agesServed, agesReq)) continue;

      const behaviourComfort = normaliseSafetyBehaviors(prof.behaviour_comfort ?? []);
      if (behavioursReq.length > 0 && !matchesBehaviourComfort(behaviourComfort, behavioursReq)) continue;

      // date/time ∩ availability
      const grid = (prof.availability_grid ?? {}) as AvailabilityGrid;
      const availabilitySummary = renderAvailabilitySummary(grid);
      if (availabilityQuery) {
        if (p.role === 'caregiver') {
          if (!caregiverGridMatchesWindow(grid, availabilityQuery)) continue;
        } else {
          const open = intersectSlotsWithQuery((slotsById.get(p.id) ?? []).map(toConsultationSlot), availabilityQuery);
          if (open.length === 0) continue;
        }
      }

      // ratings — no persistence yet (cold start): everyone unrated.
      const ratingAverage = 0;
      const ratingCount = 0;
      if (!passesMinRating(ratingAverage, ratingCount, minRating)) continue;

      // distance / radius
      const candidatePoint = resolveZipCentroid(prof.zip);
      let distanceMiles = 0; // unknown → neutral proximity (documented)
      let distanceKnown = false;
      if (searcherPoint && candidatePoint) {
        distanceMiles = haversineMiles(searcherPoint, candidatePoint);
        distanceKnown = true;
        if (distanceMiles > radiusMiles) continue; // radius cut only when both resolve
      }
      distanceKnownById.set(p.id, distanceKnown);

      const categoryKey =
        p.role === 'provider'
          ? 'provider'
          : categories.length === 1
            ? categories[0]!
            : (pCategories[0] ?? 'caregiver');

      cards.push({
        id: p.id,
        distanceMiles,
        ratingAverage,
        lastActiveAt: toDate(prof.updated_at) ?? new Date(0),
        role: p.role,
        categoryKey,
        displayName: prof.display_name ?? null,
        headline: prof.headline ?? null,
        photoUrl: photoUrlFor(env.SUPABASE_URL, env.AVATAR_BUCKET, prof.photo_object_path ?? null),
        zip: prof.zip ?? null,
        areaLabel: areaLabelForZip(prof.zip),
        fromRateCents,
        negotiable: prof.negotiable ?? true,
        categories: pCategories,
        specialty: p.specialty ?? null,
        agesServed,
        behaviourComfort,
        taxCreditFriendly: prof.w10_tax_credit_friendly === true,
        fcchBadge: fcchById.get(p.id)?.decision === 'verified',
        availabilitySummary,
        ratingCount,
      });
    }

    // ── rank + preview wall ───────────────────────────────────────────────────
    const ranked = rankCandidates(cards, { now: new Date(), radiusMiles });
    const page = ranked.slice(0, q.limit);
    const wall = projectPreviewWall(page, { entitled, fullPerCategory: DEFAULT_PREVIEW_FULL_PER_CATEGORY });

    const results = wall.items.map((item) => {
      if (item.kind === 'full') {
        const card = item.card;
        return {
          kind: 'full' as const,
          card: {
            id: card.id,
            role: card.role,
            categoryKey: card.categoryKey,
            displayName: card.displayName,
            headline: card.headline,
            photoUrl: card.photoUrl,
            zip: card.zip,
            areaLabel: card.areaLabel,
            distanceMiles: distanceKnownById.get(card.id) ? round1(card.distanceMiles) : null,
            fromRateCents: card.fromRateCents,
            negotiable: card.negotiable,
            categories: card.categories,
            specialty: card.specialty,
            agesServed: card.agesServed,
            behaviourComfort: card.behaviourComfort,
            taxCreditFriendly: card.taxCreditFriendly,
            fcchBadge: card.fcchBadge,
            availabilitySummary: card.availabilitySummary,
            ratingAverage: card.ratingAverage,
            ratingCount: card.ratingCount,
            ctas: ctasForRole(card.role),
          },
        };
      }
      return { kind: 'blurred' as const, card: item.card };
    });

    // The card facets are stored on SupplyCard as broad string[] / string|null
    // (they originate from raw DB rows but are taxonomy-validated above via
    // normalise*/isCaregiverCategory + the providers CHECK constraint), so cast
    // the assembled body to the narrowed OpenAPI response type at the boundary.
    const body = {
      entitled: wall.entitled,
      total: cards.length,
      fullCount: wall.fullCount,
      blurredCount: wall.blurredCount,
      results,
    } as z.infer<typeof SearchResponse>;
    return c.json(body, 200);
  });
}
