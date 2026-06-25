/**
 * Rating reveal logic — deep module (OH-180, deepens OH-113).
 *
 * Pure-TS per ADR-0004 (no DB / vendor imports). Encodes the v1 mutual-rating
 * rules from CONTEXT.md § Rating:
 *
 *   - A 1–5 star score + optional text, submitted by one party about the other
 *     after a Booking enters `completed`.
 *   - Both sides may rate within a 14-day window, submitted BLIND and revealed
 *     mutually (Airbnb-style): a rating is hidden until BOTH sides submit OR the
 *     window closes — whichever comes first.
 *   - Display is ASYMMETRIC:
 *       · supply Ratings (Parent → Caregiver/Provider) are PUBLIC on the
 *         profile — aggregate + count + full text.
 *       · Parent Ratings (supply → Parent) are visible ONLY to supply
 *         evaluating a request, and only as aggregate stars + count (the text is
 *         internal to admin / ranking — never surfaced).
 *   - A Rating tied to a Booking under active Dispute is WITHHELD from public
 *     display until the dispute resolves.
 *
 * The asymmetry is enforced at the type level: the supply-only parent display
 * (`ParentRatingForSupplyDisplay`) has no `text`/`items` field, so parent-rating
 * free text cannot leak through this surface.
 *
 * Pure + deterministic and clock-free — `now` is supplied by the caller so the
 * window math is reproducible.
 */

/** The mutual-rating window after completion (CONTEXT.md § Rating). */
export const RATING_WINDOW_DAYS = 14;
export const RATING_MIN_STARS = 1;
export const RATING_MAX_STARS = 5;

const DAY_MS = 86_400_000;

/**
 * A single submitted rating. Direction (who rated whom) is encoded by which
 * field of a `RatingExchange` holds it — see `parentToSupply` / `supplyToParent`.
 */
export interface Rating {
  /** Integer 1..5. */
  stars: number;
  /** Optional free text. Public for a parent→supply rating; internal-only for
   *  supply→parent. */
  text?: string;
  /** Handler-supplied submission time (must fall in the open window). */
  submittedAt: Date;
}

/**
 * The pair of (at most two) ratings exchanged over one completed Booking. Each
 * direction is independently optional — either, both, or neither side may have
 * submitted at a given moment.
 */
export interface RatingExchange {
  /** When the Booking entered `completed` — the window anchor. */
  completedAt: Date;
  /** Parent's rating ABOUT the supply member → becomes a PUBLIC supply rating. */
  parentToSupply?: Rating;
  /** Supply's rating ABOUT the parent → becomes a supply-only parent rating. */
  supplyToParent?: Rating;
  /** Booking under an active Dispute → its ratings are withheld from PUBLIC
   *  display until the dispute resolves (CONTEXT.md § Rating). */
  disputeActive?: boolean;
}

export function isValidStars(stars: number): boolean {
  return Number.isInteger(stars) && stars >= RATING_MIN_STARS && stars <= RATING_MAX_STARS;
}

/** The instant the rating window closes — `completedAt` + 14 days. */
export function windowClosesAt(completedAt: Date): Date {
  return new Date(completedAt.getTime() + RATING_WINDOW_DAYS * DAY_MS);
}

/** Whether the window is still open at `now` (ratings can still be submitted). */
export function isWindowOpen(exchange: Pick<RatingExchange, 'completedAt'>, now: Date): boolean {
  return now.getTime() < windowClosesAt(exchange.completedAt).getTime();
}

/** A new rating can only be submitted while the window is open. */
export function canSubmitRating(
  exchange: Pick<RatingExchange, 'completedAt'>,
  now: Date,
): boolean {
  return isWindowOpen(exchange, now);
}

/**
 * Blind mutual reveal: ratings are revealed once BOTH sides have submitted OR
 * the 14-day window has closed — whichever first. Until then everything stays
 * blind, even if one side has already submitted.
 */
export function isRevealed(exchange: RatingExchange, now: Date): boolean {
  const bothSubmitted = exchange.parentToSupply != null && exchange.supplyToParent != null;
  return bothSubmitted || !isWindowOpen(exchange, now);
}

/** What is visible for a single exchange at `now` — blind ⇒ both `null`. */
export interface ExchangeRevealState {
  revealed: boolean;
  parentToSupply: Rating | null;
  supplyToParent: Rating | null;
}

/**
 * Resolve what each side may see for one exchange right now. Before reveal both
 * are `null` (blind), regardless of what has been submitted. After reveal each
 * side shows whatever was actually submitted (`null` if that side never rated —
 * e.g. only one side rated and the window then closed).
 */
export function revealExchange(exchange: RatingExchange, now: Date): ExchangeRevealState {
  const revealed = isRevealed(exchange, now);
  return {
    revealed,
    parentToSupply: revealed ? exchange.parentToSupply ?? null : null,
    supplyToParent: revealed ? exchange.supplyToParent ?? null : null,
  };
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * The PUBLIC supply-profile rating display — aggregate + count + full text of
 * every revealed Parent→supply rating, EXCLUDING any tied to a Booking under
 * active Dispute (CONTEXT.md § Rating).
 */
export interface PublicSupplyRatingDisplay {
  count: number;
  /** Mean stars, or `null` when there are no revealed, non-withheld ratings. */
  averageStars: number | null;
  /** Full text is public for supply ratings. `null` when the rating had no text. */
  items: ReadonlyArray<{ stars: number; text: string | null }>;
}

/**
 * The SUPPLY-ONLY parent rating display — aggregate stars + count of every
 * revealed supply→Parent rating. Deliberately NO text/items field: parent
 * rating text is internal to admin / ranking and never surfaced to supply.
 */
export interface ParentRatingForSupplyDisplay {
  count: number;
  averageStars: number | null;
}

/**
 * Project a supply member's completed-Booking exchanges into their public
 * profile rating. Only revealed Parent→supply ratings count, and any under an
 * active Dispute are withheld until it resolves.
 */
export function projectPublicSupplyRating(
  exchanges: readonly RatingExchange[],
  now: Date,
): PublicSupplyRatingDisplay {
  const items: Array<{ stars: number; text: string | null }> = [];
  for (const ex of exchanges) {
    if (ex.disputeActive) continue; // withheld from public until the dispute resolves
    const rating = revealExchange(ex, now).parentToSupply;
    if (rating) items.push({ stars: rating.stars, text: rating.text ?? null });
  }
  return { count: items.length, averageStars: mean(items.map((i) => i.stars)), items };
}

/**
 * Project a parent's completed-Booking exchanges into the aggregate a supply
 * member sees when evaluating a request. Only revealed supply→Parent ratings
 * count; the text never crosses this surface. Dispute-withholding is a PUBLIC
 * rule — it does not apply to this supply-internal aggregate.
 */
export function projectParentRatingForSupply(
  exchanges: readonly RatingExchange[],
  now: Date,
): ParentRatingForSupplyDisplay {
  const stars: number[] = [];
  for (const ex of exchanges) {
    const rating = revealExchange(ex, now).supplyToParent;
    if (rating) stars.push(rating.stars);
  }
  return { count: stars.length, averageStars: mean(stars) };
}

export const RATING_REVEAL_MODULE_VERSION = '0.2.0-OH-180';
