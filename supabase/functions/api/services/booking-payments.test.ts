import { describe, expect, it, vi } from 'vitest';

import type { StripeAdapter } from '../vendors/stripe.ts';
import {
  applyCancellationCharge,
  authorizeBooking,
  captureBooking,
  captureTip,
  commissionOn,
  mapAuthorizeStatus,
  priceBooking,
  reauthorizeBooking,
  releaseBookingHold,
  setBookingTip,
  TIP_SETTLE_HOURS,
} from './booking-payments.ts';

/** A Stripe stub whose booking-payment methods are vi.fn()s; everything else 503s. */
function makeStripe(over: Partial<StripeAdapter> = {}): StripeAdapter {
  const notImpl = () => {
    throw new Error('not stubbed');
  };
  const base = {
    createBookingPaymentIntent: vi.fn(async () => ({
      id: 'pi_new',
      client_secret: 'pi_new_secret',
      status: 'requires_capture',
    })),
    capturePaymentIntent: vi.fn(async () => ({ id: 'pi_1', status: 'succeeded', amount: 0 })),
    cancelPaymentIntent: vi.fn(async () => ({ id: 'pi_1', status: 'canceled', amount: 0 })),
    refundPaymentIntent: vi.fn(async () => ({ id: 're_1', status: 'succeeded' })),
    retrievePaymentIntent: vi.fn(notImpl),
    retrieveCustomerDefaultPaymentMethod: vi.fn(notImpl),
  } as unknown as StripeAdapter;
  return { ...base, ...over } as StripeAdapter;
}

const AUTH_INPUT = {
  bookingId: 'bkg-1',
  amountCents: 10_000,
  commissionCents: 1_500,
  commissionBp: 1_500,
  connectAccountId: 'acct_cg',
  customerId: 'cus_parent',
  paymentMethodId: 'pm_saved',
  description: 'Booking bkg-1',
};

describe('priceBooking', () => {
  it('computes the parent charge + 15% commission on a plain hourly booking', () => {
    const price = priceBooking({
      agreedRateCents: 2_500,
      hours: 4,
      childCount: 1,
      perChildSurchargeCents: 0,
      commissionBp: 1_500,
      category: 'babysitter',
    });
    expect(price.parentChargeCents).toBe(10_000); // $25 × 4h
    expect(price.commissionCents).toBe(1_500); // 15%
  });

  it('adds the per-child surcharge for multi-child bookings', () => {
    const price = priceBooking({
      agreedRateCents: 2_000,
      hours: 3,
      childCount: 2,
      perChildSurchargeCents: 500,
      commissionBp: 1_500,
      category: 'nanny',
    });
    // base $20×3 = 6000; surcharge $5/h × 3h × 1 extra child = 1500 → 7500
    expect(price.parentChargeCents).toBe(7_500);
    expect(price.commissionCents).toBe(1_125);
  });
});

describe('commissionOn', () => {
  it('rounds to the nearest cent', () => {
    expect(commissionOn(10_000, 1_500)).toBe(1_500);
    expect(commissionOn(3_333, 1_500)).toBe(500); // 499.95 → 500
  });
});

describe('mapAuthorizeStatus', () => {
  it('maps requires_capture → authorized', () => {
    expect(mapAuthorizeStatus('requires_capture')).toBe('authorized');
  });
  it('maps requires_action → requires_action', () => {
    expect(mapAuthorizeStatus('requires_action')).toBe('requires_action');
  });
  it('maps requires_payment_method → failed', () => {
    expect(mapAuthorizeStatus('requires_payment_method')).toBe('failed');
  });
});

describe('authorizeBooking', () => {
  it('creates a manual-capture PI and returns an authorized patch + client secret', async () => {
    const stripe = makeStripe();
    const res = await authorizeBooking(stripe, { ...AUTH_INPUT, offSession: false });
    expect(stripe.createBookingPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 10_000,
        applicationFeeCents: 1_500,
        destinationAccountId: 'acct_cg',
        customerId: 'cus_parent',
        paymentMethodId: 'pm_saved',
        confirm: true,
        offSession: false,
        idempotencyKey: 'booking:authorize:bkg-1',
        metadata: { purpose: 'booking', booking_id: 'bkg-1' },
      }),
    );
    expect(res.patch).toEqual({
      payment_intent_id: 'pi_new',
      payment_status: 'authorized',
      authorized_amount_cents: 10_000,
      commission_bp: 1_500,
      commission_cents: 1_500,
    });
    expect(res.clientSecret).toBe('pi_new_secret');
  });

  it('surfaces a requires_action (3DS) result', async () => {
    const stripe = makeStripe({
      createBookingPaymentIntent: vi.fn(async () => ({
        id: 'pi_3ds',
        client_secret: 'pi_3ds_secret',
        status: 'requires_action',
      })),
    });
    const res = await authorizeBooking(stripe, { ...AUTH_INPUT, offSession: true });
    expect(res.patch.payment_status).toBe('requires_action');
    expect(res.clientSecret).toBe('pi_3ds_secret');
  });
});

