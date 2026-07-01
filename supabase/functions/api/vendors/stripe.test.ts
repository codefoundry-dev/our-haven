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

  it('authorizes with manual capture, the saved card, confirm + interactive (on-session) flags', async () => {
    const { impl, call } = fakeFetch({ id: 'pi_3', client_secret: 'pi_3_secret', status: 'requires_capture' });
    const res = await adapter(impl).createBookingPaymentIntent({
      amountCents: 8_000,
      applicationFeeCents: 1_200,
      destinationAccountId: 'acct_cg',
      description: 'Booking bkg-3',
      metadata: { booking_id: 'bkg-3', purpose: 'booking' },
      customerId: 'cus_parent',
      paymentMethodId: 'pm_saved',
      confirm: true,
      idempotencyKey: 'booking:authorize:bkg-3',
    });
    expect(res.status).toBe('requires_capture');
    const body = formBody(call().init);
    expect(body.get('capture_method')).toBe('manual');
    expect(body.get('payment_method')).toBe('pm_saved');
    expect(body.get('confirm')).toBe('true');
    // interactive (on-session) — no off_session / allow_redirects restriction
    expect(body.has('off_session')).toBe(false);
    expect(body.has('automatic_payment_methods[allow_redirects]')).toBe(false);
    const headers = call().init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('booking:authorize:bkg-3');
  });

  it('off-session authorize forbids redirect-based methods', async () => {
    const { impl, call } = fakeFetch({ id: 'pi_4', client_secret: 's', status: 'requires_capture' });
    await adapter(impl).createBookingPaymentIntent({
      amountCents: 8_000,
      applicationFeeCents: 1_200,
      destinationAccountId: 'acct_cg',
      description: 'd',
      metadata: {},
      customerId: 'cus_parent',
      paymentMethodId: 'pm_saved',
      confirm: true,
      offSession: true,
    });
    const body = formBody(call().init);
    expect(body.get('off_session')).toBe('true');
    expect(body.get('automatic_payment_methods[allow_redirects]')).toBe('never');
  });

  it('translates an off-session authentication_required 402 into a requires_action result', async () => {
    const { impl } = fakeFetch(
      { error: { code: 'authentication_required', payment_intent: { id: 'pi_5', client_secret: 'pi_5_secret', status: 'requires_action' } } },
      402,
    );
    const res = await adapter(impl).createBookingPaymentIntent({
      amountCents: 8_000,
      applicationFeeCents: 1_200,
      destinationAccountId: 'acct_cg',
      description: 'd',
      metadata: {},
      customerId: 'cus_parent',
      paymentMethodId: 'pm_saved',
      confirm: true,
      offSession: true,
    });
    expect(res.id).toBe('pi_5');
    expect(res.status).toBe('requires_action');
    expect(res.client_secret).toBe('pi_5_secret');
  });

  it('throws on a hard decline (no embedded payment_intent to recover)', async () => {
    const { impl } = fakeFetch({ error: { code: 'card_declined', message: 'Your card was declined.' } }, 402);
    await expect(
      adapter(impl).createBookingPaymentIntent({
        amountCents: 8_000,
        applicationFeeCents: 1_200,
        destinationAccountId: 'acct_cg',
        description: 'd',
        metadata: {},
        customerId: 'cus_parent',
        paymentMethodId: 'pm_bad',
        confirm: true,
      }),
    ).rejects.toThrow(/stripe POST \/payment_intents failed: 402/);
  });
});

