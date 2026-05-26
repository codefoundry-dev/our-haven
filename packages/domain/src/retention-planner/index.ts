/**
 * Retention / erasure planner (Phase 2 ticket 2.14).
 *
 * Schedules retention jobs per CONTEXT.md § Retention policy:
 *   - Account data:        30d soft-delete grace, then hard-delete
 *   - Booking + payments:  7y pseudonymized retention
 *   - Messages:            3y from last activity (unless flagged)
 *   - Background-check raw: 6mo, then hard-delete (cleared/not status stays)
 *   - Sensitive data:      deleted on account deletion OR consent withdrawal
 *
 * Pluggable state-privacy patchwork module routes per-state deletion-right
 * SLAs (CCPA 45d, FDBR response window, etc.) on top of these rules.
 */
export const RETENTION_PLANNER_MODULE_VERSION = '0.0.0-2.1-skeleton';
