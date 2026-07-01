/**
 * Booking payment-source resolvers (shared by the Award handler and the Parent
 * adjust-time re-authorize, OH-211/OH-212). A Caregiver Booking's real Stripe
 * money move needs two counterparties resolved from the DB: the Caregiver's
 * *ready* Connect Express account (the payout destination) and the Parent's
 * Stripe Customer + saved default card. Both are read the same way at Award and
 * at re-auth, so they live here rather than being duplicated per route.
 *
 * Deno-clean: type-only imports (`Db`, `StripeAdapter`); the Stripe call is
 * fetch-based via the adapter (ADR-0019).
 */
import type { Db } from '../db/kysely.ts';
import type { StripeAdapter } from '../vendors/stripe.ts';

/** The Caregiver's ready Connect account (`acct_…`), or null if not payable. */
export async function resolveCaregiverConnectAccount(
  db: Db,
  providerId: string,
): Promise<string | null> {
  const row = (await db
    .selectFrom('provider_connect_accounts')
    .select(['stripe_account_id', 'charges_enabled', 'payouts_enabled'])
    .where('provider_id', '=', providerId)
    .executeTakeFirst()) as
    | { stripe_account_id: string | null; charges_enabled: boolean; payouts_enabled: boolean }
    | undefined;
  if (!row?.stripe_account_id || !row.charges_enabled || !row.payouts_enabled) return null;
  return row.stripe_account_id;
}

/** The Parent's Stripe Customer + saved default card, or null if either is missing. */
export async function resolveParentPaymentSource(
  db: Db,
  stripe: StripeAdapter,
  uid: string,
): Promise<{ customerId: string; paymentMethodId: string } | null> {
  const sub = (await db
    .selectFrom('parent_subscriptions')
    .select(['stripe_customer_id'])
    .where('uid', '=', uid)
    .executeTakeFirst()) as { stripe_customer_id: string | null } | undefined;
  const customerId = sub?.stripe_customer_id;
  if (!customerId) return null;
  const paymentMethodId = await stripe.retrieveCustomerDefaultPaymentMethod(customerId);
  if (!paymentMethodId) return null;
  return { customerId, paymentMethodId };
}
