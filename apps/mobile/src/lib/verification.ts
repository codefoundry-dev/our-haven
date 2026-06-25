/**
 * Verification view-model (OH-184) — pure derivation of the applicant-facing
 * checklist from the server's verification result. The STATE itself is computed
 * server-side by the @our-haven/domain state machine; this only maps the returned
 * `state` + `facts` into labels, per-step statuses, and progress for rendering.
 * Kept dependency-free so it is trivial to unit-test once the app gains a runner.
 */
import type { Verification, VerificationState } from '@/api/client';

export type StepStatus = 'done' | 'in-progress' | 'todo' | 'blocked';

/** Which steps carry an in-app action in OH-184 (the rest are status-only here). */
export type StepAction = 'id-doc' | 'phone';

export interface VerificationStep {
  key: 'email' | 'id' | 'screening' | 'connect' | 'license' | 'insurance' | 'phone';
  label: string;
  hint: string;
  status: StepStatus;
  action?: StepAction;
}

export type StateTone = 'neutral' | 'progress' | 'success' | 'warn' | 'error';

export interface StateCopy {
  label: string;
  tone: StateTone;
  blurb: string;
}

/** Header copy per verification state (the design's status pill + sub-line). */
export const VERIFICATION_STATE_COPY: Record<VerificationState, StateCopy> = {
  unverified: { label: 'Not started', tone: 'neutral', blurb: 'Complete the steps below to start getting bookings.' },
  'email-verified': { label: 'In progress', tone: 'progress', blurb: 'Email confirmed. Keep going to go live.' },
  'id-uploaded': { label: 'In progress', tone: 'progress', blurb: 'ID received. A background check comes next.' },
  'screening-initiated': { label: 'Background check running', tone: 'progress', blurb: 'This usually finishes within a few days.' },
  'connect-pending': { label: 'Set up payouts', tone: 'progress', blurb: 'Connect a payout account so you can be paid for bookings.' },
  'license-pending': { label: 'License under review', tone: 'progress', blurb: 'Our team is verifying your professional license.' },
  'insurance-pending': { label: 'Insurance under review', tone: 'progress', blurb: 'Our team is verifying your liability insurance.' },
  'holding-state-not-supported': { label: 'State not yet supported', tone: 'warn', blurb: "We don't verify licenses in your state yet. We'll email you when we do." },
  'awaiting-phone-verification': { label: 'Verify your phone to go live', tone: 'progress', blurb: 'A verified phone is required — booking requests are sent by SMS.' },
  activated: { label: 'Verified', tone: 'success', blurb: "You're verified and visible to families." },
  rejected: { label: 'Verification declined', tone: 'error', blurb: 'Contact support to find out what happened and what to do next.' },
};

function step(
  key: VerificationStep['key'],
  label: string,
  status: StepStatus,
  hint: string,
  action?: StepAction,
): VerificationStep {
  return { key, label, status, hint, action };
}

/** The ordered, per-role checklist with a status for each step. */
export function verificationSteps(v: Verification): VerificationStep[] {
  const f = v.facts;
  const rejected = v.state === 'rejected';
  const has = (value: string | null) => value !== null;

  const email = step(
    'email',
    'Confirm your email',
    has(f.emailConfirmedAt) ? 'done' : 'todo',
    has(f.emailConfirmedAt) ? '' : 'Tap the link in the email we sent you.',
  );

  const id = step(
    'id',
    'Upload a government ID',
    has(f.idDocUploadedAt) ? 'done' : 'todo',
    has(f.idDocUploadedAt) ? "We've received your ID." : "A driver's licence, state ID, or passport.",
    'id-doc',
  );

  const screening = step(
    'screening',
    'Background check',
    has(f.screeningPassedAt) ? 'done' : has(f.screeningInitiatedAt) ? 'in-progress' : 'todo',
    has(f.screeningPassedAt)
      ? 'Cleared.'
      : has(f.screeningInitiatedAt)
        ? 'In progress — no action needed.'
        : 'Starts automatically after your ID is received.',
  );

  const phone = step(
    'phone',
    'Verify your phone',
    has(f.phoneConfirmedAt) ? 'done' : 'todo',
    has(f.phoneConfirmedAt) ? 'Verified.' : 'Required to go live — booking requests arrive by SMS.',
    'phone',
  );

  const middle: VerificationStep[] =
    v.role === 'caregiver'
      ? [
          step(
            'connect',
            'Set up payouts',
            has(f.connectAccountReadyAt) ? 'done' : 'todo',
            has(f.connectAccountReadyAt) ? 'Payouts enabled.' : 'Connect a bank account to get paid (opens Stripe).',
          ),
        ]
      : [
          step(
            'license',
            'Professional license',
            !v.licenseBoardSupported ? 'blocked' : has(f.licenseVerifiedAt) ? 'done' : 'todo',
            !v.licenseBoardSupported
              ? "Not available in your state yet."
              : has(f.licenseVerifiedAt)
                ? 'Verified.'
                : 'Our team verifies this against your state board.',
          ),
          step(
            'insurance',
            'Liability insurance',
            !v.licenseBoardSupported ? 'blocked' : has(f.licenseVerifiedAt) ? 'todo' : 'todo',
            !v.licenseBoardSupported ? 'Not available in your state yet.' : 'Reviewed by our team after your license.',
          ),
        ];

  const steps = [email, id, screening, ...middle, phone];
  if (rejected) {
    // Terminal: nothing is actionable; surface the rejection at the header instead.
    return steps.map((s) => (s.status === 'done' ? s : { ...s, status: 'blocked', action: undefined }));
  }
  return steps;
}

export function verificationProgress(steps: VerificationStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.status === 'done').length, total: steps.length };
}
