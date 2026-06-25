import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createStripeAdapter } from './stripe.ts';

const SECRET = 'sk_test_dummy';
const CONNECT_WEBHOOK_SECRET = 'whsec_connect_dummy';

/** A fetch stub that records calls and returns canned JSON. */
function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  /** The single fetch the adapter method under test is expected to make. */
  const call = () => {
    const c = calls[0];
    if (!c) throw new Error('expected the adapter to make a fetch call');
    return c;
  };
  return { impl, calls, call };
}

/** Decode the form-encoded request body back into a flat map for assertions. */
function formBody(init: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init.body ?? ''));
}

function adapter(fetchImpl: typeof fetch) {
  return createStripeAdapter({
    secretKey: SECRET,
    connectWebhookSecret: CONNECT_WEBHOOK_SECRET,
    apiBase: 'https://api.stripe.test/v1',
    fetchImpl,
  });
}

function signConnect(rawBody: string, secret = CONNECT_WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

describe('createConnectAccount', () => {
  it('requests an Express US individual account with card_payments + transfers and traceback metadata', async () => {
    const { impl, calls, call } = fakeFetch({ id: 'acct_1', charges_enabled: false, payouts_enabled: false, details_submitted: false });
    await adapter(impl).createConnectAccount({
      email: 'cg@example.com',
      providerId: 'prov-1',
      metadata: { uid: 'uid-1', state: 'CA', role: 'caregiver' },
    });

    expect(calls).toHaveLength(1);
    expect(call().url).toBe('https://api.stripe.test/v1/accounts');
    expect(call().init.method).toBe('POST');
    const headers = call().init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);

    const body = formBody(call().init);
    expect(body.get('type')).toBe('express');
    expect(body.get('country')).toBe('US');
    expect(body.get('email')).toBe('cg@example.com');
    expect(body.get('business_type')).toBe('individual');
    expect(body.get('capabilities[card_payments][requested]')).toBe('true');
    expect(body.get('capabilities[transfers][requested]')).toBe('true');
    expect(body.get('metadata[provider_id]')).toBe('prov-1');
    expect(body.get('metadata[purpose]')).toBe('caregiver_connect');
    expect(body.get('metadata[uid]')).toBe('uid-1');
    expect(body.get('metadata[state]')).toBe('CA');
    expect(body.get('metadata[role]')).toBe('caregiver');
  });

  it('throws a readable error on a non-2xx Stripe response', async () => {
    const { impl } = fakeFetch({ error: { message: 'bad' } }, 400);
    await expect(
      adapter(impl).createConnectAccount({ email: 'x@y.z', providerId: 'p' }),
    ).rejects.toThrow(/stripe POST \/accounts failed: 400/);
  });
});

describe('createAccountLink', () => {
  it('posts the account + return/refresh urls + onboarding type', async () => {
    const { impl, call } = fakeFetch({ url: 'https://connect.stripe/onboard', expires_at: 1234 });
    const res = await adapter(impl).createAccountLink({
      accountId: 'acct_1',
      refreshUrl: 'https://app/refresh',
      returnUrl: 'https://app/return',
      type: 'account_onboarding',
    });
    expect(res.url).toBe('https://connect.stripe/onboard');
    const body = formBody(call().init);
    expect(call().url).toBe('https://api.stripe.test/v1/account_links');
    expect(body.get('account')).toBe('acct_1');
    expect(body.get('refresh_url')).toBe('https://app/refresh');
    expect(body.get('return_url')).toBe('https://app/return');
    expect(body.get('type')).toBe('account_onboarding');
  });
});

describe('createLoginLink', () => {
  it('hits the account login_links subresource', async () => {
    const { impl, call } = fakeFetch({ url: 'https://connect.stripe/dash', created: 999 });
    const res = await adapter(impl).createLoginLink('acct_42');
    expect(res.url).toBe('https://connect.stripe/dash');
    expect(call().url).toBe('https://api.stripe.test/v1/accounts/acct_42/login_links');
    expect(call().init.method).toBe('POST');
  });
});

