/**
 * ZIP → centroid resolver for the Search ZIP+radius filter (OH-201).
 *
 * The pure layer takes `distanceMiles` already computed (search-ranking
 * `RankingCandidate`); turning a 5-digit ZIP into a lat/lng is an ADAPTER
 * concern, which is what this file is. `haversineMiles` (in
 * `@our-haven/domain` search) does the crow-flies math; this only maps a ZIP to
 * a `GeoPoint`.
 *
 * ⚠️ DATA COVERAGE IS PARTIAL — DELIBERATELY (OH-201 scope).
 * There is no geo column / PostGIS / `earthdistance` in the schema and the full
 * US ZCTA centroid gazetteer is ~33k rows; bundling it (or seeding a
 * `zip_centroids` table) is its own follow-up. This ships a curated set of
 * accurate 5-digit centroids for major metros plus a 3-digit-prefix fallback so
 * the ZIP+radius filter is *real* (precise haversine distances) wherever a ZIP
 * resolves, and DEGRADES GRACEFULLY where it doesn't: the search handler keeps a
 * candidate whose ZIP doesn't resolve (it just can't be distance-filtered or
 * distance-ranked precisely — see routes/search.ts). The follow-up is to load
 * the Census Gazetteer ZCTA centroids into a `zip_centroids` table and resolve
 * from there; the resolver signature below stays the same.
 *
 * Pure data + a lookup. No I/O, Deno-clean.
 */

export interface ZipCentroid {
  lat: number;
  lng: number;
  /** Coarse, display-safe area label ("City, ST"). */
  label: string;
}

/**
 * Curated 5-digit ZIP centroids (decimal degrees), accurate to ~city level.
 * Spread across many states so launch demand has real distances in major
 * markets. Extend freely — or replace with a `zip_centroids` table lookup.
 */
const ZIP5: Record<string, ZipCentroid> = {
  // CA
  '90001': { lat: 33.973, lng: -118.249, label: 'Los Angeles, CA' },
  '90012': { lat: 34.061, lng: -118.239, label: 'Los Angeles, CA' },
  '90210': { lat: 34.1, lng: -118.414, label: 'Beverly Hills, CA' },
  '94103': { lat: 37.773, lng: -122.411, label: 'San Francisco, CA' },
  '94110': { lat: 37.749, lng: -122.415, label: 'San Francisco, CA' },
  '95113': { lat: 37.334, lng: -121.889, label: 'San Jose, CA' },
  '92101': { lat: 32.717, lng: -117.163, label: 'San Diego, CA' },
  '95814': { lat: 38.582, lng: -121.494, label: 'Sacramento, CA' },
  // NY
  '10001': { lat: 40.751, lng: -73.997, label: 'New York, NY' },
  '10003': { lat: 40.732, lng: -73.989, label: 'New York, NY' },
  '10027': { lat: 40.811, lng: -73.953, label: 'New York, NY' },
  '11201': { lat: 40.694, lng: -73.99, label: 'Brooklyn, NY' },
  '11375': { lat: 40.721, lng: -73.846, label: 'Queens, NY' },
  '14604': { lat: 43.157, lng: -77.611, label: 'Rochester, NY' },
  // IL
  '60601': { lat: 41.886, lng: -87.622, label: 'Chicago, IL' },
  '60614': { lat: 41.924, lng: -87.654, label: 'Chicago, IL' },
  '60657': { lat: 41.94, lng: -87.653, label: 'Chicago, IL' },
  // TX
  '78701': { lat: 30.271, lng: -97.742, label: 'Austin, TX' },
  '78704': { lat: 30.243, lng: -97.766, label: 'Austin, TX' },
  '75201': { lat: 32.787, lng: -96.799, label: 'Dallas, TX' },
  '77002': { lat: 29.757, lng: -95.364, label: 'Houston, TX' },
  '78205': { lat: 29.424, lng: -98.486, label: 'San Antonio, TX' },
  // FL
  '33101': { lat: 25.779, lng: -80.198, label: 'Miami, FL' },
  '33130': { lat: 25.765, lng: -80.205, label: 'Miami, FL' },
  '32801': { lat: 28.541, lng: -81.376, label: 'Orlando, FL' },
  '33602': { lat: 27.953, lng: -82.458, label: 'Tampa, FL' },
  // GA
  '30303': { lat: 33.753, lng: -84.39, label: 'Atlanta, GA' },
  '30309': { lat: 33.797, lng: -84.387, label: 'Atlanta, GA' },
  // NC
  '27601': { lat: 35.778, lng: -78.639, label: 'Raleigh, NC' },
  '28202': { lat: 35.227, lng: -80.843, label: 'Charlotte, NC' },
  // PA
  '19103': { lat: 39.952, lng: -75.172, label: 'Philadelphia, PA' },
  '15222': { lat: 40.446, lng: -79.995, label: 'Pittsburgh, PA' },
  // OH
  '43215': { lat: 39.964, lng: -83.001, label: 'Columbus, OH' },
  '44114': { lat: 41.508, lng: -81.677, label: 'Cleveland, OH' },
  // AZ
  '85004': { lat: 33.452, lng: -112.073, label: 'Phoenix, AZ' },
  '85701': { lat: 32.218, lng: -110.97, label: 'Tucson, AZ' },
  // WA
  '98101': { lat: 47.611, lng: -122.334, label: 'Seattle, WA' },
  '98109': { lat: 47.626, lng: -122.343, label: 'Seattle, WA' },
  // MA
  '02108': { lat: 42.357, lng: -71.064, label: 'Boston, MA' },
  '02139': { lat: 42.364, lng: -71.104, label: 'Cambridge, MA' },
  // DC
  '20001': { lat: 38.91, lng: -77.018, label: 'Washington, DC' },
  '20005': { lat: 38.903, lng: -77.031, label: 'Washington, DC' },
  // CO
  '80202': { lat: 39.75, lng: -104.996, label: 'Denver, CO' },
  // OR
  '97205': { lat: 45.521, lng: -122.685, label: 'Portland, OR' },
  // MN
  '55401': { lat: 44.985, lng: -93.269, label: 'Minneapolis, MN' },
  // TN
  '37203': { lat: 36.151, lng: -86.79, label: 'Nashville, TN' },
  // MI
  '48226': { lat: 42.332, lng: -83.046, label: 'Detroit, MI' },
  // NV
  '89101': { lat: 36.174, lng: -115.137, label: 'Las Vegas, NV' },
};

