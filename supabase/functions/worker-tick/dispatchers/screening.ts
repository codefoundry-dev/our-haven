import {
  SCREENING_INVITE_EVENT,
  type ScreeningInvitePayload,
} from '../../_shared/screening-invite.ts';
// The pure reducer (@our-haven/domain, OH-181) + the vendor-agnostic adapter
// type. Value import of the reducer via explicit `.ts` (erased adapter type is
// type-only) — the Edge import map carries no `@our-haven/*` entry.
import {
  reduceBackgroundCheckEvent,
  type BackgroundCheckAdapter,
} from '../../../../packages/domain/src/background-check/index.ts';
import type { Db } from '../db/kysely.ts';
import { loggingDispatcher, type NotificationDispatcher, type OutboxRow } from '../outbox.ts';

/**
 * The `screening.invite` dispatcher (OH-185) — the durable, off-request-path
 * half of the Checkr integration (ADR-0019 § Decision 5; OH-237 substrate).
 *
 * The api payments webhook enqueues a `screening.invite` outbox row (carrying the
 * applicant's identity) the instant the $35 charge succeeds, then acks fast. This
 * dispatcher, draining that row on the worker-tick, makes the SLOW Checkr calls
 * (POST /candidates + POST /invitations) and persists the result. Running off the
 * tick survives isolate recycling: a crash mid-flight leaves the outbox row
 * unmarked, so the next tick re-drains it.
 *
 * Two idempotency layers keep a re-drain (after a crash, or a Stripe redelivery
 * that slipped past the dedupe key) from creating a second Checkr candidate:
 *   - the row is only acted on while `provider_screenings.status = payment_succeeded`;
 *   - the status flip to `in_progress` is guarded `WHERE status = 'payment_succeeded'`.
 * The only true duplicate window is a crash between Checkr returning and the
 * status write — the same narrow window the Fastify original carried.
 *
 * IMPORTANT — the `db` here MUST be a SEPARATE connection from the one the outbox
 * drain runs on: `drainOutboxTx` holds the drain's single pooled connection inside
 * a transaction for the life of the dispatch (the SKIP-LOCKED guarantee), so a
 * write through that same handle would deadlock against `max:1`. index.ts passes a
 * dedicated `createDb(env)` handle for exactly this reason. Non-screening event
 * types fall through to `loggingDispatcher` (OH-194 supplies the real channels).
 */

export interface ScreeningInviteDispatcherDeps {
  /** A DEDICATED db handle (separate pool from the outbox drain) — see note above. */
  db: Db;
  checkr: BackgroundCheckAdapter;
  /** Dispatcher for every other event_type. Defaults to the OH-237 logging no-op. */
  fallback?: NotificationDispatcher;
}

export function createScreeningInviteDispatcher(
  deps: ScreeningInviteDispatcherDeps,
): NotificationDispatcher {
  const fallback = deps.fallback ?? loggingDispatcher;

  return {
    async dispatch(row: OutboxRow): Promise<void> {
      if (row.event_type !== SCREENING_INVITE_EVENT) {
        return fallback.dispatch(row);
      }

      const payload = row.payload as unknown as ScreeningInvitePayload;
      if (!payload?.screeningId || !payload.providerId) {
        throw new Error('screening.invite: malformed payload (missing screeningId/providerId)');
      }

      const screening = await deps.db
        .selectFrom('provider_screenings')
        .select(['id', 'status'])
        .where('id', '=', payload.screeningId)
        .executeTakeFirst();

      if (!screening) {
        // Row gone (hard-deleted by the FCRA disposal sweep, say). Nothing to do —
        // treat as handled so the outbox stops retrying.
        console.warn('[worker-tick] screening.invite: no screening row', payload.screeningId);
        return;
      }
      // Already invited (in_progress / terminal) or reset — idempotent no-op.
      if (screening.status !== 'payment_succeeded') {
        return;
      }

      // The slow vendor call — OUTSIDE any transaction (it is external HTTP).
      const result = await deps.checkr.initiateScreening({
        providerId: payload.providerId,
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        state: payload.state,
        correlationId: payload.screeningId,
      });

      const initiatedAt = new Date();
      const factsPatch = reduceBackgroundCheckEvent({
        kind: 'initiated',
        vendorReportId: result.vendorReportId,
        occurredAt: initiatedAt,
      });

      // Persist the report id + the initiated fact atomically. Quick local writes,
      // on the dedicated handle (not the drain's locked connection).
      await deps.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('provider_screenings')
          .set({
            status: 'in_progress',
            vendor_report_id: result.vendorReportId,
            candidate_action_url: result.candidateActionUrl ?? null,
            initiated_at: initiatedAt,
            updated_at: initiatedAt,
          })
          .where('id', '=', payload.screeningId)
          .where('status', '=', 'payment_succeeded')
          .execute();

        await trx
          .updateTable('provider_verifications')
          .set({ ...factsPatch, updated_at: initiatedAt })
          .where('provider_id', '=', payload.providerId)
          .execute();
      });
    },
  };
}
