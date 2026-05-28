import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createStripeAdapter } from '@/vendors/stripe.js';

const CFG = {
  secretKey: 'sk_test_unused',
  webhookSecret: 'whsec_test',
};

function stripeSignatureHeader(rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signedPayload = `${timestamp}.${rawBody}`;
  const v1 = createHmac('sha256', CFG.webhookSecret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

describe('StripeAdapter.verifyWebhookSignature', () => {
  it('accepts a freshly signed payload', () => {
    const adapter = createStripeAdapter(CFG);
    const body = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' });
    expect(adapter.verifyWebhookSignature(body, stripeSignatureHeader(body))).toBe(true);
  });

  it('rejects when no header is present', () => {
    const adapter = createStripeAdapter(CFG);
    expect(adapter.verifyWebhookSignature('{}', null)).toBe(false);
  });

  it('rejects a timestamp outside the tolerance window', () => {
    const adapter = createStripeAdapter({ ...CFG, webhookToleranceSec: 60 });
    const ancient = Math.floor(Date.now() / 1000) - 600;
    const body = '{"id":"evt_1"}';
    expect(adapter.verifyWebhookSignature(body, stripeSignatureHeader(body, ancient))).toBe(false);
  });

  it('rejects a tampered body', () => {
    const adapter = createStripeAdapter(CFG);
    const body = JSON.stringify({ id: 'evt_1' });
    const tampered = body + ' ';
    expect(adapter.verifyWebhookSignature(tampered, stripeSignatureHeader(body))).toBe(false);
  });
});

describe('StripeAdapter.createScreeningPaymentIntent', () => {
  it('posts amount + metadata to Stripe and returns the client_secret', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 'pi_1', client_secret: 'pi_1_secret_abc', status: 'requires_payment_method' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = createStripeAdapter({ ...CFG, fetchImpl });

    const result = await adapter.createScreeningPaymentIntent({
      amountCents: 3500,
      currency: 'usd',
      description: 'Our Haven background screening',
      metadata: { screening_id: 's-1', provider_id: 'p-1', purpose: 'screening' },
    });

    expect(result.id).toBe('pi_1');
    expect(result.client_secret).toBe('pi_1_secret_abc');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toMatch(/\/payment_intents$/);
    const body = String(init?.body ?? '');
    expect(body).toContain('amount=3500');
    expect(body).toContain('currency=usd');
    expect(body).toContain('metadata%5Bpurpose%5D=screening');
    expect(body).toContain('metadata%5Bscreening_id%5D=s-1');
  });
});

describe('StripeAdapter — Stripe Connect Express (OH-110)', () => {
  it('createConnectAccount posts type=express, country=US, capabilities + provider metadata', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'acct_new',
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = createStripeAdapter({ ...CFG, fetchImpl });

    const result = await adapter.createConnectAccount({
      email: 'maya@example.com',
      providerId: 'p-1',
      metadata: { state: 'FL', kind: 'caregiver' },
    });
    expect(result.id).toBe('acct_new');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toMatch(/\/accounts$/);
    const body = String(init?.body ?? '');
    expect(body).toContain('type=express');
    expect(body).toContain('country=US');
    expect(body).toContain('email=maya%40example.com');
    expect(body).toContain('capabilities%5Bcard_payments%5D%5Brequested%5D=true');
    expect(body).toContain('capabilities%5Btransfers%5D%5Brequested%5D=true');
    expect(body).toContain('business_type=individual');
    expect(body).toContain('metadata%5Bprovider_id%5D=p-1');
    expect(body).toContain('metadata%5Bstate%5D=FL');
  });

  it('createAccountLink posts account + URLs + type=account_onboarding', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ url: 'https://connect.stripe.com/setup/e/acct_1/x', expires_at: 12345 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = createStripeAdapter({ ...CFG, fetchImpl });
    const result = await adapter.createAccountLink({
      accountId: 'acct_1',
      refreshUrl: 'http://app/refresh',
      returnUrl: 'http://app/return',
    });
    expect(result.url).toMatch(/connect\.stripe\.com/);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toMatch(/\/account_links$/);
    const body = String(init?.body ?? '');
    expect(body).toContain('account=acct_1');
    expect(body).toContain('refresh_url=http%3A%2F%2Fapp%2Frefresh');
    expect(body).toContain('return_url=http%3A%2F%2Fapp%2Freturn');
    expect(body).toContain('type=account_onboarding');
  });

  it('createLoginLink POSTs to /accounts/{id}/login_links', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ url: 'https://connect.stripe.com/express/acct_1/dashboard', created: 7 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = createStripeAdapter({ ...CFG, fetchImpl });
    const result = await adapter.createLoginLink('acct_1');
    expect(result.url).toMatch(/express\/acct_1\/dashboard/);
    expect(fetchImpl.mock.calls[0]?.[0]).toMatch(/\/accounts\/acct_1\/login_links$/);
  });

  it('verifyConnectWebhookSignature uses the connectWebhookSecret when provided', () => {
    const connectSecret = 'whsec_connect';
    const adapter = createStripeAdapter({ ...CFG, connectWebhookSecret: connectSecret });
    const body = JSON.stringify({ id: 'evt', type: 'account.updated' });
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', connectSecret).update(`${ts}.${body}`).digest('hex');
    expect(adapter.verifyConnectWebhookSignature(body, `t=${ts},v1=${sig}`)).toBe(true);
    // The screening secret must NOT validate against the Connect signature.
    expect(adapter.verifyWebhookSignature(body, `t=${ts},v1=${sig}`)).toBe(false);
  });

  it('parseConnectWebhookEvent returns null on malformed JSON', () => {
    const adapter = createStripeAdapter(CFG);
    expect(adapter.parseConnectWebhookEvent('{ not json')).toBeNull();
  });
});

