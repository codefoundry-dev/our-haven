import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import { createTwilioAdapter } from './twilio.ts';

function fakeFetch(body: unknown, status = 201) {
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
  return { impl, calls, call };
}

const CONFIG = { accountSid: 'AC123', authToken: 'secret', fromNumber: '+19123013104' };

describe('createTwilioAdapter', () => {
  it('POSTs form-encoded to the account Messages endpoint with Basic auth', async () => {
    const { impl, call } = fakeFetch({ sid: 'SM1' });
    const result = await createTwilioAdapter({ ...CONFIG, fetchImpl: impl }).sendSms({
      to: '+15551230000',
      body: 'Our Haven: a booking request. Open: ourhaven://x',
    });

    expect(call().url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    const headers = call().init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('AC123:secret').toString('base64')}`);

    const form = new URLSearchParams(String(call().init.body));
    expect(form.get('To')).toBe('+15551230000');
    expect(form.get('From')).toBe('+19123013104');
    expect(form.get('Body')).toContain('Our Haven:');
    expect(result).toEqual({ sid: 'SM1' });
  });

  it('throws on a Twilio error response (the SMS-mandatory row retries)', async () => {
    const { impl } = fakeFetch({ code: 21211, message: 'Invalid To number' }, 400);
    await expect(
      createTwilioAdapter({ ...CONFIG, fetchImpl: impl }).sendSms({ to: 'bad', body: 'x' }),
    ).rejects.toThrow(/twilio send failed: 400 21211/);
  });

  it('throws when misconfigured (no From number)', async () => {
    const { impl, calls } = fakeFetch({ sid: 'SM1' });
    await expect(
      createTwilioAdapter({ accountSid: 'AC', authToken: 't', fromNumber: '', fetchImpl: impl }).sendSms({
        to: '+1',
        body: 'x',
      }),
    ).rejects.toThrow(/From number required/);
    expect(calls).toHaveLength(0);
  });
});
