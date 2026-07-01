import type { Db } from '../db/kysely.ts';

/**
 * The dispute queue (OH-213) — one shared insert used by every entry point so
 * they can never diverge: the in-window payout-holding dispute + the out-of-window
 * escalation (`routes/bookings.ts`), the no-show (also `bookings.ts`), and the
 * past-Job `Job.dispute` (`routes/jobs.ts`). Admin resolution reads/writes the
 * same rows (`routes/admin/disputes.ts`). ADR-0013 (amended) § Dispute.
 */

/** The reason chip shared with the OH-211 DisputeSheet. */
export type DisputeReason = 'overcharged' | 'no-show' | 'safety' | 'quality' | 'other';

export interface InsertDisputeInput {
  subjectType: 'booking' | 'job';
  subjectId: string;
  filedByUid: string;
  reason: DisputeReason;
  details?: string | null;
  /** True only for the in-window review dispute that auto-held the Payout. */
  inWindow: boolean;
  holdApplied: boolean;
}

/**
 * Insert the admin-queue dispute record. The partial-unique index
 * `(subject_type, subject_id) WHERE status='open'` makes a re-file while one is
 * still open a no-op, so this is safe to call on every dispute/no-show. Pass the
 * same `trx` as the surrounding domain write so the two commit atomically.
 */
export async function insertDisputeRecord(trx: Db, input: InsertDisputeInput): Promise<void> {
  await trx
    .insertInto('disputes')
    .values({
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      filed_by_uid: input.filedByUid,
      reason: input.reason,
      details: input.details ?? null,
      in_window: input.inWindow,
      hold_applied: input.holdApplied,
    })
    .onConflict((oc) =>
      oc.columns(['subject_type', 'subject_id']).where('status', '=', 'open').doNothing(),
    )
    .execute();
}
