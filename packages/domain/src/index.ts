/**
 * @our-haven/domain — public surface for the pure-TS deep modules.
 *
 * Per ADR-0004 § Consequences, these modules:
 *   - hold all v1 business rules (Booking lifecycle, Pricing & Commission,
 *     Cancellation policy, Disintermediation detector, Search ranking scorer,
 *     Rating reveal logic, Verification workflow, Retention/erasure planner),
 *   - import nothing from the database, Stripe, Twilio, Firebase, GCP, etc.,
 *   - receive collaborators (db, clock, vendor adapters) at the handler layer.
 *
 * Phase 2 ticket 2.1 ships the package shell. Subsequent Phase 2 tickets
 * 2.11 / 2.12 / 2.13 / 2.14 / 2.4 / 2.5 fill in the modules.
 */

export * from './booking-lifecycle/index.js';
export * from './pricing/index.js';
export * from './cancellation/index.js';
export * from './disintermediation/index.js';
export * from './search-ranking/index.js';
export * from './rating-reveal/index.js';
export * from './verification-workflow/index.js';
export * from './retention-planner/index.js';
