import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * In-memory Kysely fake for the caregiver-profile route (OH-188). Unlike the
 * badges fake, this one honours `where` predicates + `orderBy` so the
 * credential-ownership, rate-replacement and admin-decision flows are
 * observable. Backs four tables; `captures` records writes.
 */
type Row = Record<string, unknown>;
type Cond = [string, string, unknown];

const TABLE_DEFAULTS: Record<string, Row> = {
  provider_profiles: {
    display_name: null,
    headline: null,
    bio: null,
    languages: [],
    specialty_tags: [],
    photo_object_path: null,
    published_rate_cents: null,
    per_child_surcharge_cents: null,
    availability_grid: {},
    availability_note: null,
    paused: false,
    w10_tax_credit_friendly: false,
    negotiable: true,
    ages_served: [],
    behaviour_comfort: [],
  },
  provider_category_rates: { per_child_surcharge_cents: null },
  caregiver_credentials: { rejection_reason: null, review_state: 'pending' },
};

function makeDb(seed: Partial<Record<string, Row[]>> = {}) {
  const tables: Record<string, Row[]> = {
    providers: seed.providers ?? [],
    provider_profiles: seed.provider_profiles ?? [],
    provider_category_rates: seed.provider_category_rates ?? [],
    caregiver_credentials: seed.caregiver_credentials ?? [],
  };
  const captures = {
    inserts: [] as Array<{ table: string; values: Row }>,
    updates: [] as Array<{ table: string; set: Row }>,
    deletes: [] as Array<{ table: string }>,
  };
  let seq = 0;

  const match = (rows: Row[], conds: Cond[]) =>
    rows.filter((r) => conds.every(([col, , val]) => r[col] === val));

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

  const deleteFrom = (table: string) => {
    const conds: Cond[] = [];
    const b: Row = {
      where: (col: string, op: string, val: unknown) => (conds.push([col, op, val]), b),
      execute: async () => {
        captures.deletes.push({ table });
        tables[table] = (tables[table] ?? []).filter((r) => !conds.every(([c, , v]) => r[c] === v));
        return [];
      },
    };
    return b;
  };

  const handle = { selectFrom, insertInto, updateTable, deleteFrom };
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

const BABYSITTER_ID = '11111111-1111-4111-8111-111111111111';
const TUTOR_ID = '33333333-3333-4333-8333-333333333333';
const PROVIDER_ID = '44444444-4444-4444-8444-444444444444';

const BABYSITTER = { id: BABYSITTER_ID, uid: 'uid-bs', role: 'caregiver', categories: ['babysitter', 'nanny'], specialty: null, state: 'FL' };
const TUTOR = { id: TUTOR_ID, uid: 'uid-tutor', role: 'caregiver', categories: ['tutor'], specialty: null, state: 'FL' };

function caregiverToken(uid: string, categories: string[]) {
  return mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'caregiver', categories } });
}
function providerToken(uid = 'uid-prov') {
  return mintAccessToken({ sub: uid, email: 'pr@example.com', appMetadata: { role: 'provider', specialty: 'ot' } });
}
function adminToken(uid = 'admin-1') {
  return mintAccessToken({
    sub: uid,
    email: 'admin@ourhaven.com',
    appMetadata: { role: 'admin' },
    aal: 'aal2',
    amr: [{ method: 'totp' }],
  });
}

const get = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } });
const body = (method: string, token: string, payload?: unknown): RequestInit => ({
  method,
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: payload === undefined ? undefined : JSON.stringify(payload),
});

const PROFILE = '/v1/providers/me/profile';
const CREDS = '/v1/providers/me/credentials';

/* ── GET profile ────────────────────────────────────────────────────────────── */

