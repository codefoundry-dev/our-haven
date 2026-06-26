/**
 * Safety-Behaviors taxonomy + age bands — the shared vocabulary behind two
 * matchable Caregiver/Parent surfaces (CONTEXT.md § Ages served &
 * behaviour-comfort, § Parent profile; ADR-0015 / ADR-0016):
 *
 *   - Caregiver **`behaviour_comfort[]`** — the atypical behaviour patterns a
 *     Caregiver is comfortable supporting. The Caregiver's own capability data,
 *     so NO consent gate.
 *   - Parent **`safety_behaviors[]`** — the behaviours a family discloses about
 *     their child. Sensitive child data, consent-gated (built on the Parent
 *     surface, not here).
 *
 * Both draw from the SAME fixed list so a "caregiver-comfort ⊇ child-behaviours"
 * match is well-defined. Automated match-scoring is deferred — v1 is display +
 * search-filter only (CONTEXT.md § Ages served & behaviour-comfort).
 *
 * ⚠️ PROVISIONAL LIST — M2.10 / M0.8 dependency. CONTEXT.md § Parent profile
 * pins the canonical taxonomy as the "**final list from Ci'erro**". Until that
 * lands, the set below is a reasonable working list seeded from the CONTEXT
 * examples (aggression, self-injurious behaviour, wandering, …).
 * Every consumer (caregiver profile, parent profile, search filters) reads these
 * constants, so swapping in Ci'erro's final list is a single edit here.
 *
 * Canonical wire values are kebab-case; UI surfaces map them to display strings.
 * Pure data + guards — no I/O, no clock.
 */

// ---------------------------------------------------------------------------
// Safety Behaviors
// ---------------------------------------------------------------------------

export const SAFETY_BEHAVIORS = [
  'aggression',
  'self-injury',
  'wandering',
  'meltdowns',
  'property-destruction',
  'pica',
  'sensory-sensitivity',
  'communication-support',
  'transition-difficulty',
  'sleep-disturbance',
] as const;
export type SafetyBehavior = (typeof SAFETY_BEHAVIORS)[number];

const SAFETY_BEHAVIOR_LABELS: Record<SafetyBehavior, string> = {
  aggression: 'Aggression',
  'self-injury': 'Self-injurious behaviour',
  wandering: 'Wandering',
  meltdowns: 'Meltdowns',
  'property-destruction': 'Property destruction',
  pica: 'Pica (eating non-food items)',
  'sensory-sensitivity': 'Sensory sensitivities',
  'communication-support': 'Communication support',
  'transition-difficulty': 'Difficulty with transitions',
  'sleep-disturbance': 'Sleep disturbance',
};

export function isSafetyBehavior(value: string): value is SafetyBehavior {
  return (SAFETY_BEHAVIORS as readonly string[]).includes(value);
}

export function safetyBehaviorLabel(value: SafetyBehavior): string {
  return SAFETY_BEHAVIOR_LABELS[value];
}

/**
 * Filter an arbitrary string array down to the valid, de-duplicated set of
 * SafetyBehavior values in canonical (declaration) order. Used at the API layer
 * to sanitise a posted `behaviour_comfort[]` / `safety_behaviors[]` before
 * persisting — unknown or duplicate tokens are dropped, never an error.
 */
export function normaliseSafetyBehaviors(values: readonly string[]): SafetyBehavior[] {
  const set = new Set(values);
  return SAFETY_BEHAVIORS.filter((b) => set.has(b));
}

// ---------------------------------------------------------------------------
// Age bands (ages_served)
// ---------------------------------------------------------------------------

/**
 * The age bands a Caregiver/Provider serves (`ages_served`) and a Parent's
 * child falls into. Bands (not a free min/max range) so the field is a clean
 * multi-select that matches the "child-age-band" the pre-signup questionnaire
 * already speaks in (CONTEXT.md § Sensitive-data consent). Ranges below are the
 * platform mapping, not user-tunable.
 *
 * ⚠️ PROVISIONAL boundaries — confirm bands with Ci'erro alongside the
 * Safety-Behaviors list (M2.10).
 */
export const AGE_BANDS = ['infant', 'toddler', 'preschool', 'school-age', 'teen'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Platform-defined band-to-age mapping in months. Inclusive start, exclusive end. */
export const AGE_BAND_MONTHS: Record<AgeBand, { startMonth: number; endMonth: number }> = {
  infant: { startMonth: 0, endMonth: 12 },
  toddler: { startMonth: 12, endMonth: 36 },
  preschool: { startMonth: 36, endMonth: 60 },
  'school-age': { startMonth: 60, endMonth: 144 },
  teen: { startMonth: 144, endMonth: 216 },
};

const AGE_BAND_LABELS: Record<AgeBand, string> = {
  infant: 'Infant (0–1)',
  toddler: 'Toddler (1–3)',
  preschool: 'Preschool (3–5)',
  'school-age': 'School-age (5–12)',
  teen: 'Teen (12–17)',
};

export function isAgeBand(value: string): value is AgeBand {
  return (AGE_BANDS as readonly string[]).includes(value);
}

export function ageBandLabel(value: AgeBand): string {
  return AGE_BAND_LABELS[value];
}

/** Filter to the valid, de-duplicated set of AgeBand values in canonical order. */
export function normaliseAgeBands(values: readonly string[]): AgeBand[] {
  const set = new Set(values);
  return AGE_BANDS.filter((b) => set.has(b));
}

/** Provenance marker so consumers can detect the provisional vs Ci'erro-final list. */
export const SAFETY_BEHAVIORS_TAXONOMY_VERSION = '0.1.0-provisional-OH-188';
