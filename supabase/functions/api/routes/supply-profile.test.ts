import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Table-routed Kysely fake for the supply-profile route (OH-202). The route is
 * read-only and loads each satellite by a single `executeTakeFirst` (plus
 * `execute` for the rate/credential lists), so the fake resolves `.execute()` to
 * the table's canned array and `.executeTakeFirst()` to its first row — the route
 * re-applies the where/in filters in TS, so a single-provider fixture is enough.
 */
interface Tables {
  providers?: Record<string, unknown>[];
  provider_profiles?: Record<string, unknown>[];
  provider_verifications?: Record<string, unknown>[];
  provider_subscriptions?: Record<string, unknown>[];
  provider_home_childcare_registrations?: Record<string, unknown>[];
  provider_category_rates?: Record<string, unknown>[];
  caregiver_credentials?: Record<string, unknown>[];
  provider_slots?: Record<string, unknown>[];
  specialist_credentials?: Record<string, unknown>[];
}

function makeDb(tables: Tables = {}) {
  const chain = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      selectAll: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => b,
      execute: async () => rows,
      executeTakeFirst: async () => rows[0] ?? undefined,
    });
    return b;
  };
  return {
    selectFrom: (table: string) =>
      chain((tables as Record<string, Record<string, unknown>[] | undefined>)[table] ?? []),
  } as unknown as AppDeps['db'];
}

function makeDeps(db?: AppDeps['db']): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return {
    env: buildTestEnv(),
    db: (db ?? stub) as AppDeps['db'],
    supabase: stub,
    stripe: stub,
    backgroundCheck: stub,
    daily: stub,
  };
}

const parentToken = (uid = 'uid-par') =>
  mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'parent' } });
const caregiverToken = () =>
  mintAccessToken({ sub: 'uid-cg', appMetadata: { role: 'caregiver', categories: ['tutor'] } });

const get = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });

// ── fixtures ─────────────────────────────────────────────────────────────────
const PID = '11111111-1111-4111-8111-111111111111';
const PATH = `/v1/supply/${PID}`;

const ALL_DAYS = {
  mon: { morning: false, afternoon: true, evening: true },
  tue: { morning: false, afternoon: true, evening: true },
  wed: { morning: false, afternoon: true, evening: true },
  thu: { morning: false, afternoon: true, evening: true },
  fri: { morning: false, afternoon: true, evening: true },
  sat: { morning: true, afternoon: false, evening: false },
  sun: { morning: false, afternoon: false, evening: false },
};

const caregiverRow = (over: Record<string, unknown> = {}) => ({
  id: PID,
  uid: 'u-cg',
  role: 'caregiver',
  categories: ['tutor', 'babysitter'],
  specialty: null,
  state: 'TX',
  ...over,
});

const profile = (over: Record<string, unknown> = {}) => ({
  provider_id: PID,
  display_name: 'Maya Okafor',
  headline: 'K–8 Math',
  bio: 'Eight years tutoring K–8 across the metro area.',
  zip: '78701',
  years_experience: 8,
  languages: ['English', 'Spanish'],
  specialty_tags: ['Math', 'Test prep'],
  photo_object_path: null,
  published_rate_cents: null,
  availability_grid: ALL_DAYS,
  availability_note: null,
  paused: false,
  w10_tax_credit_friendly: true,
  negotiable: true,
  ages_served: ['school-age'],
  behaviour_comfort: ['meltdowns'],
  ...over,
});

const listableVer = (over: Record<string, unknown> = {}) => ({
  provider_id: PID,
  phone_confirmed_at: '2026-06-01T00:00:00.000Z',
  screening_passed_at: '2026-06-01T00:00:00.000Z',
  license_verified_at: '2026-06-01T00:00:00.000Z',
  insurance_verified_at: '2026-06-01T00:00:00.000Z',
  rejected_at: null,
  ...over,
});

const rate = (category: string, cents: number, surcharge: number | null = null) => ({
  provider_id: PID,
  category,
  published_rate_cents: cents,
  per_child_surcharge_cents: surcharge,
});

const credential = (id: string, label: string, review_state: string, type = 'training') => ({
  id,
  provider_id: PID,
  type,
  label,
  review_state,
});

const listableCaregiver = (over: Tables = {}): Tables => ({
  providers: [caregiverRow()],
  provider_profiles: [profile()],
  provider_verifications: [listableVer()],
  provider_home_childcare_registrations: [{ provider_id: PID, decision: 'verified' }],
  provider_category_rates: [rate('tutor', 3500), rate('babysitter', 2800, 500)],
  caregiver_credentials: [
    credential('c1', 'CPR & First Aid', 'approved'),
    credential('c2', 'Speech-Language Pathologist', 'pending', 'title'),
    credential('c3', 'Lifeguard', 'rejected'),
  ],
  ...over,
});

interface Body {
  id: string;
  role: string;
  fromRateCents: number | null;
  distanceMiles: number | null;
  categoryRates: { category: string }[];
  credentials: { id: string; label: string }[];
  rating: { average: number | null; count: number; reviews: unknown[] };
  ctas: string[];
  taxCreditFriendly: boolean;
  fcchBadge: boolean;
  specialty: string | null;
  behaviourComfort: string[];
  consultationSlots: { id: string; date: string; startMin: number; endMin: number }[];
  providerCredential: {
    overall: string;
    licenseVerified: boolean;
    insuranceVerified: boolean;
    screeningPassed: boolean;
    publiclyVerified: boolean;
  } | null;
}

