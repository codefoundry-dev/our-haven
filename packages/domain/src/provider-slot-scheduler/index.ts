/**
 * Provider consultation-slot scheduler — deep module (OH-180).
 *
 * Pure-TS per ADR-0004 (no DB / vendor imports). Encodes the v1 Provider
 * consultation slot-pick from CONTEXT.md § Availability + § Booking (slot-pick
 * resurrected for the Provider role only — ADR-0011):
 *
 *   "Provider publishes bookable consultation slots. Booking an open slot holds
 *    it and creates a per-session Provider Booking (null payment); cancellation
 *    releases it."
 *
 * Slots are concrete dated time windows the Provider lists. This module owns the
 * SLOT state only; the per-session Provider Booking it backs (born `accepted`,
 * null payment, auto-complete after the slot) is the booking-lifecycle module's
 * concern. The handler wires the two: on a consultation booking it creates the
 * Provider Booking AND calls `holdSlot`; on cancellation, booking-lifecycle
 * emits `release-consultation-slot`, which the handler executes via
 * `releaseSlot`.
 *
 * ── Slot lifecycle (open / held / released) ────────────────────────────────
 *        open ──holdSlot(bookingId)──▶ held ──releaseSlot──▶ released
 *         │                                                     │
 *         └──withdrawSlot──▶ released ◀── reopenSlot ──────────┘ (released→open)
 *
 *   - open      published & bookable — the only state `intersectSlotsWithQuery`
 *               surfaces.
 *   - held      a consultation Booking holds it (`heldByBookingId`).
 *   - released  the hold was released (consultation cancelled) OR the Provider
 *               withdrew an open slot. NOT bookable until the Provider
 *               re-lists it with `reopenSlot` — a freed slot returns to the
 *               Provider's control rather than silently re-opening.
 *
 * Pure + deterministic and clock-free.
 */

export const SLOT_STATES = ['open', 'held', 'released'] as const;
export type SlotState = (typeof SLOT_STATES)[number];

/** A concrete bookable consultation slot. */
export interface ConsultationSlot {
  id: string;
  /** Calendar day, ISO `YYYY-MM-DD`. */
  date: string;
  /** Window start, minutes-since-midnight (0..1440). */
  startMin: number;
  /** Window end, minutes-since-midnight (start < end ≤ 1440). */
  endMin: number;
  state: SlotState;
  /** The consultation Booking holding this slot while `held`; null otherwise. */
  heldByBookingId: string | null;
}

/** A search date/time slice to test bookable slots against. */
export interface SlotQuery {
  date: string;
  startMin: number;
  endMin: number;
}

export type SlotResult =
  | { ok: true; slot: ConsultationSlot }
  | { ok: false; reason: string };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDate(date: string): boolean {
  const m = DATE_RE.exec(date);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const back = new Date(Date.UTC(y, mo - 1, d));
  return (
    back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d
  );
}

function isValidWindow(startMin: number, endMin: number): boolean {
  return (
    Number.isInteger(startMin) &&
    Number.isInteger(endMin) &&
    startMin >= 0 &&
    endMin <= 1440 &&
    startMin < endMin
  );
}

/** The state a freshly-listed slot is born in. */
export function initialSlotState(): SlotState {
  return 'open';
}

/** Whether a slot can be booked right now (only `open` slots are bookable). */
export function isBookable(slot: Pick<ConsultationSlot, 'state'>): boolean {
  return slot.state === 'open';
}

/**
 * List a new consultation slot (CRUD create). Validates the date + window and
 * returns the slot born `open`. Returns a refusal (rather than throwing) on bad
 * Provider input so the editor can surface it.
 */
export function createSlot(input: {
  id: string;
  date: string;
  startMin: number;
  endMin: number;
}): SlotResult {
  if (!input.id) return { ok: false, reason: 'slot id must be non-empty' };
  if (!isValidDate(input.date)) {
    return { ok: false, reason: `invalid slot date '${input.date}' (expected YYYY-MM-DD)` };
  }
  if (!isValidWindow(input.startMin, input.endMin)) {
    return {
      ok: false,
      reason: `invalid slot window startMin=${input.startMin} endMin=${input.endMin}`,
    };
  }
  return {
    ok: true,
    slot: {
      id: input.id,
      date: input.date,
      startMin: input.startMin,
      endMin: input.endMin,
      state: 'open',
      heldByBookingId: null,
    },
  };
}

