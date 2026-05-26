/**
 * US states + DC + the five inhabited territories. v1 launches in the 50 states
 * + DC (per ADR-0009 US-national posture). Territories are listed for
 * completeness — Provider sign-up may accept them later, but at launch they
 * route to the "verification pending — state not yet supported" holding state.
 */
export const US_STATES_50_PLUS_DC = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
  'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI',
  'WY',
] as const;
export type UsState = (typeof US_STATES_50_PLUS_DC)[number];

export const US_TERRITORIES = ['PR', 'GU', 'VI', 'MP', 'AS'] as const;
export type UsTerritory = (typeof US_TERRITORIES)[number];

export function isUsState(value: string): value is UsState {
  return (US_STATES_50_PLUS_DC as readonly string[]).includes(value);
}
