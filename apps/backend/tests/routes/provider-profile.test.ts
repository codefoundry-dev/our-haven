import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDeps } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';
import { authPlugin } from '@/plugins/auth.js';
import { providerProfileRoutes } from '@/routes/provider-profile.js';

import { applyTestEnv, mintAccessToken } from '../helpers/test-jwt.js';

function envForTest() {
  resetEnvForTests();
  applyTestEnv();
  return loadEnv();
}

interface ProviderRow {
  id: string;
  uid: string;
  role: 'caregiver' | 'provider';
  categories: string[] | null;
  specialty: string | null;
}

interface ProfileRow {
  provider_id: string;
  display_name: string | null;
  headline: string | null;
  bio: string | null;
  languages: string[];
  specialty_tags: string[];
  photo_object_path: string | null;
  published_rate_cents: number | null;
  per_child_surcharge_cents: number | null;
  availability_grid: Record<string, Record<string, boolean>>;
  availability_note: string | null;
  paused: boolean;
  w10_tax_credit_friendly: boolean;
}

function emptyProfile(providerId: string): ProfileRow {
  return {
    provider_id: providerId,
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
  };
}

interface HomeChildcareRegistrationRow {
  state_at_upload: string | null;
  decision: 'verified' | 'rejected' | null;
  decision_at: Date | null;
}

interface DbStubOpts {
  provider?: ProviderRow | null;
  profile?: ProfileRow | null;
  homeChildcareRegistration?: HomeChildcareRegistrationRow | null;
}

function makeDbStub(opts: DbStubOpts) {
  let profile: ProfileRow | null = opts.profile ?? null;
  const updateSpy = vi.fn();

  const db = {
    selectFrom(table: string) {
      if (table === 'providers') {
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: vi.fn(async () => opts.provider ?? undefined),
            }),
          }),
        };
      }
      if (table === 'provider_profiles') {
        return {
          selectAll: () => ({
            where: () => ({
              executeTakeFirst: vi.fn(async () => profile ?? undefined),
            }),
          }),
        };
      }
      if (table === 'provider_home_childcare_registrations') {
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: vi.fn(async () => opts.homeChildcareRegistration ?? undefined),
            }),
          }),
        };
      }
      throw new Error(`unstubbed selectFrom(${table})`);
    },
    insertInto(table: string) {
      if (table === 'provider_profiles') {
        return {
          values: (vals: Partial<ProfileRow>) => ({
            returningAll: () => ({
              executeTakeFirstOrThrow: vi.fn(async () => {
                const fresh = { ...emptyProfile(vals.provider_id ?? ''), ...vals };
                profile = fresh;
                return fresh;
              }),
            }),
          }),
        };
      }
      throw new Error(`unstubbed insertInto(${table})`);
    },
    updateTable(table: string) {
      if (table === 'provider_profiles') {
        let patch: Partial<ProfileRow> = {};
        const chain = {
          set: (p: Partial<ProfileRow>) => {
            patch = p;
            updateSpy(p);
            return chain;
          },
          where: () => chain,
          returningAll: () => chain,
          executeTakeFirstOrThrow: vi.fn(async () => {
            if (!profile) throw new Error('profile not initialised');
            profile = { ...profile, ...patch };
            return profile;
          }),
        };
        return chain;
      }
      throw new Error(`unstubbed updateTable(${table})`);
    },
  };

  return { db, getProfile: () => profile, updateSpy };
}

function makeDeps(opts: { db?: unknown }): AppDeps {
  const passThrough = new Proxy({} as never, { get: () => passThrough });
  return {
    env: envForTest(),
    db: (opts.db ?? passThrough) as never,
    supabase: passThrough,
    storage: passThrough,
    stripe: passThrough,
    backgroundCheck: passThrough,
  };
}

async function buildAppWithRoutes(deps: AppDeps) {
  const app = Fastify({ logger: { level: 'fatal' }, disableRequestLogging: true })
    .withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);
  await app.register(authPlugin);
  await app.register(providerProfileRoutes, { prefix: '/v1' });
  return app;
}

const PROVIDER_BABYSITTER: ProviderRow = {
  id: '0193a4b1-0001-7a01-9abc-000000000001',
  uid: 'supabase-uid-babysitter',
  role: 'caregiver',
  categories: ['babysitter'],
  specialty: null,
};

const PROVIDER_TUTOR: ProviderRow = {
  id: '0193a4b1-0002-7a02-9abc-000000000002',
  uid: 'supabase-uid-tutor',
  role: 'caregiver',
  categories: ['tutor'],
  specialty: null,
};

