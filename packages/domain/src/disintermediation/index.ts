/**
 * Disintermediation detector (Phase 2 ticket 2.13).
 *
 * Regex-based scanning for phone numbers, email addresses, social handles,
 * payment app names (Venmo / Zelle / Cashapp / PayPal / etc.), and
 * address-like patterns. Runs on every Message and every Offer.scope_note.
 * Returns redacted text + a category list for the Trust & Safety queue.
 * Structured Offer numeric fields (proposed_rate / computed_total /
 * scope_quantity) bypass the detector entirely.
 */
export const DISINTERMEDIATION_MODULE_VERSION = '0.0.0-2.1-skeleton';
