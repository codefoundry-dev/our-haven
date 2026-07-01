import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Fake Kysely surface for the caregiver-badges route (OH-187). Mirrors
 * routes/provider-credentials.test.ts: `provider_home_childcare_registrations`
 * and `provider_profiles` are stateful so the load-or-create + decision + W-10
 * writes are observable. `captures` records every insert/update so we can assert
 * that NEITHER badge ever touches `provider_verifications` (no activation gate).
 */
interface RegistrationRow {
  provider_id: string;
  state_at_upload: string | null;
  certificate_doc_object_path: string | null;
  certificate_uploaded_at: Date | string | null;
  decision: 'verified' | 'rejected' | null;
  decision_at: Date | string | null;
  decision_by_admin_uid: string | null;
  decision_notes: string | null;
}

function emptyRegistration(providerId: string): RegistrationRow {
  return {
    provider_id: providerId,
    state_at_upload: null,
    certificate_doc_object_path: null,
    certificate_uploaded_at: null,
    decision: null,
    decision_at: null,
    decision_by_admin_uid: null,
    decision_notes: null,
  };
}

interface DbOpts {
  provider?: Record<string, unknown> | null;
  /** Initial registration row; null → none yet (insert on first touch). */
  registration?: RegistrationRow | null;
  /** Initial provider_profiles row; null → none yet. */
  profile?: { w10_tax_credit_friendly: boolean } | null;
}

function makeDb(opts: DbOpts = {}) {
  const captures = {
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  };
  let registration: RegistrationRow | null = opts.registration ?? null;
  let profile: { w10_tax_credit_friendly: boolean } | null = opts.profile ?? null;

  const selectChain = (getResult: () => unknown) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      selectAll: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => b,
      executeTakeFirst: async () => getResult() ?? undefined,
    });
    return b;
  };

  const insertChain = (table: string) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      values: (values: Record<string, unknown>) => {
        captures.inserts.push({ table, values });
        if (table === 'provider_home_childcare_registrations') {
          registration = emptyRegistration(String(values.provider_id ?? ''));
        }
        if (table === 'provider_profiles') {
          profile = { w10_tax_credit_friendly: false };
        }
        return b;
      },
      returning: () => b,
      returningAll: () => b,
      execute: async () => [],
      executeTakeFirstOrThrow: async () => registration,
    });
    return b;
  };

  const updateChain = (table: string) => {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      set: (set: Record<string, unknown>) => {
        captures.updates.push({ table, set });
        if (table === 'provider_home_childcare_registrations' && registration) {
          registration = { ...registration, ...(set as Partial<RegistrationRow>) };
        }
        if (table === 'provider_profiles' && profile && 'w10_tax_credit_friendly' in set) {
          profile = { w10_tax_credit_friendly: Boolean(set.w10_tax_credit_friendly) };
        }
        return b;
      },
      where: () => b,
      returning: () => b,
      returningAll: () => b,
      execute: async () => [],
      executeTakeFirstOrThrow: async () => registration,
    });
    return b;
  };

  const db = {
    selectFrom: (table: string) => {
      if (table === 'providers') return selectChain(() => opts.provider);
      if (table === 'provider_home_childcare_registrations') return selectChain(() => registration ?? undefined);
      if (table === 'provider_profiles') return selectChain(() => profile ?? undefined);
      return selectChain(() => undefined);
    },
    insertInto: (table: string) => insertChain(table),
    updateTable: (table: string) => updateChain(table),
  } as unknown as AppDeps['db'];

  return {
    db,
    captures,
    getRegistration: () => registration,
    getProfile: () => profile,
  };
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

// Provider ids are uuids in prod; the admin route param is uuid-validated.
const BABYSITTER_FL_ID = '11111111-1111-4111-8111-111111111111';
const NANNY_AK_ID = '22222222-2222-4222-8222-222222222222';
const TUTOR_FL_ID = '33333333-3333-4333-8333-333333333333';
const PROVIDER_ID = '44444444-4444-4444-8444-444444444444';

const BABYSITTER_FL = { id: BABYSITTER_FL_ID, uid: 'uid-bs-fl', role: 'caregiver', categories: ['babysitter'], specialty: null, state: 'FL' };
const NANNY_AK = { id: NANNY_AK_ID, uid: 'uid-nanny-ak', role: 'caregiver', categories: ['nanny'], specialty: null, state: 'AK' };
const TUTOR_FL = { id: TUTOR_FL_ID, uid: 'uid-tutor-fl', role: 'caregiver', categories: ['tutor'], specialty: null, state: 'FL' };
const PROVIDER = { id: PROVIDER_ID, uid: 'uid-prov', role: 'provider', categories: null, specialty: 'ot', state: 'FL' };

