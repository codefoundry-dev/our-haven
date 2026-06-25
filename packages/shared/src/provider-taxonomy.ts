/**
 * Supply-side sub-taxonomy for the two supply roles (ADR-0011 — three flat
 * top-level roles `{parent, caregiver, provider}`; the former
 * `Provider`-umbrella + `kind` discriminator is gone):
 *   - role=caregiver → categories ⊆ {babysitter, tutor, nanny} (one or more)
 *   - role=provider  → specialty ∈ {slp, ot, aba, psychology, other}
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

/**
 * The two supply-side roles (ADR-0011) — the accounts that hold a `providers`
 * row. `caregiver` carries `categories`; `provider` carries `specialty`.
 * `parent` (and the internal `admin`) hold no supply row.
 */
export const SUPPLY_ROLES = ['caregiver', 'provider'] as const;
export type SupplyRole = (typeof SUPPLY_ROLES)[number];

export function isCaregiverCategory(value: string): value is CaregiverCategory {
  return (CAREGIVER_CATEGORIES as readonly string[]).includes(value);
}

export function isSpecialty(value: string): value is Specialty {
  return (SPECIALTIES as readonly string[]).includes(value);
}