const PROVIDER_SPECIALIST: ProviderRow = {
  id: '0193a4b1-0003-7a03-9abc-000000000003',
  uid: 'supabase-uid-specialist',
  role: 'provider',
  categories: null,
  specialty: 'ot',
};

/**
 * Mint a supply token whose role/categories/specialty mirror the given provider
 * fixture, so the `roles: ['caregiver','provider']` guard sees the right role.
 * Eligibility itself is derived from the DB provider row, not the token.
 */
async function tokenFor(provider: ProviderRow): Promise<string> {
  const appMetadata: Record<string, unknown> = { role: provider.role };
  if (provider.role === 'caregiver' && provider.categories) {
    appMetadata.categories = provider.categories;
  }
  if (provider.role === 'provider' && provider.specialty) {
    appMetadata.specialty = provider.specialty;
  }
  return mintAccessToken({
    sub: provider.uid,
    email: `${provider.uid}@example.com`,
    appMetadata,
  });
}

describe('GET /v1/providers/me/profile', () => {
  beforeEach(() => resetEnvForTests());

  it('401s without a bearer token', async () => {
    const { db } = makeDbStub({});
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const res = await app.inject({ method: 'GET', url: '/v1/providers/me/profile' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('403s when the JWT carries a non-provider role', async () => {
    const { db } = makeDbStub({});
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await mintAccessToken({
        sub: 'parent-uid',
        appMetadata: { role: 'parent' },
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('404s when no Provider row exists for the authenticated user', async () => {
    const { db } = makeDbStub({ provider: null });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      // Valid supply token (passes the role guard) but no provider row in the DB.
      const token = await mintAccessToken({
        sub: 'orphan-uid',
        email: 'orphan-uid@example.com',
        appMetadata: { role: 'caregiver', categories: ['babysitter'] },
      });
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns a fresh empty profile + flags the caregiver babysitter as W-10 + surcharge eligible', async () => {
    const { db } = makeDbStub({ provider: PROVIDER_BABYSITTER });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await tokenFor(PROVIDER_BABYSITTER);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.providerId).toBe(PROVIDER_BABYSITTER.id);
      expect(body.role).toBe('caregiver');
      expect(body.categories).toEqual(['babysitter']);
      expect(body.rateUnit).toBe('hour');
      expect(body.multiChildSurchargeEligible).toBe(true);
      expect(body.w10Eligible).toBe(true);
      expect(body.publishedRateCents).toBeNull();
      expect(body.availabilityGrid).toEqual({});
      expect(body.paused).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('flags a Tutor as ineligible for surcharge + W-10', async () => {
    const { db } = makeDbStub({ provider: PROVIDER_TUTOR });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await tokenFor(PROVIDER_TUTOR);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rateUnit).toBe('hour');
      expect(body.multiChildSurchargeEligible).toBe(false);
      expect(body.w10Eligible).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('reports per-session rate unit for Provider (clinical)', async () => {
    const { db } = makeDbStub({ provider: PROVIDER_SPECIALIST });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await tokenFor(PROVIDER_SPECIALIST);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rateUnit).toBe('session');
      expect(body.multiChildSurchargeEligible).toBe(false);
      expect(body.w10Eligible).toBe(false);
      expect(body.specialty).toBe('ot');
    } finally {
      await app.close();
    }
  });

  it('omits the state-registered home-childcare badge when no decision exists', async () => {
    const { db } = makeDbStub({ provider: PROVIDER_BABYSITTER });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await tokenFor(PROVIDER_BABYSITTER);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().stateRegisteredHomeChildcareBadge).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('omits the badge when the registration was rejected', async () => {
    const { db } = makeDbStub({
      provider: PROVIDER_BABYSITTER,
      homeChildcareRegistration: {
        state_at_upload: 'FL',
        decision: 'rejected',
        decision_at: new Date('2026-05-20T10:00:00Z'),
      },
    });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await tokenFor(PROVIDER_BABYSITTER);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().stateRegisteredHomeChildcareBadge).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('surfaces the badge with the FL agency name + verifiedAt when verified', async () => {
    const verifiedAt = new Date('2026-05-20T10:00:00Z');
    const { db } = makeDbStub({
      provider: PROVIDER_BABYSITTER,
      homeChildcareRegistration: {
        state_at_upload: 'FL',
        decision: 'verified',
        decision_at: verifiedAt,
      },
    });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await tokenFor(PROVIDER_BABYSITTER);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const badge = res.json().stateRegisteredHomeChildcareBadge;
      expect(badge).not.toBeNull();
      expect(badge.state).toBe('FL');
      expect(badge.agencyName).toMatch(/Florida/);
      expect(badge.programName).toMatch(/Family Child Care/i);
      expect(badge.verifiedAt).toBe(verifiedAt.toISOString());
    } finally {
      await app.close();
    }
  });

  it('omits the badge for an ineligible Provider (Tutor) even if a verified row exists', async () => {
    const { db } = makeDbStub({
      provider: PROVIDER_TUTOR,
      homeChildcareRegistration: {
        state_at_upload: 'FL',
        decision: 'verified',
        decision_at: new Date('2026-05-20T10:00:00Z'),
      },
    });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await tokenFor(PROVIDER_TUTOR);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().stateRegisteredHomeChildcareBadge).toBeNull();
    } finally {
      await app.close();
    }
  });
});

describe('PATCH /v1/providers/me/profile', () => {
  beforeEach(() => resetEnvForTests());

  it('persists rate + availability grid + note + paused for a Babysitter', async () => {
    const { db, updateSpy, getProfile } = makeDbStub({ provider: PROVIDER_BABYSITTER });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await tokenFor(PROVIDER_BABYSITTER);
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          displayName: 'Maya G.',
          headline: 'Babysitter — evenings + weekends',
          bio: 'Nine years with toddlers and pre-K. CPR + first aid current.',
          publishedRateCents: 2200,
          perChildSurchargeCents: 500,
          w10TaxCreditFriendly: true,
          availabilityGrid: {
            mon: { evening: true },
            tue: { evening: true },
            wed: { evening: true, morning: false },
            sat: { morning: true, afternoon: true, evening: true },
          },
          availabilityNote: 'Last-minute weekends OK.',
          paused: false,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.displayName).toBe('Maya G.');
      expect(body.publishedRateCents).toBe(2200);
      expect(body.perChildSurchargeCents).toBe(500);
      expect(body.w10TaxCreditFriendly).toBe(true);
      // Grid is normalised — false cells dropped, empty days removed.
      expect(body.availabilityGrid).toEqual({
        mon: { evening: true },
        tue: { evening: true },
        wed: { evening: true },
        sat: { morning: true, afternoon: true, evening: true },
      });
      expect(updateSpy).toHaveBeenCalled();
      expect(getProfile()?.published_rate_cents).toBe(2200);
    } finally {
      await app.close();
    }
  });

  it('400s when a Tutor tries to set per-child surcharge', async () => {
    const { db, updateSpy } = makeDbStub({ provider: PROVIDER_TUTOR });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await tokenFor(PROVIDER_TUTOR);
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
        payload: { perChildSurchargeCents: 500 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('per_child_surcharge_not_eligible');
      expect(updateSpy).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('400s when a Provider (clinical) tries to set W-10 = true', async () => {
    const { db, updateSpy } = makeDbStub({ provider: PROVIDER_SPECIALIST });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await tokenFor(PROVIDER_SPECIALIST);
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
        payload: { w10TaxCreditFriendly: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('w10_not_eligible');
      expect(updateSpy).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('400s when availability note exceeds 200 chars', async () => {
    const { db } = makeDbStub({ provider: PROVIDER_BABYSITTER });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await tokenFor(PROVIDER_BABYSITTER);
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
        payload: { availabilityNote: 'x'.repeat(201) },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('400s when rate is negative', async () => {
    const { db } = makeDbStub({ provider: PROVIDER_BABYSITTER });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await tokenFor(PROVIDER_BABYSITTER);
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
        payload: { publishedRateCents: -1 },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('allows a Provider (clinical) to set a per-session rate and toggle paused', async () => {
    const { db, getProfile } = makeDbStub({ provider: PROVIDER_SPECIALIST });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await tokenFor(PROVIDER_SPECIALIST);
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
        payload: { publishedRateCents: 12000, paused: true },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.publishedRateCents).toBe(12000);
      expect(body.paused).toBe(true);
      expect(body.rateUnit).toBe('session');
      expect(getProfile()?.paused).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('rejects unknown fields (strict body schema)', async () => {
    const { db } = makeDbStub({ provider: PROVIDER_BABYSITTER });
    const app = await buildAppWithRoutes(makeDeps({ db }));
    try {
      const token = await tokenFor(PROVIDER_BABYSITTER);
      const res = await app.inject({
        method: 'PATCH',
        url: '/v1/providers/me/profile',
        headers: { authorization: `Bearer ${token}` },
        payload: { hijackedField: 'oops' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
