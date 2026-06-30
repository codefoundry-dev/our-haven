/**
 * Search filter vocabulary + the filter-state → API-query mapping (OH-201).
 *
 * Pure data + derivation (mirrors the lib/parent-profile.ts convention): option
 * `value`s are typed against the generated contract (`@our-haven/openapi-types`
 * via `@/api/client`) so a backend enum change breaks compilation; labels are UI
 * copy. The Search screens (native + web) own the `SearchFilters` UI state and
 * call `buildSearchQuery` to hit the backend.
 */
import type { SearchQuery, SearchResultCard, SearchSupplyRole } from '@/api/client';

export type CaregiverCategory = SearchResultCard['categories'][number];
export type Specialty = NonNullable<SearchResultCard['specialty']>;
export type AgeBand = SearchResultCard['agesServed'][number];
export type Behaviour = SearchResultCard['behaviourComfort'][number];

/** A category chip: the three Caregiver categories plus the Provider role. */
export type CategoryChoice = CaregiverCategory | 'provider';

export interface Option<V extends string> {
  value: V;
  label: string;
}

export const CATEGORY_CHOICES: Option<CategoryChoice>[] = [
  { value: 'babysitter', label: 'Babysitter' },
  { value: 'tutor', label: 'Tutor' },
  { value: 'nanny', label: 'Nanny' },
  { value: 'provider', label: 'Provider' },
];

export const SPECIALTY_OPTIONS: Option<Specialty>[] = [
  { value: 'slp', label: 'Speech-Language Pathology' },
  { value: 'ot', label: 'Occupational Therapy' },
  { value: 'aba', label: 'ABA Therapy' },
  { value: 'psychology', label: 'Psychology' },
  { value: 'other', label: 'Other' },
];

export const AGE_BAND_OPTIONS: Option<AgeBand>[] = [
  { value: 'infant', label: 'Infant (0–1)' },
  { value: 'toddler', label: 'Toddler (1–3)' },
  { value: 'preschool', label: 'Preschool (3–5)' },
  { value: 'school-age', label: 'School-age (5–12)' },
  { value: 'teen', label: 'Teen (12–17)' },
];

export const BEHAVIOUR_OPTIONS: Option<Behaviour>[] = [
  { value: 'aggression', label: 'Aggression' },
  { value: 'self-injury', label: 'Self-injurious behaviour' },
  { value: 'wandering', label: 'Wandering' },
  { value: 'meltdowns', label: 'Meltdowns' },
  { value: 'property-destruction', label: 'Property destruction' },
  { value: 'pica', label: 'Pica' },
  { value: 'sensory-sensitivity', label: 'Sensory sensitivities' },
  { value: 'communication-support', label: 'Communication support' },
  { value: 'transition-difficulty', label: 'Difficulty with transitions' },
  { value: 'sleep-disturbance', label: 'Sleep disturbance' },
];

export const RADIUS_OPTIONS = [5, 10, 25, 50] as const;
export const DEFAULT_RADIUS_MILES = 5;

export const MIN_RATING_OPTIONS = [3, 4, 5] as const;

/** Hourly Rate ceilings (cents) offered as quick chips. */
export const RATE_CEILING_OPTIONS = [2500, 4000, 6000, 10000] as const;

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';
export const TIME_OF_DAY_OPTIONS: {
  value: TimeOfDay;
  label: string;
  span: string;
  startMin: number;
  endMin: number;
}[] = [
  // Band → clock window mirrors the platform BAND_CLOCK_HOURS (shared availability).
  { value: 'morning', label: 'Morning', span: '6–12', startMin: 6 * 60, endMin: 12 * 60 },
  { value: 'afternoon', label: 'Afternoon', span: '12–6', startMin: 12 * 60, endMin: 18 * 60 },
  { value: 'evening', label: 'Evening', span: '6–10', startMin: 18 * 60, endMin: 22 * 60 },
];

/** The filter UI state both Search screens drive. */
export interface SearchFilters {
  categories: CategoryChoice[];
  specialties: Specialty[];
  zip: string;
  radiusMiles: number;
  /** When set, applies a date/time window (today at that band) — see buildSearchQuery. */
  timeOfDay: TimeOfDay | null;
  maxRateCents: number | null;
  /** 0 = any rating. */
  minRating: number;
  taxCreditFriendly: boolean;
  agesServed: AgeBand[];
  behaviourComfort: Behaviour[];
}

export const EMPTY_FILTERS: SearchFilters = {
  categories: [],
  specialties: [],
  zip: '',
  radiusMiles: DEFAULT_RADIUS_MILES,
  timeOfDay: null,
  maxRateCents: null,
  minRating: 0,
  taxCreditFriendly: false,
  agesServed: [],
  behaviourComfort: [],
};

/** Local calendar date as YYYY-MM-DD (for the time-of-day window). */
function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Whether the Provider role is in play (shows Provider-specific sub-filters). */
export function providerInScope(f: SearchFilters): boolean {
  return f.categories.length === 0 || f.categories.includes('provider');
}

