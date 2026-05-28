/**
 * Job lifecycle state machine (OH-113).
 *
 * Pure-TS deep module per ADR-0004. Encodes the v1 Job state graph from
 * CONTEXT.md § Job + ADR-0006 § Decision 3.
 *
 *   Posted Job:
 *     draft → open → (awarded | expired | cancelled) → closed
 *     - 14d auto-expiry from publish if no Award.
 *     - 15-Application cap (per-Job UX protection — Decision §7).
 *
 *   Direct-Message Job:
 *     Born `awarded` at Book-request acceptance time (skips draft + open).
 *     Materialised atomically with its single Application + Booking.
 *     14d expiry and 15-cap do not apply (the Job is already awarded).
 *
 * The terminal state `closed` is reached from `awarded` after the spawned
 * Booking reaches a Booking-terminal state (completed | cancelled | disputed
 * | expired | declined). At that point the Job has nothing left to do and is
 * marked closed; closure is signalled by the `booking-resolved` event from
 * the handler layer.
 *
 * Inputs: current Job shape + state + event. Outputs: next state + the
 * semantic side-effects the handler layer must enqueue (notifications,
 * auto-decline of losing Applications, Booking creation). No I/O happens
 * here.
 */

export const JOB_STATES = [
  'draft',
  'open',
  'awarded',
  'expired',
  'cancelled',
  'closed',
] as const;
export type JobState = (typeof JOB_STATES)[number];

/**
 * States from which no further transitions are valid.
 *
 * `awarded` is intentionally *not* terminal — the Job still has work to do:
 * once its spawned Booking resolves, `awarded → closed` runs to seal the
 * Job's audit trail.
 */
export const JOB_TERMINAL_STATES = ['expired', 'cancelled', 'closed'] as const;
export type JobTerminalState = (typeof JOB_TERMINAL_STATES)[number];

export const JOB_ORIGINS = ['posted', 'direct-message'] as const;
export type JobOrigin = (typeof JOB_ORIGINS)[number];

export interface JobShape {
  origin: JobOrigin;
}

export interface Job extends JobShape {
  state: JobState;
}

/**
 * Hard per-Job Application cap. Posted-Job UX protection (ADR-0006 §7).
 * Direct-Message Jobs always have exactly one Application by construction
 * and are exempt.
 */
export const JOB_APPLICATION_CAP = 15;

/**
 * Posted-Job time-to-live after publish (transit to `open`). After this
 * duration without an Award, the Job auto-transitions `open → expired`
 * via the `auto-expire` event.
 */
export const JOB_OPEN_TTL_DAYS = 14;

export const JOB_EVENT_TYPES = [
  'publish',
  'award',
  'auto-expire',
  'parent-cancel',
  'booking-resolved',
  'materialise-direct-message',
] as const;
export type JobEventType = (typeof JOB_EVENT_TYPES)[number];

export interface JobEvent {
  type: JobEventType;
}

/**
 * Semantic side-effect tags. The handler layer translates each into actual
 * I/O — Expo Push / SendGrid / Twilio dispatch, pgmq enqueue, Application
 * lockstep transitions, Booking creation.
 */
export const JOB_SIDE_EFFECT_TYPES = [
  'schedule-job-expiry-14d',
  'notify-providers-in-category',
  'notify-parent',
  'notify-applicants',
  'auto-decline-losing-applications',
  'create-booking-from-offer',
  'rebind-thread-to-job',
  'mark-applications-expired',
] as const;
export type JobSideEffectType = (typeof JOB_SIDE_EFFECT_TYPES)[number];

export interface JobSideEffect {
  type: JobSideEffectType;
}

export type JobTransitionResult =
  | { ok: true; next: JobState; sideEffects: readonly JobSideEffect[] }
  | { ok: false; reason: string };

/**
 * The state a newly-created Job is born in.
 *
 *   - Posted Job:    born `draft` (Parent composer state)
 *   - Direct-Message Job: born `awarded` (materialised at acceptance)
 */
export function initialJobState(shape: JobShape): JobState {
  return shape.origin === 'posted' ? 'draft' : 'awarded';
}

/**
 * Side-effects to enqueue at Job creation. Direct-Message Jobs are
 * materialised together with their Application + Booking in one TX (see
 * § Direct-Message atomic materialisation), so the rebind-thread and
 * booking-creation side-effects belong to that flow, not to Job creation.
 */
