/**
 * Caregiver Availability summary — deep module (OH-180).
 *
 * Pure-TS per ADR-0004 (no DB / vendor imports). Encodes the v1 Caregiver
 * Availability rules from CONTEXT.md § Availability (post-ADR-0011, where the
 * weekly-grid availability is the CAREGIVER's; clinical Providers instead
 * publish consultation slots — see `provider-slot-scheduler`):
 *
 *   - A 7-day × 3-band toggle grid (Morning / Afternoon / Evening) + a
 *     ≤200-char free-text note + a `paused` boolean.
 *   - Renders to Parents as a short string ("Weekdays, afternoons").
 *   - Search date/time intersects the GRID only (the free-text note is
 *     unindexed). There is no per-slot calendar for Caregivers in v1.
 *   - `paused` Caregivers do not appear in search.
 *
 * The 7×3 grid primitives — the day/band enums, the platform band-to-clock
 * mapping (Morning 06–12, Afternoon 12–18, Evening 18–22), `isAvailable`, and
 * the render-to-string — live in `@our-haven/shared` and are reused here. This
 * module adds the Caregiver wrapper (`paused` + note), the search-intersection,
 * and the "appears in search" rule.
 *
 * Pure + deterministic and clock-free — the search query carries its own date.
 */

import {
  AVAILABILITY_BANDS,
  AVAILABILITY_NOTE_MAX_CHARS,
  BAND_CLOCK_HOURS,
  isAvailable,
  renderAvailabilitySummary,
} from '@our-haven/shared';
import type { AvailabilityBand, AvailabilityDay, AvailabilityGrid } from '@our-haven/shared';

/**
 * A Caregiver's published availability: the weekly grid + free-text note +
 * paused flag (CONTEXT.md § Availability).
 */
export interface CaregiverAvailability {
  grid: AvailabilityGrid;
  /** Free text shown under the grid; ≤ `AVAILABILITY_NOTE_MAX_CHARS`. */
  note: string;
  /** When true, the Caregiver is hidden from search and accepts no new requests. */
  paused: boolean;
}

/** A search date/time slice to test against a Caregiver's grid. */
export interface AvailabilityQuery {
  /** Calendar day the Parent is searching for, ISO `YYYY-MM-DD`. */
  date: string;
  /** Window start, minutes-since-midnight (0..1440). */
  startMin: number;
  /** Window end, minutes-since-midnight (start < end ≤ 1440). */
  endMin: number;
}

/** Whether the Caregiver is paused (hidden from search; CONTEXT.md § Availability). */
export function isPaused(availability: Pick<CaregiverAvailability, 'paused'>): boolean {
  return availability.paused === true;
}

/**
 * Whether the Caregiver appears in search results at all. The ONLY search-hiding
 * rule on availability is `paused` — an empty grid still appears (it simply
 * matches no date/time query). Verification / activation gates live elsewhere.
 */
export function appearsInSearch(availability: Pick<CaregiverAvailability, 'paused'>): boolean {
  return !isPaused(availability);
}

/** Whether the note is within the platform length limit. */
export function noteWithinLimit(note: string): boolean {
  return note.length <= AVAILABILITY_NOTE_MAX_CHARS;
}

/**
 * Render the grid as the short Parent-facing summary (e.g. "Weekdays,
 * afternoons"). Returns `null` for an empty grid. Delegates to the shared
 * renderer so the wording stays consistent across surfaces.
 */
export function renderCaregiverAvailability(
  availability: Pick<CaregiverAvailability, 'grid'>,
): string | null {
  return renderAvailabilitySummary(availability.grid);
}

// JS `Date.getUTCDay()` is 0=Sun..6=Sat; map to the shared mon..sun ordering.
const JS_DAY_TO_AVAILABILITY_DAY: readonly AvailabilityDay[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse `YYYY-MM-DD` to the weekday in the shared enum, or throw on garbage. */
export function weekdayOf(date: string): AvailabilityDay {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`invalid query date '${date}' (expected YYYY-MM-DD)`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new Error(`invalid query date '${date}' (no such calendar day)`);
  }
  // getUTCDay() is 0..6 so the indexed lookup is always in-bounds.
  return JS_DAY_TO_AVAILABILITY_DAY[back.getUTCDay()]!;
}

function bandMinutes(band: AvailabilityBand): { start: number; end: number } {
  const { startHour, endHour } = BAND_CLOCK_HOURS[band];
  return { start: startHour * 60, end: endHour * 60 };
}

/**
 * The Morning/Afternoon/Evening bands a clock window touches. A window overlaps
 * a band when it shares any minute with it (half-open intervals). A window
 * entirely outside 06:00–22:00 touches no band.
 */
export function bandsOverlapping(startMin: number, endMin: number): AvailabilityBand[] {
  return AVAILABILITY_BANDS.filter((b) => {
    const { start, end } = bandMinutes(b);
    return startMin < end && endMin > start;
  });
}

function validateWindow(startMin: number, endMin: number): void {
  if (
    !Number.isInteger(startMin) ||
    !Number.isInteger(endMin) ||
    startMin < 0 ||
    endMin > 1440 ||
    startMin >= endMin
  ) {
    throw new Error(`invalid query window startMin=${startMin} endMin=${endMin}`);
  }
}

/**
 * Whether a Caregiver's availability satisfies a search date/time query: NOT
 * paused, and the grid has at least one toggled band on the query's weekday
 * that overlaps the query window. Intersects the grid only — the free-text note
 * is never consulted (CONTEXT.md § Availability). Throws on a malformed query
 * (caller bug); a query is supplied once per search, not per candidate.
 */
export function intersectAvailabilityWithQuery(
  availability: CaregiverAvailability,
  query: AvailabilityQuery,
): boolean {
  if (isPaused(availability)) return false;
  validateWindow(query.startMin, query.endMin);
  const day = weekdayOf(query.date);
  const bands = bandsOverlapping(query.startMin, query.endMin);
  return bands.some((b) => isAvailable(availability.grid, day, b));
}

export const CAREGIVER_AVAILABILITY_MODULE_VERSION = '0.2.0-OH-180';
