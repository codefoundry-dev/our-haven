/**
 * Stripe wrapper covering:
 *   - OH-106 screening PaymentIntent (one-shot $35 direct charge).
 *   - OH-110 Stripe Connect Express — account create / account-link (hosted
 *     KYC) / login-link (Express dashboard) / account retrieve / a second
 *     `account.updated` webhook signed with a distinct Connect secret.
 *   - OH-111 Stripe Tax — per-state taxability calculations on Subscription
 *     (subscriber's resident state) and Commission (Provider's resident
 *     state, B2B service); tax-registration list/create surface for the admin
 *     dashboard so nexus is visible and pre-registration is possible per
 *     OH-97's posture decision. Bookings are deliberately NOT plumbed through
 *     Stripe Tax — Providers carry their own services' sales-tax exposure
 *     (CONTEXT.md § Sales tax model, ADR-0009).
 *
 * All surfaces use raw fetch + URLSearchParams (no Stripe Node SDK dep)
 * because the surface remains small and the SDK pulls in significant weight.
 * Signature verification follows https://docs.stripe.com/webhooks#verify-manually
 * and is shared by all webhook secrets.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** OH-110: secret for the Stripe Connect webhook endpoint (account.updated). */
  connectWebhookSecret?: string;
  /** Override Stripe API base URL — defaults to https://api.stripe.com/v1. */
  apiBase?: string;
  /** Override fetch impl — tests inject a stub. */
  fetchImpl?: typeof fetch;
  /** Maximum allowed clock skew on webhook timestamp, in seconds. Default 300. */
  webhookToleranceSec?: number;
  /** OH-111: per-purpose tax code defaults + optional origin state for Stripe Tax. */
  tax?: StripeTaxDefaults;
}

export interface CreatePaymentIntentInput {
  amountCents: number;
  currency: 'usd';
  description: string;
  metadata: Record<string, string>;
  /**
   * Stripe customer or null — for the OH-106 screening charge we don't yet
   * have a Stripe customer (Provider sign-up doesn't create one). When null,
   * Stripe charges the card via the PaymentIntent's payment method only.
   */
  customerId?: string | null;
}

export interface CreatePaymentIntentResult {
  id: string;
  client_secret: string;
  status: string;
}

export interface ParsedStripeEvent {
  id: string;
  type: string;
  created: number;
  data: {
    object: ParsedStripePaymentIntent;
  };
}

export interface ParsedStripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
}

/* ────────────────────────────────────────────────────────────────────────
 * Stripe Connect Express (OH-110)
 * ──────────────────────────────────────────────────────────────────────── */

export interface CreateConnectAccountInput {
  email: string;
  providerId: string;
  /** Free-form metadata stamped onto the Stripe account for traceback. */
  metadata?: Record<string, string>;
}

export interface ConnectAccountRequirements {
  currently_due?: string[];
  eventually_due?: string[];
  past_due?: string[];
  pending_verification?: string[];
  disabled_reason?: string | null;
  [k: string]: unknown;
}

export interface RetrievedConnectAccount {
  id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements?: ConnectAccountRequirements;
  capabilities?: Record<string, string>;
  [k: string]: unknown;
}

export interface CreateAccountLinkInput {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
  type?: 'account_onboarding' | 'account_update';
}

export interface AccountLinkResult {
  url: string;
  expires_at: number;
}

export interface LoginLinkResult {
  url: string;
  created: number;
}

export interface ParsedConnectEvent {
  id: string;
  type: string;
  created: number;
  data: { object: RetrievedConnectAccount };
}

/* ────────────────────────────────────────────────────────────────────────
 * Stripe Tax (OH-111)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * One US state plus optional ZIP. Stripe Tax decides taxability from the
 * subscriber's resident address (Subscription) or the Provider's resident
 * address (Commission, B2B service); both flows live in this shape.
 */
export interface UsAddress {
  state: string;
  postalCode?: string;
  city?: string;
  line1?: string;
}

export type TaxPurpose = 'subscription' | 'commission';

export interface TaxCalculationInput {
  purpose: TaxPurpose;
  amountCents: number;
  /** Caller-supplied id so the audit row can join Stripe's calculation back. */
  reference: string;
  customerAddress: UsAddress;
  /** Override the env default tax code for this calculation. */
  taxCode?: string;
  /** Whether `amountCents` is `inclusive` (back-out) or `exclusive` (add-on). Default: exclusive. */
  taxBehavior?: 'inclusive' | 'exclusive';
  /** Free-form metadata stamped onto the Stripe Tax Calculation object. */
  metadata?: Record<string, string>;
}

/**
 * Subset of the Stripe Tax Calculation shape the platform cares about. The
 * full payload is preserved alongside in `raw` for the audit table.
 */
