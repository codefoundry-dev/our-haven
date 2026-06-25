/**
 * Supply onboarding option data (OH-183) — the runtime lists the supply sign-up
 * screens map over: Caregiver categories (multi-select, ADR-0015), Provider
 * clinical specialty (single-select, ADR-0011), and resident US state.
 *
 * The option `value`s are typed against the generated role-claim contract
 * (@our-haven/openapi-types), so if the wire enum ever changes these lists stop
 * compiling. The canonical enum source is @our-haven/shared
 * (provider-taxonomy.ts / us-states.ts) → the Edge route → the OpenAPI spec.
 */
import type { RoleClaimBody } from '@/api/client';
import type { ColorToken } from '@/theme/tokens';

export type Category = NonNullable<RoleClaimBody['categories']>[number];
export type Specialty = NonNullable<RoleClaimBody['specialty']>;
export type StateCode = NonNullable<RoleClaimBody['state']>;

export interface CategoryOption {
  value: Category;
  label: string;
  blurb: string;
  tone: ColorToken;
}

/** A Caregiver picks one or more of these (ADR-0015). Tones from the design tokens. */
export const CATEGORY_OPTIONS: CategoryOption[] = [
  { value: 'babysitter', label: 'Babysitter', blurb: 'On-demand & date-night care', tone: 'catBaby' },
  { value: 'tutor', label: 'Tutor', blurb: 'Academic help, one-on-one', tone: 'catTutor' },
  { value: 'nanny', label: 'Nanny', blurb: 'Regular, ongoing childcare', tone: 'catNanny' },
];

export interface SpecialtyOption {
  value: Specialty;
  label: string;
  blurb: string;
}

/** A Provider picks exactly one clinical specialty (ADR-0011). */
export const SPECIALTY_OPTIONS: SpecialtyOption[] = [
  { value: 'slp', label: 'Speech-Language Pathology', blurb: 'SLP' },
  { value: 'ot', label: 'Occupational Therapy', blurb: 'OT' },
  { value: 'aba', label: 'Applied Behavior Analysis', blurb: 'ABA' },
  { value: 'psychology', label: 'Psychology', blurb: 'Clinical / counseling' },
  { value: 'other', label: 'Other', blurb: 'Another licensed clinical specialty' },
];

export interface StateOption {
  value: StateCode;
  label: string;
}

/** 50 states + DC (ADR-0009). Order mirrors the contract enum. */
export const STATE_OPTIONS: StateOption[] = [
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'DC', label: 'District of Columbia' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
];

export function stateLabel(code: StateCode): string {
  return STATE_OPTIONS.find((s) => s.value === code)?.label ?? code;
}
