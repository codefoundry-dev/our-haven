/**
 * Stripe adapter for the `api` Edge Function — Stripe Connect Express, the
 * Caregiver-only payment rail (OH-190; ADR-0001 / ADR-0011).
 *
 * Ported from apps/backend/src/vendors/stripe.ts (the OH-110 Fastify adapter),
 * trimmed to the surface OH-190 needs and re-authored with explicit-.ts hygiene
 * so the Edge tree is self-contained on Deno. ADR-0019 § Decision 5 blesses this
 * port: the vendor adapters are SDK-free (`fetch` + `URLSearchParams` +
 * `node:crypto` + `Buffer`, all Deno-compatible), so signature verification
 * carries over unchanged.
 *
 * Surface:
 *   - Connect Express account create / account-link (hosted KYC) / login-link
 *     (Express dashboard — bank edits + withdrawals) / account retrieve.
 *   - `account.updated` webhook signature verify + parse (distinct Connect
 *     secret from the screening webhook).
 *   - `createBookingPaymentIntent` — a destination charge that skims the
 *     platform Commission via `application_fee_amount` and transfers the
 *     remainder to the Caregiver's connected account (ADR-0001: "the Parent
 *     pays the displayed Rate; the Caregiver receives Rate × (1 − Commission)").
 *
 * NOT ported here (out of OH-190 scope): the screening PaymentIntent (OH-106)
 * and Stripe Tax (OH-111) — they belong to their own Edge ports.
 *
 * Form 1099-K issuance is handled automatically by Stripe Connect for Express
 * accounts (ADR-0001 / CONTEXT § Sales tax model); no application plumbing is
 * required — see routes/caregiver-connect.ts for the operational note.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { NotConfiguredError } from '../errors.ts';

export interface StripeConfig {
  /** Optional — the function boots without Stripe configured; any API call made
   *  while this is unset throws NotConfiguredError (→ 503 not_configured). */
  secretKey?: string;
  /** Secret for the Stripe Connect webhook endpoint (account.updated). Optional;
   *  webhook verification fails closed (returns false) when unset. */
  connectWebhookSecret?: string;
  /**
   * OH-185: secret for the payments webhook endpoint (`payment_intent.succeeded`
   * for the screening charge). A DISTINCT endpoint + signing secret from the
   * Connect webhook — Stripe signs each endpoint with its own secret.
   */
  paymentsWebhookSecret?: string;
  /** Stripe API base URL — defaults to https://api.stripe.com/v1. */
  apiBase?: string;
  /** Override fetch impl — tests inject a stub. */
  fetchImpl?: typeof fetch;
  /** Maximum allowed clock skew on webhook timestamp, in seconds. Default 300. */
  webhookToleranceSec?: number;
  /** OH-192: per-purpose tax-code defaults + optional origin state for Stripe Tax. */
  tax?: StripeTaxDefaults;
  /**
   * OH-191: secret for the Stripe BILLING webhook endpoint (subscription
   * lifecycle — checkout.session.completed + customer.subscription.*). A DISTINCT
   * endpoint + signing secret from both the Connect and the payments webhooks.
   */
  billingWebhookSecret?: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * Stripe Connect Express
 * ──────────────────────────────────────────────────────────────────────── */

