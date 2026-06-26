import { describe, expect, it } from 'vitest';

import {
  ACCESS_GRANTING_STATUSES,
  deriveAccessDecision,
  isAccessGrantingStatus,
  isStripeSubscriptionStatus,
  STRIPE_SUBSCRIPTION_STATUSES,
  type StripeSubscriptionStatus,
} from './index.js';

describe('parent-subscription access gate', () => {
  describe('isStripeSubscriptionStatus', () => {
    it('accepts every Stripe status and rejects junk', () => {
      for (const s of STRIPE_SUBSCRIPTION_STATUSES) expect(isStripeSubscriptionStatus(s)).toBe(true);
      expect(isStripeSubscriptionStatus('expired')).toBe(false);
      expect(isStripeSubscriptionStatus('')).toBe(false);
    });
  });

  describe('isAccessGrantingStatus', () => {
    it('entitles only active + trialing', () => {
      expect(ACCESS_GRANTING_STATUSES).toEqual(['active', 'trialing']);
      expect(isAccessGrantingStatus('active')).toBe(true);
      expect(isAccessGrantingStatus('trialing')).toBe(true);
    });

    it('does NOT entitle past_due (no dunning grace) or any other lapsed state', () => {
      const notEntitled: StripeSubscriptionStatus[] = [
        'past_due',
        'canceled',
        'unpaid',
        'incomplete',
        'incomplete_expired',
        'paused',
      ];
      for (const s of notEntitled) expect(isAccessGrantingStatus(s)).toBe(false);
    });

    it('treats a missing subscription (null) as not entitled', () => {
      expect(isAccessGrantingStatus(null)).toBe(false);
    });
  });

  describe('deriveAccessDecision', () => {
    it('active → entitled with reason active', () => {
      expect(deriveAccessDecision({ status: 'active' })).toEqual({
        entitled: true,
        status: 'active',
        reason: 'active',
      });
    });

    it('trialing → entitled with reason trialing', () => {
      expect(deriveAccessDecision({ status: 'trialing' })).toEqual({
        entitled: true,
        status: 'trialing',
        reason: 'trialing',
      });
    });

    it('null → not entitled with reason none (free browse account)', () => {
      expect(deriveAccessDecision({ status: null })).toEqual({
        entitled: false,
        status: null,
        reason: 'none',
      });
    });

    it('past_due / canceled / unpaid / incomplete / paused → not entitled with reason inactive', () => {
      for (const status of ['past_due', 'canceled', 'unpaid', 'incomplete', 'paused'] as const) {
        expect(deriveAccessDecision({ status })).toEqual({ entitled: false, status, reason: 'inactive' });
      }
    });
  });
});
