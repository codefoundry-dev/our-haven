/**
 * Parent **Preferences** taxonomy — the checklist of desired Caregiver traits a
 * family can advertise on its Parent profile (CONTEXT.md § Parent profile;
 * ADR-0012):
 *
 *   Parent **`preferences[]`** — desired Caregiver traits (e.g. non-smoker,
 *   pet-friendly). Unlike `safety_behaviors[]` these are NOT safety-critical and
 *   carry **no consent gate** (ADR-0012 — "Not safety-critical; no consent
 *   gate"). A subset may graduate to search filters post-launch.
 *
 * ⚠️ PROVISIONAL LIST. ADR-0012 / PRD-0001 story 4 enumerate only "non-smoker"
 * and "pet-friendly" by example; the full set is not yet pinned. The working list
 * below is a reasonable seed in the spirit of the examples. Every consumer (the
 * Parent profile editor, the API validator, future search filters) reads these
 * constants, so swapping in the final list is a single edit here — the same
 * single-source posture as `safety-behaviors.ts`.
 *
 * Canonical wire values are kebab-case; UI surfaces map them to display strings.
 * Pure data + guards — no I/O, no clock. Deno-clean (zero imports) so the Edge
 * can consume it cross-tree with an explicit `.ts` specifier (ADR-0019), exactly
 * like `safety-behaviors.ts`.
 */

export const PARENT_PREFERENCES = [
  'non-smoker',
  'comfortable-with-pets',
  'has-own-transport',
  'cpr-certified',
  'first-aid-certified',
  'experience-with-infants',
  'special-needs-experience',
  'bilingual',
  'light-housekeeping',
  'meal-preparation',
  'homework-help',
] as const;
export type ParentPreference = (typeof PARENT_PREFERENCES)[number];

const PARENT_PREFERENCE_LABELS: Record<ParentPreference, string> = {
  'non-smoker': 'Non-smoker',
  'comfortable-with-pets': 'Comfortable with pets',
  'has-own-transport': 'Has own transportation',
  'cpr-certified': 'CPR certified',
  'first-aid-certified': 'First-aid certified',
  'experience-with-infants': 'Experience with infants',
  'special-needs-experience': 'Special-needs experience',
  bilingual: 'Bilingual',
  'light-housekeeping': 'Helps with light housekeeping',
  'meal-preparation': 'Helps with meal prep',
  'homework-help': 'Helps with homework',
};

export function isParentPreference(value: string): value is ParentPreference {
  return (PARENT_PREFERENCES as readonly string[]).includes(value);
}

export function parentPreferenceLabel(value: ParentPreference): string {
  return PARENT_PREFERENCE_LABELS[value];
}

/**
 * Filter an arbitrary string array down to the valid, de-duplicated set of
 * ParentPreference values in canonical (declaration) order. Used at the API layer
 * to sanitise a posted `preferences[]` before persisting — unknown or duplicate
 * tokens are dropped, never an error (mirrors `normaliseSafetyBehaviors`).
 */
export function normaliseParentPreferences(values: readonly string[]): ParentPreference[] {
  const set = new Set(values);
  return PARENT_PREFERENCES.filter((p) => set.has(p));
}

/** Provenance marker so consumers can detect the provisional vs final list. */
export const PARENT_PREFERENCES_TAXONOMY_VERSION = '0.1.0-provisional-OH-200';
