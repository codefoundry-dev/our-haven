import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createCheckrAdapter } from './checkr.ts';

const WEBHOOK_SECRET = 'checkr_whsec_test';

function checkrSign(rawBody: string, secret = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** A fetch stub that returns queued JSON responses in order and records calls. */
function fetchStub(responses: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let i = 0;
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[i++] ?? { ok: true, body: {} };
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('createCheckrAdapter — initiateScreening', () => {
  it('creates a candidate then an invitation and returns the report id + action url', async () => {
    const { impl, calls } = fetchStub([
      { body: { id: 'cand_1', invitation_url: 'https://apply.checkr.test/cand_1' } },
      { body: { id: 'inv_1', report_id: 'rep_1', invitation_url: 'https://apply.checkr.test/inv_1' } },
    ]);
    const adapter = createCheckrAdapter({
      apiKey: 'checkr_api_test',
      packageSlug: 'tasker_standard',
      apiBase: 'https://api.checkr.test/v1',
      fetchImpl: impl,
    });

    const result = await adapter.initiateScreening({
      providerId: 'prov-1',
      email: 'cg@example.com',
      firstName: 'Casey',
      lastName: 'Giver',
      state: 'CA',
      correlationId: 'screening-1',
    });

    expect(result).toEqual({
      vendorReportId: 'rep_1',
      candidateActionUrl: 'https://apply.checkr.test/inv_1',
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('https://api.checkr.test/v1/candidates');
    expect(calls[1]!.url).toBe('https://api.checkr.test/v1/invitations');

    const candidateBody = JSON.parse(calls[0]!.init!.body as string);
    expect(candidateBody).toMatchObject({
      first_name: 'Casey',
      last_name: 'Giver',
      email: 'cg@example.com',
      custom_id: 'screening-1',
      work_locations: [{ country: 'US', state: 'CA' }],
    });
    const invitationBody = JSON.parse(calls[1]!.init!.body as string);
    expect(invitationBody).toMatchObject({ candidate_id: 'cand_1', package: 'tasker_standard' });

    // Basic auth header: base64("<apiKey>:")
    const auth = (calls[0]!.init!.headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Basic ${Buffer.from('checkr_api_test:').toString('base64')}`);
  });

  it('falls back to the invitation id when no report_id is present', async () => {
    const { impl } = fetchStub([{ body: { id: 'cand_1' } }, { body: { id: 'inv_1' } }]);
    const adapter = createCheckrAdapter({ apiKey: 'k', packageSlug: 'p', fetchImpl: impl });
    const result = await adapter.initiateScreening({
      providerId: 'p1',
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      state: 'NY',
      correlationId: 'c1',
    });
    expect(result.vendorReportId).toBe('inv_1');
  });

  it('throws when CHECKR_API_KEY is not configured (api host has none)', async () => {
    const adapter = createCheckrAdapter({ webhookSecret: WEBHOOK_SECRET, packageSlug: 'p' });
    await expect(
      adapter.initiateScreening({
        providerId: 'p1',
        email: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
        state: 'NY',
        correlationId: 'c1',
      }),
    ).rejects.toThrow(/CHECKR_API_KEY/);
  });

  it('throws on a non-2xx vendor response', async () => {
    const { impl } = fetchStub([{ ok: false, status: 422, body: { error: 'bad' } }]);
    const adapter = createCheckrAdapter({ apiKey: 'k', packageSlug: 'p', fetchImpl: impl });
    await expect(
      adapter.initiateScreening({
        providerId: 'p1',
        email: 'a@b.com',
        firstName: 'A',
        lastName: 'B',
        state: 'NY',
        correlationId: 'c1',
      }),
    ).rejects.toThrow(/checkr \/candidates failed: 422/);
  });
});

describe('createCheckrAdapter — verifySignature', () => {
  const adapter = createCheckrAdapter({ webhookSecret: WEBHOOK_SECRET, packageSlug: 'p' });
  const raw = JSON.stringify({ id: 'evt', type: 'report.completed' });

  it('accepts a correct HMAC', () => {
    expect(adapter.verifySignature(raw, checkrSign(raw))).toBe(true);
  });

  it('rejects a wrong HMAC', () => {
    expect(adapter.verifySignature(raw, checkrSign(raw, 'other_secret'))).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(adapter.verifySignature(raw, null)).toBe(false);
  });

  it('fails closed when no webhook secret is configured (worker-tick host has none)', () => {
    const noSecret = createCheckrAdapter({ apiKey: 'k', packageSlug: 'p' });
    expect(noSecret.verifySignature(raw, checkrSign(raw))).toBe(false);
  });
});

describe('createCheckrAdapter — normalizeWebhookEvent', () => {
  const adapter = createCheckrAdapter({ webhookSecret: WEBHOOK_SECRET, packageSlug: 'p' });
  const envelope = (type: string, report: Record<string, unknown>) =>
    JSON.stringify({ id: 'evt', type, created_at: '2026-06-25T10:00:00.000Z', data: { object: report } });

  it('maps report.created/report.pending → initiated', () => {
    expect(adapter.normalizeWebhookEvent(envelope('report.created', { id: 'rep_1' }))).toEqual({
      kind: 'initiated',
      vendorReportId: 'rep_1',
      occurredAt: new Date('2026-06-25T10:00:00.000Z'),
    });
    expect(adapter.normalizeWebhookEvent(envelope('report.pending', { id: 'rep_1' }))?.kind).toBe('initiated');
  });

  it('maps report.completed clear → completed/clear', () => {
    expect(adapter.normalizeWebhookEvent(envelope('report.completed', { id: 'rep_1', status: 'clear' }))).toEqual({
      kind: 'completed',
      vendorReportId: 'rep_1',
      occurredAt: new Date('2026-06-25T10:00:00.000Z'),
      outcome: 'clear',
    });
  });

  it('maps report.completed consider → completed/consider (the rejection path)', () => {
    const ev = adapter.normalizeWebhookEvent(envelope('report.completed', { id: 'rep_1', status: 'consider' }));
    expect(ev).toMatchObject({ kind: 'completed', outcome: 'consider' });
  });

  it('maps report.suspended → completed/suspended', () => {
    const ev = adapter.normalizeWebhookEvent(envelope('report.suspended', { id: 'rep_1' }));
    expect(ev).toMatchObject({ kind: 'completed', outcome: 'suspended' });
  });

  it('maps report.canceled → cancelled', () => {
    const ev = adapter.normalizeWebhookEvent(envelope('report.canceled', { id: 'rep_1' }));
    expect(ev).toMatchObject({ kind: 'cancelled', vendorReportId: 'rep_1' });
  });

  it('returns null for ignored event types, malformed json, and missing report id', () => {
    expect(adapter.normalizeWebhookEvent(envelope('report.upgraded', { id: 'rep_1' }))).toBeNull();
    expect(adapter.normalizeWebhookEvent('not json')).toBeNull();
    expect(adapter.normalizeWebhookEvent(envelope('report.completed', {}))).toBeNull();
  });
});
