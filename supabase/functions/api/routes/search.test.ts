import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Table-routed Kysely fake for the search route (OH-201). Search is read-only,
 * so the fake only needs select chains; each table resolves to a canned array
 * via `.execute()` (regardless of the where/in clauses, which the route applies
 * — or re-applies — in TS), plus `parent_subscriptions` via `.executeTakeFirst()`.
 */
interface Tables {
  providers?: Record<string, unknown>[];
  provider_profiles?: Record<string, unknown>[];
  provider_verifications?: Record<string, unknown>[];
  provider_category_rates?: Record<string, unknown>[];
  provider_subscriptions?: Record<string, unknown>[];
  provider_home_childcare_registrations?: Record<string, unknown>[];
  provider_slots?: Record<string, unknown>[];
  parent_subscriptions?: Record<string, unknown> | null;
}

function makeDb(tables: Tables = {}) {
  const selectChain = (rows: unknown[], single: unknown) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      selectAll: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => b,
      execute: async () => rows,
      executeTakeFirst: async () => single ?? undefined,
    });
    return b;
  };

  return {
    selectFrom: (table: string) => {
      if (table === 'parent_subscriptions') return selectChain([], tables.parent_subscriptions ?? undefined);
      const rows = (tables as Record<string, Record<string, unknown>[] | undefined>)[table] ?? [];
      return selectChain(rows, undefined);
    },
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
  };
}

const parentToken = (uid = 'uid-par') =>
  mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'parent' } });
const caregiverToken = () =>
  mintAccessToken({ sub: 'uid-cg', appMetadata: { role: 'caregiver', categories: ['tutor'] } });

const get = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });

// ── fixtures ─────────────────────────────────────────────────────────────────
const caregiver = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  uid: `u-${id}`,
  role: 'caregiver',
  categories: ['tutor'],
  specialty: null,
  state: 'TX',
  ...over,
});
const providerRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  uid: `u-${id}`,
  role: 'provider',
  categories: null,
  specialty: 'slp',
  state: 'TX',
  ...over,
});

const ALL_DAYS = {
  mon: { morning: true, afternoon: true, evening: true },
  tue: { morning: true, afternoon: true, evening: true },
  wed: { morning: true, afternoon: true, evening: true },
  thu: { morning: true, afternoon: true, evening: true },
  fri: { morning: true, afternoon: true, evening: true },
  sat: { morning: true, afternoon: true, evening: true },
  sun: { morning: true, afternoon: true, evening: true },
};

const profile = (provider_id: string, over: Record<string, unknown> = {}) => ({
  provider_id,
  display_name: `Name ${provider_id}`,
  headline: 'Headline',
  zip: '78701',
  photo_object_path: null,
  published_rate_cents: 5000,
  availability_grid: ALL_DAYS,
  availability_note: null,
  paused: false,
  w10_tax_credit_friendly: false,
  negotiable: true,
  ages_served: ['school-age'],
  behaviour_comfort: [],
  updated_at: '2026-06-29T00:00:00.000Z',
  ...over,
});

const listableVer = (provider_id: string, over: Record<string, unknown> = {}) => ({
  provider_id,
  phone_confirmed_at: '2026-06-01T00:00:00.000Z',
  screening_passed_at: '2026-06-01T00:00:00.000Z',
  license_verified_at: '2026-06-01T00:00:00.000Z',
  insurance_verified_at: '2026-06-01T00:00:00.000Z',
  rejected_at: null,
  ...over,
});

const rate = (provider_id: string, category: string, cents: number) => ({
  provider_id,
  category,
  published_rate_cents: cents,
});

const PATH = '/v1/search';

type Json = {
  entitled: boolean;
  total: number;
  fullCount: number;
  blurredCount: number;
  results: Array<{ kind: 'full' | 'blurred'; card: Record<string, unknown> }>;
};

describe('GET /v1/search — auth', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps(makeDb()));
    expect((await app.request(PATH)).status).toBe(401);
  });

  it('403 for a Caregiver (parent-only)', async () => {
    const app = buildApp(makeDeps(makeDb()));
    expect((await app.request(PATH, get(await caregiverToken()))).status).toBe(403);
  });
});

