import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * In-memory Kysely fake for the provider-profile route (OH-189). Honours `where`
 * predicates (including `!=`, which the slot list/overlap queries use) + a single
 * `orderBy`. Backs the five tables the route touches.
 */
type Row = Record<string, unknown>;
type Cond = [string, string, unknown];

const TABLE_DEFAULTS: Record<string, Row> = {
  provider_profiles: {
    display_name: null,
    headline: null,
    bio: null,
    published_rate_cents: null,
  },
  provider_slots: { state: 'open', held_by_booking_id: null },
};

function makeDb(seed: Partial<Record<string, Row[]>> = {}) {
  const tables: Record<string, Row[]> = {
    providers: seed.providers ?? [],
    provider_profiles: seed.provider_profiles ?? [],
    provider_verifications: seed.provider_verifications ?? [],
    specialist_credentials: seed.specialist_credentials ?? [],
    provider_slots: seed.provider_slots ?? [],
    provider_subscriptions: seed.provider_subscriptions ?? [],
  };
  const captures = {
    inserts: [] as Array<{ table: string; values: Row }>,
    updates: [] as Array<{ table: string; set: Row }>,
  };
  let seq = 0;

  const test1 = (r: Row, [col, op, val]: Cond) => (op === '!=' ? r[col] !== val : r[col] === val);
  const match = (rows: Row[], conds: Cond[]) => rows.filter((r) => conds.every((c) => test1(r, c)));

  const selectFrom = (table: string) => {
    const conds: Cond[] = [];
    let order: [string, 'asc' | 'desc'] | null = null;
    const b: Row = {
      select: () => b,
      selectAll: () => b,
      where: (col: string, op: string, val: unknown) => (conds.push([col, op, val]), b),
      orderBy: (col: string, dir: 'asc' | 'desc') => ((order = [col, dir]), b),
      limit: () => b,
      execute: async () => {
        let rows = match(tables[table] ?? [], conds);
        if (order) {
          const [col, dir] = order;
          rows = [...rows].sort((a, z) =>
            (dir === 'asc' ? 1 : -1) * String(a[col]).localeCompare(String(z[col])),
          );
        }
        return rows.map((r) => ({ ...r }));
      },
      executeTakeFirst: async () => {
        const rows = match(tables[table] ?? [], conds);
        return rows[0] ? { ...rows[0] } : undefined;
      },
    };
    return b;
  };

  const insertInto = (table: string) => {
    let inserted: Row[] = [];
    const b: Row = {
      values: (vals: Row | Row[]) => {
        const arr = Array.isArray(vals) ? vals : [vals];
        for (const v of arr) {
          seq += 1;
          const row: Row = {
            id: (v.id as string) ?? `gen-${table}-${seq}`,
            created_at: new Date(2026, 0, seq),
            updated_at: (v.updated_at as Date) ?? new Date(2026, 0, seq),
            ...(TABLE_DEFAULTS[table] ?? {}),
            ...v,
          };
          (tables[table] ??= []).push(row);
          inserted.push(row);
          captures.inserts.push({ table, values: v });
        }
        return b;
      },
      returning: () => b,
      returningAll: () => b,
      execute: async () => inserted.map((r) => ({ ...r })),
      executeTakeFirstOrThrow: async () => {
        if (!inserted[0]) throw new Error('insert returned no row');
        return { ...inserted[0] };
      },
    };
    return b;
  };

  const updateTable = (table: string) => {
    const conds: Cond[] = [];
    let setVals: Row = {};
    const apply = () => {
      const matched = match(tables[table] ?? [], conds);
      for (const r of matched) Object.assign(r, setVals);
      return matched;
    };
    const b: Row = {
      set: (s: Row) => (captures.updates.push({ table, set: s }), (setVals = s), b),
      where: (col: string, op: string, val: unknown) => (conds.push([col, op, val]), b),
      returning: () => b,
      returningAll: () => b,
      execute: async () => (apply(), []),
      executeTakeFirstOrThrow: async () => {
        const updated = apply();
        if (!updated[0]) throw new Error('update matched no row');
        return { ...updated[0] };
      },
    };
    return b;
  };

  const handle = { selectFrom, insertInto, updateTable };
  const db = {
    ...handle,
    transaction: () => ({ execute: async (cb: (trx: typeof handle) => Promise<unknown>) => cb(handle) }),
  } as unknown as AppDeps['db'];

  return { db, captures, tables };
}

function makeDeps(opts: { db?: AppDeps['db'] } = {}): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return {
    env: buildTestEnv(),
    db: (opts.db ?? stub) as AppDeps['db'],
    supabase: stub,
    stripe: stub,
    backgroundCheck: stub,
    daily: stub,
  };
}

const PROVIDER_ID = '44444444-4444-4444-8444-444444444444';
const PROVIDER = { id: PROVIDER_ID, uid: 'uid-prov', role: 'provider', categories: null, specialty: 'ot', state: 'FL' };
const SLOT_ID = '55555555-5555-4555-8555-555555555551';
// An active Provider Subscription lists the Provider — the OH-191 gate that the
// slot-publish path requires. Seeded into the publish tests below.
const ACTIVE_SUB = { provider_id: PROVIDER_ID, status: 'active' };