export interface CreateConnectAccountInput {
  email: string;
  /** `providers.id` of the Caregiver this account belongs to (FK key). */
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
 * Booking payment — destination charge with application_fee (the Commission skim)
 * ──────────────────────────────────────────────────────────────────────── */

export interface CreateBookingPaymentIntentInput {
  /**
   * Total the Parent is charged, in cents — the Caregiver's Rate × hours plus
   * any per-child surcharge (the domain `PricingResult.parentChargeCents`).
   * Tips are NOT included here: they are commission-exempt and paid as a
   * separate no-fee transfer (ADR-0018).
   */
  amountCents: number;
  /**
   * Platform Commission skimmed off the charge, in cents — the domain
   * `PricingResult.platformCommissionCents`. Stripe deducts this from the
   * amount transferred to the connected account.
   */
  applicationFeeCents: number;
  /** The Caregiver's Connect Express account id (`acct_…`) — payout destination. */
  destinationAccountId: string;
  description: string;
  metadata: Record<string, string>;
  /** Stripe customer (the Parent) or null when charging a one-off PaymentMethod. */
  customerId?: string | null;
  currency?: 'usd';
}

export interface CreatePaymentIntentResult {
  id: string;
  client_secret: string;
  status: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * Screening charge (OH-185) — a one-shot direct PaymentIntent on the platform
 * account (NOT a Connect destination charge): the Provider/Caregiver pays the
 * $35 background-check fee, the platform keeps it (margin over Checkr's ~$30
 * cost). Settled on the platform account so it needs no connected account.
 * ──────────────────────────────────────────────────────────────────────── */

export interface CreateScreeningPaymentIntentInput {
  amountCents: number;
  description: string;
  /** Carries `purpose: 'screening'` + `screening_id` + `provider_id` so the
   *  payments webhook can locate the screening row on success. */
  metadata: Record<string, string>;
  /** No Stripe customer exists at supply sign-up — charge the PaymentIntent's
   *  payment method directly. Optional for forward compatibility. */
  customerId?: string | null;
  currency?: 'usd';
}

export interface ParsedPaymentsEvent {
  id: string;
  type: string;
  created: number;
  data: { object: ParsedStripePaymentIntent };
}

export interface ParsedStripePaymentIntent {
  id: string;
  status: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
}

/* ────────────────────────────────────────────────────────────────────────
 * Stripe Tax (OH-192)
 *
 * Per-state taxability on the Parent Subscription (subscriber's resident
 * state) and the Commission (Provider's resident state, B2B service), plus the
 * tax-registration list/create surface that powers the admin nexus dashboard.
 * Bookings are deliberately NOT plumbed through Stripe Tax — Providers carry
 * their own services' sales-tax exposure (CONTEXT § Sales tax model, ADR-0009).
 *
 * Ported from apps/backend/src/vendors/stripe.ts (the OH-111 Fastify adapter)
 * onto the Edge tree with explicit-.ts hygiene. Still SDK-free: `fetch` +
 * `URLSearchParams`, Deno-clean.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * One US state plus optional ZIP/city. Stripe Tax decides taxability from the
 * subscriber's resident address (Subscription) or the Provider's resident
 * address (Commission); both flows share this shape.
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
 * Subset of the Stripe Tax Calculation shape the platform cares about. The full
 * payload is preserved alongside in the audit table's `raw_payload`.
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
   * filing posture; the admin UI sticks to `state_sales_tax` by default.
   */
  registrationType: string;
  /** Unix seconds; defaults to `now`. */
  activeFrom?: number;
}

export interface StripeTaxDefaults {
  /** Default tax code for Parent Subscription line items (SaaS / digital service). */
  subscriptionTaxCode: string;
  /** Default tax code for Commission line items (marketplace facilitator B2B service). */
  commissionTaxCode: string;
  /**
   * 2-letter US state code where Our Haven is registered as the seller. Stripe
   * Tax uses it in addition to the customer address to decide nexus. Optional —
   * Stripe Tax falls back to the account's primary address when omitted.
   */
  originState?: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * Provider Subscription — Stripe Billing (OH-191)
 *
 * The clinical tier's listing fee (ADR-0011 / CONTEXT § Subscription). The
 * Provider is a Stripe *Customer* (NOT a Connect account — Providers receive no
 * Payouts): we create a Customer, drive a Stripe-hosted Checkout Session in
 * `subscription` mode (sold on web to dodge the iOS/Android IAP rules), and
 * mirror the subscription lifecycle from a dedicated billing webhook. The
 * Billing Portal session lets the Provider manage / cancel off-app.
 *
 * Still SDK-free — `fetch` + `URLSearchParams`, Deno-clean — exactly like the
 * Connect + Tax surfaces above.
 * ──────────────────────────────────────────────────────────────────────── */

export interface CreateBillingCustomerInput {
  email: string;
  /** `providers.id` of the Provider this customer belongs to (stamped as metadata). */
  providerId: string;
  metadata?: Record<string, string>;
}

export interface BillingCustomer {
  id: string;
  [k: string]: unknown;
}

export interface CreateSubscriptionCheckoutSessionInput {
  /** The Provider's Stripe Customer (cus_…). */
  customerId: string;
  /** The recurring Price (price_…) for the Provider Subscription. */
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  /** `providers.id` — surfaced as Checkout's `client_reference_id` + subscription metadata. */
  clientReferenceId: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  id: string;
  url: string;
  [k: string]: unknown;
}

export interface CreateBillingPortalSessionInput {
  customerId: string;
  returnUrl: string;
}

export interface BillingPortalSessionResult {
  id: string;
  url: string;
  [k: string]: unknown;
}

/* ────────────────────────────────────────────────────────────────────────
 * Parent Subscription — Stripe Billing (OH-193)
 *
 * The demand-side analogue of the Provider Subscription: the Parent is a Stripe
 * *Customer*, drives a Stripe-hosted Checkout Session in `subscription` mode
 * (sold on web to dodge the iOS/Android IAP rules), and the same billing webhook
 * mirrors the lifecycle — onto `parent_subscriptions` rather than
 * `provider_subscriptions`. Two differences from the provider surface: the row
 * is keyed by the auth `uid` (there is no Provider/account id — a Parent is just
 * the auth user), and checkout supports **Stripe Promotion Codes** (PRD story 9
 * — "apply a discount code to my Subscription"). The Billing Portal + webhook
 * verify/parse helpers are shared with the provider flow (same Stripe account,
 * same billing event family).
 * ──────────────────────────────────────────────────────────────────────── */

export interface CreateParentBillingCustomerInput {
  email: string;
  /** The Parent's Supabase auth uid — stamped as customer metadata for traceback. */
  uid: string;
  metadata?: Record<string, string>;
}

export interface CreateParentSubscriptionCheckoutSessionInput {
  /** The Parent's Stripe Customer (cus_…). */
  customerId: string;
  /** The recurring Price (price_…) for the Parent Subscription. */
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  /** The Parent's auth `uid` — surfaced as Checkout's `client_reference_id` + subscription metadata. */
  clientReferenceId: string;
  /**
   * A Stripe Promotion Code id (`promo_…`) to pre-apply to the subscription (deep
   * link from a launch promo). Mutually exclusive with the hosted promo-code
   * field: when set, Stripe forbids `allow_promotion_codes`, so we drop it.
   */
  promotionCode?: string;
  /**
   * Render Stripe Checkout's "Add promotion code" field so the Parent can type a
   * launch code on the hosted page (PRD story 9). Defaults to true; ignored when
   * `promotionCode` is supplied (Stripe rejects both together).
   */
  allowPromotionCodes?: boolean;
  metadata?: Record<string, string>;
}

/** The subset of a Stripe Subscription object the billing webhook mirrors. */
export interface StripeSubscriptionObject {
  id: string;
  customer: string;
  status: string;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  items?: { data?: Array<{ price?: { id?: string | null } | null }> };
  metadata?: Record<string, string>;
  [k: string]: unknown;
}

/** The subset of a Stripe Checkout Session object the billing webhook reads. */
export interface StripeCheckoutSessionObject {
  id: string;
  mode?: string;
  customer?: string | null;
  subscription?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
  [k: string]: unknown;
}

/**
 * A parsed billing webhook event. The `data.object` shape varies by `type`
 * (Checkout Session for `checkout.session.completed`, Subscription for
 * `customer.subscription.*`), so it is left generic and the route narrows it.
 */
export interface ParsedBillingEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

export interface StripeAdapter {
  // Connect Express
  createConnectAccount(input: CreateConnectAccountInput): Promise<RetrievedConnectAccount>;
  createAccountLink(input: CreateAccountLinkInput): Promise<AccountLinkResult>;
  createLoginLink(accountId: string): Promise<LoginLinkResult>;
  retrieveConnectAccount(accountId: string): Promise<RetrievedConnectAccount>;
  verifyConnectWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;
  parseConnectWebhookEvent(rawBody: string): ParsedConnectEvent | null;