function caregiverToken(uid: string, categories: string[]) {
  return mintAccessToken({ sub: uid, email: `${uid}@example.com`, appMetadata: { role: 'caregiver', categories } });
}
function providerToken(uid = PROVIDER.uid) {
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
const post = (token: string, payload?: unknown) => body('POST', token, payload);
const put = (token: string, payload?: unknown) => body('PUT', token, payload);

const FCCH = '/v1/providers/me/home-childcare-registration';
const adminFcch = (id: string) => `/v1/admin/providers/${id}/home-childcare-registration`;
const W10 = '/v1/providers/me/tax-credit-attestation';

/* ── FCCH provider-side ─────────────────────────────────────────────────────── */

describe('GET /v1/providers/me/home-childcare-registration', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps());
    expect((await app.request(FCCH)).status).toBe(401);
  });

  it('403 forbidden_role for a clinical Provider (caregiver-only)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: PROVIDER }).db }));
    const res = await app.request(FCCH, get(await providerToken()));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'forbidden_role' });
  });

  it('404 when the supply row is missing', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: null }).db }));
    const res = await app.request(FCCH, get(await caregiverToken('orphan', ['babysitter'])));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'provider_not_found' });
  });

  it('409 for a Tutor-only Caregiver', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: TUTOR_FL }).db }));
    const res = await app.request(FCCH, get(await caregiverToken(TUTOR_FL.uid, ['tutor'])));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'home_childcare_registration_not_applicable' });
  });

  it('returns FL agency context for a Babysitter in FL (creates the row on first read)', async () => {
    const { db, getRegistration } = makeDb({ provider: BABYSITTER_FL, registration: null });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(FCCH, get(await caregiverToken(BABYSITTER_FL.uid, ['babysitter'])));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.role).toBe('caregiver');
    expect(json.categories).toEqual(['babysitter']);
    expect(json.residentState).toBe('FL');
    expect(json.homeChildcareBoardSupported).toBe(true);
    expect((json.board as Record<string, unknown>).state).toBe('FL');
    expect((json.board as Record<string, unknown>).agencyName).toMatch(/Florida/);
    expect((json.board as Record<string, unknown>).registerUrl).toMatch(/^https:\/\//);
    expect(json.decision).toBeNull();
    expect(json.badge).toBeNull();
    expect(getRegistration()).not.toBeNull();
  });

  it('marks homeChildcareBoardSupported=false + board null for a Nanny in a non-slate state', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: NANNY_AK }).db }));
    const res = await app.request(FCCH, get(await caregiverToken(NANNY_AK.uid, ['nanny'])));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.homeChildcareBoardSupported).toBe(false);
    expect(json.board).toBeNull();
  });

  it('surfaces the public badge once a verified decision is stored', async () => {
    const registration: RegistrationRow = {
      provider_id: BABYSITTER_FL_ID,
      state_at_upload: 'FL',
      certificate_doc_object_path: `state-childcare-registration/${BABYSITTER_FL.uid}/cert.pdf`,
      certificate_uploaded_at: new Date('2026-05-18'),
      decision: 'verified',
      decision_at: new Date('2026-05-20T10:00:00.000Z'),
      decision_by_admin_uid: 'admin-1',
      decision_notes: 'DCF confirms active.',
    };
    const app = buildApp(makeDeps({ db: makeDb({ provider: BABYSITTER_FL, registration }).db }));
    const res = await app.request(FCCH, get(await caregiverToken(BABYSITTER_FL.uid, ['babysitter'])));
    expect(res.status).toBe(200);
    const badge = ((await res.json()) as Record<string, unknown>).badge as Record<string, unknown>;
    expect(badge).not.toBeNull();
    expect(badge.state).toBe('FL');
    expect(badge.agencyName).toMatch(/Florida/);
    expect(badge.verifiedAt).toBe('2026-05-20T10:00:00.000Z');
  });
});

