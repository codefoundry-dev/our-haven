import { sql, type SqlBool } from 'kysely';

import type { Db } from './db/kysely.ts';
// Cross-tree, Deno-clean domain module (ADR-0019; explicit-`.ts`). The Booking
// state machine is the single authority for the auto-complete transition — the
// sweep claims the due rows and applies what the domain returns.
import {
  transitionBooking,
  type BookingState,
} from '../../../packages/domain/src/booking-lifecycle/index.ts';
// The Stripe adapter + booking-payment orchestration live on the `api` function;
// the payment sweeps reuse them cross-function (Deno resolves the relative `.ts`
// at bundle time — same mechanism as the domain import above).
import type { StripeAdapter } from '../api/vendors/stripe.ts';
import {
  authorizeBooking,
  captureBooking,
  captureTip,
  commissionOn,
  releaseBookingHold,
} from '../api/services/booking-payments.ts';

/**
 * Due-row sweeps for the minute tick (ADR-0019 § Decision 4; OH-237).
 *
 * "Due work is rows; a tick processes them." Each sweep scans a deadline/expiry
 * column (`WHERE deadline <= now() AND state = …`), claims the due rows with
 * `FOR UPDATE SKIP LOCKED` so overlapping ticks never double-process, and acts
 * on them inside one transaction.
 *
 * Two due-work sources exist today:
 *   - FCRA screening disposal (`provider_screenings.purge_at`) — the
 *     background-check raw 6-month retention sweep (CONTEXT § Retention;
 *     @our-haven/domain `RETENTION_HORIZONS.BACKGROUND_CHECK_RAW_RETENTION_MONTHS`).
 *   - Consultation auto-complete (`bookings.auto_complete_at`, OH-203) — an
 *     `accepted` Provider Booking auto-completes once its slot end has passed
 *     (null payment, no payout; the booking-lifecycle `consultation-auto-complete`
 *     transition).
 *
 * The remaining Booking 24h-expiry / Session auto-confirm / Offer 72h-expiry and
 * the retention/erasure sweeps named in ADR-0019 land here as their owning
 * tickets add the deadline columns (OH-179 / OH-2.13): implement a `Sweep` that
 * scans the deadline column and applies the matching action. OH-182 ships the
 * pure policy those sweeps consume — `planErasure` → `dueDirectives(plan, now)` in
 * @our-haven/domain `retention-planner` decides the {category, action, dueAt}; a
 * sweep stays a thin "claim due rows, apply the directive" loop.
 */

