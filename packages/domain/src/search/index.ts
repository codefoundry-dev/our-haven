/**
 * Unified Search — filter predicates + the blur-to-unblur preview wall (OH-201).
 *
 * Pure-TS per ADR-0004 (no DB / vendor imports). This module is the filter +
 * preview half of Search; the hybrid *ranking* lives in `../search-ranking`
 * (OH-180) and the date/time ∩ Availability matchers live in
 * `../caregiver-availability` + `../provider-slot-scheduler`. OH-201 wires them
 * together at the handler layer:
 *
 *   filter (here + SQL) → rankCandidates (search-ranking) → projectPreviewWall (here)
 *
 * Two responsibilities live here because both are business rules, not plumbing:
 *
 *   1. **Filter predicates** that aren't cheap scalar SQL — age-band /
 *      behaviour-comfort set overlap, the cold-start min-Rating rule, the
 *      Rate-ceiling rule — kept pure so they have one tested definition.
 *   2. **The preview wall** (CONTEXT.md § Search & filters; ADR-0006 paywall;
 *      PRD-0001 v1.7 stories 7–9, 123): a Parent who is NOT entitled
 *      (Subscription inactive — see `../parent-subscription`) sees the top
 *      **1–2 full profiles per category** and the rest as **blurred teaser
 *      cards**; an entitled Parent sees everything unblurred. `toBlurred`
 *      is the privacy boundary — a blurred card carries only the
 *      marketing-safe subset (no name, no photo, no exact ZIP, no contact), so
 *      the client physically cannot un-blur without re-fetching after
 *      subscribing.
 *
 * Geo: ZIP→centroid resolution is an adapter concern (no geo data in the pure
 * layer), but `haversineMiles` — the crow-flies distance the ranking proximity
 * term consumes — is pure and lives here.
 *
 * Pure + deterministic; no clock (the ranker injects `now`).
 */

import {
  rankCandidates,
  type RankingCandidate,
  type RankingOptions,
  type ScoredCandidate,
} from '../search-ranking/index.js';

export const SEARCH_MODULE_VERSION = '0.1.0-OH-201';

/** The two supply roles a result can be (ADR-0011). */
export type SupplyResultRole = 'caregiver' | 'provider';

// ---------------------------------------------------------------------------
// Geo — crow-flies distance for the proximity term
// ---------------------------------------------------------------------------

export interface GeoPoint {
  /** Latitude in decimal degrees. */
  lat: number;
  /** Longitude in decimal degrees. */
  lng: number;
}

/** Mean Earth radius in miles (IUGG), matching the ranking proximity units. */
const EARTH_RADIUS_MILES = 3958.7613;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle (haversine) distance between two lat/lng points, in miles.
 * Symmetric, ≥ 0, and 0 for identical points. The caller resolves ZIP →
 * `GeoPoint`; this is the pure distance kernel the ZIP+radius filter and the
 * ranking proximity term share.
 */