describe('captureBooking', () => {
  it('captures the amount with a recomputed application_fee', async () => {
    const stripe = makeStripe();
    const res = await captureBooking(stripe, {
      bookingId: 'bkg-1',
      paymentIntentId: 'pi_1',
      captureAmountCents: 10_000,
      commissionCents: 1_500,
    });
    expect(stripe.capturePaymentIntent).toHaveBeenCalledWith({
      id: 'pi_1',
      amountToCaptureCents: 10_000,
      applicationFeeCents: 1_500,
      idempotencyKey: 'booking:capture:bkg-1',
    });
    expect(res.patch).toEqual({
      payment_status: 'captured',
      captured_amount_cents: 10_000,
      commission_cents: 1_500,
    });
  });
});

describe('releaseBookingHold', () => {
  it('no-ops on Stripe for a scheduled booking with no PI', async () => {
    const stripe = makeStripe();
    const res = await releaseBookingHold(stripe, {
      bookingId: 'bkg-1',
      paymentIntentId: null,
      paymentStatus: 'scheduled',
    });
    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
    expect(res.patch.payment_status).toBe('canceled');
  });

  it('cancels an uncaptured hold', async () => {
    const stripe = makeStripe();
    const res = await releaseBookingHold(stripe, {
      bookingId: 'bkg-1',
      paymentIntentId: 'pi_1',
      paymentStatus: 'authorized',
    });
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_1', 'booking:release:bkg-1');
    expect(res.patch.payment_status).toBe('canceled');
  });

  it('refunds an already-captured booking', async () => {
    const stripe = makeStripe();
    const res = await releaseBookingHold(stripe, {
      bookingId: 'bkg-1',
      paymentIntentId: 'pi_1',
      paymentStatus: 'captured',
      authorizedAmountCents: 10_000,
    });
    expect(stripe.refundPaymentIntent).toHaveBeenCalledWith({
      id: 'pi_1',
      idempotencyKey: 'booking:refund:bkg-1',
    });
    expect(res.patch).toEqual({ payment_status: 'refunded', refunded_amount_cents: 10_000 });
  });
});

describe('applyCancellationCharge', () => {
  it('free tier releases the whole hold', async () => {
    const stripe = makeStripe();
    const res = await applyCancellationCharge(stripe, {
      bookingId: 'bkg-1',
      paymentIntentId: 'pi_1',
      cancellation: { chargeCents: 0, refundCents: 10_000, tier: 'free' },
      commissionBp: 1_500,
    });
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_1', 'booking:cancel-release:bkg-1');
    expect(stripe.capturePaymentIntent).not.toHaveBeenCalled();
    expect(res.patch).toEqual({
      payment_status: 'canceled',
      cancellation_tier: 'free',
      captured_amount_cents: 0,
      refunded_amount_cents: 10_000,
    });
  });

  it('half tier partial-captures the charge with commission on the charge', async () => {
    const stripe = makeStripe();
    const res = await applyCancellationCharge(stripe, {
      bookingId: 'bkg-1',
      paymentIntentId: 'pi_1',
      cancellation: { chargeCents: 5_000, refundCents: 5_000, tier: 'half' },
      commissionBp: 1_500,
    });
    expect(stripe.capturePaymentIntent).toHaveBeenCalledWith({
      id: 'pi_1',
      amountToCaptureCents: 5_000,
      applicationFeeCents: 750, // 15% of the $50 charge
      idempotencyKey: 'booking:cancel-capture:bkg-1',
    });
    expect(res.patch).toEqual({
      payment_status: 'captured',
      captured_amount_cents: 5_000,
      refunded_amount_cents: 5_000,
      cancellation_tier: 'half',
      commission_cents: 750,
    });
  });
});

