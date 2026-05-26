/**
 * Verification workflow state machine (Phase 2 ticket 2.4).
 *
 * State-agnostic — consumes verification results (Checkr webhooks, admin
 * decisions on per-state license-board lookups, ID-doc + insurance + state
 * home-childcare-registration admin reviews), not vendor APIs. Vendor
 * adapters live at the handler layer.
 */
export const VERIFICATION_WORKFLOW_MODULE_VERSION = '0.0.0-2.1-skeleton';
