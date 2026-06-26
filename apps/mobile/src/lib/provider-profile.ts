/**
 * Provider (clinical) profile builder option data (OH-189) — the runtime lists
 * the provider profile screen maps over: specialty labels, the consultation-slot
 * time options, and the read-only credential-status copy/tones.
 *
 * Like profile.ts, the option `value`s are typed against the generated contract
 * (@our-haven/openapi-types via @/api/client) — the canonical enum source is
 * @our-haven/shared → the Edge route → the OpenAPI spec — so a backend enum
 * change stops these lists compiling. Labels are UI copy.
 */
import type { ProviderCredentialStatus, ProviderSpecialty } from '@/api/client';
// The dollar↔cents helpers are role-agnostic; reuse them from the caregiver lib.
import { centsToDollars, dollarsToCents } from '@/lib/profile';

export { centsToDollars, dollarsToCents };

export interface Option<V extends string> {
  value: V;
  label: string;
}

export const SPECIALTY_LABELS: Record<ProviderSpecialty, string> = {
  slp: 'Speech-Language Pathologist',
  ot: 'Occupational Therapist',
  aba: 'ABA Therapist',
  psychology: 'Psychologist',
  other: 'Other specialty',
};

export const SPECIALTY_OPTIONS: Option<ProviderSpecialty>[] = [
  { value: 'slp', label: 'Speech-Language Pathology' },
  { value: 'ot', label: 'Occupational Therapy' },
  { value: 'aba', label: 'ABA Therapy' },
  { value: 'psychology', label: 'Psychology' },
  { value: 'other', label: 'Other' },
];

export function specialtyLabel(specialty: ProviderSpecialty | null): string {
  return specialty ? SPECIALTY_LABELS[specialty] : 'Specialty not set';
}

/** "$120/session" style label; "Rate on request" when unset. */
export function sessionRateLabel(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return 'Rate on request';
  return `$${(cents / 100).toFixed(0)}/session`;
}

// ── consultation-slot time options ──────────────────────────────────────────
// Minutes-since-midnight at 30-min increments across a generous clinical day.

function buildTimeOptions(startHour: number, endHour: number): Option<string>[] {
  const out: Option<string>[] = [];
  for (let min = startHour * 60; min <= endHour * 60; min += 30) {
    out.push({ value: String(min), label: minToLabel(min) });
  }
  return out;
}

/** Minutes-since-midnight → "9:00 AM". */
export function minToLabel(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export const SLOT_TIME_OPTIONS: Option<string>[] = buildTimeOptions(6, 21);

/** Render a slot window as "Wed Jul 1 · 9:00 AM – 10:00 AM". */
export function slotWindowLabel(date: string, startMin: number, endMin: number): string {
  return `${slotDateLabel(date)} · ${minToLabel(startMin)} – ${minToLabel(endMin)}`;
}

/** "2026-07-01" → "Wed, Jul 1" (UTC, locale-independent). */
export function slotDateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[dt.getUTCDay()]}, ${months[dt.getUTCMonth()]} ${d}`;
}

// ── credential-status copy ──────────────────────────────────────────────────

type Overall = ProviderCredentialStatus['overall'];
type DocStatus = ProviderCredentialStatus['license'];

export const OVERALL_STATUS_LABELS: Record<Overall, string> = {
  verified: 'Verified',
  'in-review': 'Under review',
  rejected: 'Action needed',
  unverified: 'Not started',
};

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  verified: 'Verified',
  uploaded: 'Uploaded · pending review',
  missing: 'Not uploaded',
};

/** Semantic tone key for the overall badge, mapped to colours in the screen. */
export function overallStatusTone(overall: Overall): 'success' | 'neutral' | 'danger' | 'muted' {
  switch (overall) {
    case 'verified':
      return 'success';
    case 'in-review':
      return 'neutral';
    case 'rejected':
      return 'danger';
    default:
      return 'muted';
  }
}