describe('booking payment lifecycle — capture / cancel / refund / retrieve (OH-211)', () => {
  it('captures a partial amount with a recomputed application_fee + idempotency key', async () => {
    const { impl, call } = fakeFetch({ id: 'pi_1', status: 'succeeded', amount_received: 5_000 });
    const res = await adapter(impl).capturePaymentIntent({
      id: 'pi_1',
      amountToCaptureCents: 5_000,
      applicationFeeCents: 750,
      idempotencyKey: 'booking:capture:bkg-1',
    });
    expect(res.status).toBe('succeeded');
    expect(call().url).toBe('https://api.stripe.test/v1/payment_intents/pi_1/capture');
    expect(call().init.method).toBe('POST');
    const body = formBody(call().init);
    expect(body.get('amount_to_capture')).toBe('5000');
    expect(body.get('application_fee_amount')).toBe('750');
    expect((call().init.headers as Record<string, string>)['Idempotency-Key']).toBe('booking:capture:bkg-1');
  });

  it('captures the full authorized amount when no partial amount is given', async () => {
    const { impl, call } = fakeFetch({ id: 'pi_1', status: 'succeeded' });
    await adapter(impl).capturePaymentIntent({ id: 'pi_1' });
    const body = formBody(call().init);
    expect(body.has('amount_to_capture')).toBe(false);
    expect(body.has('application_fee_amount')).toBe(false);
  });

  it('cancels an uncaptured hold', async () => {
    const { impl, call } = fakeFetch({ id: 'pi_2', status: 'canceled' });
    const res = await adapter(impl).cancelPaymentIntent('pi_2', 'booking:release:bkg-2');
    expect(res.status).toBe('canceled');
    expect(call().url).toBe('https://api.stripe.test/v1/payment_intents/pi_2/cancel');
    expect((call().init.headers as Record<string, string>)['Idempotency-Key']).toBe('booking:release:bkg-2');
  });

  it('refunds a captured PaymentIntent', async () => {
    const { impl, call } = fakeFetch({ id: 're_1', status: 'succeeded', amount: 3_000 });
    const res = await adapter(impl).refundPaymentIntent({ id: 'pi_3', amountCents: 3_000 });
    expect(res.id).toBe('re_1');
    expect(call().url).toBe('https://api.stripe.test/v1/refunds');
    const body = formBody(call().init);
    expect(body.get('payment_intent')).toBe('pi_3');
    expect(body.get('amount')).toBe('3000');
  });

  it('retrieves a PaymentIntent by id', async () => {
    const { impl, call } = fakeFetch({ id: 'pi_4', status: 'requires_capture', amount: 8_000, amount_capturable: 8_000 });
    const res = await adapter(impl).retrievePaymentIntent('pi_4');
    expect(res.amount_capturable).toBe(8_000);
    expect(call().url).toBe('https://api.stripe.test/v1/payment_intents/pi_4');
    expect(call().init.method).toBe('GET');
  });

  it('reads the customer default payment method (string id)', async () => {
    const { impl, call } = fakeFetch({ id: 'cus_1', invoice_settings: { default_payment_method: 'pm_default' } });
    const pm = await adapter(impl).retrieveCustomerDefaultPaymentMethod('cus_1');
    expect(pm).toBe('pm_default');
    expect(call().url).toBe('https://api.stripe.test/v1/customers/cus_1');
  });

  it('reads the customer default payment method (expanded object)', async () => {
    const { impl } = fakeFetch({ id: 'cus_1', invoice_settings: { default_payment_method: { id: 'pm_expanded' } } });
    expect(await adapter(impl).retrieveCustomerDefaultPaymentMethod('cus_1')).toBe('pm_expanded');
  });

  it('returns null when the customer has no default payment method', async () => {
    const { impl } = fakeFetch({ id: 'cus_1', invoice_settings: {} });
    expect(await adapter(impl).retrieveCustomerDefaultPaymentMethod('cus_1')).toBeNull();
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

describe('createParentBillingCustomer (OH-193)', () => {
  it('creates a Customer stamped with the auth uid + parent_subscription purpose', async () => {
    const { impl, call } = fakeFetch({ id: 'cus_par' });
    const res = await adapter(impl).createParentBillingCustomer({ email: 'p@example.com', uid: 'uid-par' });
    expect(res.id).toBe('cus_par');
    expect(call().url).toBe('https://api.stripe.test/v1/customers');
    const body = formBody(call().init);
    expect(body.get('email')).toBe('p@example.com');
    expect(body.get('metadata[uid]')).toBe('uid-par');
    expect(body.get('metadata[purpose]')).toBe('parent_subscription');
  });
});

describe('createParentSubscriptionCheckoutSession (OH-193)', () => {
  const baseInput = {
    customerId: 'cus_par',
    priceId: 'price_par',
    successUrl: 'https://app/ok',
    cancelUrl: 'https://app/no',
    clientReferenceId: 'uid-par',
  };

  it('opens a subscription-mode Checkout stamped with uid + purpose, hosted promo field on by default', async () => {
    const { impl, call } = fakeFetch({ id: 'cs_par', url: 'https://checkout/cs_par' });
    const res = await adapter(impl).createParentSubscriptionCheckoutSession(baseInput);
    expect(res.url).toBe('https://checkout/cs_par');
    expect(call().url).toBe('https://api.stripe.test/v1/checkout/sessions');
    const body = formBody(call().init);
    expect(body.get('mode')).toBe('subscription');
    expect(body.get('customer')).toBe('cus_par');
    expect(body.get('line_items[0][price]')).toBe('price_par');
    expect(body.get('line_items[0][quantity]')).toBe('1');
    expect(body.get('client_reference_id')).toBe('uid-par');
    expect(body.get('subscription_data[metadata][uid]')).toBe('uid-par');
    expect(body.get('subscription_data[metadata][purpose]')).toBe('parent_subscription');
    expect(body.get('metadata[uid]')).toBe('uid-par');
    expect(body.get('metadata[purpose]')).toBe('parent_subscription');
    // PRD story 9: the Parent can type a launch code on the hosted page.
    expect(body.get('allow_promotion_codes')).toBe('true');
    expect(body.has('discounts[0][promotion_code]')).toBe(false);
  });

  it('pre-applies a promotion code and drops the hosted field (mutually exclusive in Stripe)', async () => {
    const { impl, call } = fakeFetch({ id: 'cs_par2', url: 'https://checkout/cs_par2' });
    await adapter(impl).createParentSubscriptionCheckoutSession({ ...baseInput, promotionCode: 'promo_launch' });
    const body = formBody(call().init);
    expect(body.get('discounts[0][promotion_code]')).toBe('promo_launch');
    expect(body.has('allow_promotion_codes')).toBe(false);
  });

  it('suppresses the hosted promo field when allowPromotionCodes is false', async () => {
    const { impl, call } = fakeFetch({ id: 'cs_par3', url: 'https://checkout/cs_par3' });
    await adapter(impl).createParentSubscriptionCheckoutSession({ ...baseInput, allowPromotionCodes: false });
    const body = formBody(call().init);
    expect(body.has('allow_promotion_codes')).toBe(false);
    expect(body.has('discounts[0][promotion_code]')).toBe(false);
  });
});
