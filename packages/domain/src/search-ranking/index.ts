/**
 * Search ranking scorer (Phase 2 ticket 2.13).
 *
 * Hybrid score per CONTEXT.md § Search & filters:
 *   0.5 × distance_proximity + 0.3 × rating + 0.2 × recency_active_in_last_7_days
 */
export const SEARCH_RANKING_MODULE_VERSION = '0.0.0-2.1-skeleton';