describe('GET /v1/search — preview wall', () => {
  const threeTutors = {
    providers: [caregiver('t1'), caregiver('t2'), caregiver('t3')],
    provider_profiles: [profile('t1'), profile('t2'), profile('t3')],
    provider_verifications: [listableVer('t1'), listableVer('t2'), listableVer('t3')],
    provider_category_rates: [rate('t1', 'tutor', 3500), rate('t2', 'tutor', 4000), rate('t3', 'tutor', 4500)],
  };

  it('free browse (no subscription) → top 2 per category full, rest blurred', async () => {
    const app = buildApp(makeDeps(makeDb({ ...threeTutors, parent_subscriptions: null })));
    const res = await app.request(PATH, get(await parentToken()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.entitled).toBe(false);
    expect(body.total).toBe(3);
    expect(body.fullCount).toBe(2);
    expect(body.blurredCount).toBe(1);
    const blurred = body.results.find((r) => r.kind === 'blurred')!;
    expect(blurred.card.locked).toBe(true);
    expect(blurred.card).not.toHaveProperty('displayName');
    expect(blurred.card).not.toHaveProperty('zip');
    const full = body.results.find((r) => r.kind === 'full')!;
    expect(full.card).toHaveProperty('displayName');
    expect(full.card.ctas).toEqual(['message', 'book']);
  });

  it('entitled (active subscription) → all results full, none blurred', async () => {
    const app = buildApp(makeDeps(makeDb({ ...threeTutors, parent_subscriptions: { status: 'active' } })));
    const res = await app.request(PATH, get(await parentToken()));
    const body = (await res.json()) as Json;
    expect(body.entitled).toBe(true);
    expect(body.fullCount).toBe(3);
    expect(body.blurredCount).toBe(0);
    expect(body.results.every((r) => r.kind === 'full')).toBe(true);
  });
});

describe('GET /v1/search — listability gates', () => {
  it('excludes paused, unverified, and rejected supply', async () => {
    const db = makeDb({
      parent_subscriptions: { status: 'active' },
      providers: [caregiver('ok'), caregiver('paused'), caregiver('noPhone'), caregiver('rejected')],
      provider_profiles: [
        profile('ok'),
        profile('paused', { paused: true }),
        profile('noPhone'),
        profile('rejected'),
      ],
      provider_verifications: [
        listableVer('ok'),
        listableVer('paused'),
        listableVer('noPhone', { phone_confirmed_at: null }),
        listableVer('rejected', { rejected_at: '2026-06-10T00:00:00.000Z' }),
      ],
      provider_category_rates: [rate('ok', 'tutor', 4000)],
    });
    const app = buildApp(makeDeps(db));
    const body = (await (await app.request(PATH, get(await parentToken()))).json()) as Json;
    expect(body.total).toBe(1);
    expect(body.results[0]!.card.id).toBe('ok');
  });

  it('excludes a Provider without an active Subscription; includes one with', async () => {
    const db = makeDb({
      parent_subscriptions: { status: 'active' },
      providers: [providerRow('pSub'), providerRow('pNoSub')],
      provider_profiles: [profile('pSub'), profile('pNoSub')],
      provider_verifications: [listableVer('pSub'), listableVer('pNoSub')],
      provider_subscriptions: [{ provider_id: 'pSub', status: 'trialing' }],
    });
    const app = buildApp(makeDeps(db));
    const body = (await (await app.request(`${PATH}?role=provider`, get(await parentToken()))).json()) as Json;
    expect(body.total).toBe(1);
    expect(body.results[0]!.card.id).toBe('pSub');
    expect(body.results[0]!.card.ctas).toEqual(['book-consultation']);
  });
});

describe('GET /v1/search — filters', () => {
  const base = {
    parent_subscriptions: { status: 'active' },
    provider_verifications: [listableVer('a'), listableVer('b')],
  };

  it('category filter keeps matching Caregivers only', async () => {
    const db = makeDb({
      ...base,
      providers: [caregiver('a', { categories: ['tutor'] }), caregiver('b', { categories: ['babysitter'] })],
      provider_profiles: [profile('a'), profile('b')],
      provider_category_rates: [rate('a', 'tutor', 4000), rate('b', 'babysitter', 2500)],
    });
    const app = buildApp(makeDeps(db));
    const body = (await (await app.request(`${PATH}?category=tutor`, get(await parentToken()))).json()) as Json;
    expect(body.total).toBe(1);
    expect(body.results[0]!.card.id).toBe('a');
  });

  it('rate ceiling excludes Caregivers above the cap (from-rate via category rates)', async () => {
    const db = makeDb({
      ...base,
      providers: [caregiver('a'), caregiver('b')],
      provider_profiles: [profile('a'), profile('b')],
      provider_category_rates: [rate('a', 'tutor', 3000), rate('b', 'tutor', 9000)],
    });
    const app = buildApp(makeDeps(db));
    const body = (await (await app.request(`${PATH}?maxRateCents=5000`, get(await parentToken()))).json()) as Json;
    expect(body.results.map((r) => r.card.id)).toEqual(['a']);
    expect(body.results[0]!.card.fromRateCents).toBe(3000);
  });

  it('tax-credit-friendly filter keeps only W-10 Caregivers', async () => {
    const db = makeDb({
      ...base,
      providers: [caregiver('a'), caregiver('b')],
      provider_profiles: [profile('a', { w10_tax_credit_friendly: true }), profile('b', { w10_tax_credit_friendly: false })],
      provider_category_rates: [rate('a', 'tutor', 3000), rate('b', 'tutor', 3000)],
    });
    const app = buildApp(makeDeps(db));
    const body = (await (await app.request(`${PATH}?taxCreditFriendly=true`, get(await parentToken()))).json()) as Json;
    expect(body.results.map((r) => r.card.id)).toEqual(['a']);
    expect(body.results[0]!.card.taxCreditFriendly).toBe(true);
  });

  it('ages-served filter matches on band overlap', async () => {
    const db = makeDb({
      ...base,
      providers: [caregiver('a'), caregiver('b')],
      provider_profiles: [
        profile('a', { ages_served: ['infant', 'toddler'] }),
        profile('b', { ages_served: ['teen'] }),
      ],
      provider_category_rates: [rate('a', 'tutor', 3000), rate('b', 'tutor', 3000)],
    });
    const app = buildApp(makeDeps(db));
    const body = (await (await app.request(`${PATH}?agesServed=toddler`, get(await parentToken()))).json()) as Json;
    expect(body.results.map((r) => r.card.id)).toEqual(['a']);
  });

  it('behaviour-comfort filter matches Caregivers on overlap and excludes Providers', async () => {
    const db = makeDb({
      parent_subscriptions: { status: 'active' },
      providers: [caregiver('a'), caregiver('b'), providerRow('p')],
      provider_profiles: [
        profile('a', { behaviour_comfort: ['aggression', 'meltdowns'] }),
        profile('b', { behaviour_comfort: ['pica'] }),
        profile('p'),
      ],
      provider_verifications: [listableVer('a'), listableVer('b'), listableVer('p')],
      provider_subscriptions: [{ provider_id: 'p', status: 'active' }],
      provider_category_rates: [rate('a', 'tutor', 3000), rate('b', 'tutor', 3000)],
    });
    const app = buildApp(makeDeps(db));
    const body = (await (await app.request(`${PATH}?behaviourComfort=aggression`, get(await parentToken()))).json()) as Json;
    expect(body.results.map((r) => r.card.id)).toEqual(['a']);
  });
});

describe('GET /v1/search — ZIP + radius', () => {
  it('excludes candidates outside the radius; reports distance for those inside', async () => {
    const db = makeDb({
      parent_subscriptions: { status: 'active' },
      // a is in Austin (78701 == searcher), b is in Dallas (75201, ~182 mi away)
      providers: [caregiver('a'), caregiver('b')],
      provider_profiles: [profile('a', { zip: '78701' }), profile('b', { zip: '75201' })],
      provider_verifications: [listableVer('a'), listableVer('b')],
      provider_category_rates: [rate('a', 'tutor', 3000), rate('b', 'tutor', 3000)],
    });
    const app = buildApp(makeDeps(db));
    const body = (await (await app.request(`${PATH}?zip=78701&radiusMiles=5`, get(await parentToken()))).json()) as Json;
    expect(body.results.map((r) => r.card.id)).toEqual(['a']);
    expect(body.results[0]!.card.distanceMiles).toBe(0);

    // widen the radius → Dallas comes back in, with a real distance
    const wide = (await (await app.request(`${PATH}?zip=78701&radiusMiles=300`, get(await parentToken()))).json()) as Json;
    const ids = wide.results.map((r) => r.card.id).sort();
    expect(ids).toEqual(['a', 'b']);
    const dallas = wide.results.find((r) => r.card.id === 'b')!;
    expect(dallas.card.distanceMiles).toBeGreaterThan(150);
  });
});

describe('GET /v1/search — date/time availability', () => {
  it('Caregiver grid ∩ window: empty grid is excluded when a window is set', async () => {
    const db = makeDb({
      parent_subscriptions: { status: 'active' },
      providers: [caregiver('open'), caregiver('empty')],
      provider_profiles: [profile('open', { availability_grid: ALL_DAYS }), profile('empty', { availability_grid: {} })],
      provider_verifications: [listableVer('open'), listableVer('empty')],
      provider_category_rates: [rate('open', 'tutor', 3000), rate('empty', 'tutor', 3000)],
    });
    const app = buildApp(makeDeps(db));
    const body = (await (await app.request(`${PATH}?date=2026-07-06&startMin=780&endMin=900`, get(await parentToken()))).json()) as Json;
    expect(body.results.map((r) => r.card.id)).toEqual(['open']);
  });

  it('Provider slots ∩ window: only a Provider with an overlapping open slot matches', async () => {
    const db = makeDb({
      parent_subscriptions: { status: 'active' },
      providers: [providerRow('hasSlot'), providerRow('noSlot')],
      provider_profiles: [profile('hasSlot'), profile('noSlot')],
      provider_verifications: [listableVer('hasSlot'), listableVer('noSlot')],
      provider_subscriptions: [
        { provider_id: 'hasSlot', status: 'active' },
        { provider_id: 'noSlot', status: 'active' },
      ],
      provider_slots: [
        { id: 's1', provider_id: 'hasSlot', slot_date: '2026-07-06', start_min: 780, end_min: 900, state: 'open', held_by_booking_id: null },
      ],
    });
    const app = buildApp(makeDeps(db));
    const body = (await (await app.request(`${PATH}?role=provider&date=2026-07-06&startMin=780&endMin=900`, get(await parentToken()))).json()) as Json;
    expect(body.results.map((r) => r.card.id)).toEqual(['hasSlot']);
  });

  it('400 on an inverted window', async () => {
    const app = buildApp(makeDeps(makeDb({ parent_subscriptions: { status: 'active' } })));
    const res = await app.request(`${PATH}?date=2026-07-06&startMin=900&endMin=780`, get(await parentToken()));
    expect(res.status).toBe(400);
  });
});