export interface SweepContext {
  now: Date;
  /** Per-sweep row cap so a runaway backlog cannot blow up one tick. */
  limit: number;
  /** Stripe adapter for the booking-payment sweeps (OH-211). Absent when Stripe
   *  is unconfigured — those sweeps then log + skip rather than throw. */
  stripe?: StripeAdapter;
  /** Platform Commission (basis points) for the lazy authorize-due sweep. */
  commissionBp?: number;
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

/**
 * Consultation auto-complete (OH-203; CONTEXT § Booking — Provider slot-pick,
 * ADR-0011). A per-session Provider Booking is born `accepted` when the Parent
 * books the slot; once the slot end (`auto_complete_at`) has passed it
 * auto-completes — `accepted → completed` — with NO payment side effect (the
 * clinical service is paid off-platform). The held slot stays held (the
 * consultation happened); cancellation, not completion, is what releases a slot.
 *
 * Claimed with `FOR UPDATE SKIP LOCKED` and completed in the same transaction.
 */
/** The auto-complete claim, factored out so a unit test can assert the generated
 *  SQL carries `for update` + `skip locked` without a live database. */
export function dueConsultationsQuery(db: Db, now: Date, limit: number) {
  return db
    .selectFrom('bookings')
    .select(['id', 'state'])
    .where('kind', '=', 'provider')
    .where('state', '=', 'accepted')
    .where('auto_complete_at', 'is not', null)
    .where('auto_complete_at', '<=', now)
    .orderBy('auto_complete_at', 'asc')
    .limit(limit)
    .forUpdate()
    .skipLocked();
}

export const consultationAutoCompleteSweep: Sweep = {
  name: 'consultation_auto_complete',
  run(db, { now, limit }) {
    return db.transaction().execute(async (trx) => {
      const due = (await dueConsultationsQuery(trx, now, limit).execute()) as {
        id: string;
        state: BookingState;
      }[];

      // The Booking state machine is the authority: a consultation completes only
      // from `accepted`. The WHERE already constrains it, but routing through the
      // domain keeps the transition rule in one place (and skips anything it rejects).
      const ids = due
        .filter((row) => {
          const r = transitionBooking({ kind: 'provider', state: row.state }, { type: 'consultation-auto-complete' });
          return r.ok && r.next === 'completed';
        })
        .map((row) => row.id);

      if (ids.length === 0) return { name: 'consultation_auto_complete', processed: 0 };

      await trx
        .updateTable('bookings')
        .set({ state: 'completed', updated_at: now })
        .where('id', 'in', ids)
        .execute();

      return { name: 'consultation_auto_complete', processed: ids.length };
    });
  },
};

/* ── Booking payment sweeps (OH-211) ───────────────────────────────────────────
 * Three deadline sweeps drive the Caregiver payment lifecycle off the request
 * path. Each routes its transition through `transitionBooking` (the state-machine
 * authority) and its money move through the shared booking-payment orchestration.
 * Stripe calls carry deterministic idempotency keys, so a redelivered/overlapping
 * tick is a no-op; a per-row try/catch isolates one bad PaymentIntent from the
 * rest of the batch (a JS throw does not abort the surrounding PG transaction).
 * ──────────────────────────────────────────────────────────────────────────── */

/** A `scheduled` occurrence due for its lazy off-session authorization. */
interface AuthorizeDueRow {
  id: string;
  parent_uid: string;
  provider_id: string;
  authorized_amount_cents: number | null;
  commission_bp: number | null;
  commission_cents: number | null;
}

export function dueAuthorizeQuery(db: Db, now: Date, limit: number) {
  return db
    .selectFrom('bookings')
    .select(['id', 'parent_uid', 'provider_id', 'authorized_amount_cents', 'commission_bp', 'commission_cents'])
    .where('payment_status', '=', 'scheduled')
    .where('authorize_at', 'is not', null)
    .where('authorize_at', '<=', now)
    .orderBy('authorize_at', 'asc')
    .limit(limit)
    .forUpdate()
    .skipLocked();
}

/**
 * Lazy authorize-due (OH-211): a Booking born `scheduled` at Award (far-future
 * one-off / every Series occurrence) is authorized off-session ~48h before its
 * start, holding the estimated total on the Parent's saved card. Opportunistic
 * 3DS surfaces as `requires_action` — the row leaves `scheduled` (so it is not
 * re-swept) and the Parent is notified to complete authentication.
 */
export const bookingAuthorizeDueSweep: Sweep = {
  name: 'booking_authorize_due',
  async run(db, { now, limit, stripe, commissionBp }) {
    if (!stripe) return { name: 'booking_authorize_due', processed: 0, error: 'stripe_unconfigured' };
    return db.transaction().execute(async (trx) => {
      const due = (await dueAuthorizeQuery(trx, now, limit).execute()) as AuthorizeDueRow[];
      let processed = 0;
      for (const row of due) {
        try {
          const connect = (await trx
            .selectFrom('provider_connect_accounts')
            .select(['stripe_account_id', 'charges_enabled', 'payouts_enabled'])
            .where('provider_id', '=', row.provider_id)
            .executeTakeFirst()) as
            | { stripe_account_id: string | null; charges_enabled: boolean; payouts_enabled: boolean }
            | undefined;
          const sub = (await trx
            .selectFrom('parent_subscriptions')
            .select(['stripe_customer_id'])
            .where('uid', '=', row.parent_uid)
            .executeTakeFirst()) as { stripe_customer_id: string | null } | undefined;
          const connectAccountId = connect?.stripe_account_id;
          const customerId = sub?.stripe_customer_id;
          if (!connectAccountId || !connect?.charges_enabled || !connect?.payouts_enabled || !customerId) {
            continue; // not payable yet — leave `scheduled` for a later tick
          }
          const paymentMethodId = await stripe.retrieveCustomerDefaultPaymentMethod(customerId);
          if (!paymentMethodId) continue;

          const amountCents = row.authorized_amount_cents ?? 0;
          const bp = row.commission_bp ?? commissionBp ?? 0;
          const commissionCents = row.commission_cents ?? commissionOn(amountCents, bp);
          const { patch, clientSecret } = await authorizeBooking(stripe, {
            bookingId: row.id,
            amountCents,
            commissionCents,
            commissionBp: bp,
            connectAccountId,
            customerId,
            paymentMethodId,
            description: `Our Haven booking ${row.id}`,
            offSession: true,
          });
          await trx
            .updateTable('bookings')
            .set({ ...patch, authorize_at: null, updated_at: now })
            .where('id', '=', row.id)
            .execute();
          // 3DS needed off-session → nudge the Parent to complete it on-session.
          if (patch.payment_status === 'requires_action') {
            await trx
              .insertInto('notification_outbox')
              .values({
                recipient_uid: row.parent_uid,
                event_type: 'booking_authorization_action_required',
                payload: { bookingId: row.id },
                dedupe_key: `booking_auth_action:${patch.payment_intent_id ?? row.id}`,
              })
              .onConflict((oc) => oc.column('dedupe_key').doNothing())
              .execute();
          }
          void clientSecret;
          processed++;
        } catch (e) {
          console.error('[booking_authorize_due] authorize failed', row.id, e);
        }
      }
      return { name: 'booking_authorize_due', processed };
    });
  },
};

/** A `requested` Booking whose 24h Caregiver-accept window has elapsed. */
interface RequestExpiryRow {
  id: string;
  state: BookingState;
  origin: 'posted-job' | 'direct-message' | null;
  payment_intent_id: string | null;
  payment_status:
    | 'scheduled'
    | 'requires_action'
    | 'authorized'
    | 'captured'
    | 'canceled'
    | 'refunded'
    | 'failed'
    | null;
}

export function dueRequestExpiryQuery(db: Db, now: Date, limit: number) {
  return db
    .selectFrom('bookings')
    .select(['id', 'state', 'origin', 'payment_intent_id', 'payment_status'])
    .where('state', '=', 'requested')
    .where('request_expires_at', 'is not', null)
    .where('request_expires_at', '<=', now)
    .orderBy('request_expires_at', 'asc')
    .limit(limit)
    .forUpdate()
    .skipLocked();
}

/**
 * Request-expiry (OH-211; closes OH-210's flagged hole): a posted-Job Booking is
 * born `requested` with a 24h Caregiver-accept window. On expiry it auto-declines
 * (`request-expire` → `expired`) and the authorization hold is released.
 */
export const bookingRequestExpirySweep: Sweep = {
  name: 'booking_request_expiry',
  async run(db, { now, limit, stripe }) {
    if (!stripe) return { name: 'booking_request_expiry', processed: 0, error: 'stripe_unconfigured' };
    return db.transaction().execute(async (trx) => {
      const due = (await dueRequestExpiryQuery(trx, now, limit).execute()) as RequestExpiryRow[];
      let processed = 0;
      for (const row of due) {
        const r = transitionBooking(
          { kind: 'caregiver', origin: row.origin ?? 'posted-job', state: row.state },
          { type: 'request-expire' },
        );
        if (!r.ok || r.next !== 'expired') continue;
        try {
          const { patch } = await releaseBookingHold(stripe, {
            bookingId: row.id,
            paymentIntentId: row.payment_intent_id,
            paymentStatus: row.payment_status,
          });
          await trx
            .updateTable('bookings')
            .set({ state: 'expired', ...patch, updated_at: now })
            .where('id', '=', row.id)
            .execute();
          processed++;
        } catch (e) {
          console.error('[booking_request_expiry] release failed', row.id, e);
        }
      }
      return { name: 'booking_request_expiry', processed };
    });
  },
};

/** An `awaiting-confirmation` Booking past its ~24h review deadline. */
interface AutoConfirmRow {
  id: string;
  state: BookingState;
  origin: 'posted-job' | 'direct-message' | null;
  payment_intent_id: string | null;
  authorized_amount_cents: number | null;
  computed_total_cents: number | null;
  proposed_amount_cents: number | null;
  commission_bp: number | null;
}

export function dueAutoConfirmQuery(db: Db, now: Date, limit: number) {
  return db
    .selectFrom('bookings')
    .select([
      'id',
      'state',
      'origin',
      'payment_intent_id',
      'authorized_amount_cents',
      'computed_total_cents',
      'proposed_amount_cents',
      'commission_bp',
    ])
    .where('state', '=', 'awaiting-confirmation')
    .where('confirm_deadline_at', 'is not', null)
    .where('confirm_deadline_at', '<=', now)
    .orderBy('confirm_deadline_at', 'asc')
    .limit(limit)
    .forUpdate()
    .skipLocked();
}

/**
 * Session auto-confirm (OH-211; ADR-0013): when the ~24h review window closes
 * with no dispute, the Booking auto-confirms (`session-auto-confirm` →
 * `completed`), the held amount is captured, and the payout releases (the
 * destination-charge capture IS the payout). Capture uses the Caregiver's
 * proposed hours (OH-218/219) when present, else the booked estimate.
 */
export const sessionAutoConfirmSweep: Sweep = {
  name: 'session_auto_confirm',
  async run(db, { now, limit, stripe }) {
    if (!stripe) return { name: 'session_auto_confirm', processed: 0, error: 'stripe_unconfigured' };
    return db.transaction().execute(async (trx) => {
      const due = (await dueAutoConfirmQuery(trx, now, limit).execute()) as AutoConfirmRow[];
      let processed = 0;
      for (const row of due) {
        const r = transitionBooking(
          { kind: 'caregiver', origin: row.origin ?? 'posted-job', state: row.state },
          { type: 'session-auto-confirm' },
        );
        if (!r.ok || r.next !== 'completed') continue;
        if (!row.payment_intent_id) continue; // never authorized — nothing to capture
        try {
          const authorized = row.authorized_amount_cents ?? row.computed_total_cents ?? 0;
          const captureAmountCents =
            row.proposed_amount_cents != null ? Math.min(row.proposed_amount_cents, authorized) : authorized;
          const commissionCents = commissionOn(captureAmountCents, row.commission_bp ?? 0);
          const { patch } = await captureBooking(stripe, {
            bookingId: row.id,
            paymentIntentId: row.payment_intent_id,
            captureAmountCents,
            commissionCents,
          });
          await trx
            .updateTable('bookings')
            .set({ state: 'completed', confirmed_at: now, ...patch, updated_at: now })
            .where('id', '=', row.id)
            .execute();
          processed++;
        } catch (e) {
          console.error('[session_auto_confirm] capture failed', row.id, e);
        }
      }
      return { name: 'session_auto_confirm', processed };
    });
  },
};

/** A live tip hold past its ~24h settlement cut-off (OH-215; ADR-0018 §3). */
interface TipSettleRow {
  id: string;
  provider_id: string;
  tip_cents: number | null;
  tip_payment_intent_id: string | null;
  tip_status: string | null;
}

export function dueTipSettleQuery(db: Db, now: Date, limit: number) {
  return db
    .selectFrom('bookings')
    .select(['id', 'provider_id', 'tip_cents', 'tip_payment_intent_id', 'tip_status'])
    .where('tip_status', 'in', ['authorized', 'requires_action'])
    .where('tip_settle_at', 'is not', null)
    .where('tip_settle_at', '<=', now)
    .orderBy('tip_settle_at', 'asc')
    .limit(limit)
    .forUpdate()
    .skipLocked();
}

/**
 * Tip settlement (OH-215; ADR-0018 §3): a tip stays a mutable card hold for
 * ~24h after the Parent's last edit; when the cut-off passes, capture it with a
 * 0 application fee — the commission-exempt pass-through IS the payout — and
 * the tip becomes immutable. A hold still stuck on `requires_action` at the
 * cut-off (an abandoned 3DS challenge) never confirmed, so it is released and
 * the tip cleared — the Parent may simply tip again.
 */
export const tipSettleSweep: Sweep = {
  name: 'tip_settle',
  async run(db, { now, limit, stripe }) {
    if (!stripe) return { name: 'tip_settle', processed: 0, error: 'stripe_unconfigured' };
    return db.transaction().execute(async (trx) => {
      const due = (await dueTipSettleQuery(trx, now, limit).execute()) as TipSettleRow[];
      let processed = 0;
      for (const row of due) {
        if (!row.tip_payment_intent_id) continue;
        try {
          if (row.tip_status === 'requires_action') {
            // Abandoned 3DS — the hold never confirmed; release + clear the tip.
            await stripe.cancelPaymentIntent(
              row.tip_payment_intent_id,
              `tip:release:${row.tip_payment_intent_id}`,
            );
            await trx
              .updateTable('bookings')
              .set({
                tip_cents: null,
                tip_payment_intent_id: null,
                tip_status: null,
                tip_settle_at: null,
                updated_at: now,
              })
              .where('id', '=', row.id)
              .execute();
            processed++;
            continue;
          }

          const { patch } = await captureTip(stripe, {
            paymentIntentId: row.tip_payment_intent_id,
            now,
          });
          await trx
            .updateTable('bookings')
            .set({ ...patch, updated_at: now })
            .where('id', '=', row.id)
            .execute();
          // Tell the Caregiver their gratuity landed — 100%, no skim (ADR-0018).
          const supply = (await trx
            .selectFrom('providers')
            .select(['uid'])
            .where('id', '=', row.provider_id)
            .executeTakeFirst()) as { uid: string } | undefined;
          if (supply?.uid) {
            await trx
              .insertInto('notification_outbox')
              .values({
                recipient_uid: supply.uid,
                event_type: 'booking_tip_received',
                payload: { bookingId: row.id, tipCents: row.tip_cents ?? 0 },
                dedupe_key: `booking_tip_received:${row.tip_payment_intent_id}`,
              })
              .onConflict((oc) => oc.column('dedupe_key').doNothing())
              .execute();
          }
          processed++;
        } catch (e) {
          console.error('[tip_settle] settle failed', row.id, e);
        }
      }
      return { name: 'tip_settle', processed };
    });
  },
};

/** Every sweep the minute tick runs. Append future deadline sweeps here. */
export const SWEEPS: readonly Sweep[] = [
  screeningDisposalSweep,
  consultationAutoCompleteSweep,
  bookingAuthorizeDueSweep,
  bookingRequestExpirySweep,
  sessionAutoConfirmSweep,
  tipSettleSweep,
];
