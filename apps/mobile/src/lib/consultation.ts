/**
 * Display derivations for Provider consultation booking (OH-203) — shared by the
 * Provider detail booking surface and the Parent/Provider schedule lists.
 *
 * Pure presentation helpers: slot/booking date + time formatting (the slot window
 * is minutes-since-midnight, tz-agnostic per the backend), the per-session Rate
 * label, the Verified-clinician credential breakdown, and the upcoming/past split.
 */
import type { BookingSummary, SupplyProfileProviderCredential, SupplyProfileSlot } from '@/api/client';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Minutes-since-midnight → a 12-hour clock label (e.g. 540 → "9:00 AM"). */
export function minutesToClock(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** A slot window as "9:00 AM – 10:00 AM". */
export function slotTimeRange(s: { startMin: number; endMin: number }): string {
  return `${minutesToClock(s.startMin)} – ${minutesToClock(s.endMin)}`;
}

/** ISO `YYYY-MM-DD` → "Fri Jul 10" (tz-agnostic — parsed as a plain calendar day). */
export function formatSlotDate(date: string): string {
  const parts = date.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return date;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()] ?? ''} ${MONTHS[m - 1] ?? ''} ${d}`;
}

/** A full slot label, e.g. "Fri Jul 10 · 9:00 AM – 10:00 AM". */
export function slotLabel(s: SupplyProfileSlot): string {
  return `${formatSlotDate(s.date)} · ${slotTimeRange(s)}`;
}

/** A booking's scheduled day + window. */
export function bookingWhen(b: BookingSummary): string {
  return `${formatSlotDate(b.scheduledDate)} · ${slotTimeRange(b)}`;
}

/** Cents → "$120 / session"; null cents → null. */
export function sessionRate(cents: number | null | undefined): string | null {
  if (cents == null) return null;
  return `$${Math.round(cents / 100)} / session`;
}

const SPECIALTY_LABELS: Record<string, string> = {
  slp: 'Speech-Language Pathology',
  ot: 'Occupational Therapy',
  aba: 'ABA Therapy',
  psychology: 'Psychology',
  other: 'Specialist',
};

/** A Provider specialty key → its display label; null passes through to null. */
export function specialtyLabel(specialty: string | null | undefined): string | null {
  if (!specialty) return null;
  return SPECIALTY_LABELS[specialty] ?? specialty;
}

/** The Provider's Verified-clinician credential breakdown rows. */
export function providerCredentialRows(c: SupplyProfileProviderCredential): { label: string; ok: boolean }[] {
  return [
    { label: 'License verified', ok: c.licenseVerified },
    { label: 'Insurance verified', ok: c.insuranceVerified },
    { label: 'Background check', ok: c.screeningPassed },
  ];
}

/** Whether a booking sits on the Upcoming (vs Past) schedule tab. */
export function isUpcomingBooking(b: Pick<BookingSummary, 'state'>): boolean {
  return b.state === 'accepted' || b.state === 'requested' || b.state === 'in-progress';
}

/** Whether the caller can still cancel a consultation (only while accepted). */
export function isCancellable(b: Pick<BookingSummary, 'state'>): boolean {
  return b.state === 'accepted';
}