const slot = (id: string, date: string, start_min: number, end_min: number, state = 'open') => ({
  id,
  provider_id: PID,
  slot_date: date,
  start_min,
  end_min,
  state,
});

describe('GET /v1/supply/{id} — auth', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps(makeDb(listableCaregiver())));
    expect((await app.request(PATH)).status).toBe(401);
  });

  it('403 for a Caregiver (parent-only)', async () => {
    const app = buildApp(makeDeps(makeDb(listableCaregiver())));
    expect((await app.request(PATH, get(await caregiverToken()))).status).toBe(403);
  });
});

describe('GET /v1/supply/{id} — listable Caregiver', () => {
  it('returns the full profile with the "from $X" lowest rate + role CTAs', async () => {
    const app = buildApp(makeDeps(makeDb(listableCaregiver())));
    const res = await app.request(PATH, get(await parentToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.id).toBe(PID);
    expect(body.role).toBe('caregiver');
    expect(body.fromRateCents).toBe(2800); // min(3500, 2800)
    expect(body.categoryRates).toHaveLength(2);
    expect(body.ctas).toEqual(['message', 'book']);
    expect(body.taxCreditFriendly).toBe(true);
    expect(body.fcchBadge).toBe(true);
    expect(body.behaviourComfort).toEqual(['meltdowns']);
    // A Caregiver has no consultation slots + no clinical credential badge.
    expect(body.consultationSlots).toEqual([]);
    expect(body.providerCredential).toBeNull();
  });

  it('surfaces ONLY approved Credentials', async () => {
    const app = buildApp(makeDeps(makeDb(listableCaregiver())));
    const body = (await (await app.request(PATH, get(await parentToken()))).json()) as Body;
    expect(body.credentials).toHaveLength(1);
    expect(body.credentials[0]!.label).toBe('CPR & First Aid');
  });

  it('public Ratings are empty at cold start (no persistence yet)', async () => {
    const app = buildApp(makeDeps(makeDb(listableCaregiver())));
    const body = (await (await app.request(PATH, get(await parentToken()))).json()) as Body;
    expect(body.rating).toEqual({ average: null, count: 0, reviews: [] });
  });

  it('distanceMiles is null without a viewer ZIP, a number when both resolve', async () => {
    const app = buildApp(makeDeps(makeDb(listableCaregiver())));
    const noZip = (await (await app.request(PATH, get(await parentToken()))).json()) as Body;
    expect(noZip.distanceMiles).toBeNull();

    const withZip = (await (await app.request(`${PATH}?zip=78701`, get(await parentToken()))).json()) as Body;
    expect(typeof withZip.distanceMiles).toBe('number');
  });
});

describe('GET /v1/supply/{id} — visibility (mirrors Search)', () => {
  it('404 when the id is unknown', async () => {
    const app = buildApp(makeDeps(makeDb({ providers: [] })));
    expect((await app.request(PATH, get(await parentToken()))).status).toBe(404);
  });

  it('404 when the Caregiver is not phone-confirmed (not listable)', async () => {
    const app = buildApp(
      makeDeps(makeDb(listableCaregiver({ provider_verifications: [listableVer({ phone_confirmed_at: null })] }))),
    );
    expect((await app.request(PATH, get(await parentToken()))).status).toBe(404);
  });

  it('404 when the profile is paused', async () => {
    const app = buildApp(makeDeps(makeDb(listableCaregiver({ provider_profiles: [profile({ paused: true })] }))));
    expect((await app.request(PATH, get(await parentToken()))).status).toBe(404);
  });
});

describe('GET /v1/supply/{id} — Provider role', () => {
  it('returns the consultation CTA + per-session rate + open slots + Verified badge when listed', async () => {
    const app = buildApp(
      makeDeps(
        makeDb({
          providers: [caregiverRow({ role: 'provider', categories: null, specialty: 'slp' })],
          provider_profiles: [profile({ published_rate_cents: 12000 })],
          provider_verifications: [listableVer()],
          provider_subscriptions: [{ provider_id: PID, status: 'active' }],
          provider_category_rates: [],
          caregiver_credentials: [],
          // One bookable slot is surfaced; a released one must not be (route filters state='open').
          provider_slots: [slot('s1', '2026-07-10', 540, 600)],
          specialist_credentials: [
            { provider_id: PID, decision: 'verified', license_doc_object_path: 'l.pdf', insurance_doc_object_path: 'i.pdf' },
          ],
        }),
      ),
    );
    const res = await app.request(PATH, get(await parentToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.role).toBe('provider');
    expect(body.specialty).toBe('slp');
    expect(body.fromRateCents).toBe(12000);
    expect(body.ctas).toEqual(['book-consultation']);
    expect(body.consultationSlots).toEqual([{ id: 's1', date: '2026-07-10', startMin: 540, endMin: 600 }]);
    // A listable Provider has cleared license + insurance + screening → Verified.
    expect(body.providerCredential).toEqual({
      overall: 'verified',
      licenseVerified: true,
      insuranceVerified: true,
      screeningPassed: true,
      publiclyVerified: true,
    });
  });

  it('404 for a Provider without an active Subscription (listing gate)', async () => {
    const app = buildApp(
      makeDeps(
        makeDb({
          providers: [caregiverRow({ role: 'provider', categories: null, specialty: 'slp' })],
          provider_profiles: [profile({ published_rate_cents: 12000 })],
          provider_verifications: [listableVer()],
          provider_subscriptions: [],
          provider_category_rates: [],
          caregiver_credentials: [],
        }),
      ),
    );
    expect((await app.request(PATH, get(await parentToken()))).status).toBe(404);
  });
});
