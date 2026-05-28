import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createCheckrAdapter } from '@/vendors/checkr.js';

const CFG = {
  apiKey: 'test-checkr-key',
  webhookSecret: 'test-checkr-secret',
  packageSlug: 'tasker_standard',
};

function sign(body: string, secret = CFG.webhookSecret): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('CheckrAdapter.verifySignature', () => {
  it('accepts a correctly HMAC-signed body', () => {
    const adapter = createCheckrAdapter(CFG);
    const body = JSON.stringify({ id: 'evt_1', type: 'report.completed' });
    expect(adapter.verifySignature(body, sign(body))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const adapter = createCheckrAdapter(CFG);
    const body = JSON.stringify({ id: 'evt_1', type: 'report.completed' });
    const tampered = body + ' ';
    expect(adapter.verifySignature(tampered, sign(body))).toBe(false);
  });

  it('rejects when the header is missing', () => {
    const adapter = createCheckrAdapter(CFG);
    expect(adapter.verifySignature('{}', null)).toBe(false);
  });

  it('rejects when signed with the wrong secret', () => {
    const adapter = createCheckrAdapter(CFG);
    const body = '{"id":"evt_1"}';
    expect(adapter.verifySignature(body, sign(body, 'other-secret'))).toBe(false);
  });
});

describe('CheckrAdapter.normalizeWebhookEvent', () => {
  const adapter = createCheckrAdapter(CFG);

  it('maps report.completed/status=clear to a clear completion', () => {
    const body = JSON.stringify({
      id: 'evt_1',
      type: 'report.completed',
      created_at: '2026-06-01T12:00:00Z',
      data: { object: { id: 'rep_1', status: 'clear' } },
    });
    expect(adapter.normalizeWebhookEvent(body)).toEqual({
      kind: 'completed',
      vendorReportId: 'rep_1',
      occurredAt: new Date('2026-06-01T12:00:00Z'),
      outcome: 'clear',
    });
  });

  it('maps report.completed/status=consider to a consider completion', () => {
    const body = JSON.stringify({
      id: 'evt_2',
      type: 'report.completed',
      created_at: '2026-06-01T12:00:00Z',
      data: { object: { id: 'rep_2', status: 'consider' } },
    });
    const result = adapter.normalizeWebhookEvent(body);
    expect(result).toMatchObject({ kind: 'completed', outcome: 'consider', vendorReportId: 'rep_2' });
  });

  it('maps report.suspended to a suspended completion', () => {
    const body = JSON.stringify({
      id: 'evt_3',
      type: 'report.suspended',
      created_at: '2026-06-01T12:00:00Z',
      data: { object: { id: 'rep_3' } },
    });
    expect(adapter.normalizeWebhookEvent(body)).toMatchObject({
      kind: 'completed',
      outcome: 'suspended',
      vendorReportId: 'rep_3',
    });
  });

  it('maps report.created to initiated', () => {
    const body = JSON.stringify({
      id: 'evt_4',
      type: 'report.created',
      created_at: '2026-06-01T12:00:00Z',
      data: { object: { id: 'rep_4' } },
    });
    expect(adapter.normalizeWebhookEvent(body)).toMatchObject({
      kind: 'initiated',
      vendorReportId: 'rep_4',
    });
  });

  it('returns null for unknown event types', () => {
    const body = JSON.stringify({
      id: 'evt_5',
      type: 'candidate.created',
      data: { object: { id: 'cand_1' } },
    });
    expect(adapter.normalizeWebhookEvent(body)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(adapter.normalizeWebhookEvent('not-json')).toBeNull();
  });
});

describe('CheckrAdapter.initiateScreening', () => {
  it('calls candidates + invitations and returns the report id + invitation url', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'cand_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'inv_1', report_id: 'rep_1', invitation_url: 'https://check.example/inv/1' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const adapter = createCheckrAdapter({ ...CFG, fetchImpl });

    const result = await adapter.initiateScreening({
      providerId: 'p-1',
      email: 'p@example.com',
      firstName: 'Test',
      lastName: 'User',
      state: 'NY',
      correlationId: 'screening-1',
    });

    expect(result).toEqual({
      vendorReportId: 'rep_1',
      candidateActionUrl: 'https://check.example/inv/1',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [candidateUrl, candidateInit] = fetchImpl.mock.calls[0]!;
    expect(candidateUrl).toMatch(/\/candidates$/);
    expect(JSON.parse(String(candidateInit?.body ?? ''))).toMatchObject({
      first_name: 'Test',
      last_name: 'User',
      email: 'p@example.com',
      custom_id: 'screening-1',
      work_locations: [{ country: 'US', state: 'NY' }],
    });
    const [invitationUrl, invitationInit] = fetchImpl.mock.calls[1]!;
    expect(invitationUrl).toMatch(/\/invitations$/);
    expect(JSON.parse(String(invitationInit?.body ?? ''))).toMatchObject({
      candidate_id: 'cand_1',
      package: 'tasker_standard',
    });
  });

  it('throws when the vendor returns a non-2xx response', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"error":"unauthorized"}', { status: 401 }));
    const adapter = createCheckrAdapter({ ...CFG, fetchImpl });
    await expect(
      adapter.initiateScreening({
        providerId: 'p-1',
        email: 'p@example.com',
        firstName: 'T',
        lastName: 'U',
        state: 'NY',
        correlationId: 'screening-1',
      }),
    ).rejects.toThrow(/checkr/i);
  });
});