export interface TaxCalculationResult {
  id: string;
  amount_total: number;
  tax_amount_exclusive: number;
  tax_amount_inclusive: number;
  currency: string;
  expires_at: number;
  customer_details: {
    address?: {
      country?: string | null;
      state?: string | null;
      postal_code?: string | null;
    };
    address_source?: string;
    tax_ids?: unknown[];
    taxability_override?: string;
  };
  tax_breakdown?: Array<{
    amount: number;
    inclusive: boolean;
    tax_rate_details?: {
      country?: string;
      state?: string;
      percentage_decimal?: string;
      tax_type?: string;
    };
    taxability_reason?: string;
    taxable_amount?: number;
  }>;
  line_items?: {
    data: Array<{
      amount: number;
      amount_tax: number;
      reference: string;
      tax_behavior: string;
      tax_code: string;
    }>;
  };
}

export interface StripeTaxRegistration {
  id: string;
  active_from: number;
  country: string;
  country_options?: Record<string, unknown>;
  expires_at: number | null;
  status: 'active' | 'expired' | 'scheduled';
  created?: number;
}

export interface StripeTaxRegistrationList {
  data: StripeTaxRegistration[];
  has_more: boolean;
}

export interface CreateUsStateRegistrationInput {
  state: string;
  /**
   * Stripe Tax expects a state-specific registration shape (e.g. `state_sales_tax`,
   * `local_amusement_tax`). Caller picks the shape that matches the state's
   * filing posture; admin UI sticks to `state_sales_tax` by default.
   */
  registrationType: string;
  /** Unix seconds; defaults to `now`. */
  activeFrom?: number;
}

export interface StripeAdapter {
  createScreeningPaymentIntent(input: CreatePaymentIntentInput): Promise<CreatePaymentIntentResult>;
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;
  parseWebhookEvent(rawBody: string): ParsedStripeEvent | null;

  // OH-110 — Stripe Connect Express
  createConnectAccount(input: CreateConnectAccountInput): Promise<RetrievedConnectAccount>;
  createAccountLink(input: CreateAccountLinkInput): Promise<AccountLinkResult>;
  createLoginLink(accountId: string): Promise<LoginLinkResult>;
  retrieveConnectAccount(accountId: string): Promise<RetrievedConnectAccount>;
  verifyConnectWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;
  parseConnectWebhookEvent(rawBody: string): ParsedConnectEvent | null;

  // OH-111 — Stripe Tax
  createTaxCalculation(input: TaxCalculationInput): Promise<TaxCalculationResult>;
  listTaxRegistrations(opts?: { status?: 'active' | 'expired' | 'scheduled' | 'all'; limit?: number }): Promise<StripeTaxRegistrationList>;
  createUsStateRegistration(input: CreateUsStateRegistrationInput): Promise<StripeTaxRegistration>;
}

export interface StripeTaxDefaults {
  /** Default tax code for Parent Subscription line items (e.g. SaaS / digital service). */
  subscriptionTaxCode: string;
  /** Default tax code for Commission line items (e.g. marketplace facilitator B2B service). */
  commissionTaxCode: string;
  /**
   * 2-letter US state code where Our Haven is registered as the seller.
   * Stripe Tax uses this in addition to the customer address to decide nexus.
   * Optional — Stripe Tax falls back to the account's primary address when omitted.
   */
  originState?: string;
}

