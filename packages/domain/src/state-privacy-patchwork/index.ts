/**
 * State-privacy patchwork — pure-TS deep module (OH-182).
 *
 * Maps a member's resident US state to the privacy REGIME that governs their
 * consumer deletion / access right and the SLA the platform must honour it
 * within. This layers ON TOP of the federal-uniform retention rules in the
 * sibling `retention-planner`: the planner decides *what* happens to each data
 * category and on what retention clock; this module decides *by when* a
 * deletion request must be actioned for a given resident (CONTEXT § Retention:
 * "State-specific deletion-right SLAs … honored at the API layer via the
 * state-privacy-patchwork module, on top of the underlying retention rules").
 *
 * ── Source of truth ─────────────────────────────────────────────────────────
 * The authoritative per-state appendix is the **PIA** authored by US privacy
 * counsel (OH-225; CONTEXT § PIA: "Carries state-specific appendices that the
 * state-privacy-patchwork module surfaces per user residence"). This table is
 * the **launch-conservative baseline** that the PIA refines — it is structured
 * so counsel's values slot into the same shape without a code change:
 *   - States with a comprehensive consumer-privacy statute carry that statute's
 *     well-established response window (the modal value across CCPA/CPRA, VCDPA,
 *     CPA, CTDPA, UCPA, TDPSA, … is **45 days**; Iowa's ICDPA is 90).
 *   - Every other state resolves to the **federal floor** (COPPA / FCRA / GLBA
 *     + platform best practice) with the same conservative 45-day house SLA, so
 *     a deletion request from any resident always gets a concrete deadline.
 *
 * Pure-TS per ADR-0004 — no DB, no network. The API layer reads `deletionSlaFor`
 * / `deletionDeadline` to set and surface the per-resident deadline.
 */

import { US_STATES_50_PLUS_DC, type UsState } from '@our-haven/shared';

/** Where a regime's SLA comes from. */
export type PrivacyRegimeSource =
  | 'statute' // a comprehensive state consumer-privacy law
  | 'platform-default'; // federal floor + platform best practice (no comprehensive state law)

export interface PrivacyRegime {
  state: UsState;
  /** Statute acronym (e.g. "CCPA/CPRA"), or null under the federal floor. */
  law: string | null;
  /** Human-readable regime name for admin / PIA surfaces. */
  lawName: string;
  source: PrivacyRegimeSource;
  /** Days within which a consumer deletion/access request must be actioned. */
  deletionResponseDays: number;
  /** Additional days the statute permits as a one-time extension (with notice). */
  extensionDays: number;
}

/** The conservative house SLA applied wherever a statute does not set a stricter one. */
export const DEFAULT_DELETION_RESPONSE_DAYS = 45;
export const DEFAULT_EXTENSION_DAYS = 45;

/**
 * Comprehensive-law states (enacted + effective by the v1 launch window). The
 * 45/45-day response+extension window is the modal value across this wave;
 * Iowa (ICDPA) allows 90 days, and Florida (FDBR) allows a 15-day extension.
 * Provisional pending the PIA sign-off (OH-225) — values are encoded here so the
 * shape is real and testable, not to pre-empt counsel.
 */
interface StatuteEntry {
  law: string;
  lawName: string;
  deletionResponseDays?: number; // defaults to DEFAULT_DELETION_RESPONSE_DAYS
  extensionDays?: number; // defaults to DEFAULT_EXTENSION_DAYS
}