  // Booking payment — application_fee destination charge
  createBookingPaymentIntent(input: CreateBookingPaymentIntentInput): Promise<CreatePaymentIntentResult>;

  // Screening charge (OH-185) — direct PaymentIntent + its own webhook secret
  createScreeningPaymentIntent(input: CreateScreeningPaymentIntentInput): Promise<CreatePaymentIntentResult>;
  verifyPaymentsWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;
  parsePaymentsWebhookEvent(rawBody: string): ParsedPaymentsEvent | null;

  // Stripe Tax (OH-192)
  createTaxCalculation(input: TaxCalculationInput): Promise<TaxCalculationResult>;
  listTaxRegistrations(opts?: {
    status?: 'active' | 'expired' | 'scheduled' | 'all';
    limit?: number;
  }): Promise<StripeTaxRegistrationList>;
  createUsStateRegistration(input: CreateUsStateRegistrationInput): Promise<StripeTaxRegistration>;

  // Provider Subscription — Stripe Billing (OH-191)
  createBillingCustomer(input: CreateBillingCustomerInput): Promise<BillingCustomer>;
  createSubscriptionCheckoutSession(
    input: CreateSubscriptionCheckoutSessionInput,
  ): Promise<CheckoutSessionResult>;
  createBillingPortalSession(input: CreateBillingPortalSessionInput): Promise<BillingPortalSessionResult>;
  retrieveSubscription(subscriptionId: string): Promise<StripeSubscriptionObject>;
  verifyBillingWebhookSignature(rawBody: string, signatureHeader: string | null): boolean;
  parseBillingWebhookEvent(rawBody: string): ParsedBillingEvent | null;

