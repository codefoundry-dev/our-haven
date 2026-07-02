/**
 * Booking payment orchestration (OH-211) — the single place that maps a
 * Caregiver Booking's money moves onto the Stripe adapter, and the domain
 * Pricing / Cancellation calculators onto the amounts. Callers (the Award
 * handler, the Parent booking routes, and the worker-tick sweeps) run the pure
 * `transitionBooking` state machine, then hand the resulting money-tag +
 * booking row here and merge the returned **payment-only column patch** into
 * their own DB update (adding the state + timestamp columns themselves).
 *
 * Design rules:
 *   - Deno-clean: only `fetch`-based vendor + type-only domain imports (ADR-0019).
 *   - Never reads the clock — timestamps (`confirmed_at`, `cancelled_at`, …) are
 *     the caller's, who already holds `now`. This keeps the module deterministic
 *     and unit-testable with a stub Stripe adapter.
 *   - Every Stripe call carries a deterministic Idempotency-Key derived from the
 *     booking id + operation, so webhook / sweep retries never double-charge.
 *
 * Money model (CONTEXT § Payout / § Commission; ADR-0001): a Booking is one
 * manual-capture destination charge. Authorize holds `parentChargeCents`;
 * capture (at session end) transfers `parentChargeCents − commission` to the
 * Caregiver's connected account and retains the `application_fee` — the capture
 * IS the payout, so the domain `enqueue-payout` tag needs no separate call.
 */

import { calculatePricing, calculateTip } from '../../../../packages/domain/src/pricing/index.ts';
import type { CancellationResult } from '../../../../packages/domain/src/cancellation/index.ts';
import type { StripeAdapter } from '../vendors/stripe.ts';

export type BookingPaymentStatus =
  | 'scheduled'
  | 'requires_action'
  | 'authorized'
  | 'captured'
  | 'canceled'
  | 'refunded'
  | 'failed';

type Category = 'babysitter' | 'tutor' | 'nanny';

/** The payment-only columns a money move sets. The caller merges state + stamps. */
export interface BookingPaymentPatch {
  payment_intent_id?: string | null;
  payment_status?: BookingPaymentStatus;
  authorized_amount_cents?: number;
  captured_amount_cents?: number;
  refunded_amount_cents?: number;
  commission_bp?: number;
  commission_cents?: number;
  cancellation_tier?: 'free' | 'half' | 'full';
  payment_error?: string | null;
}

export interface BookingPriceInput {
  agreedRateCents: number;
  hours: number;
  childCount: number;
  perChildSurchargeCents: number;
  commissionBp: number;
  category: Category;
}

export interface BookingPrice {
  /** What the Parent is charged (authorize / capture amount), integer cents. */
  parentChargeCents: number;
  /** Platform Commission (the destination-charge application_fee), integer cents. */
  commissionCents: number;
}

/** Pricing split for one Booking (or occurrence) — the Agreed Rate × hours. */
export function priceBooking(input: BookingPriceInput): BookingPrice {
  const p = calculatePricing(input);
  return { parentChargeCents: p.parentChargeCents, commissionCents: p.platformCommissionCents };
}

/** Commission on an arbitrary charge amount (partial capture on cancellation). */
export function commissionOn(amountCents: number, commissionBp: number): number {
  return Math.round((amountCents * commissionBp) / 10_000);
}

/**
 * Map a Stripe PaymentIntent status (as returned by create+confirm) to the
 * platform's `payment_status`. The `amount_capturable_updated` /
 * `payment_intent.succeeded` webhooks are the authoritative confirmation; this
 * initial mapping just reflects the synchronous create result.
 */
export function mapAuthorizeStatus(stripeStatus: string): BookingPaymentStatus {
  switch (stripeStatus) {
    case 'requires_capture':
      return 'authorized';
    case 'requires_action':
    case 'requires_confirmation':
      return 'requires_action';
    case 'processing':
      // Async settle — optimistic; the webhook flips to authorized/failed.
      return 'authorized';
    case 'succeeded':
      return 'captured';
    case 'canceled':
      return 'canceled';
    default:
      // requires_payment_method / unknown → needs attention.
      return 'failed';
  }
}

