import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createCheckrAdapter } from '../../../_shared/checkr.ts';
import { buildApp } from '../../app.ts';
import { buildTestEnv } from '../../_test/jwt.ts';
import type { AppDeps } from '../../deps.ts';

const CHECKR_SECRET = 'checkr_whsec_test';

function sign(rawBody: string): string {
  return createHmac('sha256', CHECKR_SECRET).update(rawBody).digest('hex');
}

function makeDb(screening?: Record<string, unknown> | null) {
  const captures = {
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  };
  const selectFrom = (_table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      where: () => chain,
      executeTakeFirst: async () => screening ?? undefined,
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
  return { db: { selectFrom, updateTable } as unknown as AppDeps['db'], captures };
}

function makeDeps(db: AppDeps['db']): AppDeps {
  const stub = new Proxy({} as never, { get: () => stub });
  return {
    env: buildTestEnv(),
    db,
    supabase: stub,
    stripe: stub,
    backgroundCheck: createCheckrAdapter({ webhookSecret: CHECKR_SECRET, packageSlug: 'tasker_standard' }),
    daily: stub,
  };
}

const PATH = '/v1/webhooks/checkr';

function reportEvent(type: string, report: Record<string, unknown>) {
  return JSON.stringify({
    id: 'evt_1',
    type,
    created_at: '2026-06-25T10:00:00.000Z',
    data: { object: report },
  });
}

function postWebhook(body: string, signature: string | null): RequestInit {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature) headers['x-checkr-signature'] = signature;
  return { method: 'POST', headers, body };
}

const ACTIVE_SCREENING = { id: 'screening-1', provider_id: 'prov-1', status: 'in_progress' };

describe('POST /v1/webhooks/checkr', () => {
  it('400 invalid_signature without a signature header', async () => {
    const app = buildApp(makeDeps(makeDb(ACTIVE_SCREENING).db));
    const res = await app.request(PATH, postWebhook(reportEvent('report.completed', { id: 'rep_1', status: 'clear' }), null));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_signature' });
  });

  it('acks 200 and does nothing for an ignored event type', async () => {
    const { db, captures } = makeDb(ACTIVE_SCREENING);
    const app = buildApp(makeDeps(db));
    const raw = reportEvent('report.upgraded', { id: 'rep_1' });
    const res = await app.request(PATH, postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(captures.updates).toHaveLength(0);
  });

  it('acks 200 without writes when no screening row matches the vendor report id', async () => {
    const { db, captures } = makeDb(null);
    const app = buildApp(makeDeps(db));
    const raw = reportEvent('report.completed', { id: 'rep_unknown', status: 'clear' });
    const res = await app.request(PATH, postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(captures.updates).toHaveLength(0);
  });

  it('does not overwrite a terminal screening with a stale/retried event', async () => {
    const { db, captures } = makeDb({ id: 'screening-1', provider_id: 'prov-1', status: 'clear' });
    const app = buildApp(makeDeps(db));
    const raw = reportEvent('report.completed', { id: 'rep_1', status: 'consider' });
    const res = await app.request(PATH, postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(captures.updates).toHaveLength(0);
  });

  it('report.completed clear → marks the row clear and stamps screening_passed_at', async () => {
    const { db, captures } = makeDb(ACTIVE_SCREENING);
    const app = buildApp(makeDeps(db));
    const raw = reportEvent('report.completed', { id: 'rep_1', status: 'clear' });
    const res = await app.request(PATH, postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);

    const screeningSet = captures.updates.find((u) => u.table === 'provider_screenings')!.set;
    expect(screeningSet).toMatchObject({ status: 'clear' });
    expect(screeningSet.raw_payload).toBeTypeOf('object');
    expect(screeningSet.completed_at).toBeInstanceOf(Date);

    const verificationSet = captures.updates.find((u) => u.table === 'provider_verifications')!.set;
    expect(verificationSet.screening_passed_at).toBeInstanceOf(Date);
  });

  it('report.completed consider → marks the row consider and stamps rejected_at + reason', async () => {
    const { db, captures } = makeDb(ACTIVE_SCREENING);
    const app = buildApp(makeDeps(db));
    const raw = reportEvent('report.completed', { id: 'rep_1', status: 'consider' });
    const res = await app.request(PATH, postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);

    const screeningSet = captures.updates.find((u) => u.table === 'provider_screenings')!.set;
    expect(screeningSet).toMatchObject({ status: 'consider' });

    const verificationSet = captures.updates.find((u) => u.table === 'provider_verifications')!.set;
    expect(verificationSet.rejected_at).toBeInstanceOf(Date);
    expect(verificationSet.rejection_reason).toContain('consider');
  });

  it('report.created → marks the row in_progress and stamps screening_initiated_at', async () => {
    const { db, captures } = makeDb({ id: 'screening-1', provider_id: 'prov-1', status: 'payment_succeeded' });
    const app = buildApp(makeDeps(db));
    const raw = reportEvent('report.created', { id: 'rep_1' });
    const res = await app.request(PATH, postWebhook(raw, sign(raw)));
    expect(res.status).toBe(200);

    const screeningSet = captures.updates.find((u) => u.table === 'provider_screenings')!.set;
    expect(screeningSet).toMatchObject({ status: 'in_progress' });

    const verificationSet = captures.updates.find((u) => u.table === 'provider_verifications')!.set;
    expect(verificationSet.screening_initiated_at).toBeInstanceOf(Date);
  });
});
