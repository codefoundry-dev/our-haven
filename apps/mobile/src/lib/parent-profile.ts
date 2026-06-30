/**
 * Parent profile builder option data (OH-200) — the lists the Parent profile
 * screen maps over: the Preferences checklist, the Safety-Behaviors checklist
 * (shared taxonomy), and the US-state picker for the default service address.
 *
 * Like lib/profile.ts, the option `value`s are typed against the generated
 * contract (@our-haven/openapi-types via @/api/client) — the canonical enum
 * source is @our-haven/shared → the Edge route → the OpenAPI spec — so a backend
 * enum change stops these lists compiling. Labels are UI copy.
 *
 * ⚠️ Both checklists mirror PROVISIONAL taxonomies (Preferences + Safety Behaviors
 * — final lists pending Ci'erro, M0.8 / M2.10). They re-derive the same values the
 * backend validates against; keep in step when the final lists land.
 */
import type { ParentPreference, ParentSafetyBehavior } from '@/api/client';

export interface Option<V extends string> {
  value: V;
  label: string;
}

/** Desired-Caregiver-traits checklist (not safety-critical; no consent gate). */
export const PREFERENCE_OPTIONS: Option<ParentPreference>[] = [
  { value: 'non-smoker', label: 'Non-smoker' },
  { value: 'comfortable-with-pets', label: 'Comfortable with pets' },
  { value: 'has-own-transport', label: 'Has own transportation' },
  { value: 'cpr-certified', label: 'CPR certified' },
  { value: 'first-aid-certified', label: 'First-aid certified' },
  { value: 'experience-with-infants', label: 'Experience with infants' },
  { value: 'special-needs-experience', label: 'Special-needs experience' },
  { value: 'bilingual', label: 'Bilingual' },
  { value: 'light-housekeeping', label: 'Helps with light housekeeping' },
  { value: 'meal-preparation', label: 'Helps with meal prep' },
  { value: 'homework-help', label: 'Helps with homework' },
];

/** Fixed sensitive checklist — gated behind explicit, timestamped consent. */
export const SAFETY_BEHAVIOR_OPTIONS: Option<ParentSafetyBehavior>[] = [
  { value: 'aggression', label: 'Aggression' },
  { value: 'self-injury', label: 'Self-injurious behaviour' },
  { value: 'wandering', label: 'Wandering / running off' },
  { value: 'meltdowns', label: 'Meltdowns' },
  { value: 'property-destruction', label: 'Property destruction' },
  { value: 'pica', label: 'Pica (eating non-food items)' },
  { value: 'sensory-sensitivity', label: 'Sensory sensitivities' },
  { value: 'communication-support', label: 'Communication support' },
  { value: 'transition-difficulty', label: 'Difficulty with transitions' },
  { value: 'sleep-disturbance', label: 'Sleep disturbance' },
];

/** US states + DC (the v1 launch footprint) for the default-address state picker. */
export const US_STATE_OPTIONS: string[] = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
  'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI',
  'WY',
];

export const BIO_MAX = 600;

/** Whether any address field is set (drives the "saved" badge + clear affordance). */
export function hasAddress(a: { line1: string; line2: string; city: string; state: string; postalCode: string }): boolean {
  return (
    a.line1.trim() !== '' ||
    a.line2.trim() !== '' ||
    a.city.trim() !== '' ||
    a.state.trim() !== '' ||
    a.postalCode.trim() !== ''
  );
}