function providerToken(uid = 'uid-prov', specialty = 'ot') {
  return mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'provider', specialty } });
}
function caregiverToken(uid = 'uid-cg') {
  return mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'caregiver', categories: ['babysitter'] } });
}

const get = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });
const body = (method: string, token: string, payload?: unknown): RequestInit => ({
  method,
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: payload === undefined ? undefined : JSON.stringify(payload),
});

const PROFILE = '/v1/providers/me/clinical-profile';
const SLOTS = '/v1/providers/me/consultation-slots';

/* ── GET clinical-profile ───────────────────────────────────────────────────── */

describe('GET /v1/providers/me/clinical-profile', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps());
    expect((await app.request(PROFILE)).status).toBe(401);
  });

  it('403 for a Caregiver (provider-only)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [PROVIDER] }).db }));
    const res = await app.request(PROFILE, get(await caregiverToken()));
    expect(res.status).toBe(403);
  });

  it('404 when the supply row is missing', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [] }).db }));
    const res = await app.request(PROFILE, get(await providerToken('orphan')));
    expect(res.status).toBe(404);
  });

  it('returns sensible defaults for a fresh Provider (unverified, no slots)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [PROVIDER] }).db }));
    const res = await app.request(PROFILE, get(await providerToken()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({
      specialty: 'ot',
      residentState: 'FL',
      perSessionRateCents: null,
      bookableSlotCount: 0,
      listing: { subscriptionStatus: null, listedInSearch: false, listingReason: 'none' },
      credentialStatus: {
        overall: 'unverified',
        license: 'missing',
        insurance: 'missing',
        screening: 'pending',
        publiclyVerified: false,
      },
    });
  });

  it('reflects an active subscription as listed-in-search', async () => {
    const app = buildApp(
      makeDeps({ db: makeDb({ providers: [PROVIDER], provider_subscriptions: [ACTIVE_SUB] }).db }),
    );
    const res = await app.request(PROFILE, get(await providerToken()));
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.listing).toMatchObject({ subscriptionStatus: 'active', listedInSearch: true, listingReason: 'active' });
  });

  it('shows a verified badge once license + insurance + screening are cleared', async () => {
    const now = new Date(2026, 5, 1);
    const app = buildApp(
      makeDeps({
        db: makeDb({
          providers: [PROVIDER],
          provider_verifications: [
            { provider_id: PROVIDER_ID, license_verified_at: now, insurance_verified_at: now, screening_passed_at: now, rejected_at: null },
          ],
          specialist_credentials: [
            { provider_id: PROVIDER_ID, decision: 'verified', license_doc_object_path: 'license-doc/x', insurance_doc_object_path: 'insurance-doc/x' },
          ],
        }).db,
      }),
    );
    const res = await app.request(PROFILE, get(await providerToken()));
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.credentialStatus).toMatchObject({ overall: 'verified', publiclyVerified: true, license: 'verified', insurance: 'verified', screening: 'passed' });
  });
});

/* ── PATCH clinical-profile ─────────────────────────────────────────────────── */

describe('PATCH /v1/providers/me/clinical-profile', () => {
  it('persists specialty + per-session rate + identity', async () => {
    const { db, tables } = makeDb({ providers: [{ ...PROVIDER }] });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      PROFILE,
      body('PATCH', await providerToken(), { specialty: 'aba', perSessionRateCents: 15000, displayName: 'Dr. Lee' }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ specialty: 'aba', perSessionRateCents: 15000, displayName: 'Dr. Lee' });
    expect(tables.providers![0]!.specialty).toBe('aba');
    expect(tables.provider_profiles![0]!.published_rate_cents).toBe(15000);
  });

  it('clears the rate when perSessionRateCents is null', async () => {
    const { db } = makeDb({
      providers: [PROVIDER],
      provider_profiles: [{ provider_id: PROVIDER_ID, published_rate_cents: 20000, display_name: null, headline: null, bio: null }],
    });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(PROFILE, body('PATCH', await providerToken(), { perSessionRateCents: null }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).perSessionRateCents).toBeNull();
  });

  it('rejects a negative rate → 400', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [PROVIDER] }).db }));
    const res = await app.request(PROFILE, body('PATCH', await providerToken(), { perSessionRateCents: -100 }));
    expect(res.status).toBe(400);
  });

  it('rejects an unknown specialty at the schema → 400', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [PROVIDER] }).db }));
    const res = await app.request(PROFILE, body('PATCH', await providerToken(), { specialty: 'astrology' }));
    expect(res.status).toBe(400);
  });
});

/* ── consultation slots ─────────────────────────────────────────────────────── */