export function createStripeAdapter(config: StripeConfig): StripeAdapter {
  const apiBase = config.apiBase ?? 'https://api.stripe.com/v1';
  const doFetch = config.fetchImpl ?? fetch;
  const tolerance = config.webhookToleranceSec ?? 300;

  function checkSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
    if (!signatureHeader) return false;
    const parts = signatureHeader.split(',').map((s) => s.trim());
    let timestamp: string | null = null;
    const signatures: string[] = [];
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const key = part.slice(0, eq);
      const val = part.slice(eq + 1);
      if (key === 't') timestamp = val;
      else if (key === 'v1') signatures.push(val);
    }
    if (!timestamp || signatures.length === 0) return false;

    const nowSec = Math.floor(Date.now() / 1000);
    const tsNum = Number(timestamp);
    if (!Number.isFinite(tsNum) || Math.abs(nowSec - tsNum) > tolerance) return false;

    const signedPayload = `${timestamp}.${rawBody}`;
    const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');
    return signatures.some((sig) => {
      if (sig.length !== expected.length) return false;
      try {
        return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(sig, 'utf8'));
      } catch {
        return false;
      }
    });
  }

  async function stripeFetch<T>(path: string, body: URLSearchParams, method = 'POST'): Promise<T> {
    const res = await doFetch(`${apiBase}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${config.secretKey}`,
      },
      body: method === 'GET' ? undefined : body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`stripe ${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async function stripeGet<T>(path: string): Promise<T> {
    const res = await doFetch(`${apiBase}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.secretKey}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`stripe GET ${path} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  return {
    async createScreeningPaymentIntent(input: CreatePaymentIntentInput) {
      const body = new URLSearchParams();
      body.set('amount', String(input.amountCents));
      body.set('currency', input.currency);
      body.set('description', input.description);
      body.set('automatic_payment_methods[enabled]', 'true');
      if (input.customerId) body.set('customer', input.customerId);
      for (const [k, v] of Object.entries(input.metadata)) {
        body.set(`metadata[${k}]`, v);
      }
      return stripeFetch<CreatePaymentIntentResult>('/payment_intents', body);
    },

    verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
      return checkSignature(rawBody, signatureHeader, config.webhookSecret);
    },

    parseWebhookEvent(rawBody: string): ParsedStripeEvent | null {
      try {
        const parsed = JSON.parse(rawBody) as ParsedStripeEvent;
        if (!parsed?.type || !parsed.data?.object?.id) return null;
        return parsed;
      } catch {
        return null;
      }
    },

    async createConnectAccount(input: CreateConnectAccountInput): Promise<RetrievedConnectAccount> {
      // Stripe Connect Express — US-entity. Capabilities are the v1 marketplace
      // shape: card payments + transfers. Stripe collects the rest via the
      // hosted onboarding link (tax info, bank, identity verification).
      const body = new URLSearchParams();
      body.set('type', 'express');
      body.set('country', 'US');
      body.set('email', input.email);
      body.set('capabilities[card_payments][requested]', 'true');
      body.set('capabilities[transfers][requested]', 'true');
      body.set('business_type', 'individual');
      body.set('metadata[provider_id]', input.providerId);
      body.set('metadata[purpose]', 'provider_connect');
      for (const [k, v] of Object.entries(input.metadata ?? {})) {
        body.set(`metadata[${k}]`, v);
      }
      return stripeFetch<RetrievedConnectAccount>('/accounts', body);
    },

    async createAccountLink(input: CreateAccountLinkInput): Promise<AccountLinkResult> {
      const body = new URLSearchParams();
      body.set('account', input.accountId);
      body.set('refresh_url', input.refreshUrl);
      body.set('return_url', input.returnUrl);
      body.set('type', input.type ?? 'account_onboarding');
      return stripeFetch<AccountLinkResult>('/account_links', body);
    },

    async createLoginLink(accountId: string): Promise<LoginLinkResult> {
      const body = new URLSearchParams();
      return stripeFetch<LoginLinkResult>(`/accounts/${encodeURIComponent(accountId)}/login_links`, body);
    },

    async retrieveConnectAccount(accountId: string): Promise<RetrievedConnectAccount> {
      return stripeGet<RetrievedConnectAccount>(`/accounts/${encodeURIComponent(accountId)}`);
    },

    verifyConnectWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
      const secret = config.connectWebhookSecret ?? config.webhookSecret;
      return checkSignature(rawBody, signatureHeader, secret);
    },

    parseConnectWebhookEvent(rawBody: string): ParsedConnectEvent | null {
      try {
        const parsed = JSON.parse(rawBody) as ParsedConnectEvent;
        if (!parsed?.type || !parsed.data?.object?.id) return null;
        return parsed;
      } catch {
        return null;
      }
    },

    async createTaxCalculation(input: TaxCalculationInput): Promise<TaxCalculationResult> {
      const defaults = config.tax;
      const taxCode =
        input.taxCode ??
        (input.purpose === 'subscription'
          ? defaults?.subscriptionTaxCode
          : defaults?.commissionTaxCode);
      if (!taxCode) {
        throw new Error(
          `stripe tax: no tax code resolved for purpose=${input.purpose}; configure STRIPE_TAX_${input.purpose.toUpperCase()}_TAX_CODE`,
        );
      }

      const body = new URLSearchParams();
      body.set('currency', 'usd');
      body.set('line_items[0][amount]', String(input.amountCents));
      body.set('line_items[0][reference]', input.reference);
      body.set('line_items[0][tax_code]', taxCode);
      body.set('line_items[0][tax_behavior]', input.taxBehavior ?? 'exclusive');
      body.set('customer_details[address][country]', 'US');
      body.set('customer_details[address][state]', input.customerAddress.state);
      if (input.customerAddress.postalCode) {
        body.set('customer_details[address][postal_code]', input.customerAddress.postalCode);
      }
      if (input.customerAddress.city) {
        body.set('customer_details[address][city]', input.customerAddress.city);
      }
      if (input.customerAddress.line1) {
        body.set('customer_details[address][line1]', input.customerAddress.line1);
      }
      body.set('customer_details[address_source]', 'billing');
      body.set('metadata[purpose]', input.purpose);
      body.set('metadata[reference]', input.reference);
      for (const [k, v] of Object.entries(input.metadata ?? {})) {
        body.set(`metadata[${k}]`, v);
      }
      return stripeFetch<TaxCalculationResult>('/tax/calculations', body);
    },

    async listTaxRegistrations(opts = {}): Promise<StripeTaxRegistrationList> {
      const params = new URLSearchParams();
      const status = opts.status ?? 'active';
      if (status !== 'all') params.set('status', status);
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      const qs = params.toString();
      const path = `/tax/registrations${qs ? `?${qs}` : ''}`;
      return stripeGet<StripeTaxRegistrationList>(path);
    },

    async createUsStateRegistration(input: CreateUsStateRegistrationInput): Promise<StripeTaxRegistration> {
      const body = new URLSearchParams();
      body.set('country', 'US');
      body.set('active_from', String(input.activeFrom ?? Math.floor(Date.now() / 1000)));
      body.set(`country_options[us][state]`, input.state);
      body.set(`country_options[us][type]`, input.registrationType);
      return stripeFetch<StripeTaxRegistration>('/tax/registrations', body);
    },
  };
}
