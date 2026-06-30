/**
 * Offer / Book-request formatting + copy (OH-206). Pure helpers (no RN imports)
 * shared by the OfferBubble + OfferComposer across native + web so wording and
 * money/date formatting can't drift. Times are minutes-from-midnight; money is
 * integer cents; dates are ISO `YYYY-MM-DD`.
 */
import type { OfferStatus } from '@/api/client';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `'2026-08-01'` → `'Fri, Aug 1'` (UTC, lib-free for Hermes). */
export function formatOfferDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]}, ${MONTHS[m - 1]} ${d}`;
}

/** Minutes-from-midnight → `'6:00 PM'`. */
export function formatTimeOfDay(min: number): string {
  const h24 = Math.floor(min / 60);
  const mm = min % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
}

/** `'6:00 PM – 9:00 PM'`. */
export function formatWindow(startMin: number, endMin: number): string {
  return `${formatTimeOfDay(startMin)} – ${formatTimeOfDay(endMin)}`;
}

/** Integer cents → `'$50'` / `'$52.50'`. */
export function formatMoney(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** Minutes → `'3h'` / `'2.5h'`. */
export function formatHours(minutes: number): string {
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  countered: 'Countered',
  declined: 'Declined',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
};

/** Bundled summary for a multi-day Offer card: `'3 dates · 9h · $180'`. */
export function bundledSummary(slotCount: number, totalMinutes: number, totalCents: number): string {
  const dates = slotCount === 1 ? '1 date' : `${slotCount} dates`;
  return `${dates} · ${formatHours(totalMinutes)} · ${formatMoney(totalCents)}`;
}

export const OFFER_TITLE = 'Booking request';
export const OFFER_COUNTER_TITLE = 'Counter-offer';

/** The consent line shown above the Safety-Behaviors disclosure step (ADR-0016). */
export const OFFER_DISCLOSURE_CONSENT =
  "Choosing what to share is required. What you disclose is shown to this caregiver to help them judge whether they're the right fit — your full profile stays private until you book.";

/** The mandatory-choice helper under the disclosure step (story 133). */
export const OFFER_DISCLOSURE_PROMPT =
  "Select the behaviours you'd like to share, or choose to share none.";
