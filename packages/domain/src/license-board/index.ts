/**
 * Per-state professional-license-board adapter (OH-107).
 *
 * Maps a Specialist's (state, specialty) tuple to the issuing board, its
 * public license-verification register, and the verification mode. Admins
 * consult this when manually verifying a Specialist's uploaded license — the
 * adapter surfaces the right register URL so the admin can cross-check the
 * license number without hunting.
 *
 * The slate populated here is the **12 priority Specialist-supply states**
 * confirmed in PRD-0001 / ADR-0009 / CONTEXT.md: CA, FL, TX, NY, IL, GA, NC,
 * PA, OH, AZ, WA, MA (~60% of US population). Specialists whose `state` is
 * outside the slate route to `holding-state-not-supported` per the Verification
 * state machine.
 *
 * Pure-TS deep module per ADR-0004 — no DB, no network. Vendor/portal calls
 * are out-of-band manual steps performed by admins; this module just exposes
 * the metadata they need.
 *
 * Mode legend:
 *   - `api`           — register exposes a structured query API the adapter
 *                       could call programmatically (currently *all* states
 *                       are portal-only at launch; reserved for future).
 *   - `portal-only`   — register is a human-facing search page; admin types
 *                       the license number in and reads the result back.
 */

import { SPECIALTIES, type Specialty, type UsState } from '@our-haven/shared';

/** The 12 priority states whose adapters ship at launch (PRD-0001, ADR-0009). */
export const LICENSE_BOARD_LAUNCH_STATES: readonly UsState[] = [
  'CA',
  'FL',
  'TX',
  'NY',
  'IL',
  'GA',
  'NC',
  'PA',
  'OH',
  'AZ',
  'WA',
  'MA',
] as const;

export type LicenseBoardMode = 'api' | 'portal-only';

export interface LicenseBoard {
  state: UsState;
  specialty: Specialty;
  /** Human-readable name of the issuing board, used in the admin UI + Provider portal. */
  boardName: string;
  /** Public license-lookup register URL. Admin opens this in a new tab. */
  registerUrl: string;
  /** Whether the register supports programmatic lookup or is portal-only. */
  mode: LicenseBoardMode;
  /** Optional admin-facing hint (e.g., "search by license #, exact match"). */
  hint?: string;
}

// ---------------------------------------------------------------------------
// Per-state register URLs. Most states route every specialty through a single
// unified portal, so these constants are referenced from the per-(state,
// specialty) builders below.
// ---------------------------------------------------------------------------

const URL = {
  CA_DCA: 'https://search.dca.ca.gov/',
  FL_DOH: 'https://mqa-internet.doh.state.fl.us/MQASearchServices/HealthCareProviders',
  TX_TDLR: 'https://www.tdlr.texas.gov/LicenseSearch/',
  TX_TBHEC: 'https://vo.licensing.hpc.texas.gov/datamart/searchSplash.do',
  NY_SED: 'https://www.op.nysed.gov/verification-search',
  IL_IDFPR: 'https://online-dfpr.micropact.com/Lookup/LicenseLookup.aspx',
  GA_SOS: 'https://verify.sos.ga.gov/verification/',
  NC_SLP: 'https://www.ncboeslpa.org/license-search/',
  NC_OT: 'https://portalplus.ncbot.org/Lookup/LicenseLookup.aspx',
  NC_ABA: 'https://nclicensing.org/verification',
  NC_PSY: 'https://license.ncpsychologyboard.org/verification/Search.aspx',
  PA_PALS: 'https://www.pals.pa.gov/#/page/search',
  OH_ELICENSE: 'https://elicense3.com.ohio.gov/Lookup/LicenseLookup.aspx',
  AZ_DPL: 'https://aps.azdhs.gov/PublicPortal/index.html',
  AZ_OT: 'https://otboard.az.gov/license-verification',
  AZ_PSY: 'https://psychboard.az.gov/license-verification',
  WA_DOH: 'https://fortress.wa.gov/doh/providercredentialsearch/',
  MA_DPL: 'https://elicensing21.mass.gov/CitizenAccess/',
} as const;

function buildBoard(
  state: UsState,
  specialty: Specialty,
  boardName: string,
  registerUrl: string,
  mode: LicenseBoardMode = 'portal-only',
  hint?: string,
): LicenseBoard {
  const out: LicenseBoard = { state, specialty, boardName, registerUrl, mode };
  if (hint) out.hint = hint;
  return out;
}

