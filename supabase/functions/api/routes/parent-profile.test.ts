import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * In-memory Kysely fake for the parent-profile route (OH-200). Backs the single
 * `parent_profiles` table, honouring `where` predicates so the consent gate,
 * withdrawal erasure, and default-address flows are observable. `captures`
 * records writes.
 */
type Row = Record<string, unknown>;
type Cond = [string, string, unknown];

const TABLE_DEFAULTS: Record<string, Row> = {
  parent_profiles: {
    bio: null,
    preferences: [],
    safety_behaviors: [],
    safety_behaviors_consent_at: null,
    default_address_line1: null,
    default_address_line2: null,
    default_city: null,
    default_state: null,
    default_postal_code: null,
  },
};

function makeDb(seed: Partial<Record<string, Row[]>> = {}) {
  const tables: Record<string, Row[]> = {
    parent_profiles: seed.parent_profiles ?? [],
  };
  const captures = {
    inserts: [] as Array<{ table: string; values: Row }>,
    updates: [] as Array<{ table: string; set: Row }>,
  };
  let seq = 0;

  const match = (rows: Row[], conds: Cond[]) =>
    rows.filter((r) => conds.every(([col, , val]) => r[col] === val));

  const selectFrom = (table: string) => {
    const conds: Cond[] = [];
    const b: Row = {
      select: () => b,
      selectAll: () => b,
      where: (col: string, op: string, val: unknown) => (conds.push([col, op, val]), b),
      limit: () => b,
      execute: async () => match(tables[table] ?? [], conds).map((r) => ({ ...r })),
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
            created_at: new Date(2026, 0, seq),
            updated_at: new Date(2026, 0, seq),
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
    const b: Row = {
      set: (s: Row) => (captures.updates.push({ table, set: s }), (setVals = s), b),
      where: (col: string, op: string, val: unknown) => (conds.push([col, op, val]), b),
      execute: async () => {
        for (const r of match(tables[table] ?? [], conds)) Object.assign(r, setVals);
        return [];
      },
    };
    return b;
  };

  const handle = { selectFrom, insertInto, updateTable };
  const db = handle as unknown as AppDeps['db'];
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
  };
}

function parentToken(uid = 'uid-parent') {
  return mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'parent' } });
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

const PROFILE = '/v1/parents/me/profile';
const CONSENT = '/v1/parents/me/profile/consent';
const BEHAVIORS = '/v1/parents/me/profile/safety-behaviors';

/* ── GET ────────────────────────────────────────────────────────────────────── */

describe('GET /v1/parents/me/profile', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps({ db: makeDb().db }));
    expect((await app.request(PROFILE)).status).toBe(401);
  });

  it('403 for a caregiver (parent-only)', async () => {
    const app = buildApp(makeDeps({ db: makeDb().db }));
    expect((await app.request(PROFILE, get(await caregiverToken()))).status).toBe(403);
  });

  it('returns empty defaults for a Parent with no row yet (no write)', async () => {
    const { db, tables } = makeDb();
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(PROFILE, get(await parentToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bio: null,
      preferences: [],
      safetyBehaviors: [],
      safetyBehaviorsConsentAt: null,
      hasConsent: false,
      defaultAddress: { line1: null, line2: null, city: null, state: null, postalCode: null },
    });
    expect(tables.parent_profiles).toHaveLength(0);
  });
});

/* ── PATCH (non-sensitive) ──────────────────────────────────────────────────── */

