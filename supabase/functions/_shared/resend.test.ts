import { describe, expect, it, vi } from 'vitest';

import { createResendAdapter } from './resend.ts';

function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const call = () => {
    const c = calls[0];
    if (!c) throw new Error('expected the adapter to make a fetch call');
    return c;
  };
  return { impl, call };
}

const CONFIG = { apiKey: 're_test', from: 'Our Haven <notifications@ourhaven.com>' };

describe('createResendAdapter', () => {
  it('POSTs to the Resend endpoint with Bearer auth + plain-text body', async () => {
    const { impl, call } = fakeFetch({ id: 'email-1' });
    const result = await createResendAdapter({ ...CONFIG, fetchImpl: impl }).sendEmail({
      to: 'cg@example.com',
      subject: 'New booking request',
      text: 'Alex sent a booking request.',
    });

    expect(call().url).toBe('https://api.resend.com/emails');
    const headers = call().init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test');
    const body = JSON.parse(String(call().init.body));
    expect(body).toMatchObject({
      from: CONFIG.from,
      to: 'cg@example.com',
      subject: 'New booking request',
      text: 'Alex sent a booking request.',
    });
    expect(result).toEqual({ id: 'email-1' });
  });

  it('maps + sanitises tags (Resend allows only [A-Za-z0-9_-])', async () => {
    const { impl, call } = fakeFetch({ id: 'email-2' });
    await createResendAdapter({ ...CONFIG, fetchImpl: impl }).sendEmail({
      to: 'x@y.com',
      subject: 's',
      text: 't',
      tags: [
        { name: 'event_kind', value: 'booking_request_received' },
        { name: 'dispatch_id', value: 'screening.invite:abc' },
      ],
    });

    const body = JSON.parse(String(call().init.body));
    expect(body.tags).toEqual([
      { name: 'event_kind', value: 'booking_request_received' },
      { name: 'dispatch_id', value: 'screening_invite_abc' },
    ]);
  });

  it('throws on a non-2xx response', async () => {
    const { impl } = fakeFetch({ name: 'validation_error', message: 'bad from' }, 422);
    await expect(
      createResendAdapter({ ...CONFIG, fetchImpl: impl }).sendEmail({ to: 'x@y.com', subject: 's', text: 't' }),
    ).rejects.toThrow(/resend send failed: 422/);
  });

  it('throws when the response carries no id', async () => {
    const { impl } = fakeFetch({}, 200);
    await expect(
      createResendAdapter({ ...CONFIG, fetchImpl: impl }).sendEmail({ to: 'x@y.com', subject: 's', text: 't' }),
    ).rejects.toThrow(/resend send failed/);
  });
});