/** Map the filter UI state to the backend query (omitting inert values). */
export function buildSearchQuery(f: SearchFilters): SearchQuery {
  const caregiverCats = f.categories.filter((c): c is CaregiverCategory => c !== 'provider');
  const hasProvider = f.categories.includes('provider');

  const q: SearchQuery = {};

  // Role narrows only when the choice is unambiguous; a mix (or nothing) = all.
  if (f.categories.length > 0) {
    if (hasProvider && caregiverCats.length === 0) q.role = 'provider';
    else if (!hasProvider && caregiverCats.length > 0) q.role = 'caregiver';
  }
  if (caregiverCats.length > 0) q.category = caregiverCats.join(',');
  if (hasProvider && f.specialties.length > 0) q.specialty = f.specialties.join(',');

  if (f.zip.trim().length > 0) q.zip = f.zip.trim();
  q.radiusMiles = f.radiusMiles;

  if (f.timeOfDay) {
    const band = TIME_OF_DAY_OPTIONS.find((t) => t.value === f.timeOfDay);
    if (band) {
      q.date = todayIso();
      q.startMin = band.startMin;
      q.endMin = band.endMin;
    }
  }

  if (f.maxRateCents != null) q.maxRateCents = f.maxRateCents;
  if (f.minRating > 0) q.minRating = f.minRating;
  if (f.taxCreditFriendly) q.taxCreditFriendly = 'true';
  if (f.agesServed.length > 0) q.agesServed = f.agesServed.join(',');
  if (f.behaviourComfort.length > 0) q.behaviourComfort = f.behaviourComfort.join(',');

  return q;
}

/** Count of non-default filter facets — drives the "Filters (N)" badge. */
export function activeFilterCount(f: SearchFilters): number {
  let n = 0;
  if (f.categories.length > 0) n += 1;
  if (f.specialties.length > 0) n += 1;
  if (f.zip.trim().length > 0) n += 1;
  if (f.radiusMiles !== DEFAULT_RADIUS_MILES) n += 1;
  if (f.timeOfDay) n += 1;
  if (f.maxRateCents != null) n += 1;
  if (f.minRating > 0) n += 1;
  if (f.taxCreditFriendly) n += 1;
  if (f.agesServed.length > 0) n += 1;
  if (f.behaviourComfort.length > 0) n += 1;
  return n;
}

/** A page-title summary of the selected categories (e.g. "Tutor · Nanny"). */
export function summaryFromCategories(categories: CategoryChoice[]): string {
  if (categories.length === 0) return 'Caregivers & Providers';
  return categories
    .map((c) => CATEGORY_CHOICES.find((o) => o.value === c)?.label ?? c)
    .join(' · ');
}

/** A short "$X/hr" from-rate teaser; cents → dollars, rounded. */
export function formatFromRate(fromRateCents: number | null | undefined): string | null {
  if (fromRateCents == null) return null;
  return `$${Math.round(fromRateCents / 100)}`;
}

const CATEGORY_LABELS: Record<CategoryChoice, string> = {
  babysitter: 'Babysitter',
  tutor: 'Tutor',
  nanny: 'Nanny',
  provider: 'Provider',
};
const SPECIALTY_LABELS: Record<Specialty, string> = {
  slp: 'Speech-Language Pathology',
  ot: 'Occupational Therapy',
  aba: 'ABA Therapy',
  psychology: 'Psychology',
  other: 'Specialist',
};

/** A display label for a result's category bucket (Caregiver category or specialty). */
export function categoryLabel(card: { role: SearchSupplyRole; categories: string[]; specialty: string | null }): string {
  if (card.role === 'provider') {
    return card.specialty ? (SPECIALTY_LABELS[card.specialty as Specialty] ?? 'Provider') : 'Provider';
  }
  const first = card.categories[0] as CategoryChoice | undefined;
  return first ? CATEGORY_LABELS[first] : 'Caregiver';
}

// ── Seed filters from the ephemeral preview questionnaire (OH-198) ───────────
// shapeBrowse already orders categories; the screen passes the shaped lead
// category (display string) + the preview child age so the first browse opens on
// a relevant filter. The preview age vocabulary differs from the search age
// bands, hence the explicit mapping.
const PREVIEW_CATEGORY_TO_CHOICE: Record<string, CategoryChoice> = {
  Babysitter: 'babysitter',
  Tutor: 'tutor',
  Nanny: 'nanny',
  Provider: 'provider',
  Specialist: 'provider',
};

export function previewCategoryToChoice(display: string | null): CategoryChoice | null {
  if (!display) return null;
  return PREVIEW_CATEGORY_TO_CHOICE[display] ?? null;
}

const PREVIEW_AGE_TO_BANDS: Record<string, AgeBand[]> = {
  '0-2': ['infant', 'toddler'],
  '3-5': ['preschool'],
  '6-9': ['school-age'],
  '10-12': ['school-age'],
  '13-17': ['teen'],
  mixed: [],
};

export function previewAgeToBands(age: string | null): AgeBand[] {
  if (!age) return [];
  return PREVIEW_AGE_TO_BANDS[age] ?? [];
}

/** Initial filters seeded from the preview answers (a relevant first browse). */
export function filtersFromPreview(input: { leadCategory: string | null; age: string | null }): SearchFilters {
  const choice = previewCategoryToChoice(input.leadCategory);
  return {
    ...EMPTY_FILTERS,
    categories: choice ? [choice] : [],
    agesServed: previewAgeToBands(input.age),
  };
}