export interface AuthorizeBookingInput {
  bookingId: string;
  amountCents: number;
  commissionCents: number;
  commissionBp: number;
  /** Caregiver's Connect Express account (`acct_…`) — the payout destination. */
  connectAccountId: string;
  /** Parent's Stripe Customer (`cus_…`) — from their subscription. */
  customerId: string;
  /** Parent's saved card (`pm_…`). */
  paymentMethodId: string;
  description: string;
  /** true for the lazy authorize-due sweep (Parent absent); false at Award. */
  offSession: boolean;
}

export interface AuthorizeBookingResult {
  patch: BookingPaymentPatch;
  /** For the interactive path — the client confirms 3DS with this when needed. */
  clientSecret: string | null;
}

/**
 * Authorize-at-booking: create a manual-capture destination charge that HOLDS
 * `amountCents` on the Parent's card. Confirmed server-side against the saved
 * card; 3DS surfaces as `requires_action` (the caller notifies / the client
 * completes it). Off-session `authentication_required` is already normalised to
 * `requires_action` by the adapter, so this never throws for 3DS — only for a
 * hard decline (which the caller catches → `failed`).
 */
export async function authorizeBooking(
  stripe: StripeAdapter,
  input: AuthorizeBookingInput,
): Promise<AuthorizeBookingResult> {
  const res = await stripe.createBookingPaymentIntent({
    amountCents: input.amountCents,
    applicationFeeCents: input.commissionCents,
    destinationAccountId: input.connectAccountId,
    description: input.description,
    metadata: { purpose: 'booking', booking_id: input.bookingId },
    customerId: input.customerId,
    paymentMethodId: input.paymentMethodId,
    confirm: true,
    offSession: input.offSession,
    idempotencyKey: `booking:authorize:${input.bookingId}`,
  });
  return {
    patch: {
      payment_intent_id: res.id,
      payment_status: mapAuthorizeStatus(res.status),
      authorized_amount_cents: input.amountCents,
      commission_bp: input.commissionBp,
      commission_cents: input.commissionCents,
    },
    clientSecret: res.client_secret || null,
  };
}

export interface CaptureBookingInput {
  bookingId: string;
  paymentIntentId: string;
  /** Amount to capture — min(final hours amount, authorized). ≤ authorized. */
  captureAmountCents: number;
  /** Commission recomputed on the captured amount. */
  commissionCents: number;
}

/**
 * Capture-at-session-end: capture (all or part of) the held amount. Partial
 * capture releases the remainder automatically. The capture transfers the
 * payout to the Caregiver's connected account (the destination charge) — so this
 * satisfies both `enqueue-payment-capture` and `enqueue-payout`.
 */
export async function captureBooking(
  stripe: StripeAdapter,
  input: CaptureBookingInput,
): Promise<{ patch: BookingPaymentPatch }> {
  await stripe.capturePaymentIntent({
    id: input.paymentIntentId,
    amountToCaptureCents: input.captureAmountCents,
    applicationFeeCents: input.commissionCents,
    idempotencyKey: `booking:capture:${input.bookingId}`,
  });
  return {
    patch: {
      payment_status: 'captured',
      captured_amount_cents: input.captureAmountCents,
      commission_cents: input.commissionCents,
    },
  };
}

export interface ReleaseHoldInput {
  bookingId: string;
  /** null when the Booking never authorized (still `scheduled`). */
  paymentIntentId: string | null;
  /** The Booking's current payment status — captured ⇒ refund, else ⇒ cancel. */
  paymentStatus: BookingPaymentStatus | null;
  authorizedAmountCents?: number | null;
}

/**
 * Full release (`enqueue-payment-full-refund` — caregiver-decline / request-
 * expire / caregiver-cancel): release the uncaptured hold (cancel the PI), or
 * refund it if (unexpectedly) already captured. A `scheduled` Booking with no PI
 * is a no-op on Stripe.
 */