/**
 * Book (hold) an open slot — the slot-side of creating a consultation Booking.
 * Stamps the holding Booking id. Refuses unless the slot is `open`.
 */
export function holdSlot(slot: ConsultationSlot, bookingId: string): SlotResult {
  if (!bookingId) return { ok: false, reason: 'bookingId must be non-empty' };
  if (slot.state !== 'open') {
    return { ok: false, reason: `holdSlot invalid from ${slot.state} — only an open slot can be held` };
  }
  return { ok: true, slot: { ...slot, state: 'held', heldByBookingId: bookingId } };
}

/**
 * Release a held slot — the slot-side of a consultation cancellation
 * (booking-lifecycle's `release-consultation-slot`). Clears the holding Booking
 * id and moves the slot to `released`. Refuses unless the slot is `held`.
 */
export function releaseSlot(slot: ConsultationSlot): SlotResult {
  if (slot.state !== 'held') {
    return {
      ok: false,
      reason: `releaseSlot invalid from ${slot.state} — only a held slot can be released`,
    };
  }
  return { ok: true, slot: { ...slot, state: 'released', heldByBookingId: null } };
}

/**
 * Provider withdraws a still-open slot from listing (CRUD un-publish). Refuses a
 * `held` slot — the consultation Booking must be cancelled first (which releases
 * it). Moves `open → released`.
 */
export function withdrawSlot(slot: ConsultationSlot): SlotResult {
  if (slot.state !== 'open') {
    return {
      ok: false,
      reason: `withdrawSlot invalid from ${slot.state} — only an open slot can be withdrawn (cancel the booking to free a held slot)`,
    };
  }
  return { ok: true, slot: { ...slot, state: 'released', heldByBookingId: null } };
}

/** Provider re-lists a released slot, returning it to bookable `open`. */
export function reopenSlot(slot: ConsultationSlot): SlotResult {
  if (slot.state !== 'released') {
    return {
      ok: false,
      reason: `reopenSlot invalid from ${slot.state} — only a released slot can be re-opened`,
    };
  }
  return { ok: true, slot: { ...slot, state: 'open', heldByBookingId: null } };
}

function windowsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Whether two slots collide — same calendar day with overlapping windows. */
export function slotsOverlap(
  a: Pick<ConsultationSlot, 'date' | 'startMin' | 'endMin'>,
  b: Pick<ConsultationSlot, 'date' | 'startMin' | 'endMin'>,
): boolean {
  return a.date === b.date && windowsOverlap(a.startMin, a.endMin, b.startMin, b.endMin);
}

/**
 * Existing slots that collide with `candidate` (ignoring the candidate itself by
 * id) — a CRUD guard so the Provider cannot list two overlapping slots.
 */
export function findSlotConflicts(
  candidate: ConsultationSlot,
  existing: readonly ConsultationSlot[],
): ConsultationSlot[] {
  return existing.filter((s) => s.id !== candidate.id && slotsOverlap(candidate, s));
}

/**
 * The bookable (`open`) slots that intersect a search date/time query — same day
 * + overlapping window. Held / released slots are never surfaced. Throws on a
 * malformed query (caller bug; the query is supplied once per search).
 */
export function intersectSlotsWithQuery(
  slots: readonly ConsultationSlot[],
  query: SlotQuery,
): ConsultationSlot[] {
  if (!isValidDate(query.date)) {
    throw new Error(`invalid query date '${query.date}' (expected YYYY-MM-DD)`);
  }
  if (!isValidWindow(query.startMin, query.endMin)) {
    throw new Error(`invalid query window startMin=${query.startMin} endMin=${query.endMin}`);
  }
  return slots.filter(
    (s) =>
      s.state === 'open' &&
      s.date === query.date &&
      windowsOverlap(s.startMin, s.endMin, query.startMin, query.endMin),
  );
}

export const PROVIDER_SLOT_SCHEDULER_MODULE_VERSION = '0.2.0-OH-180';
