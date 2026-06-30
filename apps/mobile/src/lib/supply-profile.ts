/**
 * Display derivations for the Parent-facing supply profile (OH-202).
 *
 * Pure presentation helpers shared by the native + web Provider-detail screens:
 * the weekly Availability rows, the category-rate + badge mappings, and the
 * age-band / behaviour-comfort label lookups (reusing the Search filter
 * vocabulary so a backend enum change still breaks compilation here).
 */
import type { BadgeKind } from '@/components/ui/Badge';
import type { Category } from '@/components/ui/CategoryChip';
import type { SupplyProfile, SupplyProfileCategoryRate } from '@/api/client';
import { AGE_BAND_OPTIONS, BEHAVIOUR_OPTIONS } from '@/lib/search';

/** Fixed weekday order + display labels for the availability grid. */
const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

const BANDS: { key: string; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
];

export interface AvailabilityRow {
  day: string;
  /** The "on" bands joined (e.g. "Afternoon · Evening"), or null when unavailable. */
  bands: string | null;
}

/** One row per weekday with its enabled bands, or null bands when unavailable. */
export function availabilityRows(grid: SupplyProfile['availabilityGrid']): AvailabilityRow[] {
  return DAYS.map(({ key, label }) => {
    const dayGrid = (grid?.[key] ?? {}) as Record<string, boolean>;
    const on = BANDS.filter((b) => dayGrid[b.key] === true).map((b) => b.label);
    return { day: label, bands: on.length > 0 ? on.join(' · ') : null };
  });
}

/** Whether the grid has any availability at all (drives the empty state). */
export function hasAnyAvailability(grid: SupplyProfile['availabilityGrid']): boolean {
  return availabilityRows(grid).some((r) => r.bands != null);
}

/** Cents → a short "$35" dollar string (rounded). Null cents → null. */
export function dollars(cents: number | null | undefined): string | null {
  if (cents == null) return null;
  return `$${Math.round(cents / 100)}`;
}

const CATEGORY_LABELS: Record<string, string> = {
  babysitter: 'Babysitter',
  tutor: 'Tutor',
  nanny: 'Nanny',
};

/** A Caregiver category key → its display label (e.g. "babysitter" → "Babysitter"). */
export function categoryRateLabel(rate: SupplyProfileCategoryRate): string {
  return CATEGORY_LABELS[rate.category] ?? rate.category;
}

/** The pastel CategoryChip category for a profile (Provider, or its lead category). */
export function profileCategory(profile: Pick<SupplyProfile, 'role' | 'categories'>): Category {
  if (profile.role === 'provider') return 'Provider';
  const c = profile.categories[0];
  if (c === 'nanny') return 'Nanny';
  if (c === 'tutor') return 'Tutor';
  return 'Babysitter';
}

/**
 * The badges a profile earns. `verified` is implicit (only listable supply is
 * returned), plus tax-credit / FCCH / top-rated (≥ 4.8 with ≥ 1 rating).
 */
export function profileBadges(profile: SupplyProfile): BadgeKind[] {
  const out: BadgeKind[] = ['verified'];
  if (profile.rating.count > 0 && (profile.rating.average ?? 0) >= 4.8) out.push('toprated');
  if (profile.taxCreditFriendly) out.push('tax');
  if (profile.fcchBadge) out.push('fcch');
  return out;
}

const AGE_LABELS: Record<string, string> = Object.fromEntries(
  AGE_BAND_OPTIONS.map((o) => [o.value, o.label]),
);
const BEHAVIOUR_LABELS: Record<string, string> = Object.fromEntries(
  BEHAVIOUR_OPTIONS.map((o) => [o.value, o.label]),
);

export function ageBandLabel(band: string): string {
  return AGE_LABELS[band] ?? band;
}
export function behaviourLabel(behaviour: string): string {
  return BEHAVIOUR_LABELS[behaviour] ?? behaviour;
}

/** A one-line "also offers …" string for the secondary Caregiver categories. */
export function alsoOffersLabel(profile: Pick<SupplyProfile, 'role' | 'categories'>): string | null {
  if (profile.role === 'provider') return null;
  const extra = profile.categories.slice(1).map((c) => CATEGORY_LABELS[c] ?? c);
  if (extra.length === 0) return null;
  return `Also offers ${extra.join(' · ')}`;
}
