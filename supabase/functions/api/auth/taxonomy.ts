// Mirror of packages/shared/src/provider-taxonomy.ts (ADR-0011) — re-authored
// with explicit-.ts hygiene so the Edge tree stays self-contained on Deno
// (same pattern as roles.ts). Keep in sync with the shared source of truth.
export const CAREGIVER_CATEGORIES = ['babysitter', 'tutor', 'nanny'] as const;
export type CaregiverCategory = (typeof CAREGIVER_CATEGORIES)[number];

export const SPECIALTIES = ['slp', 'ot', 'aba', 'psychology', 'other'] as const;
export type Specialty = (typeof SPECIALTIES)[number];