/**
 * 3-digit-prefix fallback centroids — coarse (regional) but enough for the
 * radius filter to mean *something* outside the curated 5-digit set. Keyed by
 * the first 3 ZIP digits. A 5-digit ZIP unknown to `ZIP5` falls back here.
 */
const ZIP3: Record<string, ZipCentroid> = {
  '900': { lat: 34.05, lng: -118.25, label: 'Los Angeles area, CA' },
  '941': { lat: 37.77, lng: -122.42, label: 'San Francisco area, CA' },
  '951': { lat: 37.33, lng: -121.89, label: 'San Jose area, CA' },
  '921': { lat: 32.72, lng: -117.16, label: 'San Diego area, CA' },
  '100': { lat: 40.75, lng: -73.99, label: 'New York area, NY' },
  '112': { lat: 40.69, lng: -73.99, label: 'Brooklyn area, NY' },
  '606': { lat: 41.88, lng: -87.63, label: 'Chicago area, IL' },
  '787': { lat: 30.27, lng: -97.74, label: 'Austin area, TX' },
  '752': { lat: 32.78, lng: -96.8, label: 'Dallas area, TX' },
  '770': { lat: 29.76, lng: -95.37, label: 'Houston area, TX' },
  '331': { lat: 25.77, lng: -80.2, label: 'Miami area, FL' },
  '328': { lat: 28.54, lng: -81.38, label: 'Orlando area, FL' },
  '303': { lat: 33.75, lng: -84.39, label: 'Atlanta area, GA' },
  '191': { lat: 39.95, lng: -75.17, label: 'Philadelphia area, PA' },
  '981': { lat: 47.61, lng: -122.33, label: 'Seattle area, WA' },
  '021': { lat: 42.36, lng: -71.06, label: 'Boston area, MA' },
  '200': { lat: 38.9, lng: -77.02, label: 'Washington, DC area' },
  '802': { lat: 39.75, lng: -105.0, label: 'Denver area, CO' },
};

/**
 * Resolve a 5-digit US ZIP to its centroid + a coarse area label, or `null`
 * when neither the exact ZIP nor its 3-digit region is known. Tries the exact
 * 5-digit centroid first, then the 3-digit-prefix region.
 */
export function resolveZipCentroid(zip: string | null | undefined): ZipCentroid | null {
  if (!zip) return null;
  const z = zip.trim();
  if (!/^\d{5}$/.test(z)) return null;
  return ZIP5[z] ?? ZIP3[z.slice(0, 3)] ?? null;
}

/**
 * A coarse, display-safe area label for a ZIP — the resolved centroid's label
 * when known, else a masked "ZIP 9xxxx" region from the first digit (never the
 * exact ZIP, so it's safe on a blurred preview card).
 */
export function areaLabelForZip(zip: string | null | undefined): string | null {
  if (!zip) return null;
  const resolved = resolveZipCentroid(zip);
  if (resolved) return resolved.label;
  const z = zip.trim();
  if (/^\d{5}$/.test(z)) return `ZIP ${z.slice(0, 3)}xx`;
  return null;
}