describe('GET /v1/providers/me/profile', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps());
    expect((await app.request(PROFILE)).status).toBe(401);
  });

  it('403 for a clinical Provider (caregiver-only)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [{ id: PROVIDER_ID, uid: 'uid-prov', role: 'provider', categories: null, specialty: 'ot', state: 'FL' }] }).db }));
    const res = await app.request(PROFILE, get(await providerToken()));
    expect(res.status).toBe(403);
  });

  it('404 when the supply row is missing', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [] }).db }));
    const res = await app.request(PROFILE, get(await caregiverToken('orphan', ['babysitter'])));
    expect(res.status).toBe(404);
  });

  it('returns sensible defaults for a fresh Caregiver (negotiable on, empty rates)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [BABYSITTER] }).db }));
    const res = await app.request(PROFILE, get(await caregiverToken(BABYSITTER.uid, BABYSITTER.categories)));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({
      categories: ['babysitter', 'nanny'],
      categoryRates: [],
      fromRateCents: null,
      negotiable: true,
      paused: false,
      agesServed: [],
      behaviourComfort: [],
      credentials: [],
      zip: null,
      yearsExperience: null,
      languages: [],
      specialties: [],
      photoObjectPath: null,
      photoUrl: null,
    });
  });
});

/* ── PATCH profile ──────────────────────────────────────────────────────────── */

describe('PATCH /v1/providers/me/profile', () => {
  it('persists per-category rates + surcharge and derives "from $X"', async () => {
    const { db, tables } = makeDb({ providers: [BABYSITTER] });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      PROFILE,
      body('PATCH', await caregiverToken(BABYSITTER.uid, BABYSITTER.categories), {
        categoryRates: [
          { category: 'nanny', publishedRateCents: 3000, perChildSurchargeCents: null },
          { category: 'babysitter', publishedRateCents: 2500, perChildSurchargeCents: 500 },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.fromRateCents).toBe(2500);
    expect((json.categoryRates as unknown[]).length).toBe(2);
    expect(tables.provider_category_rates).toHaveLength(2);
  });

  it('rejects a per-child surcharge on a Tutor rate (Babysitter/Nanny only) → 400', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [TUTOR] }).db }));
    const res = await app.request(
      PROFILE,
      body('PATCH', await caregiverToken(TUTOR.uid, TUTOR.categories), {
        categoryRates: [{ category: 'tutor', publishedRateCents: 4000, perChildSurchargeCents: 500 }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a rate for a category the Caregiver does not offer → 400', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [TUTOR] }).db }));
    const res = await app.request(
      PROFILE,
      body('PATCH', await caregiverToken(TUTOR.uid, TUTOR.categories), {
        categoryRates: [{ category: 'babysitter', publishedRateCents: 2500, perChildSurchargeCents: null }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it('replaces the FULL rate set on each PATCH', async () => {
    const { db, tables } = makeDb({ providers: [BABYSITTER] });
    const app = buildApp(makeDeps({ db }));
    const tok = await caregiverToken(BABYSITTER.uid, BABYSITTER.categories);
    await app.request(PROFILE, body('PATCH', tok, { categoryRates: [
      { category: 'babysitter', publishedRateCents: 2500, perChildSurchargeCents: null },
      { category: 'nanny', publishedRateCents: 3000, perChildSurchargeCents: null },
    ] }));
    await app.request(PROFILE, body('PATCH', tok, { categoryRates: [
      { category: 'nanny', publishedRateCents: 3200, perChildSurchargeCents: null },
    ] }));
    expect(tables.provider_category_rates).toHaveLength(1);
    expect(tables.provider_category_rates![0]).toMatchObject({ category: 'nanny', published_rate_cents: 3200 });
  });

  it('persists negotiable + ages-served + behaviour-comfort, dropping unknown tokens', async () => {
    const { db } = makeDb({ providers: [BABYSITTER] });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      PROFILE,
      body('PATCH', await caregiverToken(BABYSITTER.uid, BABYSITTER.categories), {
        negotiable: false,
        agesServed: ['infant', 'teen'],
        behaviourComfort: ['aggression', 'pica'],
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.negotiable).toBe(false);
    expect(json.agesServed).toEqual(['infant', 'teen']);
    expect(json.behaviourComfort).toEqual(['aggression', 'pica']);
  });

  it('rejects an unknown behaviour token at the schema (zod enum) → 400', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [BABYSITTER] }).db }));
    const res = await app.request(
      PROFILE,
      body('PATCH', await caregiverToken(BABYSITTER.uid, BABYSITTER.categories), {
        behaviourComfort: ['made-up-behaviour'],
      }),
    );
    expect(res.status).toBe(400);
  });

  it('persists the availability grid + paused', async () => {
    const { db } = makeDb({ providers: [BABYSITTER] });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      PROFILE,
      body('PATCH', await caregiverToken(BABYSITTER.uid, BABYSITTER.categories), {
        availabilityGrid: { mon: { morning: true, afternoon: false } },
        availabilityNote: 'Flexible weekends',
        paused: true,
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.paused).toBe(true);
    // false cells are normalised away
    expect(json.availabilityGrid).toEqual({ mon: { morning: true } });
  });

  it('persists zip, years, languages + specialties (trimmed/de-duped) and the photo URL', async () => {
    const { db } = makeDb({ providers: [BABYSITTER] });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      PROFILE,
      body('PATCH', await caregiverToken(BABYSITTER.uid, BABYSITTER.categories), {
        zip: '90210',
        yearsExperience: 4,
        languages: ['English', 'english', '  Spanish '],
        specialties: ['Math', 'Test  prep', ''],
        photoObjectPath: `avatar/${BABYSITTER.uid}/abc-123`,
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.zip).toBe('90210');
    expect(json.yearsExperience).toBe(4);
    expect(json.languages).toEqual(['English', 'Spanish']);
    expect(json.specialties).toEqual(['Math', 'Test prep']);
    expect(json.photoObjectPath).toBe(`avatar/${BABYSITTER.uid}/abc-123`);
    expect(json.photoUrl).toContain(`/storage/v1/object/public/avatars/avatar/${BABYSITTER.uid}/abc-123`);
  });

  it('rejects a photoObjectPath outside the caller’s avatar namespace → 400', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [BABYSITTER] }).db }));
    const res = await app.request(
      PROFILE,
      body('PATCH', await caregiverToken(BABYSITTER.uid, BABYSITTER.categories), {
        photoObjectPath: 'avatar/someone-else/x',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a non-5-digit zip at the schema → 400', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ providers: [BABYSITTER] }).db }));
    const res = await app.request(
      PROFILE,
      body('PATCH', await caregiverToken(BABYSITTER.uid, BABYSITTER.categories), { zip: '9021' }),
    );
    expect(res.status).toBe(400);
  });
});

