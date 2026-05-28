/**
 * Provider Availability summary — the 7-day × 3-band toggle grid + free-text
 * note that lives on a Provider's profile.
 *
 * Per CONTEXT.md § Availability:
 *   "A general weekly summary published by a Provider on their profile,
 *    indicating roughly when they are open to receive Booking requests.
 *    Per-slot calendars are explicitly NOT in v1; there is no slot-pick flow."
 *
 *   Structured grid: 7-day × 3-band (Morning / Afternoon / Evening) the
 *   Provider sets on their profile. Band-to-clock mapping is platform-defined
 *   (Morning 06–12, Afternoon 12–18, Evening 18–22) and NOT Provider-tunable.
 *
 *   Free-text note: ≤200 chars, surfaced under the grid.
 *
 *   `paused = true` → suspend new Book-requests; paused Providers do not
 *   appear in search.
 *
 * Search filtering by date/time intersects with the structured grid only; the
 * free-text is unindexed.
 */

export const AVAILABILITY_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type AvailabilityDay = (typeof AVAILABILITY_DAYS)[number];

export const AVAILABILITY_BANDS = ['morning', 'afternoon', 'evening'] as const;
export type AvailabilityBand = (typeof AVAILABILITY_BANDS)[number];

/**
 * Platform-defined band-to-clock mapping (24-hour). Inclusive start, exclusive
 * end. Not Provider-tunable in v1.
 */
export const BAND_CLOCK_HOURS: Record<AvailabilityBand, { startHour: number; endHour: number }> = {
  morning: { startHour: 6, endHour: 12 },
  afternoon: { startHour: 12, endHour: 18 },
  evening: { startHour: 18, endHour: 22 },
};

/**
 * 21-cell grid — one boolean per (day, band). Missing keys are treated as `false`.
 */
export type AvailabilityGrid = {
  [D in AvailabilityDay]?: {
    [B in AvailabilityBand]?: boolean;
  };
};

export const AVAILABILITY_NOTE_MAX_CHARS = 200;

export function emptyAvailabilityGrid(): AvailabilityGrid {
  return {};
}

export function isAvailable(grid: AvailabilityGrid, day: AvailabilityDay, band: AvailabilityBand): boolean {
  return grid[day]?.[band] === true;
}

const DAY_LABELS: Record<AvailabilityDay, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

const BAND_LABELS: Record<AvailabilityBand, string> = {
  morning: 'mornings',
  afternoon: 'afternoons',
  evening: 'evenings',
};

const WEEKDAYS: AvailabilityDay[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKENDS: AvailabilityDay[] = ['sat', 'sun'];

/**
 * Render the structured grid as a short, human-readable summary for Parent
 * search cards (e.g., "Weekdays, afternoons" / "Weekends, mornings" /
 * "Mon–Wed all day"). Returns `null` when the grid is empty.
 *
 * The rendering rules favour readability over completeness — Parents see this
 * as a teaser, not an exhaustive schedule. The detailed view is the editor on
 * the Provider portal.
 */
export function renderAvailabilitySummary(grid: AvailabilityGrid): string | null {
  const activeDays = AVAILABILITY_DAYS.filter((d) =>
    AVAILABILITY_BANDS.some((b) => isAvailable(grid, d, b)),
  );
  if (activeDays.length === 0) return null;

  const bandsOnAllActiveDays = AVAILABILITY_BANDS.filter((b) =>
    activeDays.every((d) => isAvailable(grid, d, b)),
  );

  const dayGroupLabel = describeDayGroup(activeDays);
  const bandLabel = describeBandGroup(bandsOnAllActiveDays);
  if (bandLabel === null) {
    // Bands vary across days — fall back to listing the days only.
    return dayGroupLabel;
  }
  return `${dayGroupLabel}, ${bandLabel}`;
}

function describeDayGroup(days: AvailabilityDay[]): string {
  const set = new Set(days);
  const weekdaysAll = WEEKDAYS.every((d) => set.has(d));
  const weekendsAll = WEEKENDS.every((d) => set.has(d));
  const onlyWeekdays = weekdaysAll && !WEEKENDS.some((d) => set.has(d));
  const onlyWeekends = weekendsAll && !WEEKDAYS.some((d) => set.has(d));
  const all = weekdaysAll && weekendsAll;

  if (all) return 'Every day';
  if (onlyWeekdays) return 'Weekdays';
  if (onlyWeekends) return 'Weekends';

  const ordered = AVAILABILITY_DAYS.filter((d) => set.has(d));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (!first || !last) return '';
  if (ordered.length === 1) return DAY_LABELS[first];

  if (isContiguous(ordered)) {
    return `${DAY_LABELS[first]}–${DAY_LABELS[last]}`;
  }
  return ordered.map((d) => DAY_LABELS[d]).join(', ');
}

function describeBandGroup(bands: AvailabilityBand[]): string | null {
  if (bands.length === 0) return null;
  if (bands.length === AVAILABILITY_BANDS.length) return 'all day';
  return bands.map((b) => BAND_LABELS[b]).join(' + ');
}

function isContiguous(days: AvailabilityDay[]): boolean {
  const indices = days.map((d) => AVAILABILITY_DAYS.indexOf(d));
  for (let i = 1; i < indices.length; i += 1) {
    const prev = indices[i - 1];
    const cur = indices[i];
    if (prev === undefined || cur === undefined || cur !== prev + 1) return false;
  }
  return true;
}

/**
 * Normalise a grid posted from the UI into the canonical shape: only true
 * cells retained, all others dropped. Useful so storage never carries
 * `{ mon: { morning: false } }` noise — a missing key is equivalent.
 */
export function normaliseAvailabilityGrid(grid: AvailabilityGrid): AvailabilityGrid {
  const out: AvailabilityGrid = {};
  for (const day of AVAILABILITY_DAYS) {
    const bands = grid[day];
    if (!bands) continue;
    const kept: { [B in AvailabilityBand]?: boolean } = {};
    for (const band of AVAILABILITY_BANDS) {
      if (bands[band] === true) kept[band] = true;
    }
    if (Object.keys(kept).length > 0) out[day] = kept;
  }
  return out;
}
