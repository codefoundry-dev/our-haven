/**
 * Per-state home-childcare-licensure adapter (OH-108).
 *
 * Optional credential path for **Babysitter / Nanny** Providers who operate as
 * a state-licensed home-based childcare program. Maps a Caregiver's resident
 * state to that state's home-childcare licensing agency, its public register,
 * and an admin-facing hint for cross-checking the uploaded registration
 * certificate. On admin approval, the Provider gets a "State-registered home
 * childcare" badge on their public profile naming the specific agency.
 *
 * Unlike the professional-license-board adapter (OH-107) which gates Specialist
 * activation, this slate is **purely optional** — it never blocks a Provider
 * reaching `activated`. The Verification state machine does not read this
 * module's output. The only consumer is the Provider-profile badge surface.
 *
 * Slate populated for the same 12 priority Caregiver-supply states as OH-107
 * (PRD-0001 / ADR-0009 / CONTEXT.md): CA, FL, TX, NY, IL, GA, NC, PA, OH, AZ,
 * WA, MA. States outside the slate get a `null` lookup; the API surface uses
 * that to disable the upload affordance in the Provider portal.
 *
 * Pure-TS deep module per ADR-0004 — no DB, no network. Vendor/portal calls
 * are out-of-band manual steps performed by admins; this module just exposes
 * the metadata they need.
 */

import { type UsState } from '@our-haven/shared';

/** The 12 priority states whose home-childcare adapters ship at launch. */
export const HOME_CHILDCARE_LICENSE_BOARD_LAUNCH_STATES: readonly UsState[] = [
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

export interface HomeChildcareLicenseBoard {
  state: UsState;
  /** Human-readable name of the issuing agency, surfaced on the profile badge
   *  and in the admin queue (e.g., "Florida DCF Family Child Care Home"). */
  agencyName: string;
  /**
   * Short program label the badge renders below the agency name. Captures the
   * specific regulatory programme within the agency (e.g., "Family Child Care
   * Home", "Type B Home"), since one agency may run multiple categories.
   */
  programName: string;
  /** Public register / lookup URL. Admin opens this in a new tab to verify. */
  registerUrl: string;
  /** Admin-facing hint (e.g., "search by provider name or registration #"). */
  hint: string;
}

const BOARDS: readonly HomeChildcareLicenseBoard[] = [
  {
    state: 'CA',
    agencyName: 'California Department of Social Services · Community Care Licensing',
    programName: 'Family Child Care Home',
    registerUrl: 'https://www.cdss.ca.gov/inforesources/community-care-licensing/care-facility-search-welcome',
    hint: 'Search by facility name, license number, or city on the CCLD public search.',
  },
  {
    state: 'FL',
    agencyName: 'Florida Department of Children and Families',
    programName: 'Family Child Care Home (FCCH)',
    registerUrl: 'https://www.myflfamilies.com/services/child-family/child-care/looking-child-care/search-child-care-facilityhome',
    hint: 'DCF Provider Search — pick "Family Child Care Home" + county to verify by name.',
  },
  {
    state: 'TX',
    agencyName: 'Texas Health and Human Services Commission · Child Care Regulation',
    programName: 'Registered or Licensed Child-Care Home',
    registerUrl: 'https://www.hhs.texas.gov/services/safety/child-care/search-texas-child-care',
    hint: 'HHSC Search Texas Child Care — filter by Registered or Licensed Child-Care Home.',
  },
  {
    state: 'NY',
    agencyName: 'New York State Office of Children and Family Services',
    programName: 'Family Day Care (FDC) / Group Family Day Care (GFDC)',
    registerUrl: 'https://ocfs.ny.gov/programs/childcare/looking/',
    hint: 'OCFS Day Care Search — pick FDC or GFDC + county.',
  },
  {
    state: 'IL',
    agencyName: 'Illinois Department of Children and Family Services',
    programName: 'Licensed Day Care Home',
    registerUrl: 'https://sunshine.dcfs.illinois.gov/Content/Licensing/Daycare/DayCareLookup.aspx',
    hint: 'DCFS Sunshine portal — search by provider last name or licence number.',
  },
  {
    state: 'GA',
    agencyName: 'Georgia Department of Early Care and Learning (DECAL)',
    programName: 'Family Child Care Learning Home (FCCLH)',
    registerUrl: 'https://families.decal.ga.gov/ChildCare/Search',
    hint: 'Quality Rated search — filter Care Type to Family Child Care Learning Home.',
  },
  {
    state: 'NC',
    agencyName: 'North Carolina Division of Child Development and Early Education',
    programName: 'Family Child Care Home',
    registerUrl: 'https://ncchildcaresearch.dhhs.nc.gov/search.asp',
    hint: 'DCDEE Child Care Search — filter Facility Type to Family Child Care Home.',
  },
  {
    state: 'PA',
    agencyName: 'Pennsylvania Department of Human Services · Office of Child Development and Early Learning',
    programName: 'Family Child Care Home',
    registerUrl: 'https://www.findchildcare.pa.gov/',
    hint: 'COMPASS Find Child Care — search by ZIP + Family Child Care Home.',
  },
  {
    state: 'OH',
    agencyName: 'Ohio Department of Job and Family Services',
    programName: 'Family Child Care (Type B Home)',
    registerUrl: 'https://childcaresearch.ohio.gov/',
    hint: 'ODJFS Child Care Search — filter Program Type to Type B Home.',
  },
  {
    state: 'AZ',
    agencyName: 'Arizona Department of Health Services · Bureau of Child Care Licensing',
    programName: 'Certified Child Care Group Home',
    registerUrl: 'https://www.azdhs.gov/licensing/childcare-facilities/index.php#provider-search',
    hint: 'ADHS facility search — filter Type to Certified Group Home / DES certified providers also listed.',
  },
  {
    state: 'WA',
    agencyName: 'Washington State Department of Children, Youth, and Families',
    programName: 'Licensed Family Home Child Care',
    registerUrl: 'https://www.dcyf.wa.gov/services/earlylearning-childcare/find-childcare',
    hint: 'DCYF Find Child Care — search by city or licence number; pick Family Home Child Care.',
  },
  {
    state: 'MA',
    agencyName: 'Massachusetts Department of Early Education and Care',
    programName: 'Licensed Family Child Care',
    registerUrl: 'https://eeclead.force.com/EEC_ChildCareSearch',
    hint: 'EEC Child Care Search — filter Program Type to Family Child Care.',
  },
];

const BOARD_INDEX = new Map<string, HomeChildcareLicenseBoard>();
for (const b of BOARDS) {
  BOARD_INDEX.set(b.state, b);
}

/**
 * Look up the home-childcare board for a state. Returns `null` if the state is
 * outside the launch slate — callers (the Provider-side endpoint) use that to
 * surface a "not yet available in your state" affordance instead of an upload
 * button.
 */
export function findHomeChildcareLicenseBoard(state: UsState): HomeChildcareLicenseBoard | null {
  return BOARD_INDEX.get(state) ?? null;
}

/** Whether the launch slate covers this state. */
export function isHomeChildcareLicenseBoardLaunchState(state: UsState): boolean {
  return BOARD_INDEX.has(state);
}

/** Every board in the slate, ordered as declared. */
export function listHomeChildcareLicenseBoardSlate(): readonly HomeChildcareLicenseBoard[] {
  return BOARDS;
}