describe('retrieveConnectAccount', () => {
  it('GETs the account by id', async () => {
    const { impl, call } = fakeFetch({ id: 'acct_7', charges_enabled: true, payouts_enabled: true, details_submitted: true });
    const res = await adapter(impl).retrieveConnectAccount('acct_7');
    expect(res.charges_enabled).toBe(true);
    expect(call().url).toBe('https://api.stripe.test/v1/accounts/acct_7');
    expect(call().init.method).toBe('GET');
  });
});

describe('createBookingPaymentIntent — application_fee destination charge', () => {
  it('skims application_fee_amount and routes transfer_data[destination] to the Caregiver account', async () => {
    const { impl, call } = fakeFetch({ id: 'pi_1', client_secret: 'pi_1_secret', status: 'requires_payment_method' });
    // Parent charged $100.00; platform Commission 15% = $15.00 skim.
    const res = await adapter(impl).createBookingPaymentIntent({
      amountCents: 10_000,
      applicationFeeCents: 1_500,
      destinationAccountId: 'acct_cg',
      description: 'Booking bkg-1',
      metadata: { booking_id: 'bkg-1' },
      customerId: 'cus_parent',
    });

    expect(res.id).toBe('pi_1');
    expect(call().url).toBe('https://api.stripe.test/v1/payment_intents');
    const body = formBody(call().init);
    expect(body.get('amount')).toBe('10000');
    expect(body.get('currency')).toBe('usd');
    expect(body.get('application_fee_amount')).toBe('1500');
    expect(body.get('transfer_data[destination]')).toBe('acct_cg');
    expect(body.get('automatic_payment_methods[enabled]')).toBe('true');
    expect(body.get('customer')).toBe('cus_parent');
    expect(body.get('metadata[booking_id]')).toBe('bkg-1');
  });

  it('omits the customer field when no customer is supplied', async () => {
    const { impl, call } = fakeFetch({ id: 'pi_2', client_secret: 's', status: 'x' });
    await adapter(impl).createBookingPaymentIntent({
      amountCents: 5_000,
      applicationFeeCents: 750,
      destinationAccountId: 'acct_cg',
      description: 'd',
      metadata: {},
    });
    expect(formBody(call().init).has('customer')).toBe(false);
  });
});

describe('verifyConnectWebhookSignature', () => {
  const adp = adapter(fakeFetch({}).impl);

  it('accepts a correctly-signed payload', () => {
    const raw = JSON.stringify({ id: 'evt_1', type: 'account.updated' });
    expect(adp.verifyConnectWebhookSignature(raw, signConnect(raw))).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const raw = JSON.stringify({ id: 'evt_1', type: 'account.updated' });
    const header = signConnect(raw);
    expect(adp.verifyConnectWebhookSignature(raw + 'x', header)).toBe(false);
  });

  it('rejects a payload signed with the wrong secret', () => {
    const raw = JSON.stringify({ id: 'evt_1' });
    expect(adp.verifyConnectWebhookSignature(raw, signConnect(raw, 'whsec_wrong'))).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(adp.verifyConnectWebhookSignature('{}', null)).toBe(false);
  });

  it('rejects a stale timestamp beyond tolerance', () => {
    const raw = '{}';
    const stale = Math.floor(Date.now() / 1000) - 10_000;
    expect(adp.verifyConnectWebhookSignature(raw, signConnect(raw, CONNECT_WEBHOOK_SECRET, stale))).toBe(false);
  });
});

describe('parseConnectWebhookEvent', () => {
  const adp = adapter(fakeFetch({}).impl);

  it('parses a well-formed event', () => {
    const raw = JSON.stringify({ id: 'evt_1', type: 'account.updated', created: 1, data: { object: { id: 'acct_1' } } });
    expect(adp.parseConnectWebhookEvent(raw)?.type).toBe('account.updated');
  });

  it('returns null for non-JSON', () => {
    expect(adp.parseConnectWebhookEvent('not json')).toBeNull();
  });

  it('returns null when the object id is missing', () => {
    expect(adp.parseConnectWebhookEvent(JSON.stringify({ type: 'account.updated', data: { object: {} } }))).toBeNull();
  });
});
