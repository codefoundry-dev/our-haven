/**
 * Search ranking scorer — deep module (OH-180, deepens OH-113).
 *
 * Pure-TS per ADR-0004 (no DB / vendor imports). Encodes the v1 hybrid ranking
 * from CONTEXT.md § Search & filters:
 *
 *   score = 0.5 × distance_proximity
 *         + 0.3 × rating
 *         + 0.2 × recency_active_in_last_7_days
 *
 * The scorer runs over ALREADY-FILTERED candidates — the unified-filter pass
 * (category/specialty, ZIP+radius, date/time ∩ Availability, Rate ceiling, min
 * Rating, badges, age range, behaviour-comfort) is a separate concern (the
 * Search story this module blocks, OH-201). Here we only score + order what
 * survived the filter. Editorial / featured slots and admin boosting are
 * deferred (CONTEXT.md § Search & filters).
 *
 * ── Component normalisation (each → [0, 1]) ────────────────────────────────
 *   - proximity : 1 at the search centroid, linearly down to 0 at the search
 *                 radius (default 5 mi; CONTEXT.md § Search). Beyond the radius
 *                 clamps to 0; a candidate at the centroid is 1.
 *   - rating    : mean stars / 5. An unrated candidate (cold start) scores 0 on
 *                 this term — there is no rating boost until ratings exist.
 *   - recency   : 1 if active right now, linearly down to 0 at 7 days idle
 *                 (`RECENCY_WINDOW_DAYS`); clamps to 0 past the window.
 *
 * With weights summing to 1 and every component in [0, 1], the final score is
 * in [0, 1].
 *
 * Pure + deterministic, and — like the other timer-touching modules — reads no
 * clock: `now` is supplied by the caller so recency is reproducible. The only
 * refusal is a caller-bug guard on a non-positive radius; everything else is
 * total via clamping.
 */

/** Hybrid weights (CONTEXT.md § Search & filters). Sum to 1. */
export const SEARCH_RANKING_WEIGHTS = {
  proximity: 0.5,
  rating: 0.3,
  recency: 0.2,
} as const;

/** Default ZIP search radius in miles (CONTEXT.md § Search & filters). */
export const DEFAULT_SEARCH_RADIUS_MILES = 5;

/** Star scale ceiling — ratings are 1..5 (0 = unrated). Local to the scorer; the
 *  canonical public star-scale constant lives in the rating-reveal module. */
const MAX_RATING_STARS = 5;

/** The recency window: active within this many days decays 1 → 0. */
export const RECENCY_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * The ranking-relevant facets of a search candidate. A caller's richer profile
 * object can extend this — `rankCandidates` is generic and preserves it.
 */
export interface RankingCandidate {
  id: string;
  /** Crow-flies distance from the search ZIP centroid, in miles (≥ 0). */
  distanceMiles: number;
  /** Mean star rating in [0, 5]; 0 when unrated (cold start). */
  ratingAverage: number;
  /** When the supply member was last active (drives the recency term). */
  lastActiveAt: Date;
}

export interface ScoreComponents {
  proximity: number;
  rating: number;
  recency: number;
}

export interface ScoredCandidate<C extends RankingCandidate> {
  candidate: C;
  /** Weighted hybrid score in [0, 1]. */
  score: number;
  /** The three normalised components (each in [0, 1]) that produced `score`. */
  components: ScoreComponents;
}

export interface RankingOptions {
  /** Caller-supplied wall-clock; the module reads no clock of its own. */
  now: Date;
  /** Search radius for the proximity term. Defaults to 5 mi. Must be > 0. */
  radiusMiles?: number;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Proximity term: 1 at the centroid, linearly to 0 at `radiusMiles`, clamped to
 * 0 beyond. Negative distances (nonsense input) clamp to 1.
 */
export function proximityScore(
  distanceMiles: number,
  radiusMiles: number = DEFAULT_SEARCH_RADIUS_MILES,
): number {
  if (!(radiusMiles > 0)) {
    throw new Error(`radiusMiles must be > 0 (got ${radiusMiles})`);
  }
  return clamp01(1 - distanceMiles / radiusMiles);
}

/** Rating term: mean stars / 5, clamped to [0, 1]. Unrated (0) → 0. */
export function ratingScore(ratingAverage: number): number {
  return clamp01(ratingAverage / MAX_RATING_STARS);
}

/**
 * Recency term: 1 when active now, linearly to 0 at `RECENCY_WINDOW_DAYS` idle,
 * clamped to 0 past the window. A future `lastActiveAt` (negative age) clamps
 * to 1.
 */
export function recencyScore(lastActiveAt: Date, now: Date): number {
  const ageDays = (now.getTime() - lastActiveAt.getTime()) / DAY_MS;
  return clamp01(1 - ageDays / RECENCY_WINDOW_DAYS);
}

/** Score one candidate, returning the weighted score + its three components. */
export function scoreCandidate<C extends RankingCandidate>(
  candidate: C,
  options: RankingOptions,
): ScoredCandidate<C> {
  const components: ScoreComponents = {
    proximity: proximityScore(candidate.distanceMiles, options.radiusMiles),
    rating: ratingScore(candidate.ratingAverage),
    recency: recencyScore(candidate.lastActiveAt, options.now),
  };
  const score =
    SEARCH_RANKING_WEIGHTS.proximity * components.proximity +
    SEARCH_RANKING_WEIGHTS.rating * components.rating +
    SEARCH_RANKING_WEIGHTS.recency * components.recency;
  return { candidate, score, components };
}

/**
 * Score + rank filtered candidates, highest score first. The sort is STABLE:
 * candidates with equal scores keep their input order (so an upstream
 * deterministic ordering — e.g. closest-first or freshest-first — survives
 * ties rather than being scrambled). An empty input yields an empty result.
 */
export function rankCandidates<C extends RankingCandidate>(
  candidates: readonly C[],
  options: RankingOptions,
): Array<ScoredCandidate<C>> {
  return candidates
    .map((candidate, index) => ({ scored: scoreCandidate(candidate, options), index }))
    .sort((a, b) => b.scored.score - a.scored.score || a.index - b.index)
    .map((x) => x.scored);
}

export const SEARCH_RANKING_MODULE_VERSION = '0.2.0-OH-180';
