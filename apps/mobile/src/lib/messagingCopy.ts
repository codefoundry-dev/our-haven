/**
 * Messaging privacy disclosure copy (OH-205 / CONTEXT § Message).
 *
 * States ONLY the active, user-facing mechanics — disintermediation **redaction**
 * + **Trust & Safety** review. There is deliberately **no "encrypted" / "E2E"
 * claim**: messages are encrypted in transit/at rest (a backend property
 * disclosed in the Privacy Policy), but that is no longer a user-facing promise
 * (PRD story 19, v1.5) and the prototype's false "E2E" badge was removed. Shared
 * across every messaging surface (native + web) so the wording can't drift.
 */
export const MESSAGING_DISCLOSURE_TITLE = 'Contact info is auto-redacted';

export const MESSAGING_DISCLOSURE_BODY =
  'To keep everyone safe on Our Haven, shared contact details — phone numbers, emails, social handles, payment apps, and addresses — are automatically hidden, and messages may be reviewed by our Trust & Safety team.';

/** Short caption shown on a message/thread whose contact info was redacted. */
export const MESSAGING_REDACTED_HINT = 'Contact info hidden';
