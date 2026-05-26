/**
 * Pricing & Commission calculator (Phase 2 ticket 2.11).
 *
 * Takes the Agreed Rate from the accepted Offer + the Provider's per-child
 * surcharge snapshot + the Booking's child count and computes platform
 * commission split via Stripe Connect's application fee. Commission target
 * 15–20%, exact % is a Phase 0 client decision (0.2).
 */
export const PRICING_MODULE_VERSION = '0.0.0-2.1-skeleton';