describe('POST /v1/providers/me/home-childcare-registration', () => {
  it('records a certificate upload + captures resident state at upload time', async () => {
    const { db, getRegistration } = makeDb({ provider: BABYSITTER_FL, registration: null });
    const app = buildApp(makeDeps({ db }));
    const objectPath = `state-childcare-registration/${BABYSITTER_FL.uid}/dcf-cert.pdf`;
    const res = await app.request(FCCH, post(await caregiverToken(BABYSITTER_FL.uid, ['babysitter']), { objectPath }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.certificateDocObjectPath).toBe(objectPath);
    expect(json.certificateUploadedAt).not.toBeNull();
    expect(json.stateAtUpload).toBe('FL');
    expect(getRegistration()?.state_at_upload).toBe('FL');
  });

  it('clears a prior decision when a fresh certificate is uploaded', async () => {
    const registration: RegistrationRow = {
      provider_id: BABYSITTER_FL_ID,
      state_at_upload: 'FL',
      certificate_doc_object_path: `state-childcare-registration/${BABYSITTER_FL.uid}/old.pdf`,
      certificate_uploaded_at: new Date('2026-01-01'),
      decision: 'verified',
      decision_at: new Date('2026-01-02'),
      decision_by_admin_uid: 'admin-1',
      decision_notes: 'prior',
    };
    const app = buildApp(makeDeps({ db: makeDb({ provider: BABYSITTER_FL, registration }).db }));
    const res = await app.request(
      FCCH,
      post(await caregiverToken(BABYSITTER_FL.uid, ['babysitter']), {
        objectPath: `state-childcare-registration/${BABYSITTER_FL.uid}/new.pdf`,
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.decision).toBeNull();
    expect(json.decisionByAdminUid).toBeNull();
    expect(json.badge).toBeNull();
  });

  it('400 when objectPath is not scoped to the caller', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: BABYSITTER_FL }).db }));
    const res = await app.request(
      FCCH,
      post(await caregiverToken(BABYSITTER_FL.uid, ['babysitter']), {
        objectPath: 'state-childcare-registration/someone-else/file.pdf',
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_object_path' });
  });

  it('409 for a Tutor', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: TUTOR_FL }).db }));
    const res = await app.request(
      FCCH,
      post(await caregiverToken(TUTOR_FL.uid, ['tutor']), {
        objectPath: `state-childcare-registration/${TUTOR_FL.uid}/x.pdf`,
      }),
    );
    expect(res.status).toBe(409);
  });
});

/* ── FCCH admin-side ────────────────────────────────────────────────────────── */

describe('GET /v1/admin/providers/{providerId}/home-childcare-registration', () => {
  it('returns context + uploaded cert for the admin', async () => {
    const registration: RegistrationRow = {
      provider_id: BABYSITTER_FL_ID,
      state_at_upload: 'FL',
      certificate_doc_object_path: `state-childcare-registration/${BABYSITTER_FL.uid}/cert.pdf`,
      certificate_uploaded_at: new Date('2026-05-20'),
      decision: null,
      decision_at: null,
      decision_by_admin_uid: null,
      decision_notes: null,
    };
    const app = buildApp(makeDeps({ db: makeDb({ provider: BABYSITTER_FL, registration }).db }));
    const res = await app.request(adminFcch(BABYSITTER_FL_ID), get(await adminToken()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect((json.board as Record<string, unknown>).registerUrl).toMatch(/^https:\/\//);
    expect(json.certificateDocObjectPath).toBe(registration.certificate_doc_object_path);
  });

  it('403 admin_totp_required for an admin token without TOTP', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: BABYSITTER_FL }).db }));
    const noTotp = await mintAccessToken({ sub: 'admin-x', appMetadata: { role: 'admin' } });
    const res = await app.request(adminFcch(BABYSITTER_FL_ID), get(noTotp));
    expect(res.status).toBe(403);
  });

  it('403 for a non-admin caller', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: BABYSITTER_FL }).db }));
    const res = await app.request(adminFcch(BABYSITTER_FL_ID), get(await providerToken(BABYSITTER_FL.uid)));
    expect(res.status).toBe(403);
  });

  it('409 when the target is a clinical Provider', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: PROVIDER }).db }));
    const res = await app.request(adminFcch(PROVIDER_ID), get(await adminToken()));
    expect(res.status).toBe(409);
  });
});

