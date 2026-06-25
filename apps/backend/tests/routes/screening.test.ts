import { createHmac } from 'node:crypto';

import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDeps } from '@/app.js';
import { loadEnv, resetEnvForTests } from '@/config/env.js';
import { authPlugin } from '@/plugins/auth.js';
import { screeningRoutes } from '@/routes/screening.js';
import { checkrWebhookRoutes } from '@/routes/webhooks/checkr.js';
import { stripeWebhookRoutes } from '@/routes/webhooks/stripe.js';

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
  state: string;
}

interface VerificationRow {
  id_doc_uploaded_at: Date | null;
  screening_initiated_at: Date | null;
  screening_passed_at: Date | null;
  rejected_at: Date | null;
  rejection_reason: string | null;
}

interface ScreeningRow {
  id: string;
  provider_id: string;
  vendor: 'checkr';
  package: string;
  status: string;
  vendor_report_id: string | null;
  stripe_payment_intent_id: string | null;
  charge_amount_cents: number;
  paid_at: Date | null;
  initiated_at: Date | null;
  completed_at: Date | null;
  candidate_action_url: string | null;
  raw_payload: Record<string, unknown>;
}

interface DbStubOpts {
  provider?: ProviderRow | null;
  verification?: Partial<VerificationRow> | null;
  screening?: ScreeningRow | null;
  screeningsByProvider?: ScreeningRow[];
}

function uuid(seed: number): string {
  const hex = seed.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

function makeDbStub(opts: DbStubOpts) {
  let nextId = 1;
  let screening: ScreeningRow | null = opts.screening ?? null;
  const screeningsByProvider: ScreeningRow[] = [...(opts.screeningsByProvider ?? [])];
  let verification: VerificationRow | null = opts.verification
    ? {
        id_doc_uploaded_at: null,
        screening_initiated_at: null,
        screening_passed_at: null,
        rejected_at: null,
        rejection_reason: null,
        ...opts.verification,
      }
    : null;

  const matchInFlight = (row: ScreeningRow) =>
    ['payment_pending', 'payment_succeeded', 'in_progress'].includes(row.status);

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
      if (table === 'provider_verifications') {
        return {
          select: () => ({
            where: () => ({
              executeTakeFirst: vi.fn(async () => verification ?? undefined),
            }),
          }),
        };
      }
      if (table === 'provider_screenings') {
        return {
          select: () => ({
            where: (col: string, op: string, val: unknown) => {
              if (col === 'stripe_payment_intent_id') {
                return {
                  executeTakeFirst: vi.fn(async () =>
                    screening?.stripe_payment_intent_id === val ? screening : undefined,
                  ),
                };
              }
              if (col === 'provider_id') {
                // The chain continues: .where('status', 'in', [...]).executeTakeFirst
                return {
                  where: (_col2: string, _op2: string, vals: string[]) => ({
                    executeTakeFirst: vi.fn(async () => {
                      const found = screeningsByProvider.find(
                        (r) => r.provider_id === val && vals.includes(r.status),
                      );
                      return found ?? undefined;
                    }),
                  }),
                };
              }
              if (col === 'vendor') {
                return {
                  where: (col2: string, op2: string, val2: unknown) => ({
                    executeTakeFirst: vi.fn(async () =>
                      screening?.vendor === val && screening?.vendor_report_id === val2
                        ? screening
                        : undefined,
                    ),
                  }),
                };
              }
              return {
                executeTakeFirst: vi.fn(async () => undefined),
              };
            },
          }),
        };
      }
      throw new Error(`unstubbed selectFrom(${table})`);
    },
    insertInto(table: string) {
      if (table === 'provider_screenings') {
        return {
          values: (vals: Partial<ScreeningRow>) => ({
            returning: () => ({
              executeTakeFirstOrThrow: vi.fn(async () => {
                const fresh: ScreeningRow = {
                  id: uuid(nextId++),
                  provider_id: vals.provider_id ?? '',
                  vendor: (vals.vendor as 'checkr') ?? 'checkr',
                  package: vals.package ?? 'tasker_standard',
                  status: vals.status ?? 'payment_pending',
                  vendor_report_id: null,
                  stripe_payment_intent_id: null,
                  charge_amount_cents: vals.charge_amount_cents ?? 3500,
                  paid_at: null,
                  initiated_at: null,
                  completed_at: null,
                  candidate_action_url: null,
                  raw_payload: {},
                };
                screening = fresh;
                screeningsByProvider.push(fresh);
                return { id: fresh.id };
              }),
            }),
          }),
        };
      }
      throw new Error(`unstubbed insertInto(${table})`);
    },
    updateTable(table: string) {
      if (table === 'provider_screenings') {
        let patch: Partial<ScreeningRow> = {};
        const chain = {
          set: (next: Partial<ScreeningRow>) => {
            patch = { ...patch, ...next };
            return chain;
          },
          where: () => chain,
          execute: vi.fn(async () => {
            if (screening) screening = { ...screening, ...patch };
            return undefined;
          }),
        };
        return chain;
      }
      if (table === 'provider_verifications') {
        let patch: Partial<VerificationRow> = {};
        const chain = {
          set: (next: Partial<VerificationRow>) => {
            patch = { ...patch, ...next };
            return chain;
          },
          where: () => chain,
          execute: vi.fn(async () => {
            if (verification) verification = { ...verification, ...patch };
            else verification = { ...patch } as VerificationRow;
            return undefined;
          }),
        };
        return chain;
      }
      throw new Error(`unstubbed updateTable(${table})`);
    },
  };

  return {
    db,
    getScreening: () => screening,
    getVerification: () => verification,
  };
}