export async function releaseBookingHold(
  stripe: StripeAdapter,
  input: ReleaseHoldInput,
): Promise<{ patch: BookingPaymentPatch }> {
  if (!input.paymentIntentId) {
    return { patch: { payment_status: 'canceled' } };
  }
  if (input.paymentStatus === 'captured') {
    await stripe.refundPaymentIntent({
      id: input.paymentIntentId,
      idempotencyKey: `booking:refund:${input.bookingId}`,
    });
    return {
      patch: {
        payment_status: 'refunded',
        refunded_amount_cents: input.authorizedAmountCents ?? undefined,
      },
    };
  }
  await stripe.cancelPaymentIntent(input.paymentIntentId, `booking:release:${input.bookingId}`);
  return { patch: { payment_status: 'canceled' } };
}

export interface CancellationChargeInput {
  bookingId: string;
  paymentIntentId: string | null;
  /** The domain calculator's split (free / half / full). */
  cancellation: CancellationResult;
  commissionBp: number;
}

/**
 * Parent-cancel (`enqueue-payment-cancellation-charge`): apply the M2.5
 * calculator's split. Free tier (or no PI) ⇒ release the whole hold. Half/full
 * ⇒ partial-capture `chargeCents` (remainder released), with the Commission
 * recomputed on the captured charge (the fee still flows to the Caregiver, less
 * Commission — CONTEXT § Cancellation policy).
 */
export async function applyCancellationCharge(
  stripe: StripeAdapter,
  input: CancellationChargeInput,
): Promise<{ patch: BookingPaymentPatch }> {
  const { cancellation } = input;
  if (cancellation.chargeCents <= 0 || !input.paymentIntentId) {
    if (input.paymentIntentId) {
      await stripe.cancelPaymentIntent(
        input.paymentIntentId,
        `booking:cancel-release:${input.bookingId}`,
      );
    }
    return {
      patch: {
        payment_status: 'canceled',
        cancellation_tier: cancellation.tier,
        captured_amount_cents: 0,
        refunded_amount_cents: cancellation.refundCents,
      },
    };
  }
  const commissionCents = commissionOn(cancellation.chargeCents, input.commissionBp);
  await stripe.capturePaymentIntent({
    id: input.paymentIntentId,
    amountToCaptureCents: cancellation.chargeCents,
    applicationFeeCents: commissionCents,
    idempotencyKey: `booking:cancel-capture:${input.bookingId}`,
  });
  return {
    patch: {
      payment_status: 'captured',
      captured_amount_cents: cancellation.chargeCents,
      refunded_amount_cents: cancellation.refundCents,
      cancellation_tier: cancellation.tier,
      commission_cents: commissionCents,
    },
  };
}

/* ── Tip — post-session gratuity, commission-exempt (OH-215; ADR-0018) ────────
 * A Tip is NOT part of the engagement receipt: it is its own manual-capture
 * destination charge with `application_fee_amount = 0` (100% pass-through — the
 * domain `calculateTip` is the authority on that split). It stays a mutable
 * hold until the settlement cut-off (`TIP_SETTLE_HOURS` after the last edit),
 * when the worker-tick `tip_settle` sweep captures it — the capture IS the
 * pass-through payout. Editing cancels the old hold and places a new one;
 * setting `0` cancels and clears (ADR-0018 §3).
 * ──────────────────────────────────────────────────────────────────────────── */

/** The ADR-0018 §3 settlement cut-off: a tip is mutable for this long after the
 *  last edit, then captured (well inside Stripe's ~7-day hold validity). */
export const TIP_SETTLE_HOURS = 24;

export type TipStatus = 'requires_action' | 'authorized' | 'captured' | 'failed';

/** The tip-only columns a tip move sets. The caller merges `updated_at`. */
export interface TipPatch {
  tip_cents?: number | null;
  tip_payment_intent_id?: string | null;
  tip_status?: TipStatus | null;
  tip_settle_at?: Date | null;
  tip_captured_at?: Date | null;
}

export interface SetTipInput {
  bookingId: string;
  /** The new gratuity, integer cents. `0` clears any prior tip (ADR-0018 §3). */
  tipCents: number;
  /** The prior (uncaptured) tip hold to release, or null on a first tip. */
  oldTipPaymentIntentId: string | null;
  /** Caregiver's Connect Express account (`acct_…`) — the pass-through destination. */
  connectAccountId: string;
  /** Parent's Stripe Customer (`cus_…`). */
  customerId: string;
  /** Parent's saved card (`pm_…`). */
  paymentMethodId: string;
  description: string;
  /** The caller's clock — anchors `tip_settle_at` and the per-edit idempotency key. */
  now: Date;
}

