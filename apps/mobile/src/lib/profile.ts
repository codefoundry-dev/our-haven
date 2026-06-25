/**
 * Caregiver profile builder option data (OH-188) — the runtime lists the
 * profile screen maps over: per-category labels, the age-band + behaviour-comfort
 * (shared Safety-Behaviors taxonomy) chips, Credential types, and the 7×3
 * availability grid axes.
 *
 * Like supply.ts, the option `value`s are typed against the generated contract
 * (@our-haven/openapi-types via @/api/client) — the canonical enum source is
 * @our-haven/shared → the Edge route → the OpenAPI spec — so a backend enum
 * change stops these lists compiling. Labels are UI copy.
 *
 * ⚠️ The behaviour-comfort list mirrors the PROVISIONAL Safety-Behaviors
 * taxonomy (final list pending Ci'erro — M2.10). It re-derives the same values
 * the backend validates against; keep in step when the final list lands.
 */
import type {
  CaregiverProfilePatch,
  CredentialCreateBody,
} from '@/api/client';
import type { Category } from '@/lib/supply';

export type AgeBand = NonNullable<CaregiverProfilePatch['agesServed']>[number];
export type SafetyBehavior = NonNullable<CaregiverProfilePatch['behaviourComfort']>[number];
export type CredentialType = CredentialCreateBody['type'];

export interface Option<V extends string> {
  value: V;
  label: string;
}

/** Categories that may carry a per-child surcharge (Babysitter/Nanny only). */
export const SURCHARGE_CATEGORIES: readonly Category[] = ['babysitter', 'nanny'];

export const CATEGORY_LABELS: Record<Category, string> = {
  babysitter: 'Babysitter',
  tutor: 'Tutor',
  nanny: 'Nanny',
};

export function isSurchargeCategory(category: Category): boolean {
  return SURCHARGE_CATEGORIES.includes(category);
}

export const AGE_BAND_OPTIONS: Option<AgeBand>[] = [
  { value: 'infant', label: 'Infant · 0–1' },
  { value: 'toddler', label: 'Toddler · 1–3' },
  { value: 'preschool', label: 'Preschool · 3–5' },
  { value: 'school-age', label: 'School-age · 5–12' },
  { value: 'teen', label: 'Teen · 12–17' },
];

export const BEHAVIOUR_OPTIONS: Option<SafetyBehavior>[] = [
  { value: 'aggression', label: 'Aggression' },
  { value: 'self-injury', label: 'Self-injurious behaviour' },
  { value: 'elopement', label: 'Wandering / elopement' },
  { value: 'meltdowns', label: 'Meltdowns' },
  { value: 'property-destruction', label: 'Property destruction' },
  { value: 'pica', label: 'Pica' },
  { value: 'sensory-sensitivity', label: 'Sensory sensitivities' },
  { value: 'communication-support', label: 'Communication support' },
  { value: 'transition-difficulty', label: 'Difficulty with transitions' },
  { value: 'sleep-disturbance', label: 'Sleep disturbance' },
];

export const CREDENTIAL_TYPE_OPTIONS: Option<CredentialType>[] = [
  { value: 'title', label: 'Title' },
  { value: 'certification', label: 'Certification' },
  { value: 'training', label: 'Training' },
];

export const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  title: 'Title',
  certification: 'Certification',
  training: 'Training',
};

/** 7-day axis of the availability grid (CONTEXT.md § Availability). */
export const AVAILABILITY_DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
] as const;

/** 3-band axis with the platform-fixed clock mapping. */
export const AVAILABILITY_BANDS = [
  { key: 'morning', label: 'AM', time: '6–12' },
  { key: 'afternoon', label: 'Noon', time: '12–6' },
  { key: 'evening', label: 'PM', time: '6–10' },
] as const;

export const AVAILABILITY_NOTE_MAX = 200;

/** Parse a dollar string to integer cents, or null when blank/invalid. */
export function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Render integer cents as a plain dollar string for an input ("" when null). */
export function centsToDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

/** "$25/hr" style label; "—" when unpriced. */
export function rateLabel(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return `$${(cents / 100).toFixed(0)}/hr`;
}
