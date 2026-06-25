// Mirror of packages/shared/src/us-states.ts (ADR-0009 US-national posture) —
// re-authored with explicit-.ts hygiene so the Edge tree stays self-contained on
// Deno (same pattern as taxonomy.ts / roles.ts). Keep in sync with the shared
// source of truth.
//
// v1 accepts the 50 states + DC. The five inhabited territories are intentionally
// NOT accepted at supply sign-up yet (they route to a "state not yet supported"
// holding state in a later ticket) — so the role-claim `state` enum is 50 + DC.
export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
  'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI',
  'WY',
] as const;
export type UsState = (typeof US_STATES)[number];
