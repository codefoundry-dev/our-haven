import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv, mintAccessToken } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

interface DbFixtures {
  provider?: Record<string, unknown> | null;
  verification?: Record<string, unknown> | null;
  inFlight?: Record<string, unknown> | null;
  insertedId?: string;
}

function makeDb(opts: DbFixtures = {}) {
  const captures = {
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  };
  const selectFrom = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      where: () => chain,
      executeTakeFirst: async () => {
        if (table === 'providers') return opts.provider ?? undefined;
        if (table === 'provider_verifications') return opts.verification ?? undefined;
        if (table === 'provider_screenings') return opts.inFlight ?? undefined;
        return undefined;
      },
    };
    return chain;
  };
  const insertInto = (table: string) => {
    const chain: Record<string, unknown> = {
      values: (values: Record<string, unknown>) => {
        captures.inserts.push({ table, values });
        return chain;
      },
      returning: () => chain,
      executeTakeFirstOrThrow: async () => ({ id: opts.insertedId ?? 'screening-new' }),
    };
    return chain;
  };
  const updateTable = (table: string) => {
    const chain: Record<string, unknown> = {
      set: (set: Record<string, unknown>) => {
        captures.updates.push({ table, set });
        return chain;
      },
      where: () => chain,
      execute: async () => [],
    };
    return chain;
  };
  return { db: { selectFrom, insertInto, updateTable } as unknown as AppDeps['db'], captures };
}

function makeDeps(db: AppDeps['db'], stripe?: Partial<AppDeps['stripe']>): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return {
    env: buildTestEnv(),
    db,
    supabase: stub,
    stripe: (stripe ?? stub) as AppDeps['stripe'],
    backgroundCheck: stub,
  };
}

const PATH = '/v1/providers/me/verification/screening/initiate';

async function cgToken(uid = 'uid-cg') {
  return mintAccessToken({ sub: uid, email: 'cg@example.com', appMetadata: { role: 'caregiver', categories: ['babysitter'], state: 'CA' } });
}

function post(token: string | null): RequestInit {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method: 'POST', headers };
}

describe('POST /v1/providers/me/verification/screening/initiate', () => {
  it('401 without a bearer token', async () => {
    const app = buildApp(makeDeps(makeDb().db));
    const res = await app.request(PATH, post(null));
    expect(res.status).toBe(401);
  });

  it('403 for a non-supply role', async () => {
    const token = await mintAccessToken({ sub: 'uid-parent', appMetadata: { role: 'parent' } });
    const app = buildApp(makeDeps(makeDb().db));
    const res = await app.request(PATH, post(token));
    expect(res.status).toBe(403);
  });

  it('404 when no provider row exists for the uid', async () => {
    const app = buildApp(makeDeps(makeDb({ provider: null }).db));
    const res = await app.request(PATH, post(await cgToken()));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'provider_not_found' });
  });

  it('400 id_doc_required when the ID upload step is incomplete', async () => {
    const { db } = makeDb({
      provider: { id: 'prov-1', uid: 'uid-cg', role: 'caregiver', state: 'CA' },
      verification: { id_doc_uploaded_at: null, screening_passed_at: null, rejected_at: null },
    });
    const app = buildApp(makeDeps(db));
    const res = await app.request(PATH, post(await cgToken()));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'id_doc_required' });
  });

  it('409 when the Provider has already cleared', async () => {
    const { db } = makeDb({
      provider: { id: 'prov-1', uid: 'uid-cg', role: 'caregiver', state: 'CA' },
      verification: {
        id_doc_uploaded_at: new Date('2026-06-01T00:00:00Z'),
        screening_passed_at: new Date('2026-06-02T00:00:00Z'),
        rejected_at: null,
      },
    });
    const app = buildApp(makeDeps(db));
    const res = await app.request(PATH, post(await cgToken()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'screening_already_cleared' });
  });

  it('409 when verification is already terminated (rejected)', async () => {
    const { db } = makeDb({
      provider: { id: 'prov-1', uid: 'uid-cg', role: 'caregiver', state: 'CA' },
      verification: {
        id_doc_uploaded_at: new Date('2026-06-01T00:00:00Z'),
        screening_passed_at: null,
        rejected_at: new Date('2026-06-02T00:00:00Z'),
      },
    });
    const app = buildApp(makeDeps(db));
    const res = await app.request(PATH, post(await cgToken()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'verification_terminated' });
  });

  it('409 when a screening is already in flight', async () => {
    const { db } = makeDb({
      provider: { id: 'prov-1', uid: 'uid-cg', role: 'caregiver', state: 'CA' },
      verification: {
        id_doc_uploaded_at: new Date('2026-06-01T00:00:00Z'),
        screening_passed_at: null,
        rejected_at: null,
      },
      inFlight: { id: 'screening-old', status: 'in_progress' },
    });
    const app = buildApp(makeDeps(db));
    const res = await app.request(PATH, post(await cgToken()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'screening_in_flight' });
  });

  it('200 creates the screening row + the $35 PaymentIntent and returns the client secret', async () => {
    const { db, captures } = makeDb({
      provider: { id: 'prov-1', uid: 'uid-cg', role: 'caregiver', state: 'CA' },
      verification: {
        id_doc_uploaded_at: new Date('2026-06-01T00:00:00Z'),
        screening_passed_at: null,
        rejected_at: null,
      },
      inFlight: null,
      insertedId: 'screening-1',
    });
    const createScreeningPaymentIntent = vi.fn(async () => ({
      id: 'pi_1',
      client_secret: 'pi_1_secret',
      status: 'requires_payment_method',
    }));
    const app = buildApp(makeDeps(db, { createScreeningPaymentIntent }));

    const res = await app.request(PATH, post(await cgToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      screeningId: 'screening-1',
      clientSecret: 'pi_1_secret',
      paymentIntentId: 'pi_1',
      amountCents: 3500,
    });

    // Screening row inserted in payment_pending with the configured fee + package.
    expect(captures.inserts).toHaveLength(1);
    expect(captures.inserts[0]).toMatchObject({
      table: 'provider_screenings',
      values: { provider_id: 'prov-1', vendor: 'checkr', status: 'payment_pending', charge_amount_cents: 3500 },
    });

    // PaymentIntent tagged so the payments webhook can find the row.
    expect(createScreeningPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 3500,
        metadata: expect.objectContaining({ purpose: 'screening', screening_id: 'screening-1', provider_id: 'prov-1' }),
      }),
    );

    // The PI id is written back onto the row.
    expect(captures.updates).toHaveLength(1);
    expect(captures.updates[0]).toMatchObject({
      table: 'provider_screenings',
      set: { stripe_payment_intent_id: 'pi_1' },
    });
  });
});
