import {
  drainOutboxTx,
  loggingDispatcher,
  type DrainResult,
  type NotificationDispatcher,
} from './outbox.ts';
import { SWEEPS, type Sweep, type SweepResult } from './sweeps.ts';
import type { Db } from './db/kysely.ts';

/**
 * One tick (ADR-0019 § Decision 4; OH-237): drain the notification outbox, then
 * run every due-row sweep. Each step is isolated — a sweep that throws is
 * recorded as an error on its result and does not abort the others or the
 * drain — so a single bad sweep can never wedge the whole tick.
 */
export interface TickSummary {
  ranAt: string;
  drain: DrainResult;
  sweeps: SweepResult[];
}

export interface TickOptions {
  now?: Date;
  dispatcher?: NotificationDispatcher;
  sweeps?: readonly Sweep[];
  outboxLimit?: number;
  sweepLimit?: number;
  /** Injectable drain step (defaults to the transactional Kysely drain) so the
   *  orchestration is unit-testable without a database. */
  drain?: (
    db: Db,
    dispatcher: NotificationDispatcher,
    opts: { now: Date; limit: number },
  ) => Promise<DrainResult>;
}

export async function runTick(db: Db, opts: TickOptions = {}): Promise<TickSummary> {
  const now = opts.now ?? new Date();
  const dispatcher = opts.dispatcher ?? loggingDispatcher;
  const sweeps = opts.sweeps ?? SWEEPS;
  const drain = opts.drain ?? drainOutboxTx;

  const drainResult = await drain(db, dispatcher, { now, limit: opts.outboxLimit ?? 100 });

  const sweepResults: SweepResult[] = [];
  for (const sweep of sweeps) {
    try {
      sweepResults.push(await sweep.run(db, { now, limit: opts.sweepLimit ?? 1000 }));
    } catch (err) {
      sweepResults.push({
        name: sweep.name,
        processed: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ranAt: now.toISOString(), drain: drainResult, sweeps: sweepResults };
}
