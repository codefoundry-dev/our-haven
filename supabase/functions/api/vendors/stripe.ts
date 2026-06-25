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

export interface StripeConfig {
  secretKey: string;
  /** Secret for the Stripe Connect webhook endpoint (account.updated). */
  connectWebhookSecret: string;
  /** Stripe API base URL — defaults to https://api.stripe.com/v1. */
  apiBase?: string;
  /** Override fetch impl — tests inject a stub. */
  fetchImpl?: typeof fetch;
  /** Maximum allowed clock skew on webhook timestamp, in seconds. Default 300. */
  webhookToleranceSec?: number;
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
  };
}
