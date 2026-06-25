/**
 * Retention / erasure planner — pure-TS deep module (OH-182).
 *
 * Given an erasure TRIGGER (account deletion or sensitive-data consent
 * withdrawal) the planner folds the platform retention policy into an ordered
 * list of {category, action, dueAt} DIRECTIVES. Each directive names exactly one
 * of the four dispositions the policy allows — **soft-delete / pseudonymize /
 * hard-delete / retain** — and the date it becomes due. The handler / worker-tick
 * sweep layer (OH-237 substrate) executes a directive once `now >= dueAt`; this
 * module never touches a database, Stripe, or any vendor (ADR-0004 / ADR-0019).
 *
 * ── Policy table (CONTEXT.md § Retention policy; PRD-0001 v1.7) ──────────────
 *   - **Account data:**            30-day soft-delete grace, then hard-delete.
 *   - **Booking + payment (financial):** pseudonymize ("Deleted user {id}") and
 *                                  retain **7 years** (IRS recordkeeping), then
 *                                  hard-delete.
 *   - **Message content:**         hard-delete **3 years** after last activity,
 *                                  UNLESS flagged in an active investigation
 *                                  (then retain — the clock is suspended). Job
 *                                  descriptions, Application proposals and Offer
 *                                  `scope_note`s share this rule (same disclosure
 *                                  surface).
 *   - **Background-check raw:**    hard-delete **6 months** after completion
 *                                  (FCRA disposal-rule best practice; ADR-0007).
 *                                  The cleared/not STATUS is retained.
 *   - **Sensitive (Safety Behaviors + `safety_behaviors_consent_at`):** erased
 *                                  on account deletion **or** consent withdrawal.
 *                                  There are **no per-child records** to erase
 *                                  (ADR-0012 — Child entity removed).
 *
 * State-specific deletion-right SLAs (CCPA 45-day, FDBR window, …) layer ON TOP
 * of these rules at the API layer — see the sibling `state-privacy-patchwork`
 * module. The account 30-day grace completes comfortably inside every state SLA.
 *
 * ── Why a fold, not an event log ────────────────────────────────────────────
 * Retention is a pure function of (trigger, the anchor dates, an investigation
 * flag). The same inputs always yield the same plan, so it is trivially testable
 * and the sweep layer stays a thin "is this directive due yet?" loop.
 */

/** The data categories the retention policy governs. */
export const RETENTION_CATEGORIES = [
  'account',
  'financial', // Booking + payment records
  'messages', // message content + Job descriptions + Application proposals + Offer scope_notes
  'background_check_raw',
  'safety_behaviors', // Safety Behaviors checklist + consent timestamp
] as const;
export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

/**
 * The four dispositions the policy allows (the ticket's
 * "soft-delete / pseudonymize / hard-delete / retain").
 *   - `soft-delete`  — reversible delete during a grace window (account phase 1).
 *   - `pseudonymize` — strip identifying fields, keep the (now non-identifying)
 *                      record (financial — "Deleted user {id}").
 *   - `hard-delete`  — irreversible physical delete.
 *   - `retain`       — keep untouched; no scheduled erasure (investigation hold).
 */
export const ERASURE_ACTIONS = ['soft-delete', 'pseudonymize', 'hard-delete', 'retain'] as const;
export type ErasureAction = (typeof ERASURE_ACTIONS)[number];

/**
 * What set the planner in motion.
 *   - `account-deletion`   — the member asked to delete their account: every
 *                            category is planned.
 *   - `consent-withdrawal` — the Parent withdrew Safety-Behaviors consent
 *                            WITHOUT deleting their account: only the sensitive
 *                            category is erased (CONTEXT § Sensitive-data consent).
 */
export const ERASURE_TRIGGERS = ['account-deletion', 'consent-withdrawal'] as const;
export type ErasureTrigger = (typeof ERASURE_TRIGGERS)[number];

/**
 * Retention horizons, in their natural units, as the single source of truth. The
 * worker-tick sweeps and the row-insert sites that stamp deadline columns (e.g.
 * `provider_screenings.purge_at`) derive their windows from these constants so a
 * policy change lands in one place.
 */