describe('reauthorizeBooking', () => {
  it('cancels the old PI then authorizes the new total', async () => {
    const stripe = makeStripe();
    const res = await reauthorizeBooking(stripe, {
      ...AUTH_INPUT,
      offSession: false,
      oldPaymentIntentId: 'pi_old',
    });
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_old', 'booking:reauth-release:bkg-1');
    expect(stripe.createBookingPaymentIntent).toHaveBeenCalled();
    expect(res.patch.payment_status).toBe('authorized');
  });
});

// ── Tip — commission-exempt pass-through (OH-215; ADR-0018) ────────────────────

const NOW = new Date('2026-07-16T12:00:00Z');

const TIP_INPUT = {
  bookingId: 'bkg-1',
  tipCents: 1_000,
  oldTipPaymentIntentId: null,
  connectAccountId: 'acct_cg',
  customerId: 'cus_parent',
  paymentMethodId: 'pm_saved',
  description: 'Our Haven tip — booking bkg-1',
  now: NOW,
};

describe('setBookingTip', () => {
  it('places a ZERO-application-fee destination hold — 100% to the Caregiver', async () => {
    const stripe = makeStripe();
    const res = await setBookingTip(stripe, TIP_INPUT);
    expect(stripe.createBookingPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 1_000,
        applicationFeeCents: 0, // no Commission skim on a gift (ADR-0018 §2)
        destinationAccountId: 'acct_cg',
        confirm: true,
        offSession: false,
        metadata: { purpose: 'tip', booking_id: 'bkg-1' },
        idempotencyKey: `tip:authorize:bkg-1:${NOW.getTime()}`,
      }),
    );
    expect(res.patch).toMatchObject({
      tip_cents: 1_000,
      tip_payment_intent_id: 'pi_new',
      tip_status: 'authorized',
    });
    // The ADR-0018 §3 settlement cut-off anchors on the edit instant.
    expect(res.patch.tip_settle_at).toEqual(new Date(NOW.getTime() + TIP_SETTLE_HOURS * 60 * 60 * 1000));
    expect(res.clientSecret).toBe('pi_new_secret');
    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
  });

  it('releases the prior hold before placing the new one (edit)', async () => {
    const stripe = makeStripe();
    await setBookingTip(stripe, { ...TIP_INPUT, oldTipPaymentIntentId: 'pi_tip_old' });
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_tip_old', 'tip:release:pi_tip_old');
    expect(stripe.createBookingPaymentIntent).toHaveBeenCalled();
  });

  it('clears on tipCents 0: releases the hold, nulls the patch, no new PI', async () => {
    const stripe = makeStripe();
    const res = await setBookingTip(stripe, { ...TIP_INPUT, tipCents: 0, oldTipPaymentIntentId: 'pi_tip_old' });
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_tip_old', 'tip:release:pi_tip_old');
    expect(stripe.createBookingPaymentIntent).not.toHaveBeenCalled();
    expect(res.patch).toEqual({
      tip_cents: null,
      tip_payment_intent_id: null,
      tip_status: null,
      tip_settle_at: null,
    });
    expect(res.clientSecret).toBeNull();
  });

  it('surfaces a 3DS requires_action result', async () => {
    const stripe = makeStripe({
      createBookingPaymentIntent: vi.fn(async () => ({
        id: 'pi_3ds',
        client_secret: 'pi_3ds_secret',
        status: 'requires_action',
      })),
    });
    const res = await setBookingTip(stripe, TIP_INPUT);
    expect(res.patch.tip_status).toBe('requires_action');
    expect(res.clientSecret).toBe('pi_3ds_secret');
  });

  it('throws on caller-bug amounts (the domain calculateTip guard)', async () => {
    const stripe = makeStripe();
    await expect(setBookingTip(stripe, { ...TIP_INPUT, tipCents: -5 })).rejects.toThrow(/non-negative integer/);
    await expect(setBookingTip(stripe, { ...TIP_INPUT, tipCents: 10.5 })).rejects.toThrow(/non-negative integer/);
    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
  });
});

describe('captureTip', () => {
  it('captures the full hold with a 0 application fee — the pass-through payout', async () => {
    const stripe = makeStripe();
    const res = await captureTip(stripe, { paymentIntentId: 'pi_tip_1', now: NOW });
    expect(stripe.capturePaymentIntent).toHaveBeenCalledWith({
      id: 'pi_tip_1',
      applicationFeeCents: 0,
      idempotencyKey: 'tip:capture:pi_tip_1',
    });
    expect(res.patch).toEqual({ tip_status: 'captured', tip_settle_at: null, tip_captured_at: NOW });
  });
});
