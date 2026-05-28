/**
 * Application lifecycle state machine (OH-113).
 *
 * Pure-TS deep module per ADR-0004. Encodes the v1 Application state graph
 * from CONTEXT.md § Application + ADR-0006 § Decision 4.
 *
 *   submitted → countered          (Parent or Provider counter-Offer)
 *             → awarded            (Parent accepts current Offer)
 *             → declined           (Parent declines Application)
 *             → withdrawn          (Provider withdraws their own Application)
 *             → expired            (Job auto-expired or was parent-cancelled
 *                                   while this Application was still open)
 *
 *   countered ⇄ submitted          (counter goes back into negotiation;
 *                                   modelled here as a return to submitted
 *                                   because the Application is again
 *                                   actionable by either party — a fresh
 *                                   pending Offer)
 *
 *   Direct-Message Jobs:
 *     The single Application is materialised in `awarded` directly. The
 *     other Application states never apply to that flow.
 *
 * Lockstep with Job:
 *   - Job.award fires `parent-award` on the winning Application (→ awarded)
 *     and `auto-decline` on every other (→ declined).
 *   - Job.auto-expire / Job.parent-cancel fires `job-expired` on each open
 *     Application (→ expired).
 *
 * Pure + deterministic. No I/O.
 */

export const APPLICATION_STATES = [
  'submitted',
  'countered',
  'awarded',
  'declined',
  'withdrawn',
  'expired',
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];

export const APPLICATION_TERMINAL_STATES = [
  'awarded',
  'declined',
  'withdrawn',
  'expired',
] as const;
export type ApplicationTerminalState = (typeof APPLICATION_TERMINAL_STATES)[number];

export const APPLICATION_ORIGINS = ['posted', 'direct-message'] as const;
export type ApplicationOrigin = (typeof APPLICATION_ORIGINS)[number];

export interface ApplicationShape {
  origin: ApplicationOrigin;
}

export interface Application extends ApplicationShape {
  state: ApplicationState;
}

export const APPLICATION_EVENT_TYPES = [
  'parent-counter',
  'provider-counter',
  'parent-award',
  'parent-decline',
  'provider-withdraw',
  'auto-decline',
  'job-expired',
] as const;
export type ApplicationEventType = (typeof APPLICATION_EVENT_TYPES)[number];

export interface ApplicationEvent {
  type: ApplicationEventType;
}

export const APPLICATION_SIDE_EFFECT_TYPES = [
  'notify-parent',
  'notify-provider',
  'notify-both',
  'supersede-previous-offer',
  'transition-job-to-awarded',
  'create-booking-from-offer',
] as const;
export type ApplicationSideEffectType = (typeof APPLICATION_SIDE_EFFECT_TYPES)[number];

export interface ApplicationSideEffect {
  type: ApplicationSideEffectType;
}

export type ApplicationTransitionResult =
  | {
      ok: true;
      next: ApplicationState;
      sideEffects: readonly ApplicationSideEffect[];
    }
  | { ok: false; reason: string };

/**
 * The state a newly-created Application is born in.
 *
 *   - Posted-Job Application:     `submitted`
 *   - Direct-Message Application: `awarded` (materialised at acceptance)
 */
export function initialApplicationState(shape: ApplicationShape): ApplicationState {
  return shape.origin === 'posted' ? 'submitted' : 'awarded';
}

export function isApplicationTerminal(state: ApplicationState): boolean {
  return (APPLICATION_TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * Whether the Application contributes to the per-Job 15-cap headcount. Only
 * actionable states (submitted, countered) count against the cap. Withdrawn
 * Applications free up a slot; expired/declined do not (per ADR-0006 §7 the
 * cap protects Parent UX of the live applications list).
 *
 * This is a derived predicate; the storage layer owns the count itself.
 */
export function countsAgainstJobCap(state: ApplicationState): boolean {
  return state === 'submitted' || state === 'countered';
}

/**
 * Apply an event to an Application. Pure + deterministic.
 */
export function transitionApplication(
  application: Application,
  event: ApplicationEvent,
): ApplicationTransitionResult {
  const { state, origin } = application;

  // Direct-Message Applications are born terminal; no event is legal.
  if (origin === 'direct-message') {
    return {
      ok: false,
      reason: 'direct-message applications are born awarded and accept no further events',
    };
  }

  switch (event.type) {
    case 'parent-counter':
    case 'provider-counter': {
      // A counter-Offer reopens the Application to a fresh pending Offer.
      // The previous Offer is `countered` (see Offer state machine).
      if (state !== 'submitted' && state !== 'countered') {
        return { ok: false, reason: `${event.type} invalid from ${state}` };
      }
      const notify: ApplicationSideEffectType =
        event.type === 'parent-counter' ? 'notify-provider' : 'notify-parent';
      return {
        ok: true,
        next: 'countered',
        sideEffects: [{ type: 'supersede-previous-offer' }, { type: notify }],
      };
    }

    case 'parent-award': {
      // Parent accepts the Application's current Offer.
      if (state !== 'submitted' && state !== 'countered') {
        return { ok: false, reason: `parent-award invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'awarded',
        sideEffects: [
          { type: 'transition-job-to-awarded' },
          { type: 'create-booking-from-offer' },
          { type: 'notify-provider' },
        ],
      };
    }

    case 'parent-decline': {
      if (state !== 'submitted' && state !== 'countered') {
        return { ok: false, reason: `parent-decline invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'declined',
        sideEffects: [{ type: 'notify-provider' }],
      };
    }

    case 'provider-withdraw': {
      if (state !== 'submitted' && state !== 'countered') {
        return { ok: false, reason: `provider-withdraw invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'withdrawn',
        sideEffects: [{ type: 'notify-parent' }],
      };
    }

    case 'auto-decline': {
      // Fired by Job.award on every losing Application.
      if (state !== 'submitted' && state !== 'countered') {
        return { ok: false, reason: `auto-decline invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'declined',
        sideEffects: [{ type: 'notify-provider' }],
      };
    }

    case 'job-expired': {
      // Fired by Job.auto-expire or Job.parent-cancel on each open Application.
      if (state !== 'submitted' && state !== 'countered') {
        return { ok: false, reason: `job-expired invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'expired',
        sideEffects: [{ type: 'notify-provider' }],
      };
    }
  }
}

export const APPLICATION_LIFECYCLE_MODULE_VERSION = '0.1.0-OH-113';