export interface SetTipResult {
  patch: TipPatch;
  /** For the interactive path — the client confirms 3DS with this when needed. */
  clientSecret: string | null;
}

/**
 * Set / edit / clear the Booking's Tip. Cancels the prior hold (each edit is a
 * fresh PaymentIntent — a card hold can't be changed in place), then for a
 * non-zero amount places a new zero-fee hold on the Parent's card. The
 * authorize key is per-edit (`now`-stamped): unlike the engagement authorize, a
 * tip is legitimately re-created at the same amount after an intervening edit,
 * so a booking-stable key would replay a cancelled PI. Release/capture keys are
 * PI-scoped and deterministic.
 */
export async function setBookingTip(
  stripe: StripeAdapter,
  input: SetTipInput,
): Promise<SetTipResult> {
  // Domain authority on the split: validates the amount and pins the platform
  // take to 0 (`caregiverTipCents === tipCents` — ADR-0018 §2).
  const tip = calculateTip(input.tipCents);

  if (input.oldTipPaymentIntentId) {
    await stripe.cancelPaymentIntent(
      input.oldTipPaymentIntentId,
      `tip:release:${input.oldTipPaymentIntentId}`,
    );
  }

  if (tip.tipCents === 0) {
    return {
      patch: { tip_cents: null, tip_payment_intent_id: null, tip_status: null, tip_settle_at: null },
      clientSecret: null,
    };
  }

  const res = await stripe.createBookingPaymentIntent({
    amountCents: tip.caregiverTipCents,
    applicationFeeCents: tip.platformCommissionCents, // always 0 — no skim on a gift
    destinationAccountId: input.connectAccountId,
    description: input.description,
    metadata: { purpose: 'tip', booking_id: input.bookingId },
    customerId: input.customerId,
    paymentMethodId: input.paymentMethodId,
    confirm: true,
    offSession: false, // the Parent is in the sheet — 3DS surfaces interactively
    idempotencyKey: `tip:authorize:${input.bookingId}:${input.now.getTime()}`,
  });
  const status = mapAuthorizeStatus(res.status);
  return {
    patch: {
      tip_cents: tip.tipCents,
      tip_payment_intent_id: res.id,
      tip_status: status === 'authorized' || status === 'requires_action' || status === 'captured'
        ? status
        : 'failed',
      tip_settle_at: new Date(input.now.getTime() + TIP_SETTLE_HOURS * 60 * 60 * 1000),
    },
    clientSecret: res.client_secret || null,
  };
}

/**
 * Capture a due tip hold (the worker-tick `tip_settle` sweep): the full amount
 * transfers to the Caregiver's connected account with a 0 application fee — the
 * commission-exempt pass-through payout. After this the tip is immutable.
 */
export async function captureTip(
  stripe: StripeAdapter,
  input: { paymentIntentId: string; now: Date },
): Promise<{ patch: TipPatch }> {
  await stripe.capturePaymentIntent({
    id: input.paymentIntentId,
    applicationFeeCents: 0,
    idempotencyKey: `tip:capture:${input.paymentIntentId}`,
  });
  return {
    patch: { tip_status: 'captured', tip_settle_at: null, tip_captured_at: input.now },
  };
}

/**
 * Re-authorize on an adjust-time change (`enqueue-payment-reauthorize`). A card
 * hold can't be raised in place, so cancel the old PI and create a new one for
 * the new total. Helper for the adjust-time flow (OH ADR-0014) — the UI is
 * elsewhere; provided here so that ticket wires straight through.
 */
export async function reauthorizeBooking(
  stripe: StripeAdapter,
  input: AuthorizeBookingInput & { oldPaymentIntentId: string | null },
): Promise<AuthorizeBookingResult> {
  if (input.oldPaymentIntentId) {
    await stripe.cancelPaymentIntent(
      input.oldPaymentIntentId,
      `booking:reauth-release:${input.bookingId}`,
    );
  }
  return authorizeBooking(stripe, input);
}