function ca(s: Specialty, name: string): LicenseBoard {
  return buildBoard('CA', s, name, URL.CA_DCA, 'portal-only', 'Search by license number on DCA portal.');
}
function fl(s: Specialty, name: string): LicenseBoard {
  return buildBoard('FL', s, name, URL.FL_DOH, 'portal-only', 'MQA portal — search by license number or last name.');
}
function tx(s: Specialty, name: string): LicenseBoard {
  const url = s === 'slp' || s === 'ot' ? URL.TX_TDLR : URL.TX_TBHEC;
  return buildBoard('TX', s, name, url);
}
function ny(s: Specialty, name: string): LicenseBoard {
  return buildBoard('NY', s, name, URL.NY_SED);
}
function il(s: Specialty, name: string): LicenseBoard {
  return buildBoard('IL', s, name, URL.IL_IDFPR);
}
function ga(s: Specialty, name: string): LicenseBoard {
  return buildBoard('GA', s, name, URL.GA_SOS);
}
function nc(s: Specialty, name: string): LicenseBoard {
  let url: string = URL.NC_SLP;
  if (s === 'ot') url = URL.NC_OT;
  else if (s === 'aba') url = URL.NC_ABA;
  else if (s === 'psychology') url = URL.NC_PSY;
  return buildBoard('NC', s, name, url);
}
function pa(s: Specialty, name: string): LicenseBoard {
  return buildBoard('PA', s, name, URL.PA_PALS);
}
function oh(s: Specialty, name: string): LicenseBoard {
  return buildBoard('OH', s, name, URL.OH_ELICENSE);
}
function az(s: Specialty, name: string): LicenseBoard {
  let url: string = URL.AZ_DPL;
  if (s === 'ot') url = URL.AZ_OT;
  else if (s === 'psychology' || s === 'aba') url = URL.AZ_PSY;
  return buildBoard('AZ', s, name, url);
}
function wa(s: Specialty, name: string): LicenseBoard {
  return buildBoard('WA', s, name, URL.WA_DOH);
}
function ma(s: Specialty, name: string): LicenseBoard {
  return buildBoard('MA', s, name, URL.MA_DPL);
}

// ---------------------------------------------------------------------------
// Slate data. State boards group multiple specialties under one portal in
// most jurisdictions, so several entries share a registerUrl. We list every
// (state, specialty) pair explicitly so the lookup is O(1) and the slate is
// auditable by walking this file top-to-bottom.
// ---------------------------------------------------------------------------