export function haversineMiles(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Whether `b` is within `radiusMiles` of `a` (inclusive). */
export function withinRadius(a: GeoPoint, b: GeoPoint, radiusMiles: number): boolean {
  return haversineMiles(a, b) <= radiusMiles;
}

// ---------------------------------------------------------------------------
// Filter predicates (the non-trivial, set/threshold ones)
// ---------------------------------------------------------------------------

/** True when the two sets share ≥1 member. An empty `requested` is no constraint. */
export function hasOverlap(have: readonly string[], requested: readonly string[]): boolean {
  if (requested.length === 0) return true;
  const set = new Set(have);
  return requested.some((r) => set.has(r));
}

/**
 * Age-band filter: a candidate matches when the bands it serves intersect the
 * requested bands. Empty request → no constraint. A candidate that lists no
 * `agesServed` only matches when there is no request (it advertises nothing, so
 * it can't claim a band).
 */
export function matchesAgeBands(served: readonly string[], requested: readonly string[]): boolean {
  return hasOverlap(served, requested);
}

/**
 * Behaviour-comfort filter (Caregiver only; over the shared Safety-Behaviors
 * taxonomy): matches when the Caregiver's comfort set intersects the requested
 * behaviours. v1 is intersection, NOT the deferred superset match-scoring
 * (CONTEXT.md § Ages served & behaviour-comfort).
 */
export function matchesBehaviourComfort(
  comfort: readonly string[],
  requested: readonly string[],
): boolean {
  return hasOverlap(comfort, requested);
}

/**
 * Min-Rating filter with the cold-start rule: a floor of 0 (or below) is no
 * constraint, and an UNRATED candidate (`ratingCount` 0) always passes — a
 * brand-new marketplace has no ratings yet, so a positive floor must not empty
 * the results. Only a candidate that HAS revealed ratings below the floor is
 * excluded. Mirrors `ratingScore`'s "unrated → 0" cold-start treatment.
 */
export function passesMinRating(
  ratingAverage: number,
  ratingCount: number,
  minRating: number,
): boolean {
  if (minRating <= 0) return true;
  if (ratingCount <= 0) return true;
  return ratingAverage >= minRating;
}

/**
 * Hourly-Rate ceiling filter against the "from $X" lowest published rate (cents).
 * No ceiling → no constraint. An UNPRICED candidate (`fromRateCents` null)
 * passes through rather than being hidden (cold start — a Caregiver who hasn't
 * set a rate yet shouldn't vanish from every budget-capped search).
 */
export function passesRateCeiling(
  fromRateCents: number | null,
  maxRateCents: number | null,
): boolean {
  if (maxRateCents == null) return true;
  if (fromRateCents == null) return true;
  return fromRateCents <= maxRateCents;
}

// ---------------------------------------------------------------------------
// Result cards + the preview wall
// ---------------------------------------------------------------------------

/**
 * A full, unblurred search result. Extends `RankingCandidate` (so it carries
 * the scorer inputs: `id`, `distanceMiles`, `ratingAverage`, `lastActiveAt`)
 * and adds the display payload the handler assembles. `categoryKey` is the
 * bucket this card is grouped under for the preview wall — a Caregiver category
 * (`babysitter` | `tutor` | `nanny`) or `'provider'`.
 */
export interface SupplyCard extends RankingCandidate {
  role: SupplyResultRole;
  categoryKey: string;
  displayName: string | null;
  headline: string | null;
  photoUrl: string | null;
  /** 5-digit ZIP (full card only — coarsened to `areaLabel` when blurred). */
  zip: string | null;
  /** Coarse, blur-safe location string (e.g. "Austin, TX" or "ZIP 787xx"). */
  areaLabel: string | null;
  /** Lowest published hourly rate across categories, cents. Null if unpriced. */
  fromRateCents: number | null;
  negotiable: boolean;
  /** Caregiver categories (babysitter|tutor|nanny); empty for Providers. */
  categories: string[];
  /** Provider specialty (slp|ot|aba|psychology|other); null for Caregivers. */
  specialty: string | null;
  agesServed: string[];
  behaviourComfort: string[];
  taxCreditFriendly: boolean;
  fcchBadge: boolean;
  /** Rendered Availability summary (e.g. "Weekdays, afternoons"), or null. */
  availabilitySummary: string | null;
  /** Number of revealed public ratings (0 = unrated / cold start). */
  ratingCount: number;
}

/**
 * The teaser shown for a blurred result behind the preview wall — only the
 * marketing-safe subset. Deliberately omits `displayName`, `photoUrl`, exact
 * `zip`, `distanceMiles`, availability and anything else that could identify or
 * locate the supply member: the client gets nothing to un-blur with until the
 * Parent subscribes and re-fetches as `entitled`.
 */
export interface BlurredCard {
  id: string;
  role: SupplyResultRole;
  categoryKey: string;
  categories: string[];
  specialty: string | null;
  /** Coarse region only (city/ST or ZIP prefix) — never the exact ZIP. */
  areaLabel: string | null;
  fromRateCents: number | null;
  ratingAverage: number;
  ratingCount: number;
  taxCreditFriendly: boolean;
  fcchBadge: boolean;
  locked: true;
}

/** The role-appropriate primary action a Parent takes on a result (story 10). */
export type SupplyResultCta = 'message' | 'book' | 'book-consultation';

/**
 * The CTAs a result offers by role: a Caregiver result leads to Message /
 * Book-request; a Provider result leads to Book-a-consultation
 * (CONTEXT.md § Search & filters).
 */
export function ctasForRole(role: SupplyResultRole): SupplyResultCta[] {
  return role === 'provider' ? ['book-consultation'] : ['message', 'book'];
}

/**
 * Default grouping bucket for the preview wall. Providers bucket together under
 * `'provider'`; a Caregiver buckets under its first (primary) category. The
 * handler may override `categoryKey` to the *searched* category when the search
 * is filtered to one, so each category still gets its 1–2 reveals.
 */
export function categoryKeyOf(input: {
  role: SupplyResultRole;
  categories: readonly string[];
  specialty: string | null;
}): string {
  if (input.role === 'provider') return 'provider';
  return input.categories[0] ?? 'caregiver';
}

/** Project a full card down to its blur-safe teaser. */
export function toBlurred(card: SupplyCard): BlurredCard {
  return {
    id: card.id,
    role: card.role,
    categoryKey: card.categoryKey,
    categories: card.categories,
    specialty: card.specialty,
    areaLabel: card.areaLabel,
    fromRateCents: card.fromRateCents,
    ratingAverage: card.ratingAverage,
    ratingCount: card.ratingCount,
    taxCreditFriendly: card.taxCreditFriendly,
    fcchBadge: card.fcchBadge,
    locked: true,
  };
}

/** Default count of full (unblurred) reveals per category for a free browser
 *  (CONTEXT/PRD: "1–2 full profiles per category"). */
export const DEFAULT_PREVIEW_FULL_PER_CATEGORY = 2;

export interface PreviewWallOptions {
  /** Whether the Parent's Subscription entitles them to the full marketplace. */
  entitled: boolean;
  /** Full reveals per category bucket for a NON-entitled browser. Default 2. */
  fullPerCategory?: number;
}

export type SearchResultItem =
  | { kind: 'full'; card: SupplyCard }
  | { kind: 'blurred'; card: BlurredCard };

export interface PreviewWall {
  entitled: boolean;
  /** Total matched results (full + blurred). */
  total: number;
  fullCount: number;
  blurredCount: number;
  /** Results in rank order, each tagged full or blurred. */
  items: SearchResultItem[];
}

/**
 * Apply the blur-to-unblur preview wall to ALREADY-RANKED candidates,
 * preserving rank order.
 *
 *   - `entitled` → every result is full (the Subscription is paid).
 *   - otherwise → walking in rank order, the first `fullPerCategory` results in
 *     each `categoryKey` bucket are revealed full (the best matches), and the
 *     rest are blurred teasers. Because ranking already put the strongest
 *     matches first, the reveals are the most compelling profiles per category.
 *
 * This is the single definition of the paywall preview cut — the handler does
 * not re-implement it, and the blurred payload never leaves with identifying
 * fields (`toBlurred`).
 */
export function projectPreviewWall(
  ranked: ReadonlyArray<ScoredCandidate<SupplyCard>>,
  options: PreviewWallOptions,
): PreviewWall {
  const total = ranked.length;

  if (options.entitled) {
    return {
      entitled: true,
      total,
      fullCount: total,
      blurredCount: 0,
      items: ranked.map((r) => ({ kind: 'full', card: r.candidate })),
    };
  }

  const fullPerCategory = Math.max(0, options.fullPerCategory ?? DEFAULT_PREVIEW_FULL_PER_CATEGORY);
  const revealedPerCategory = new Map<string, number>();
  const items: SearchResultItem[] = [];
  let fullCount = 0;

  for (const { candidate } of ranked) {
    const revealed = revealedPerCategory.get(candidate.categoryKey) ?? 0;
    if (revealed < fullPerCategory) {
      revealedPerCategory.set(candidate.categoryKey, revealed + 1);
      items.push({ kind: 'full', card: candidate });
      fullCount += 1;
    } else {
      items.push({ kind: 'blurred', card: toBlurred(candidate) });
    }
  }

  return {
    entitled: false,
    total,
    fullCount,
    blurredCount: total - fullCount,
    items,
  };
}

/**
 * Convenience pipeline: rank the filtered cards (delegating to the OH-180
 * hybrid scorer) then apply the preview wall. The handler can call this, or
 * call `rankCandidates` + `projectPreviewWall` itself when it needs the scored
 * candidates in between.
 */
export function rankAndProject(
  cards: readonly SupplyCard[],
  ranking: RankingOptions,
  wall: PreviewWallOptions,
): PreviewWall {
  return projectPreviewWall(rankCandidates(cards, ranking), wall);
}