describe('POST /v1/admin/providers/{providerId}/home-childcare-registration', () => {
  it('records a `verified` decision with the admin uid + notes, lighting the badge', async () => {
    const registration: RegistrationRow = {
      provider_id: BABYSITTER_FL_ID,
      state_at_upload: 'FL',
      certificate_doc_object_path: `state-childcare-registration/${BABYSITTER_FL.uid}/cert.pdf`,
      certificate_uploaded_at: new Date('2026-05-18'),
      decision: null,
      decision_at: null,
      decision_by_admin_uid: null,
      decision_notes: null,
    };
    const { db, captures } = makeDb({ provider: BABYSITTER_FL, registration });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(
      adminFcch(BABYSITTER_FL_ID),
      post(await adminToken('admin-camille'), { decision: 'verified', notes: 'DCF portal confirms FCCH active.' }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.decision).toBe('verified');
    expect(json.decisionByAdminUid).toBe('admin-camille');
    expect(json.decisionNotes).toBe('DCF portal confirms FCCH active.');
    const badge = json.badge as Record<string, unknown>;
    expect(badge.state).toBe('FL');
    expect(badge.agencyName).toMatch(/Florida/);
    // Decoupled from the Verification state machine — never touches activation.
    expect(captures.updates.some((u) => u.table === 'provider_verifications')).toBe(false);
    expect(captures.inserts.some((i) => i.table === 'provider_verifications')).toBe(false);
  });

  it('records a `rejected` decision (badge stays off)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: BABYSITTER_FL }).db }));
    const res = await app.request(
      adminFcch(BABYSITTER_FL_ID),
      post(await adminToken(), { decision: 'rejected', notes: 'Certificate illegible.' }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.decision).toBe('rejected');
    expect(json.badge).toBeNull();
  });

  it('400 on an unknown decision value', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: BABYSITTER_FL }).db }));
    const res = await app.request(adminFcch(BABYSITTER_FL_ID), post(await adminToken(), { decision: 'maybe' }));
    expect(res.status).toBe(400);
  });

  it('409 when the target is a Tutor', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: TUTOR_FL }).db }));
    const res = await app.request(adminFcch(TUTOR_FL_ID), post(await adminToken(), { decision: 'verified' }));
    expect(res.status).toBe(409);
  });
});

/* ── W-10 "Tax-credit-friendly" self-attestation ────────────────────────────── */

describe('GET /v1/providers/me/tax-credit-attestation', () => {
  it('401 without a token', async () => {
    const app = buildApp(makeDeps());
    expect((await app.request(W10)).status).toBe(401);
  });

  it('403 forbidden_role for a clinical Provider', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: PROVIDER }).db }));
    expect((await app.request(W10, get(await providerToken()))).status).toBe(403);
  });

  it('defaults to not-attested when no profile row exists, but reports eligibility', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: BABYSITTER_FL, profile: null }).db }));
    const res = await app.request(W10, get(await caregiverToken(BABYSITTER_FL.uid, ['babysitter'])));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ w10Eligible: true, selfAttested: false, taxCreditFriendly: false });
  });

  it('reports the badge active once self-attested', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: BABYSITTER_FL, profile: { w10_tax_credit_friendly: true } }).db }));
    const res = await app.request(W10, get(await caregiverToken(BABYSITTER_FL.uid, ['babysitter'])));
    expect(await res.json()).toMatchObject({ w10Eligible: true, selfAttested: true, taxCreditFriendly: true });
  });

  it('a Tutor is not eligible (badge can never light)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: TUTOR_FL, profile: { w10_tax_credit_friendly: true } }).db }));
    const res = await app.request(W10, get(await caregiverToken(TUTOR_FL.uid, ['tutor'])));
    expect(await res.json()).toMatchObject({ w10Eligible: false, taxCreditFriendly: false });
  });
});

describe('PUT /v1/providers/me/tax-credit-attestation', () => {
  it('a Babysitter self-attests true → taxCreditFriendly true (no activation write)', async () => {
    const { db, captures, getProfile } = makeDb({ provider: BABYSITTER_FL, profile: null });
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(W10, put(await caregiverToken(BABYSITTER_FL.uid, ['babysitter']), { selfAttested: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ selfAttested: true, taxCreditFriendly: true });
    expect(getProfile()?.w10_tax_credit_friendly).toBe(true);
    expect(captures.updates.some((u) => u.table === 'provider_verifications')).toBe(false);
  });

  it('a Babysitter can clear the badge (self-attest false)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: BABYSITTER_FL, profile: { w10_tax_credit_friendly: true } }).db }));
    const res = await app.request(W10, put(await caregiverToken(BABYSITTER_FL.uid, ['babysitter']), { selfAttested: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ selfAttested: false, taxCreditFriendly: false });
  });

  it('400 w10_not_eligible when a Tutor tries to self-attest true', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: TUTOR_FL }).db }));
    const res = await app.request(W10, put(await caregiverToken(TUTOR_FL.uid, ['tutor']), { selfAttested: true }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'w10_not_eligible' });
  });

  it('allows a Tutor to set false (no-op clear, never gates)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: TUTOR_FL, profile: { w10_tax_credit_friendly: false } }).db }));
    const res = await app.request(W10, put(await caregiverToken(TUTOR_FL.uid, ['tutor']), { selfAttested: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ selfAttested: false, w10Eligible: false });
  });

  it('400 on a malformed body (missing selfAttested)', async () => {
    const app = buildApp(makeDeps({ db: makeDb({ provider: BABYSITTER_FL }).db }));
    const res = await app.request(W10, put(await caregiverToken(BABYSITTER_FL.uid, ['babysitter']), {}));
    expect(res.status).toBe(400);
  });
});