describe('consultation slots', () => {
  it('publishes a bookable open slot', async () => {
    const { db, tables } = makeDb({ providers: [PROVIDER], provider_subscriptions: [ACTIVE_SUB] });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(SLOTS, body('POST', await providerToken(), { date: '2026-07-01', startMin: 540, endMin: 600 }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ date: '2026-07-01', startMin: 540, endMin: 600, state: 'open', bookable: true });
    expect(tables.provider_slots).toHaveLength(1);
  });

  it('402 publishing a slot without an active Provider Subscription', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [PROVIDER] }).db }));
    const res = await app.request(SLOTS, body('POST', await providerToken(), { date: '2026-07-01', startMin: 540, endMin: 600 }));
    expect(res.status).toBe(402);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ error: 'subscription_inactive' });
  });

  it('402 when the subscription exists but is past_due (not listed)', async () => {
    const app = buildApp(
      makeDeps({ db: makeDb({ providers: [PROVIDER], provider_subscriptions: [{ provider_id: PROVIDER_ID, status: 'past_due' }] }).db }),
    );
    const res = await app.request(SLOTS, body('POST', await providerToken(), { date: '2026-07-01', startMin: 540, endMin: 600 }));
    expect(res.status).toBe(402);
  });

  it('rejects an impossible calendar date via the domain → 400', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [PROVIDER], provider_subscriptions: [ACTIVE_SUB] }).db }));
    const res = await app.request(SLOTS, body('POST', await providerToken(), { date: '2026-02-30', startMin: 540, endMin: 600 }));
    expect(res.status).toBe(400);
  });

  it('rejects an overlapping slot on the same day → 409', async () => {
    const { db } = makeDb({
      providers: [PROVIDER],
      provider_subscriptions: [ACTIVE_SUB],
      provider_slots: [
        { id: 'slot-1', provider_id: PROVIDER_ID, slot_date: '2026-07-01', start_min: 540, end_min: 600, state: 'open', held_by_booking_id: null },
      ],
    });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(SLOTS, body('POST', await providerToken(), { date: '2026-07-01', startMin: 570, endMin: 630 }));
    expect(res.status).toBe(409);
  });

  it('allows a non-overlapping slot on the same day', async () => {
    const { db, tables } = makeDb({
      providers: [PROVIDER],
      provider_subscriptions: [ACTIVE_SUB],
      provider_slots: [
        { id: 'slot-1', provider_id: PROVIDER_ID, slot_date: '2026-07-01', start_min: 540, end_min: 600, state: 'open', held_by_booking_id: null },
      ],
    });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(SLOTS, body('POST', await providerToken(), { date: '2026-07-01', startMin: 600, endMin: 660 }));
    expect(res.status).toBe(201);
    expect(tables.provider_slots).toHaveLength(2);
  });

  it('lists active slots with their bookable flag (released omitted)', async () => {
    const { db } = makeDb({
      providers: [PROVIDER],
      provider_slots: [
        { id: 'slot-1', provider_id: PROVIDER_ID, slot_date: '2026-07-01', start_min: 540, end_min: 600, state: 'open', held_by_booking_id: null },
        { id: 'slot-2', provider_id: PROVIDER_ID, slot_date: '2026-07-02', start_min: 540, end_min: 600, state: 'released', held_by_booking_id: null },
      ],
    });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(SLOTS, get(await providerToken()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { slots: Array<Record<string, unknown>> };
    expect(json.slots).toHaveLength(1);
    expect(json.slots[0]).toMatchObject({ id: 'slot-1', bookable: true });
  });

  it('withdraws an open slot (open → released)', async () => {
    const { db, tables } = makeDb({
      providers: [PROVIDER],
      provider_slots: [
        { id: SLOT_ID, provider_id: PROVIDER_ID, slot_date: '2026-07-01', start_min: 540, end_min: 600, state: 'open', held_by_booking_id: null },
      ],
    });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(`${SLOTS}/${SLOT_ID}`, body('DELETE', await providerToken()));
    expect(res.status).toBe(200);
    expect(tables.provider_slots![0]!.state).toBe('released');
  });

  it('refuses to withdraw a held slot → 409', async () => {
    const { db } = makeDb({
      providers: [PROVIDER],
      provider_slots: [
        { id: SLOT_ID, provider_id: PROVIDER_ID, slot_date: '2026-07-01', start_min: 540, end_min: 600, state: 'held', held_by_booking_id: 'booking-1' },
      ],
    });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(`${SLOTS}/${SLOT_ID}`, body('DELETE', await providerToken()));
    expect(res.status).toBe(409);
  });

  it('404 withdrawing a slot the Provider does not own', async () => {
    const { db } = makeDb({
      providers: [PROVIDER],
      provider_slots: [
        { id: SLOT_ID, provider_id: 'someone-else', slot_date: '2026-07-01', start_min: 540, end_min: 600, state: 'open', held_by_booking_id: null },
      ],
    });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(`${SLOTS}/${SLOT_ID}`, body('DELETE', await providerToken()));
    expect(res.status).toBe(404);
  });
});
