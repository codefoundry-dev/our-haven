/**
 * Onboarding-hub view-model — pure derivation of the supply setup checklist shown
 * on (app)/onboarding (the Claude Design cp-web CPOnboardHub). After a Caregiver or
 * Provider claims their role, the auth gate routes them here on web; this maps the
 * live /v1/providers/me/verification result + the fixed profile journey into the
 * ordered, design-faithful rows.
 *
 * The verification-driven rows (Government ID, Background check, Phone, Payouts,
 * License, Insurance) read their status from the server result; the profile-oriented
 * rows (Profile, Rates, Credentials, Agreements) are actionable links into the
 * existing profile screens — their completion isn't tracked server-side yet, so they
 * stay actionable.
 *
 * Kept dependency-free (type-only Verification import) so the progress/CTA decisions
 * are trivially unit-testable, matching lib/verification.
 */
import type { Verification } from '@/api/client';

/** Where a step's tap sends the user — resolved to a concrete route in the screen. */
export type OnboardingDest = 'profile' | 'verification' | null;

export type OnboardingStatus = 'done' | 'in-progress' | 'todo' | 'optional' | 'blocked';

export interface OnboardingStep {
  n: number;
  key: string;
  label: string;
  sub: string;
  status: OnboardingStatus;
  dest: OnboardingDest;
}

type Facts = Verification['facts'];

const has = (v: string | null | undefined): boolean => v != null && v !== '';

function idStep(n: number, f: Facts): OnboardingStep {
  const done = has(f.idDocUploadedAt);
  return {
    n,
    key: 'id',
    label: 'Government ID',
    sub: done ? 'Received — under review' : 'Verified via Stripe Identity',
    status: done ? 'done' : 'todo',
    dest: 'verification',
  };
}

function screeningStep(n: number, f: Facts): OnboardingStep {
  const status: OnboardingStatus = has(f.screeningPassedAt)
    ? 'done'
    : has(f.screeningInitiatedAt)
      ? 'in-progress'
      : 'todo';
  return {
    n,
    key: 'screening',
    label: 'Background check',
    sub: status === 'done' ? 'Cleared' : status === 'in-progress' ? 'Checkr · in progress' : 'Checkr standard screening',
    status,
    dest: 'verification',
  };
}

function phoneStep(n: number, f: Facts, required: boolean): OnboardingStep {
  const done = has(f.phoneConfirmedAt);
  return {
    n,
    key: 'phone',
    label: required ? 'Phone number' : 'Phone (optional)',
    sub: done
      ? 'Verified'
      : required
        ? 'Required — booking requests arrive by SMS'
        : 'Speeds up booking confirmations',
    status: done ? 'done' : required ? 'todo' : 'optional',
    dest: 'verification',
  };
}

/** The ordered, per-role hub checklist with a status for each step. */
export function onboardingSteps(v: Verification): OnboardingStep[] {
  const f = v.facts;

  if (v.role === 'provider') {
    const blocked = !v.licenseBoardSupported;
    const licenseDone = has(f.licenseVerifiedAt);
    return [
      { n: 1, key: 'specialty', label: 'Clinical specialty', sub: 'Chosen at sign-up', status: 'done', dest: 'profile' },
      { n: 2, key: 'profile', label: 'Clinical profile', sub: 'Bio, identity & display rate', status: 'todo', dest: 'profile' },
      { n: 3, key: 'rate', label: 'Consultation rate', sub: 'Your per-session rate', status: 'todo', dest: 'profile' },
      idStep(4, f),
      screeningStep(5, f),
      {
        n: 6,
        key: 'license',
        label: 'Professional license',
        sub: blocked ? 'Not supported in your state yet' : licenseDone ? 'Verified' : 'Verified against your state board',
        status: blocked ? 'blocked' : licenseDone ? 'done' : 'todo',
        dest: 'verification',
      },
      {
        n: 7,
        key: 'insurance',
        label: 'Liability insurance',
        sub: blocked ? 'Not supported in your state yet' : licenseDone ? 'On file' : 'Reviewed by our team',
        status: blocked ? 'blocked' : licenseDone ? 'done' : 'todo',
        dest: 'verification',
      },
      phoneStep(8, f, true),
      { n: 9, key: 'agreements', label: 'Agreements', sub: 'Provider terms + safety policy', status: 'todo', dest: null },
    ];
  }

  // Caregiver
  return [
    { n: 1, key: 'categories', label: 'Service categories', sub: 'Chosen at sign-up', status: 'done', dest: 'profile' },
    { n: 2, key: 'profile', label: 'Profile basics', sub: 'Photo, bio, ages & comfort', status: 'todo', dest: 'profile' },
    { n: 3, key: 'rates', label: 'Published rates', sub: 'Your hourly rate per category', status: 'todo', dest: 'profile' },
    idStep(4, f),
    screeningStep(5, f),
    { n: 6, key: 'credentials', label: 'Credentials', sub: 'CPR · CDA · optional', status: 'optional', dest: 'profile' },
    phoneStep(7, f, false),
    { n: 8, key: 'agreements', label: 'Agreements', sub: 'Caregiver terms + safety policy', status: 'todo', dest: null },
    {
      n: 9,
      key: 'payouts',
      label: 'Bank & payouts',
      sub: has(f.connectAccountReadyAt) ? 'Payouts enabled' : 'Connect a bank with Stripe',
      status: has(f.connectAccountReadyAt) ? 'done' : 'todo',
      dest: 'verification',
    },
  ];
}

/** Progress over the REQUIRED steps — optional rows don't count against the total. */
export function onboardingProgress(steps: OnboardingStep[]): { done: number; total: number; pct: number } {
  const required = steps.filter((s) => s.status !== 'optional');
  const done = required.filter((s) => s.status === 'done').length;
  const total = required.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/** The step the "Continue setup" CTA jumps to: the first actionable, not-done row. */
export function firstActionableStep(steps: OnboardingStep[]): OnboardingStep | null {
  return steps.find((s) => (s.status === 'todo' || s.status === 'in-progress') && s.dest !== null) ?? null;
}
