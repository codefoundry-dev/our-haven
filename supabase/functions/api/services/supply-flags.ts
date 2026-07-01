import type { Db } from '../db/kysely.ts';
import {
  evaluateSupplyStanding,
  type SupplyStanding,
} from '../../../../packages/domain/src/booking-lifecycle/index.ts';

/**
 * Supply-quality standing (OH-213, CONTEXT § No-show). A no-show inserts an
 * `active` `supply_flags` row against the supply's `providers.id`; the count of
 * active no-show flags drives standing (2 → manual review, 3 → suspend). The
 * suspension is enforced by `isListable` reading `providers.suspended_at`.
 */

export type { SupplyStanding };

/** Count a supply's ACTIVE no-show flags (the only flags that drive suspension). */
export async function countActiveNoShowFlags(trx: Db, providerId: string): Promise<number> {
  const r = await trx
    .selectFrom('supply_flags')
    .select((eb) => eb.fn.countAll<string>().as('c'))
    .where('provider_id', '=', providerId)
    .where('status', '=', 'active')
    .where('reason', '=', 'no-show')
    .executeTakeFirst();
  return Number(r?.c ?? 0);
}

/**
 * Recompute a supply's standing from its active no-show flags and reconcile
 * `providers.suspended_at`: set it when the count reaches the suspend threshold,
 * lift it when the count drops below (the admin-dismiss recovery path). Returns
 * the resulting standing. Run inside the caller's transaction.
 */
export async function reconcileSupplyStanding(
  trx: Db,
  providerId: string,
  now: Date,
): Promise<SupplyStanding> {
  const standing = evaluateSupplyStanding(await countActiveNoShowFlags(trx, providerId));
  if (standing === 'suspended') {
    await trx
      .updateTable('providers')
      .set({ suspended_at: now })
      .where('id', '=', providerId)
      .where('suspended_at', 'is', null)
      .execute();
  } else {
    await trx
      .updateTable('providers')
      .set({ suspended_at: null })
      .where('id', '=', providerId)
      .where('suspended_at', 'is not', null)
      .execute();
  }
  return standing;
}
