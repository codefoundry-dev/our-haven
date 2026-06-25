import { sql, type SqlBool } from 'kysely';

import type { Db } from './db/kysely.ts';

/**
 * Due-row sweeps for the minute tick (ADR-0019 § Decision 4; OH-237).
 *
 * "Due work is rows; a tick processes them." Each sweep scans a deadline/expiry
 * column (`WHERE deadline <= now() AND state = …`), claims the due rows with
 * `FOR UPDATE SKIP LOCKED` so overlapping ticks never double-process, and acts
 * on them inside one transaction.
 *
 * Today exactly one due-work source exists in the schema — FCRA screening
 * disposal (`provider_screenings.purge_at`), which IS the background-check raw
 * 6-month retention sweep (CONTEXT § Retention; @our-haven/domain
 * `RETENTION_HORIZONS.BACKGROUND_CHECK_RAW_RETENTION_MONTHS`). The Booking
 * 24h-expiry, Session auto-confirm, Offer 72h-expiry and the remaining
 * retention/erasure sweeps named in ADR-0019 land here as their owning tickets
 * add the `bookings` / `offers` / account / message tables and their deadline
 * columns (OH-177 / OH-179 / OH-200 / OH-2.13): implement a `Sweep` that scans
 * the deadline column and applies the matching action. OH-182 ships the pure
 * policy those sweeps consume — `planErasure` → `dueDirectives(plan, now)` in
 * @our-haven/domain `retention-planner` decides the {category, action, dueAt};
 * a sweep stays a thin "claim due rows, apply the directive" loop.
 */

export interface SweepContext {
  now: Date;
  /** Per-sweep row cap so a runaway backlog cannot blow up one tick. */
  limit: number;
}

export interface SweepResult {
  name: string;
  processed: number;
  /** Set when the sweep threw — the tick records it and moves on. */
  error?: string;
}

export interface Sweep {
  name: string;
  run(db: Db, ctx: SweepContext): Promise<SweepResult>;
}

/**
 * FCRA 6-month disposal (CONTEXT.md § Retention policy; ADR-0007). Rows whose
 * `purge_at` has elapsed but still hold raw vendor details get those details
 * hard-cleared — vendor ids nulled, `raw_payload` reset to `{}`. The cleared/
 * not status on `provider_verifications` is untouched, so the audit trail keeps
 * "screened + cleared on date X" without retaining what the vendor returned.
 *
 * Claimed with `FOR UPDATE SKIP LOCKED` and purged in the same transaction.
 */
/** The screening-disposal claim, factored out so a unit test can assert the
 *  generated SQL carries `for update` + `skip locked` without a live database. */
export function dueScreeningsQuery(db: Db, now: Date, limit: number) {
  return db
    .selectFrom('provider_screenings')
    .select(['id'])
    .where('purge_at', '<=', now)
    .where((eb) =>
      eb.or([
        eb('vendor_report_id', 'is not', null),
        eb('candidate_action_url', 'is not', null),
        sql<SqlBool>`raw_payload <> '{}'::jsonb`,
      ]),
    )
    .orderBy('purge_at', 'asc')
    .limit(limit)
    .forUpdate()
    .skipLocked();
}

export const screeningDisposalSweep: Sweep = {
  name: 'screening_disposal',
  run(db, { now, limit }) {
    return db.transaction().execute(async (trx) => {
      const due = await dueScreeningsQuery(trx, now, limit).execute();

      const ids = due.map((r) => r.id);
      if (ids.length === 0) {
        return { name: 'screening_disposal', processed: 0 };
      }

      await trx
        .updateTable('provider_screenings')
        .set({
          vendor_report_id: null,
          candidate_action_url: null,
          raw_payload: {},
          updated_at: now,
        })
        .where('id', 'in', ids)
        .execute();

      return { name: 'screening_disposal', processed: ids.length };
    });
  },
};

/** Every sweep the minute tick runs. Append future deadline sweeps here. */
export const SWEEPS: readonly Sweep[] = [screeningDisposalSweep];
