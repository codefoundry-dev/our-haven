import { describe, expect, it } from 'vitest';

import { buildApp } from '../app.ts';
import { buildTestEnv } from '../_test/jwt.ts';
import type { AppDeps } from '../deps.ts';

/**
 * Transactional fake for the public Contact-Us intake (OH-191). The route runs a
 * single `db.transaction().execute(cb)` that inserts the intake (returning its
 * id + status) and, when a sales recipient is configured, an outbox row.
 */
function makeDb() {
  const captures = { inserts: [] as Array<{ table: string; values: Record<string, unknown> }> };
  let seq = 0;

  const insertChain = (table: string) => {
    let captured: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      values: (values: Record<string, unknown>) => {
        captured = values;
        captures.inserts.push({ table, values });
        return b;
      },
      returning: () => b,
      returningAll: () => b,
      onConflict: () => b,
      execute: async () => [],
      executeTakeFirstOrThrow: async () => {
        seq += 1;
        return { id: `intake-${seq}`, status: captured.status };
      },
    });
    return b;
  };

  const handle = { insertInto: (table: string) => insertChain(table) };
  const db = {
    ...handle,
    transaction: () => ({ execute: async (cb: (trx: typeof handle) => Promise<unknown>) => cb(handle) }),
  } as unknown as AppDeps['db'];

  return { db, captures };
}

const NOTIFY_UID = '99999999-9999-4999-8999-999999999999';

function makeDeps(opts: { db?: AppDeps['db']; notifyUid?: string } = {}): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return {
    env: buildTestEnv(opts.notifyUid ? { CONTACT_INTAKE_NOTIFY_UID: opts.notifyUid } : {}),
    db: (opts.db ?? stub) as AppDeps['db'],
    supabase: stub,
    stripe: stub,
    backgroundCheck: stub,
  };
}

const URL = '/v1/providers/contact-us';
const postJson = (payload: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

const VALID = {
  organizationName: 'Bright Futures Pediatric Group',
  contactName: 'Dana Ruiz',
  contactEmail: 'dana@brightfutures.example',
  estimatedSeats: 40,
  state: 'ca',
  message: 'We have 40 clinicians across 6 sites.',
};

describe('POST /v1/providers/contact-us', () => {
  it('400 on an invalid payload (missing org, bad email)', async () => {
    const app = buildApp(makeDeps({ db: makeDb().db }));
    expect((await app.request(URL, postJson({ contactName: 'x', contactEmail: 'not-an-email' }))).status).toBe(400);
  });

  it('captures the intake as `new` when no sales recipient is configured', async () => {
    const { db, captures } = makeDb();
    const app = buildApp(makeDeps({ db }));
    const res = await app.request(URL, postJson(VALID));
    expect(res.status).toBe(201);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ status: 'new' });

    const intakeInsert = captures.inserts.find((i) => i.table === 'provider_contact_intakes');
    expect(intakeInsert?.values).toMatchObject({
      organization_name: VALID.organizationName,
      contact_email: VALID.contactEmail,
      state: 'CA', // upper-cased
      status: 'new',
      routed_at: null,
    });
    // No outbox handoff without a recipient.
    expect(captures.inserts.some((i) => i.table === 'notification_outbox')).toBe(false);
  });

  it('routes the intake (status `routed` + outbox row) when a recipient is configured', async () => {
    const { db, captures } = makeDb();
    const app = buildApp(makeDeps({ db, notifyUid: NOTIFY_UID }));
    const res = await app.request(URL, postJson(VALID));
    expect(res.status).toBe(201);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ status: 'routed' });

    const outbox = captures.inserts.find((i) => i.table === 'notification_outbox');
    expect(outbox?.values).toMatchObject({
      recipient_uid: NOTIFY_UID,
      event_type: 'provider_contact_intake.received',
    });
    expect((outbox?.values.payload as Record<string, unknown>).organizationName).toBe(VALID.organizationName);
  });
});