/* ── Credentials (caregiver side) ───────────────────────────────────────────── */

describe('POST /v1/providers/me/credentials', () => {
  it('creates a Credential in pending review', async () => {
    const { db } = makeDb({ providers: [BABYSITTER] });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      CREDS,
      body('POST', await caregiverToken(BABYSITTER.uid, BABYSITTER.categories), {
        type: 'certification',
        label: 'CPR / First Aid',
      }),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { credential: Record<string, unknown> };
    expect(json.credential).toMatchObject({ review: 'pending', statusLabel: 'Pending review', clinicalFlag: false });
  });

  it('flags a clinical-sounding title (admin-assist), still pending', async () => {
    const { db } = makeDb({ providers: [BABYSITTER] });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      CREDS,
      body('POST', await caregiverToken(BABYSITTER.uid, BABYSITTER.categories), {
        type: 'title',
        label: 'Pediatric Nurse',
      }),
    );
    const json = (await res.json()) as { credential: Record<string, unknown> };
    expect(json.credential.clinicalFlag).toBe(true);
  });
});

describe('DELETE /v1/providers/me/credentials/{id}', () => {
  const CRED_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  it('removes an owned Credential', async () => {
    const { db, tables } = makeDb({
      providers: [BABYSITTER],
      caregiver_credentials: [{ id: CRED_ID, provider_id: BABYSITTER_ID, type: 'training', label: 'Newborn Care', review_state: 'pending', rejection_reason: null, created_at: new Date(2026, 0, 1) }],
    });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(`${CREDS}/${CRED_ID}`, body('DELETE', await caregiverToken(BABYSITTER.uid, BABYSITTER.categories)));
    expect(res.status).toBe(200);
    expect(tables.caregiver_credentials).toHaveLength(0);
  });

  it('404 for a credential the Caregiver does not own', async () => {
    const { db } = makeDb({
      providers: [BABYSITTER],
      caregiver_credentials: [{ id: CRED_ID, provider_id: 'someone-else', type: 'training', label: 'x', review_state: 'pending', rejection_reason: null, created_at: new Date(2026, 0, 1) }],
    });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(`${CREDS}/${CRED_ID}`, body('DELETE', await caregiverToken(BABYSITTER.uid, BABYSITTER.categories)));
    expect(res.status).toBe(404);
  });
});