describe('PATCH /v1/parents/me/profile', () => {
  it('persists bio + preferences (taxonomy-validated, de-duped, canonical order)', async () => {
    const { db } = makeDb();
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      PROFILE,
      body('PATCH', await parentToken(), {
        bio: 'Two kids, a dog, and a trampoline.',
        preferences: ['comfortable-with-pets', 'non-smoker', 'non-smoker'],
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.bio).toBe('Two kids, a dog, and a trampoline.');
    expect(json.preferences).toEqual(['non-smoker', 'comfortable-with-pets']);
  });

  it('rejects an unknown preference token at the schema → 400', async () => {
    const app = buildApp(makeDeps({ db: makeDb().db }));
    const res = await app.request(PROFILE, body('PATCH', await parentToken(), { preferences: ['made-up-trait'] }));
    expect(res.status).toBe(400);
  });

  it('persists + normalises a default address', async () => {
    const { db } = makeDb();
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      PROFILE,
      body('PATCH', await parentToken(), {
        defaultAddress: { line1: '  221B Baker St ', line2: null, city: 'Boston', state: 'ma', postalCode: '02118' },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { defaultAddress: Record<string, unknown> };
    expect(json.defaultAddress).toEqual({ line1: '221B Baker St', line2: null, city: 'Boston', state: 'MA', postalCode: '02118' });
  });

  it('rejects a non-US state / malformed ZIP → 400', async () => {
    const app = buildApp(makeDeps({ db: makeDb().db }));
    const tok = await parentToken();
    expect((await app.request(PROFILE, body('PATCH', tok, { defaultAddress: { state: 'ZZ' } }))).status).toBe(400);
    expect((await app.request(PROFILE, body('PATCH', tok, { defaultAddress: { postalCode: '021' } }))).status).toBe(400);
  });

  it('does NOT let Safety Behaviors be set via PATCH (field is not accepted)', async () => {
    const { db } = makeDb();
    const app = buildApp(makeDeps({ db }));
    // An extra field is ignored by the zod object; the checklist stays empty.
    const res = await app.request(PROFILE, body('PATCH', await parentToken(), { safetyBehaviors: ['aggression'] }));
    expect(res.status).toBe(200);
    expect((await res.json() as Record<string, unknown>).safetyBehaviors).toEqual([]);
  });
});

/* ── Consent gate + Safety Behaviors (the headline ACs) ─────────────────────── */

describe('Safety-Behaviors consent-to-store gate', () => {
  it('rejects saving Safety Behaviors WITHOUT consent → 403 consent_required (AC #1)', async () => {
    const { db } = makeDb();
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(BEHAVIORS, body('PUT', await parentToken(), { safetyBehaviors: ['aggression'] }));
    expect(res.status).toBe(403);
    expect((await res.json() as Record<string, unknown>).error).toBe('consent_required');
  });

  it('grants consent (timestamped) then persists Safety Behaviors (AC #1 + #2)', async () => {
    const { db } = makeDb();
    const app = buildApp(makeDeps({ db }));
    const tok = await parentToken();

    const granted = await app.request(CONSENT, body('POST', tok));
    expect(granted.status).toBe(200);
    const grantedJson = (await granted.json()) as Record<string, unknown>;
    expect(grantedJson.hasConsent).toBe(true);
    expect(typeof grantedJson.safetyBehaviorsConsentAt).toBe('string');

    const saved = await app.request(BEHAVIORS, body('PUT', tok, { safetyBehaviors: ['pica', 'aggression', 'made-up'] as string[] }));
    // 'made-up' is rejected at the zod enum BEFORE the handler → 400, so send only valid tokens for the happy path.
    expect(saved.status).toBe(400);

    const ok = await app.request(BEHAVIORS, body('PUT', tok, { safetyBehaviors: ['pica', 'aggression'] }));
    expect(ok.status).toBe(200);
    expect((await ok.json() as Record<string, unknown>).safetyBehaviors).toEqual(['aggression', 'pica']);
  });

  it('consent grant is idempotent — a repeat keeps the original timestamp', async () => {
    const { db } = makeDb();
    const app = buildApp(makeDeps({ db }));
    const tok = await parentToken();
    const first = (await (await app.request(CONSENT, body('POST', tok))).json()) as Record<string, unknown>;
    const second = (await (await app.request(CONSENT, body('POST', tok))).json()) as Record<string, unknown>;
    expect(second.safetyBehaviorsConsentAt).toBe(first.safetyBehaviorsConsentAt);
  });

  it('withdrawal erases Safety Behaviors + the timestamp, leaving Bio + Preferences (AC #3)', async () => {
    const { db } = makeDb();
    const app = buildApp(makeDeps({ db }));
    const tok = await parentToken();

    await app.request(PROFILE, body('PATCH', tok, { bio: 'Family bio', preferences: ['non-smoker'] }));
    await app.request(CONSENT, body('POST', tok));
    await app.request(BEHAVIORS, body('PUT', tok, { safetyBehaviors: ['wandering'] }));

    const withdrawn = await app.request(CONSENT, body('DELETE', tok));
    expect(withdrawn.status).toBe(200);
    const json = (await withdrawn.json()) as Record<string, unknown>;
    expect(json.safetyBehaviors).toEqual([]);
    expect(json.safetyBehaviorsConsentAt).toBeNull();
    expect(json.hasConsent).toBe(false);
    // Non-sensitive fields survive the withdrawal.
    expect(json.bio).toBe('Family bio');
    expect(json.preferences).toEqual(['non-smoker']);
  });

  it('after withdrawal, saving Safety Behaviors is gated again → 403', async () => {
    const { db } = makeDb();
    const app = buildApp(makeDeps({ db }));
    const tok = await parentToken();
    await app.request(CONSENT, body('POST', tok));
    await app.request(CONSENT, body('DELETE', tok));
    const res = await app.request(BEHAVIORS, body('PUT', tok, { safetyBehaviors: ['aggression'] }));
    expect(res.status).toBe(403);
  });

  it('403 for a caregiver hitting the consent endpoint (parent-only)', async () => {
    const app = buildApp(makeDeps({ db: makeDb().db }));
    expect((await app.request(CONSENT, body('POST', await caregiverToken()))).status).toBe(403);
  });
});
