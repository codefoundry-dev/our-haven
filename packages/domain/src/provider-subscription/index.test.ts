import { describe, expect, it } from 'vitest';

import {
  deriveListingDecision,
  isListedStatus,
  isStripeSubscriptionStatus,
  LISTED_SUBSCRIPTION_STATUSES,
  STRIPE_SUBSCRIPTION_STATUSES,
  type StripeSubscriptionStatus,
} from './index.js';

describe('provider-subscription listing gate', () => {
  describe('isStripeSubscriptionStatus', () => {
    it('accepts every Stripe status and rejects junk', () => {
      for (const s of STRIPE_SUBSCRIPTION_STATUSES) expect(isStripeSubscriptionStatus(s)).toBe(true);
      expect(isStripeSubscriptionStatus('expired')).toBe(false);
      expect(isStripeSubscriptionStatus('')).toBe(false);
    });
  });

  describe('isListedStatus', () => {
    it('lists only active + trialing', () => {
      expect(LISTED_SUBSCRIPTION_STATUSES).toEqual(['active', 'trialing']);
      expect(isListedStatus('active')).toBe(true);
      expect(isListedStatus('trialing')).toBe(true);
    });

    it('does NOT list past_due (no dunning grace) or any other lapsed state', () => {
      const notListed: StripeSubscriptionStatus[] = [
        'past_due',
        'canceled',
        'unpaid',
        'incomplete',
        'incomplete_expired',
        'paused',
      ];
      for (const s of notListed) expect(isListedStatus(s)).toBe(false);
    });

    it('treats a missing subscription (null) as not listed', () => {
      expect(isListedStatus(null)).toBe(false);
    });
  });

  describe('deriveListingDecision', () => {
    it('active → listed with reason active', () => {
      expect(deriveListingDecision({ status: 'active' })).toEqual({
        listed: true,
        status: 'active',
        reason: 'active',
      });
    });

    it('trialing → listed with reason trialing', () => {
      expect(deriveListingDecision({ status: 'trialing' })).toEqual({
        listed: true,
        status: 'trialing',
        reason: 'trialing',
      });
    });

    it('null → not listed with reason none', () => {
      expect(deriveListingDecision({ status: null })).toEqual({
        listed: false,
        status: null,
        reason: 'none',
      });
    });

    it('past_due / canceled / unpaid → not listed with reason inactive', () => {
      for (const status of ['past_due', 'canceled', 'unpaid', 'incomplete', 'paused'] as const) {
        expect(deriveListingDecision({ status })).toEqual({ listed: false, status, reason: 'inactive' });
      }
    });
  });
});
