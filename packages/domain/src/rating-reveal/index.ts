/**
 * Rating reveal logic (Phase 2 ticket 2.13).
 *
 * Blind mutual reveal per CONTEXT.md § Rating: both sides submit within 14d
 * post-completion, revealed only after both submit or the window closes.
 * Display is asymmetric — Provider ratings public on profile (aggregate +
 * full text); Parent ratings visible only to Providers evaluating a
 * Booking-request, aggregate stars + count only (no text).
 */
export const RATING_REVEAL_MODULE_VERSION = '0.0.0-2.1-skeleton';
