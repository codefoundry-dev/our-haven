/**
 * Canonical Provider taxonomy — the sub-umbrella under `role=provider`.
 *
 * Per CONTEXT.md § Provider:
 *   - kind=caregiver  → caregiver_category ∈ {babysitter, tutor, nanny}
 *   - kind=specialist → specialty ∈ {slp, ot, aba, psychology, other}
 *
 * Snake/kebab canonical wire values. UI surfaces map these to display strings
 * (e.g. `babysitter` → "Babysitter", `slp` → "Speech-Language Pathology").
 *
 * The specialty list intentionally includes `other` as an escape hatch — the
 * state-license-board adapter (OH-107) will refine this per US state board.
 */
export const CAREGIVER_CATEGORIES = ['babysitter', 'tutor', 'nanny'] as const;
export type CaregiverCategory = (typeof CAREGIVER_CATEGORIES)[number];

export const SPECIALTIES = ['slp', 'ot', 'aba', 'psychology', 'other'] as const;
export type Specialty = (typeof SPECIALTIES)[number];

export const PROVIDER_KINDS = ['caregiver', 'specialist'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export function isCaregiverCategory(value: string): value is CaregiverCategory {
  return (CAREGIVER_CATEGORIES as readonly string[]).includes(value);
}

export function isSpecialty(value: string): value is Specialty {
  return (SPECIALTIES as readonly string[]).includes(value);
}