  // Parent Subscription — Stripe Billing (OH-193). Billing Portal + webhook
  // verify/parse are shared with the provider flow above.
  createParentBillingCustomer(input: CreateParentBillingCustomerInput): Promise<BillingCustomer>;
  createParentSubscriptionCheckoutSession(
    input: CreateParentSubscriptionCheckoutSessionInput,
  ): Promise<CheckoutSessionResult>;
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

  async function stripeFetch<T>(path: string, body: URLSearchParams): Promise<T> {
    if (!config.secretKey) throw new NotConfiguredError('STRIPE_SECRET_KEY');
    const res = await doFetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${config.secretKey}`,
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`stripe POST ${path} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  async function stripeGet<T>(path: string): Promise<T> {
    if (!config.secretKey) throw new NotConfiguredError('STRIPE_SECRET_KEY');
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
    async createConnectAccount(input: CreateConnectAccountInput): Promise<RetrievedConnectAccount> {
      // Stripe Connect Express — US entity. Capabilities are the v1 marketplace
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
      body.set('metadata[purpose]', 'caregiver_connect');
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
      if (!config.connectWebhookSecret) return false;
      return checkSignature(rawBody, signatureHeader, config.connectWebhookSecret);
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

    async createBookingPaymentIntent(
      input: CreateBookingPaymentIntentInput,
    ): Promise<CreatePaymentIntentResult> {
      // Destination charge (ADR-0001): the charge settles on the platform
      // account, `application_fee_amount` is retained as Commission, and the
      // remainder is transferred to the Caregiver's connected account. The
      // Parent pays exactly `amountCents` (the displayed Rate); the Caregiver
      // nets `amountCents − applicationFeeCents`.
      const body = new URLSearchParams();
      body.set('amount', String(input.amountCents));
      body.set('currency', input.currency ?? 'usd');
      body.set('description', input.description);
      body.set('automatic_payment_methods[enabled]', 'true');
      body.set('application_fee_amount', String(input.applicationFeeCents));
      body.set('transfer_data[destination]', input.destinationAccountId);
      if (input.customerId) body.set('customer', input.customerId);
      for (const [k, v] of Object.entries(input.metadata)) {
        body.set(`metadata[${k}]`, v);
      }
      return stripeFetch<CreatePaymentIntentResult>('/payment_intents', body);
    },

    async createScreeningPaymentIntent(
      input: CreateScreeningPaymentIntentInput,
    ): Promise<CreatePaymentIntentResult> {
      // Direct charge on the platform account (no transfer_data / application_fee):
      // the screening fee is platform revenue, not a marketplace pass-through.
      const body = new URLSearchParams();
      body.set('amount', String(input.amountCents));
      body.set('currency', input.currency ?? 'usd');
      body.set('description', input.description);
      body.set('automatic_payment_methods[enabled]', 'true');
      if (input.customerId) body.set('customer', input.customerId);
      for (const [k, v] of Object.entries(input.metadata)) {
        body.set(`metadata[${k}]`, v);
      }
      return stripeFetch<CreatePaymentIntentResult>('/payment_intents', body);
    },

    verifyPaymentsWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
      if (!config.paymentsWebhookSecret) return false;
      return checkSignature(rawBody, signatureHeader, config.paymentsWebhookSecret);
    },

    parsePaymentsWebhookEvent(rawBody: string): ParsedPaymentsEvent | null {
      try {
        const parsed = JSON.parse(rawBody) as ParsedPaymentsEvent;
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
      // Stripe's list endpoint has no `all` filter — omitting `status` returns
      // every registration regardless of lifecycle, which is our `all`.
      if (status !== 'all') params.set('status', status);
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      const qs = params.toString();
      return stripeGet<StripeTaxRegistrationList>(`/tax/registrations${qs ? `?${qs}` : ''}`);
    },

    async createUsStateRegistration(
      input: CreateUsStateRegistrationInput,
    ): Promise<StripeTaxRegistration> {
      const body = new URLSearchParams();
      body.set('country', 'US');
      body.set('active_from', String(input.activeFrom ?? Math.floor(Date.now() / 1000)));
      body.set('country_options[us][state]', input.state);
      body.set('country_options[us][type]', input.registrationType);
      return stripeFetch<StripeTaxRegistration>('/tax/registrations', body);
    },

    async createBillingCustomer(input: CreateBillingCustomerInput): Promise<BillingCustomer> {
      const body = new URLSearchParams();
      body.set('email', input.email);
      body.set('metadata[provider_id]', input.providerId);
      body.set('metadata[purpose]', 'provider_subscription');
      for (const [k, v] of Object.entries(input.metadata ?? {})) {
        body.set(`metadata[${k}]`, v);
      }
      return stripeFetch<BillingCustomer>('/customers', body);
    },

    async createSubscriptionCheckoutSession(
      input: CreateSubscriptionCheckoutSessionInput,
    ): Promise<CheckoutSessionResult> {
      // Stripe-hosted Checkout in subscription mode (PRD story 49a). The Provider
      // pays us a listing fee; this is NOT a Connect/destination charge. We stamp
      // provider_id onto BOTH the session (`client_reference_id`) and the
      // resulting subscription (`subscription_data[metadata]`) so the billing
      // webhook can locate the row whichever event lands first.
      const body = new URLSearchParams();
      body.set('mode', 'subscription');
      body.set('customer', input.customerId);
      body.set('line_items[0][price]', input.priceId);
      body.set('line_items[0][quantity]', '1');
      body.set('success_url', input.successUrl);
      body.set('cancel_url', input.cancelUrl);
      body.set('client_reference_id', input.clientReferenceId);
      body.set('subscription_data[metadata][provider_id]', input.clientReferenceId);
      body.set('metadata[provider_id]', input.clientReferenceId);
      for (const [k, v] of Object.entries(input.metadata ?? {})) {
        body.set(`metadata[${k}]`, v);
      }
      return stripeFetch<CheckoutSessionResult>('/checkout/sessions', body);
    },

    async createBillingPortalSession(
      input: CreateBillingPortalSessionInput,
    ): Promise<BillingPortalSessionResult> {
      const body = new URLSearchParams();
      body.set('customer', input.customerId);
      body.set('return_url', input.returnUrl);
      return stripeFetch<BillingPortalSessionResult>('/billing_portal/sessions', body);
    },

    async createParentBillingCustomer(
      input: CreateParentBillingCustomerInput,
    ): Promise<BillingCustomer> {
      const body = new URLSearchParams();
      body.set('email', input.email);
      body.set('metadata[uid]', input.uid);
      body.set('metadata[purpose]', 'parent_subscription');
      for (const [k, v] of Object.entries(input.metadata ?? {})) {
        body.set(`metadata[${k}]`, v);
      }
      return stripeFetch<BillingCustomer>('/customers', body);
    },

    async createParentSubscriptionCheckoutSession(
      input: CreateParentSubscriptionCheckoutSessionInput,
    ): Promise<CheckoutSessionResult> {
      // Stripe-hosted Checkout in subscription mode (PRD stories 7–9). The Parent
      // pays us the access fee; this is NOT a Connect/destination charge. We stamp
      // the auth `uid` + purpose onto BOTH the session (`client_reference_id` +
      // metadata) and the resulting subscription (`subscription_data[metadata]`)
      // so the billing webhook can route the row to parent_subscriptions whichever
      // event lands first.
      const body = new URLSearchParams();
      body.set('mode', 'subscription');
      body.set('customer', input.customerId);
      body.set('line_items[0][price]', input.priceId);
      body.set('line_items[0][quantity]', '1');
      body.set('success_url', input.successUrl);
      body.set('cancel_url', input.cancelUrl);
      body.set('client_reference_id', input.clientReferenceId);
      body.set('subscription_data[metadata][uid]', input.clientReferenceId);
      body.set('subscription_data[metadata][purpose]', 'parent_subscription');
      body.set('metadata[uid]', input.clientReferenceId);
      body.set('metadata[purpose]', 'parent_subscription');
      // Discount-code support (Stripe Promotion Codes; PRD story 9). A pre-applied
      // code and the hosted "add promotion code" field are mutually exclusive in
      // Stripe Checkout — passing `discounts` forbids `allow_promotion_codes`.
      if (input.promotionCode) {
        body.set('discounts[0][promotion_code]', input.promotionCode);
      } else if (input.allowPromotionCodes !== false) {
        body.set('allow_promotion_codes', 'true');
      }
      for (const [k, v] of Object.entries(input.metadata ?? {})) {
        body.set(`metadata[${k}]`, v);
      }
      return stripeFetch<CheckoutSessionResult>('/checkout/sessions', body);
    },

    async retrieveSubscription(subscriptionId: string): Promise<StripeSubscriptionObject> {
      return stripeGet<StripeSubscriptionObject>(
        `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      );
    },

    verifyBillingWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
      if (!config.billingWebhookSecret) return false;
      return checkSignature(rawBody, signatureHeader, config.billingWebhookSecret);
    },

    parseBillingWebhookEvent(rawBody: string): ParsedBillingEvent | null {
      try {
        const parsed = JSON.parse(rawBody) as ParsedBillingEvent;
        if (!parsed?.type || !parsed.data?.object) return null;
        return parsed;
      } catch {
        return null;
      }
    },
  };
}