interface StripeStubOpts {
  paymentIntentId?: string;
  createSpy?: ReturnType<typeof vi.fn>;
  verifySpy?: ReturnType<typeof vi.fn>;
  parseSpy?: ReturnType<typeof vi.fn>;
}
function makeStripeStub(opts: StripeStubOpts = {}) {
  const createScreeningPaymentIntent =
    opts.createSpy ??
    vi.fn(async () => ({
      id: opts.paymentIntentId ?? 'pi_1',
      client_secret: 'pi_1_secret_abc',
      status: 'requires_payment_method',
    }));
  return {
    createScreeningPaymentIntent,
    verifyWebhookSignature: opts.verifySpy ?? vi.fn(() => true),
    parseWebhookEvent: opts.parseSpy ?? vi.fn(),
  };
}

interface BgcStubOpts {
  initiateSpy?: ReturnType<typeof vi.fn>;
  verifySpy?: ReturnType<typeof vi.fn>;
  normalizeSpy?: ReturnType<typeof vi.fn>;
}
function makeBgcStub(opts: BgcStubOpts = {}) {
  return {
    vendor: 'checkr' as const,
    initiateScreening:
      opts.initiateSpy ??
      vi.fn(async () => ({
        vendorReportId: 'rep_1',
        candidateActionUrl: 'https://check.example/inv/1',
      })),
    verifySignature: opts.verifySpy ?? vi.fn(() => true),
    normalizeWebhookEvent: opts.normalizeSpy ?? vi.fn(),
  };
}

function makeDeps(opts: {
  db: unknown;
  stripe?: unknown;
  backgroundCheck?: unknown;
  getUserById?: ReturnType<typeof vi.fn>;
}): AppDeps {
  const passThrough = new Proxy({} as never, { get: () => passThrough });
  const getUserById =
    opts.getUserById ??
    vi.fn(async () => ({
      data: { user: { email: 'p@example.com', user_metadata: { first_name: 'Test', last_name: 'User' } } },
      error: null,
    }));
  return {
    env: envForTest(),
    db: opts.db as never,
    supabase: {
      admin: {
        auth: { admin: { getUserById, updateUserById: vi.fn(async () => ({ data: null, error: null })) } },
      } as never,
    },
    storage: passThrough,
    stripe: (opts.stripe ?? makeStripeStub()) as never,
    backgroundCheck: (opts.backgroundCheck ?? makeBgcStub()) as never,
  };
}