describe('StripeAdapter — Stripe Tax (OH-111)', () => {
  const TAX_CFG = {
    ...CFG,
    tax: {
      subscriptionTaxCode: 'txcd_10103001',
      commissionTaxCode: 'txcd_20030000',
      originState: 'FL',
    },
  };

  function mockTaxResponse(overrides: Record<string, unknown> = {}): Response {
    return new Response(
      JSON.stringify({
        id: 'taxcalc_test_1',
        amount_total: 5000,
        tax_amount_exclusive: 0,
        tax_amount_inclusive: 0,
        currency: 'usd',
        expires_at: Math.floor(Date.now() / 1000) + 86_400,
        customer_details: { address: { country: 'US', state: 'CA' } },
        tax_breakdown: [],
        line_items: {
          data: [
            { amount: 5000, amount_tax: 0, reference: 'r-1', tax_behavior: 'exclusive', tax_code: 'txcd_10103001' },
          ],
        },
        ...overrides,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  it('createTaxCalculation posts a Subscription line item with the SaaS tax code + US state address', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(mockTaxResponse());
    const adapter = createStripeAdapter({ ...TAX_CFG, fetchImpl });

    const result = await adapter.createTaxCalculation({
      purpose: 'subscription',
      amountCents: 1999,
      reference: 'sub_preview_u-1',
      customerAddress: { state: 'CA', postalCode: '94016', city: 'San Francisco' },
    });
    expect(result.id).toBe('taxcalc_test_1');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toMatch(/\/tax\/calculations$/);
    const body = String(init?.body ?? '');
    expect(body).toContain('currency=usd');
    expect(body).toContain('line_items%5B0%5D%5Bamount%5D=1999');
    expect(body).toContain('line_items%5B0%5D%5Btax_code%5D=txcd_10103001');
    expect(body).toContain('line_items%5B0%5D%5Btax_behavior%5D=exclusive');
    expect(body).toContain('customer_details%5Baddress%5D%5Bcountry%5D=US');
    expect(body).toContain('customer_details%5Baddress%5D%5Bstate%5D=CA');
    expect(body).toContain('customer_details%5Baddress%5D%5Bpostal_code%5D=94016');
    expect(body).toContain('metadata%5Bpurpose%5D=subscription');
  });

  it('createTaxCalculation routes commission to the B2B tax code', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(mockTaxResponse());
    const adapter = createStripeAdapter({ ...TAX_CFG, fetchImpl });

    await adapter.createTaxCalculation({
      purpose: 'commission',
      amountCents: 3000,
      reference: 'commission_booking_b-1',
      customerAddress: { state: 'TX' },
    });
    const body = String(fetchImpl.mock.calls[0]![1]?.body ?? '');
    expect(body).toContain('line_items%5B0%5D%5Btax_code%5D=txcd_20030000');
    expect(body).toContain('metadata%5Bpurpose%5D=commission');
    expect(body).toContain('customer_details%5Baddress%5D%5Bstate%5D=TX');
  });

  it.each(['CA', 'TX', 'NY', 'FL', 'WA'])(
    'createTaxCalculation reaches Stripe Tax for subscription in %s (AC #1 — 5+ state sample)',
    async (state) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(mockTaxResponse());
      const adapter = createStripeAdapter({ ...TAX_CFG, fetchImpl });
      await adapter.createTaxCalculation({
        purpose: 'subscription',
        amountCents: 1999,
        reference: `sub_${state}`,
        customerAddress: { state },
      });
      const body = String(fetchImpl.mock.calls[0]![1]?.body ?? '');
      expect(body).toContain(`customer_details%5Baddress%5D%5Bstate%5D=${state}`);
    },
  );

  it('createTaxCalculation throws when purpose has no resolved tax code', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = createStripeAdapter({ ...CFG, fetchImpl });
    await expect(
      adapter.createTaxCalculation({
        purpose: 'subscription',
        amountCents: 100,
        reference: 'r',
        customerAddress: { state: 'CA' },
      }),
    ).rejects.toThrow(/no tax code resolved/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('listTaxRegistrations GETs /tax/registrations with the status filter', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [], has_more: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = createStripeAdapter({ ...TAX_CFG, fetchImpl });
    await adapter.listTaxRegistrations({ status: 'active', limit: 50 });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toMatch(/\/tax\/registrations\?.*status=active/);
    expect(url).toMatch(/limit=50/);
    expect(init?.method).toBe('GET');
  });

  it('listTaxRegistrations omits status param when "all" requested', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [], has_more: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = createStripeAdapter({ ...TAX_CFG, fetchImpl });
    await adapter.listTaxRegistrations({ status: 'all' });
    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).not.toMatch(/status=/);
  });

  it('createUsStateRegistration posts country=US + country_options.us.state + type', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'taxreg_1',
          active_from: 1_716_700_000,
          country: 'US',
          country_options: { us: { state: 'CA', type: 'state_sales_tax' } },
          expires_at: null,
          status: 'active',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const adapter = createStripeAdapter({ ...TAX_CFG, fetchImpl });
    const reg = await adapter.createUsStateRegistration({
      state: 'CA',
      registrationType: 'state_sales_tax',
      activeFrom: 1_716_700_000,
    });
    expect(reg.id).toBe('taxreg_1');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toMatch(/\/tax\/registrations$/);
    const body = String(init?.body ?? '');
    expect(body).toContain('country=US');
    expect(body).toContain('active_from=1716700000');
    expect(body).toContain('country_options%5Bus%5D%5Bstate%5D=CA');
    expect(body).toContain('country_options%5Bus%5D%5Btype%5D=state_sales_tax');
  });
});
