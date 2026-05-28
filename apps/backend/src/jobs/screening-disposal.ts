/**
 * FCRA 6-month disposal for background-screening raw data (OH-106).
 *
 * Per CONTEXT.md § Retention policy + ADR-0007: raw screening details
 * (`provider_screenings.raw_payload`, vendor-side ids, candidate-action URL)
 * are retained 6 months maximum, then hard-deleted. The cleared/not status
 * remains on `provider_verifications.screening_passed_at` / `rejected_at`,
 * which is what every downstream consumer reads.
 *
 * v1 implementation: a function the retention scheduler in OH-2.14 / OH-118
 * calls on a daily cron. The function is split into a dryRun selector and a
 * purger so admin tooling can preview before deleting.
 *
 * The actual cron wiring lives in the retention-planner queue worker (OH-2.14);
 * this module is intentionally not enqueued from inside the webhook handlers
 * — purge_at is a row property and disposal is a sweep, not an event chain.
 */

import type { Db } from '@/db/kysely.js';

export interface DisposalResult {
  scannedAt: Date;
  rowsScanned: number;
  rowsPurged: number;
  rowIds: string[];
}

/**
 * Find rows whose `purge_at` has elapsed but still hold raw vendor details.
 * Returned for admin preview / dryRun. The select is bounded by `limit` so
 * a runaway backlog cannot blow up.
 */
export async function selectDueForDisposal(
  db: Db,
  now: Date = new Date(),
  limit = 1000,
): Promise<Array<{ id: string }>> {
  const rows = await db
    .selectFrom('provider_screenings')
    .select(['id'])
    .where('purge_at', '<=', now)
    .where((eb) =>
      eb.or([
        eb('vendor_report_id', 'is not', null),
        eb('candidate_action_url', 'is not', null),
        eb('raw_payload', '<>', '{}' as never),
      ]),
    )
    .limit(limit)
    .execute();
  return rows.map((r) => ({ id: r.id }));
}

/**
 * Hard-clear raw FCRA-disposable fields on rows past `purge_at`.
 *
 * Does NOT delete the row — that would lose the cleared/not status. Instead
 * nulls out vendor identifiers + clears the raw payload to `{}`. The status
 * column is preserved so the audit trail keeps "this Provider was screened
 * and cleared on date X" without retaining what the vendor returned.
 */
export async function purgeDueScreenings(
  db: Db,
  now: Date = new Date(),
  limit = 1000,
): Promise<DisposalResult> {
  const due = await selectDueForDisposal(db, now, limit);
  const ids = due.map((r) => r.id);

  if (ids.length === 0) {
    return { scannedAt: now, rowsScanned: 0, rowsPurged: 0, rowIds: [] };
  }

  await db
    .updateTable('provider_screenings')
    .set({
      vendor_report_id: null,
      candidate_action_url: null,
      raw_payload: {},
      updated_at: now,
    })
    .where('id', 'in', ids)
    .execute();

  return {
    scannedAt: now,
    rowsScanned: ids.length,
    rowsPurged: ids.length,
    rowIds: ids,
  };
}