const BOARDS: readonly LicenseBoard[] = [
  // California — Dept of Consumer Affairs unified search across DCA boards.
  ca('slp', 'California SLPAHADB · Speech-Language Pathologist'),
  ca('ot', 'California Board of Occupational Therapy'),
  ca('aba', 'California Behavior Analyst Board'),
  ca('psychology', 'California Board of Psychology'),
  ca('other', 'California Department of Consumer Affairs · clinical licensure'),

  // Florida — DOH MQA license lookup portal (single portal across boards).
  fl('slp', 'Florida Board of Speech-Language Pathology and Audiology'),
  fl('ot', 'Florida Board of Occupational Therapy'),
  fl('aba', 'Florida Behavior Analysis Certifying Body (BACB-recognised)'),
  fl('psychology', 'Florida Board of Psychology'),
  fl('other', 'Florida DOH MQA · clinical licensure'),

  // Texas — TDLR + Behavioral Health Executive Council split.
  tx('slp', 'Texas Speech-Language Pathologists & Audiologists Advisory Board (TDLR)'),
  tx('ot', 'Texas Board of Occupational Therapy Examiners'),
  tx('aba', 'Texas Behavior Analyst Board (TBHEC)'),
  tx('psychology', 'Texas State Board of Examiners of Psychologists (TBHEC)'),
  tx('other', 'Texas Behavioral Health Executive Council · clinical licensure'),

  // New York — NY State Office of the Professions verification portal.
  ny('slp', 'NYSED Office of the Professions · Speech-Language Pathology'),
  ny('ot', 'NYSED Office of the Professions · Occupational Therapy'),
  ny('aba', 'NYSED Office of the Professions · Applied Behavior Analysis'),
  ny('psychology', 'NYSED Office of the Professions · Psychology'),
  ny('other', 'NYSED Office of the Professions · clinical licensure'),

  // Illinois — IDFPR online lookup.
  il('slp', 'Illinois Speech-Language Pathology and Audiology Board (IDFPR)'),
  il('ot', 'Illinois Board of Occupational Therapy (IDFPR)'),
  il('aba', 'Illinois Board for Behavior Analysts (IDFPR)'),
  il('psychology', 'Illinois Clinical Psychologist Licensing Board (IDFPR)'),
  il('other', 'Illinois Department of Financial & Professional Regulation · clinical'),

  // Georgia — GA Secretary of State Professional Licensing Boards Division.
  ga('slp', 'Georgia State Board of Examiners for Speech-Language Pathology and Audiology'),
  ga('ot', 'Georgia State Board of Occupational Therapy'),
  ga('aba', 'Georgia Composite Board of Professional Counselors, Social Workers, and Marriage and Family Therapists'),
  ga('psychology', 'Georgia State Board of Examiners of Psychologists'),
  ga('other', 'Georgia Secretary of State · Professional Licensing'),

  // North Carolina — board-specific portals.
  nc('slp', 'North Carolina Board of Examiners for Speech and Language Pathologists and Audiologists'),
  nc('ot', 'North Carolina Board of Occupational Therapy'),
  nc('aba', 'North Carolina Behavior Analysis Board'),
  nc('psychology', 'North Carolina Psychology Board'),
  nc('other', 'North Carolina · clinical licensure (board-specific)'),

  // Pennsylvania — PALS unified license services.
  pa('slp', 'Pennsylvania State Board of Examiners in Speech-Language Pathology, Audiology and Hearing Aid Fitters'),
  pa('ot', 'Pennsylvania State Board of Occupational Therapy Education and Licensure'),
  pa('aba', 'Pennsylvania State Board of Medicine · ABA license'),
  pa('psychology', 'Pennsylvania State Board of Psychology'),
  pa('other', 'Pennsylvania PALS · clinical licensure'),

  // Ohio — eLicense Ohio unified portal.
  oh('slp', 'Ohio Board of Speech-Language Pathology and Audiology'),
  oh('ot', 'Ohio Occupational Therapy, Physical Therapy, and Athletic Trainers Board'),
  oh('aba', 'Ohio Board of Psychology · Applied Behavior Analyst'),
  oh('psychology', 'Ohio State Board of Psychology'),
  oh('other', 'Ohio eLicense · clinical licensure'),

  // Arizona — AZ Department of Health Services / board portals.
  az('slp', 'Arizona Department of Health Services · Speech-Language Pathology'),
  az('ot', 'Arizona Board of Occupational Therapy Examiners'),
  az('aba', 'Arizona Board of Psychologist Examiners · ABA license'),
  az('psychology', 'Arizona Board of Psychologist Examiners'),
  az('other', 'Arizona · clinical licensure (board-specific)'),

  // Washington — DOH Provider Credential Search.
  wa('slp', 'Washington State Board of Speech-Language Pathology and Audiology'),
  wa('ot', 'Washington State Occupational Therapy Practice Board'),
  wa('aba', 'Washington State Department of Health · Behavior Analyst'),
  wa('psychology', 'Washington State Examining Board of Psychology'),
  wa('other', 'Washington DOH Provider Credential Search'),

  // Massachusetts — MA Division of Professional Licensure (DPL).
  ma('slp', 'Massachusetts Board of Registration in Speech-Language Pathology and Audiology'),
  ma('ot', 'Massachusetts Board of Registration of Allied Health Professionals · OT'),
  ma('aba', 'Massachusetts Board of Allied Mental Health and Human Services Professions · ABA'),
  ma('psychology', 'Massachusetts Board of Registration of Psychologists'),
  ma('other', 'Massachusetts DPL · clinical licensure'),
];

// ---------------------------------------------------------------------------
// Indexed lookup
// ---------------------------------------------------------------------------

const BOARD_INDEX = new Map<string, LicenseBoard>();
for (const b of BOARDS) {
  BOARD_INDEX.set(`${b.state}:${b.specialty}`, b);
}

/**
 * Look up the board for a (state, specialty) pair. Returns `null` if the
 * state is outside the launch slate, signalling the Verification state
 * machine should route to `holding-state-not-supported`.
 */
export function findLicenseBoard(state: UsState, specialty: Specialty): LicenseBoard | null {
  return BOARD_INDEX.get(`${state}:${specialty}`) ?? null;
}

/**
 * Whether the launch slate covers this state for *any* specialty. Used by the
 * Verification state machine + the sign-up flow's holding-state messaging.
 */
export function isLicenseBoardLaunchState(state: UsState): boolean {
  return (LICENSE_BOARD_LAUNCH_STATES as readonly UsState[]).includes(state);
}

/**
 * All boards for a state, ordered by specialty. Useful for surface code that
 * wants to render every option (e.g., a Specialist who chose `other` and
 * wants to pick which board issued their licence).
 */
export function boardsForState(state: UsState): readonly LicenseBoard[] {
  return BOARDS.filter((b) => b.state === state);
}

/**
 * Set of every (state, specialty) pair the slate covers. Useful for tests
 * that assert the matrix is complete (12 × 5 = 60).
 */
export function listBoardSlate(): readonly LicenseBoard[] {
  return BOARDS;
}

/**
 * Re-export for callers that want to iterate specialties when rendering a
 * board picker (mirrors `SPECIALTIES` from @our-haven/shared).
 */
export const LICENSE_BOARD_SPECIALTIES: readonly Specialty[] = SPECIALTIES;