const STATUTES: Partial<Record<UsState, StatuteEntry>> = {
  CA: { law: 'CCPA/CPRA', lawName: 'California Consumer Privacy Act (as amended by CPRA)' },
  VA: { law: 'VCDPA', lawName: 'Virginia Consumer Data Protection Act' },
  CO: { law: 'CPA', lawName: 'Colorado Privacy Act' },
  CT: { law: 'CTDPA', lawName: 'Connecticut Data Privacy Act' },
  UT: { law: 'UCPA', lawName: 'Utah Consumer Privacy Act' },
  IA: { law: 'ICDPA', lawName: 'Iowa Consumer Data Protection Act', deletionResponseDays: 90 },
  IN: { law: 'INCDPA', lawName: 'Indiana Consumer Data Protection Act' },
  TN: { law: 'TIPA', lawName: 'Tennessee Information Protection Act' },
  TX: { law: 'TDPSA', lawName: 'Texas Data Privacy and Security Act' },
  OR: { law: 'OCPA', lawName: 'Oregon Consumer Privacy Act' },
  MT: { law: 'MCDPA', lawName: 'Montana Consumer Data Privacy Act' },
  FL: { law: 'FDBR', lawName: 'Florida Digital Bill of Rights', extensionDays: 15 },
  DE: { law: 'DPDPA', lawName: 'Delaware Personal Data Privacy Act' },
  NE: { law: 'NDPA', lawName: 'Nebraska Data Privacy Act' },
  NH: { law: 'NHDPA', lawName: 'New Hampshire Data Privacy Act' },
  NJ: { law: 'NJDPA', lawName: 'New Jersey Data Privacy Act' },
  MD: { law: 'MODPA', lawName: 'Maryland Online Data Privacy Act' },
  MN: { law: 'MCDPA', lawName: 'Minnesota Consumer Data Privacy Act' },
  RI: { law: 'RIDTPPA', lawName: 'Rhode Island Data Transparency and Privacy Protection Act' },
  KY: { law: 'KCDPA', lawName: 'Kentucky Consumer Data Protection Act' },
};

const FEDERAL_FLOOR_NAME = 'Federal floor (COPPA / FCRA / GLBA) + platform best practice';

const REGIME_INDEX: ReadonlyMap<UsState, PrivacyRegime> = (() => {
  const m = new Map<UsState, PrivacyRegime>();
  for (const state of US_STATES_50_PLUS_DC) {
    const statute = STATUTES[state];
    if (statute) {
      m.set(state, {
        state,
        law: statute.law,
        lawName: statute.lawName,
        source: 'statute',
        deletionResponseDays: statute.deletionResponseDays ?? DEFAULT_DELETION_RESPONSE_DAYS,
        extensionDays: statute.extensionDays ?? DEFAULT_EXTENSION_DAYS,
      });
    } else {
      m.set(state, {
        state,
        law: null,
        lawName: FEDERAL_FLOOR_NAME,
        source: 'platform-default',
        deletionResponseDays: DEFAULT_DELETION_RESPONSE_DAYS,
        extensionDays: DEFAULT_EXTENSION_DAYS,
      });
    }
  }
  return m;
})();

/** The privacy regime governing a resident of `state`. Total over all 50 + DC. */
export function deletionSlaFor(state: UsState): PrivacyRegime {
  const regime = REGIME_INDEX.get(state);
  // Total by construction (the index covers US_STATES_50_PLUS_DC); the guard
  // keeps the return type non-nullable for callers.
  if (!regime) {
    return {
      state,
      law: null,
      lawName: FEDERAL_FLOOR_NAME,
      source: 'platform-default',
      deletionResponseDays: DEFAULT_DELETION_RESPONSE_DAYS,
      extensionDays: DEFAULT_EXTENSION_DAYS,
    };
  }
  return regime;
}

/**
 * The date by which a deletion request from a resident of `state` must be
 * actioned. `useExtension` adds the statute's permitted extension (with notice).
 */
export function deletionDeadline(state: UsState, requestedAt: Date, useExtension = false): Date {
  const regime = deletionSlaFor(state);
  const days = regime.deletionResponseDays + (useExtension ? regime.extensionDays : 0);
  const deadline = new Date(requestedAt.getTime());
  deadline.setUTCDate(deadline.getUTCDate() + days);
  return deadline;
}

/** Every state whose regime is a comprehensive consumer-privacy statute. */
export function comprehensiveLawStates(): UsState[] {
  return US_STATES_50_PLUS_DC.filter((s) => deletionSlaFor(s).source === 'statute');
}

/** Every regime, for admin / PIA surfaces that render the whole patchwork. */
export function listPrivacyRegimes(): PrivacyRegime[] {
  return US_STATES_50_PLUS_DC.map((s) => deletionSlaFor(s));
}

export const STATE_PRIVACY_PATCHWORK_MODULE_VERSION = '0.1.0-OH-182';