export const RETENTION_HORIZONS = {
  ACCOUNT_GRACE_DAYS: 30,
  FINANCIAL_RETENTION_YEARS: 7,
  MESSAGE_RETENTION_YEARS: 3,
  BACKGROUND_CHECK_RAW_RETENTION_MONTHS: 6,
} as const;

/** The pseudonym written over a deleted member's financial PII (CONTEXT § Retention). */
export function pseudonymForUser(subjectUserId: string): string {
  return `Deleted user ${subjectUserId}`;
}

/**
 * One scheduled erasure step: take `action` on `category` at `dueAt`. A category
 * with a grace/retention window emits TWO directives (the immediate action plus
 * the later hard-delete) so every directive stays a simple, atomic unit the
 * sweep layer can execute independently.
 */
export interface ErasureDirective {
  category: RetentionCategory;
  action: ErasureAction;
  /** When the action becomes due. Equals `requestedAt` for immediate actions. */
  dueAt: Date;
  /** The pseudonym to write — set only when `action === 'pseudonymize'`, else null. */
  pseudonym: string | null;
  /** Audit rationale citing the governing rule. */
  reason: string;
}

export interface PlanErasureInput {
  trigger: ErasureTrigger;
  /** The subject's user id — drives the financial pseudonym. */
  subjectUserId: string;
  /** When the trigger fired (deletion request / consent withdrawal). */
  requestedAt: Date;
  /**
   * Last activity on the member's message threads — the 3-year message clock runs
   * from here. Defaults to `requestedAt` when omitted (treats the request moment
   * as last activity, the conservative latest purge date).
   */
  messagesLastActivityAt?: Date;
  /**
   * When the member's background check completed — the FCRA 6-month raw-disposal
   * clock runs from here. Defaults to `requestedAt` when omitted. Ignored for
   * members who were never screened (the sweep simply finds no rows).
   */
  backgroundCheckCompletedAt?: Date;
  /**
   * True when the member's messages are flagged in an active Trust & Safety
   * investigation — the 3-year clock is suspended and message content is RETAINED
   * until the hold lifts (CONTEXT § Retention: "unless flagged in an active
   * investigation").
   */
  investigationHold?: boolean;
}

// ---------------------------------------------------------------------------
// Date arithmetic — UTC, calendar-aware with end-of-month clamping so a horizon
// anchored on the 31st (or Feb-29) lands on a real date rather than rolling into
// the next month.
// ---------------------------------------------------------------------------

export function addDays(d: Date, days: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

export function addMonths(d: Date, months: number): Date {
  const day = d.getUTCDate();
  const r = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + months,
      1,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
  // Clamp the day to the last valid day of the target month (e.g. Jan 31 +1mo → Feb 28/29).
  const lastDayOfMonth = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, lastDayOfMonth));
  return r;
}

