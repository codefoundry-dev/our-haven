/**
 * Cancellation policy calculator (Phase 2 ticket 2.11).
 *
 * Per CONTEXT.md § Cancellation policy:
 *   - Parent-initiated ≥24h before start  → free
 *   - Parent-initiated inside 24h          → 50%
 *   - Parent-initiated inside 2h / after   → 100%
 *   - Provider-initiated                   → free in v1, tracked for review
 */
export const CANCELLATION_MODULE_VERSION = '0.0.0-2.1-skeleton';
