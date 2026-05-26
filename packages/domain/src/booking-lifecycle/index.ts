/**
 * Booking lifecycle state machine (Phase 2 ticket 2.11).
 *
 * States per CONTEXT.md § Booking states:
 *   requested → (accepted | declined | expired) →
 *     in-progress (hourly only) →
 *     awaiting-confirmation (hourly only) →
 *     (completed | disputed | cancelled)
 *
 * Direct-Message Bookings skip `requested` (born `accepted`).
 * Per-session Specialist Bookings skip in-progress + awaiting-confirmation.
 */
export const BOOKING_LIFECYCLE_MODULE_VERSION = '0.0.0-2.1-skeleton';