export function addYears(d: Date, years: number): Date {
  return addMonths(d, years * 12);
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

function planConsentWithdrawal(input: PlanErasureInput): ErasureDirective[] {
  // Consent withdrawal touches ONLY the sensitive category — the account, its
  // financial history and messages all survive (the member keeps their account).
  return [
    {
      category: 'safety_behaviors',
      action: 'hard-delete',
      dueAt: input.requestedAt,
      pseudonym: null,
      reason:
        'Safety Behaviors + consent timestamp erased immediately on consent withdrawal (CONTEXT § Sensitive-data consent; ADR-0012 — no per-child records).',
    },
  ];
}

function planAccountDeletion(input: PlanErasureInput): ErasureDirective[] {
  const { requestedAt, subjectUserId } = input;
  const lastActivity = input.messagesLastActivityAt ?? requestedAt;
  const bgCompleted = input.backgroundCheckCompletedAt ?? requestedAt;

  const directives: ErasureDirective[] = [
    // Account — 30-day soft-delete grace, then hard-delete.
    {
      category: 'account',
      action: 'soft-delete',
      dueAt: requestedAt,
      pseudonym: null,
      reason: 'Account data soft-deleted immediately; 30-day recovery grace (CONTEXT § Retention).',
    },
    {
      category: 'account',
      action: 'hard-delete',
      dueAt: addDays(requestedAt, RETENTION_HORIZONS.ACCOUNT_GRACE_DAYS),
      pseudonym: null,
      reason: 'Account data hard-deleted after the 30-day grace (CONTEXT § Retention).',
    },
    // Sensitive — erased on account deletion (same rule as consent withdrawal).
    {
      category: 'safety_behaviors',
      action: 'hard-delete',
      dueAt: requestedAt,
      pseudonym: null,
      reason:
        'Safety Behaviors + consent timestamp erased on account deletion (CONTEXT § Retention; ADR-0012 — no per-child records).',
    },
    // Financial — pseudonymize now, retain 7y for IRS recordkeeping, then hard-delete.
    {
      category: 'financial',
      action: 'pseudonymize',
      dueAt: requestedAt,
      pseudonym: pseudonymForUser(subjectUserId),
      reason:
        'Booking + payment records pseudonymized to the "Deleted user {id}" label and retained 7 years (IRS recordkeeping; CONTEXT § Retention).',
    },
    {
      category: 'financial',
      action: 'hard-delete',
      dueAt: addYears(requestedAt, RETENTION_HORIZONS.FINANCIAL_RETENTION_YEARS),
      pseudonym: null,
      reason: 'Pseudonymized Booking + payment records hard-deleted after 7 years (CONTEXT § Retention).',
    },
  ];

  // Messages — retained under an active-investigation hold, else hard-deleted 3y
  // after last activity. Job descriptions / Application proposals / Offer
  // scope_notes ride the same rule (same disclosure surface).
  if (input.investigationHold) {
    directives.push({
      category: 'messages',
      action: 'retain',
      dueAt: requestedAt,
      pseudonym: null,
      reason:
        'Message content under active-investigation legal hold — the 3-year retention clock is suspended (CONTEXT § Retention).',
    });
  } else {
    directives.push({
      category: 'messages',
      action: 'hard-delete',
      dueAt: addYears(lastActivity, RETENTION_HORIZONS.MESSAGE_RETENTION_YEARS),
      pseudonym: null,
      reason:
        'Message content (+ Job descriptions, Application proposals, Offer scope_notes) hard-deleted 3 years after last activity (CONTEXT § Retention).',
    });
  }

  // Background-check raw details — disposed 6 months after completion; the
  // cleared/not status on the account is retained.
  directives.push({
    category: 'background_check_raw',
    action: 'hard-delete',
    dueAt: addMonths(bgCompleted, RETENTION_HORIZONS.BACKGROUND_CHECK_RAW_RETENTION_MONTHS),
    pseudonym: null,
    reason:
      'Background-check raw details disposed 6 months after completion (FCRA disposal rule; ADR-0007). Cleared/not status retained.',
  });

  return directives;
}

/**
 * Fold an erasure trigger into the ordered set of retention directives. Pure +
 * deterministic — same input always yields the same plan.
 */
export function planErasure(input: PlanErasureInput): ErasureDirective[] {
  switch (input.trigger) {
    case 'consent-withdrawal':
      return planConsentWithdrawal(input);
    case 'account-deletion':
      return planAccountDeletion(input);
  }
}

/**
 * Whether a directive is due to run at `now`. A `retain` directive is never due
 * (it has no scheduled erasure — the row is held until a hold-lift re-plans it).
 */
export function isDirectiveDue(directive: ErasureDirective, now: Date): boolean {
  if (directive.action === 'retain') return false;
  return now.getTime() >= directive.dueAt.getTime();
}

/**
 * The directives a worker-tick sweep should execute at `now` — the seam the
 * OH-237 substrate consumes. Each owning ticket (account → OH-200, financial →
 * OH-177/179, messages → OH-2.13) implements a thin `Sweep` that scans its
 * deadline column and applies the matching directive's `action`; the FCRA
 * background-check raw sweep already runs live in the worker-tick from OH-237.
 */
export function dueDirectives(plan: readonly ErasureDirective[], now: Date): ErasureDirective[] {
  return plan.filter((d) => isDirectiveDue(d, now));
}

export const RETENTION_PLANNER_MODULE_VERSION = '0.2.0-OH-182';