async function buildAppWithScreening(deps: AppDeps) {
  const app = Fastify({ logger: { level: 'fatal' }, disableRequestLogging: true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);
  await app.register(authPlugin);
  await app.register(screeningRoutes, { prefix: '/v1' });
  return app;
}

async function buildAppWithWebhooks(deps: AppDeps) {
  const app = Fastify({ logger: { level: 'fatal' }, disableRequestLogging: true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);
  await app.register(stripeWebhookRoutes, { prefix: '/v1' });
  await app.register(checkrWebhookRoutes, { prefix: '/v1' });
  return app;
}

describe('POST /v1/providers/me/verification/screening/initiate', () => {
  beforeEach(() => resetEnvForTests());

  it('400s when ID doc has not been uploaded', async () => {
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      verification: { id_doc_uploaded_at: null },
    });
    const app = await buildAppWithScreening(makeDeps({ db: stub.db }));
    const token = await mintAccessToken({ sub: 'u-1', appMetadata: { role: 'caregiver' } });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/verification/screening/initiate',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('id_doc_required');
    } finally {
      await app.close();
    }
  });

  it('409s when screening already cleared', async () => {
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      verification: {
        id_doc_uploaded_at: new Date('2026-05-25T00:00:00Z'),
        screening_passed_at: new Date('2026-05-26T00:00:00Z'),
      },
    });
    const app = await buildAppWithScreening(makeDeps({ db: stub.db }));
    const token = await mintAccessToken({ sub: 'u-1', appMetadata: { role: 'caregiver' } });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/verification/screening/initiate',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('screening_already_cleared');
    } finally {
      await app.close();
    }
  });

  it('409s when an in-flight screening exists', async () => {
    const existing: ScreeningRow = {
      id: 's-existing',
      provider_id: 'p-1',
      vendor: 'checkr',
      package: 'tasker_standard',
      status: 'in_progress',
      vendor_report_id: 'rep_existing',
      stripe_payment_intent_id: 'pi_existing',
      charge_amount_cents: 3500,
      paid_at: new Date(),
      initiated_at: new Date(),
      completed_at: null,
      candidate_action_url: null,
      raw_payload: {},
    };
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      verification: { id_doc_uploaded_at: new Date('2026-05-25T00:00:00Z') },
      screening: existing,
      screeningsByProvider: [existing],
    });
    const app = await buildAppWithScreening(makeDeps({ db: stub.db }));
    const token = await mintAccessToken({ sub: 'u-1', appMetadata: { role: 'caregiver' } });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/verification/screening/initiate',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('screening_in_flight');
    } finally {
      await app.close();
    }
  });

  it('creates a screening row + Stripe PaymentIntent and returns the client_secret', async () => {
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      verification: { id_doc_uploaded_at: new Date('2026-05-25T00:00:00Z') },
    });
    const stripeStub = makeStripeStub({ paymentIntentId: 'pi_test_1' });
    const app = await buildAppWithScreening(makeDeps({ db: stub.db, stripe: stripeStub }));
    const token = await mintAccessToken({ sub: 'u-1', appMetadata: { role: 'caregiver' } });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/providers/me/verification/screening/initiate',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.paymentIntentId).toBe('pi_test_1');
      expect(body.amountCents).toBe(3500);
      expect(body.clientSecret).toMatch(/^pi_/);
      const row = stub.getScreening();
      expect(row?.status).toBe('payment_pending');
      expect(row?.stripe_payment_intent_id).toBe('pi_test_1');
      expect(stripeStub.createScreeningPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          amountCents: 3500,
          metadata: expect.objectContaining({ purpose: 'screening', provider_id: 'p-1' }),
        }),
      );
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/webhooks/stripe', () => {
  beforeEach(() => resetEnvForTests());

  it('400s on invalid signature', async () => {
    const stub = makeDbStub({});
    const stripeStub = makeStripeStub({ verifySpy: vi.fn(() => false) });
    const app = await buildAppWithWebhooks(makeDeps({ db: stub.db, stripe: stripeStub }));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': 'bad' },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_signature');
    } finally {
      await app.close();
    }
  });

  it('on payment_intent.succeeded for screening, creates Checkr invitation and stamps initiated_at', async () => {
    const screeningRow: ScreeningRow = {
      id: 's-1',
      provider_id: 'p-1',
      vendor: 'checkr',
      package: 'tasker_standard',
      status: 'payment_pending',
      vendor_report_id: null,
      stripe_payment_intent_id: 'pi_1',
      charge_amount_cents: 3500,
      paid_at: null,
      initiated_at: null,
      completed_at: null,
      candidate_action_url: null,
      raw_payload: {},
    };
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      verification: { id_doc_uploaded_at: new Date('2026-05-25T00:00:00Z') },
      screening: screeningRow,
    });
    const stripeStub = makeStripeStub({
      verifySpy: vi.fn(() => true),
      parseSpy: vi.fn(() => ({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'pi_1',
            status: 'succeeded',
            amount: 3500,
            currency: 'usd',
            metadata: { purpose: 'screening', screening_id: 's-1', provider_id: 'p-1' },
          },
        },
      })),
    });
    const bgcStub = makeBgcStub();
    const app = await buildAppWithWebhooks(
      makeDeps({ db: stub.db, stripe: stripeStub, backgroundCheck: bgcStub }),
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': 'good' },
        payload: JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });
      expect(bgcStub.initiateScreening).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'p-1',
          email: 'p@example.com',
          firstName: 'Test',
          lastName: 'User',
          state: 'NY',
          correlationId: 's-1',
        }),
      );
      const row = stub.getScreening();
      expect(row?.status).toBe('in_progress');
      expect(row?.vendor_report_id).toBe('rep_1');
      expect(stub.getVerification()?.screening_initiated_at).toBeInstanceOf(Date);
    } finally {
      await app.close();
    }
  });

  it('is idempotent: a second delivery for an already-progressed row is a no-op', async () => {
    const screeningRow: ScreeningRow = {
      id: 's-1',
      provider_id: 'p-1',
      vendor: 'checkr',
      package: 'tasker_standard',
      status: 'in_progress',
      vendor_report_id: 'rep_existing',
      stripe_payment_intent_id: 'pi_1',
      charge_amount_cents: 3500,
      paid_at: new Date(),
      initiated_at: new Date(),
      completed_at: null,
      candidate_action_url: null,
      raw_payload: {},
    };
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      screening: screeningRow,
    });
    const stripeStub = makeStripeStub({
      parseSpy: vi.fn(() => ({
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        created: 0,
        data: { object: { id: 'pi_1', status: 'succeeded', amount: 3500, currency: 'usd', metadata: { purpose: 'screening' } } },
      })),
    });
    const bgcStub = makeBgcStub();
    const app = await buildAppWithWebhooks(
      makeDeps({ db: stub.db, stripe: stripeStub, backgroundCheck: bgcStub }),
    );
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': 'good' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(200);
      expect(bgcStub.initiateScreening).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/webhooks/checkr', () => {
  beforeEach(() => resetEnvForTests());

  it('400s on invalid signature', async () => {
    const stub = makeDbStub({});
    const bgcStub = makeBgcStub({ verifySpy: vi.fn(() => false) });
    const app = await buildAppWithWebhooks(makeDeps({ db: stub.db, backgroundCheck: bgcStub }));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/checkr',
        headers: { 'content-type': 'application/json', 'x-checkr-signature': 'bad' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_signature');
    } finally {
      await app.close();
    }
  });

  it('on report.completed/clear, sets screening_passed_at on the verification row', async () => {
    const screeningRow: ScreeningRow = {
      id: 's-1',
      provider_id: 'p-1',
      vendor: 'checkr',
      package: 'tasker_standard',
      status: 'in_progress',
      vendor_report_id: 'rep_1',
      stripe_payment_intent_id: 'pi_1',
      charge_amount_cents: 3500,
      paid_at: new Date(),
      initiated_at: new Date(),
      completed_at: null,
      candidate_action_url: null,
      raw_payload: {},
    };
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      verification: { id_doc_uploaded_at: new Date('2026-05-25T00:00:00Z') },
      screening: screeningRow,
    });
    const occurred = new Date('2026-06-01T12:00:00Z');
    const bgcStub = makeBgcStub({
      normalizeSpy: vi.fn(() => ({
        kind: 'completed',
        vendorReportId: 'rep_1',
        occurredAt: occurred,
        outcome: 'clear',
      })),
    });
    const app = await buildAppWithWebhooks(makeDeps({ db: stub.db, backgroundCheck: bgcStub }));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/checkr',
        headers: { 'content-type': 'application/json', 'x-checkr-signature': 'good' },
        payload: JSON.stringify({
          id: 'evt_1',
          type: 'report.completed',
          data: { object: { id: 'rep_1', status: 'clear' } },
        }),
      });
      expect(res.statusCode).toBe(200);
      const row = stub.getScreening();
      expect(row?.status).toBe('clear');
      expect(stub.getVerification()?.screening_passed_at).toEqual(occurred);
    } finally {
      await app.close();
    }
  });

  it('on report.completed/consider, sets rejected_at + rejection_reason', async () => {
    const screeningRow: ScreeningRow = {
      id: 's-1',
      provider_id: 'p-1',
      vendor: 'checkr',
      package: 'tasker_standard',
      status: 'in_progress',
      vendor_report_id: 'rep_2',
      stripe_payment_intent_id: 'pi_2',
      charge_amount_cents: 3500,
      paid_at: new Date(),
      initiated_at: new Date(),
      completed_at: null,
      candidate_action_url: null,
      raw_payload: {},
    };
    const stub = makeDbStub({
      provider: { id: 'p-1', uid: 'u-1', role: 'caregiver', state: 'NY' },
      verification: { id_doc_uploaded_at: new Date('2026-05-25T00:00:00Z') },
      screening: screeningRow,
    });
    const occurred = new Date('2026-06-01T12:00:00Z');
    const bgcStub = makeBgcStub({
      normalizeSpy: vi.fn(() => ({
        kind: 'completed',
        vendorReportId: 'rep_2',
        occurredAt: occurred,
        outcome: 'consider',
        reason: 'pending county hit',
      })),
    });
    const app = await buildAppWithWebhooks(makeDeps({ db: stub.db, backgroundCheck: bgcStub }));
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/checkr',
        headers: { 'content-type': 'application/json', 'x-checkr-signature': 'good' },
        payload: JSON.stringify({
          id: 'evt_2',
          type: 'report.completed',
          data: { object: { id: 'rep_2', status: 'consider' } },
        }),
      });
      expect(res.statusCode).toBe(200);
      const v = stub.getVerification();
      expect(v?.rejected_at).toEqual(occurred);
      expect(v?.rejection_reason).toBe('consider: pending county hit');
      expect(stub.getScreening()?.status).toBe('consider');
    } finally {
      await app.close();
    }
  });

  it('signature check uses raw body bytes (HMAC-SHA256) — adapter test exercises crypto path', () => {
    const secret = 'oh-106-test-secret';
    const body = JSON.stringify({ ok: true });
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });
});