export function initialJobSideEffects(shape: JobShape): readonly JobSideEffect[] {
  if (shape.origin === 'posted') {
    // Draft is silent — Parent is still composing.
    return [];
  }
  return [{ type: 'rebind-thread-to-job' }, { type: 'create-booking-from-offer' }];
}

export function isJobTerminal(state: JobState): boolean {
  return (JOB_TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * Whether the Job can still accept new Applications. False once the Job is
 * past `open`, or once the 15-cap has been reached.
 *
 * The cap check is parameterised on `currentApplicationCount` because the
 * count lives on the storage layer; the pure module does not own it.
 */
export function canAcceptApplication(
  job: Job,
  currentApplicationCount: number,
): boolean {
  if (job.origin !== 'posted') return false;
  if (job.state !== 'open') return false;
  return currentApplicationCount < JOB_APPLICATION_CAP;
}

/**
 * Apply an event to a Job, returning the next state + the side-effects the
 * handler should enqueue, or a refusal explaining why the transition is
 * illegal.
 *
 * Pure + deterministic.
 */
export function transitionJob(job: Job, event: JobEvent): JobTransitionResult {
  const { state, origin } = job;

  switch (event.type) {
    case 'publish': {
      if (origin !== 'posted') {
        return {
          ok: false,
          reason: 'publish only valid for posted jobs (direct-message jobs are born awarded)',
        };
      }
      if (state !== 'draft') {
        return { ok: false, reason: `publish invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'open',
        sideEffects: [
          { type: 'notify-providers-in-category' },
          { type: 'schedule-job-expiry-14d' },
        ],
      };
    }

    case 'award': {
      if (origin !== 'posted') {
        return {
          ok: false,
          reason: 'award invalid for direct-message jobs (born awarded by materialisation)',
        };
      }
      if (state !== 'open') {
        return { ok: false, reason: `award invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'awarded',
        sideEffects: [
          { type: 'create-booking-from-offer' },
          { type: 'auto-decline-losing-applications' },
          { type: 'notify-applicants' },
        ],
      };
    }

    case 'auto-expire': {
      if (origin !== 'posted') {
        return {
          ok: false,
          reason: 'auto-expire invalid for direct-message jobs (no open state to time out)',
        };
      }
      if (state !== 'open') {
        return { ok: false, reason: `auto-expire invalid from ${state}` };
      }
      return {
        ok: true,
        next: 'expired',
        sideEffects: [
          { type: 'notify-parent' },
          { type: 'mark-applications-expired' },
        ],
      };
    }

    case 'parent-cancel': {
      // Parent may cancel a Job in `draft` or `open`. Once `awarded`, the
      // Booking lifecycle owns cancellation (parent-cancel on the Booking).
      if (origin !== 'posted') {
        return {
          ok: false,
          reason: 'parent-cancel invalid for direct-message jobs (no pre-Booking phase)',
        };
      }
      if (state !== 'draft' && state !== 'open') {
        return { ok: false, reason: `parent-cancel invalid from ${state}` };
      }
      const sideEffects: JobSideEffect[] =
        state === 'open'
          ? [{ type: 'notify-applicants' }, { type: 'mark-applications-expired' }]
          : [];
      return { ok: true, next: 'cancelled', sideEffects };
    }

    case 'booking-resolved': {
      // The Booking spawned by Award (Posted-Job flow) or by materialisation
      // (Direct-Message flow) has reached one of its terminal states. The
      // Job seals as `closed`.
      if (state !== 'awarded') {
        return { ok: false, reason: `booking-resolved invalid from ${state}` };
      }
      return { ok: true, next: 'closed', sideEffects: [] };
    }

    case 'materialise-direct-message': {
      // Sanity event for the atomic Direct-Message materialisation handler:
      // accepts only on a Job that has already been constructed in `awarded`
      // (origin direct-message). It does not move state; it exists so the
      // handler can pass through the same transitionJob channel and have its
      // side-effects (rebind-thread, create-booking) enumerated consistently.
      if (origin !== 'direct-message') {
        return {
          ok: false,
          reason: 'materialise-direct-message invalid for posted jobs',
        };
      }
      if (state !== 'awarded') {
        return {
          ok: false,
          reason: `materialise-direct-message invalid from ${state} (must be born awarded)`,
        };
      }
      return {
        ok: true,
        next: 'awarded',
        sideEffects: [
          { type: 'rebind-thread-to-job' },
          { type: 'create-booking-from-offer' },
        ],
      };
    }
  }
}

export const JOB_LIFECYCLE_MODULE_VERSION = '0.1.0-OH-113';