/* ── Credentials (admin side) ───────────────────────────────────────────────── */

describe('admin credential review', () => {
  const CRED_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const adminList = (id: string) => `/v1/admin/providers/${id}/credentials`;
  const adminDecision = (id: string, credId: string) => `/v1/admin/providers/${id}/credentials/${credId}/decision`;

  function seedWithPendingTitle() {
    return makeDb({
      providers: [BABYSITTER],
      caregiver_credentials: [{ id: CRED_ID, provider_id: BABYSITTER_ID, type: 'title', label: 'Pediatric Nurse', review_state: 'pending', rejection_reason: null, created_at: new Date(2026, 0, 1) }],
    });
  }

  it('403 for a non-admin caller', async () => {
    const app = buildApp(makeDeps({ db: seedWithPendingTitle().db }));
    const res = await app.request(adminList(BABYSITTER_ID), get(await caregiverToken(BABYSITTER.uid, BABYSITTER.categories)));
    expect(res.status).toBe(403);
  });

  it('lists credentials with clinical matches for the admin', async () => {
    const app = buildApp(makeDeps({ db: seedWithPendingTitle().db }));
    const res = await app.request(adminList(BABYSITTER_ID), get(await adminToken()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { credentials: Array<Record<string, unknown>> };
    expect(json.credentials[0]).toMatchObject({ clinicalFlag: true });
    expect(json.credentials[0]!.clinicalMatches).toContain('nurse');
  });

  it('approves a pending Credential → publicly visible', async () => {
    const { db, tables } = seedWithPendingTitle();
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(adminDecision(BABYSITTER_ID, CRED_ID), body('POST', await adminToken(), { decision: 'approve' }));
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ review: 'approved' });
    expect(tables.caregiver_credentials![0]!.review_state).toBe('approved');
  });

  it('rejects a pending Credential carrying the reason', async () => {
    const { db } = seedWithPendingTitle();
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(adminDecision(BABYSITTER_ID, CRED_ID), body('POST', await adminToken(), { decision: 'reject', reason: 'clinical-sounding title' }));
    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ review: 'rejected', rejectionReason: 'clinical-sounding title' });
  });

  it('409 deciding an already-approved Credential (terminal)', async () => {
    const { db } = makeDb({
      providers: [BABYSITTER],
      caregiver_credentials: [{ id: CRED_ID, provider_id: BABYSITTER_ID, type: 'certification', label: 'CPR', review_state: 'approved', rejection_reason: null, created_at: new Date(2026, 0, 1) }],
    });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(adminDecision(BABYSITTER_ID, CRED_ID), body('POST', await adminToken(), { decision: 'approve' }));
    expect(res.status).toBe(409);
  });

  it('hides pending Credentials from the public preview but shows them to the owner', async () => {
    // The owner GET surfaces the pending credential (with its status); the
    // public projection is the domain `publicCredentials` (covered in the domain
    // suite). Here we assert the owner sees it.
    const { db } = seedWithPendingTitle();
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(PROFILE, get(await caregiverToken(BABYSITTER.uid, BABYSITTER.categories)));
    const json = (await res.json()) as { credentials: Array<Record<string, unknown>> };
    expect(json.credentials).toHaveLength(1);
    expect(json.credentials[0]).toMatchObject({ review: 'pending', statusLabel: 'Pending review' });
  });
});
