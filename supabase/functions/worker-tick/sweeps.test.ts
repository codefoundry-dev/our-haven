import { describe, expect, it } from 'vitest';

import {
  bookingAuthorizeDueSweep,
  bookingRequestExpirySweep,
  consultationAutoCompleteSweep,
  dueAutoConfirmQuery,
  dueAuthorizeQuery,
  dueConsultationsQuery,
  dueExpiredJobsQuery,
  dueJobWarningsQuery,
  dueOffersQuery,
  dueRemindersQuery,
  dueRequestExpiryQuery,
  dueScreeningsQuery,
  jobExpirySweep,
  jobExpiryWarnSweep,
  offerExpirySweep,
  screeningDisposalSweep,
  sessionAutoConfirmSweep,
  sessionStartReminderSweep,
  SWEEPS,
} from './sweeps.ts';
import { compileOnlyDb } from './_test/env.ts';

/** A flat db fake (no transaction) for the reminder / job-warn sweeps that read +
 *  enqueue directly on `db`. The query chain resolves to `dueRows`; inserts are captured. */
function makeFlatDb(dueRows: Record<string, unknown>[]) {
  const inserts: Array<{ values: Record<string, unknown> }> = [];
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    innerJoin: () => chain,
    select: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    execute: async () => dueRows,
  });
  const db = {
    selectFrom: () => chain,
    insertInto: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflict: () => ({
          execute: async () => {
            inserts.push({ values: v });
            return [];
          },
        }),
      }),
    }),
  } as unknown as Parameters<typeof sessionStartReminderSweep.run>[0];
  return { db, inserts };
}

/** A table-routed trx fake: select* resolve to `rows[table]`, writes are captured. */
function makeTrx(rows: Record<string, Record<string, unknown>[]> = {}) {
  const updates: Array<{ table: string; set: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const selectChain = (table: string) => {
    const c: Record<string, unknown> = {
      select: () => c,
      where: () => c,
      orderBy: () => c,
      limit: () => c,
      forUpdate: () => c,
      skipLocked: () => c,
      execute: async () => rows[table] ?? [],
      executeTakeFirst: async () => (rows[table] ?? [])[0],
    };
    return c;
  };
  const trx: Record<string, unknown> = {
    selectFrom: (t: string) => selectChain(t),
    updateTable: (t: string) => ({
      set: (set: Record<string, unknown>) => ({
        where: () => ({
          execute: async () => {
            updates.push({ table: t, set });
            return [];
          },
        }),
      }),
    }),
    insertInto: (t: string) => ({
      values: (values: Record<string, unknown>) => ({
        onConflict: () => ({
          execute: async () => {
            inserts.push({ table: t, values });
            return [];
          },
        }),
      }),
    }),
  };
  const db = {
    transaction: () => ({ execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx) }),
  } as unknown as Parameters<typeof sessionAutoConfirmSweep.run>[0];
  return { db, updates, inserts };
}

function makeStripe(over: Record<string, unknown> = {}) {
  return {
    retrieveCustomerDefaultPaymentMethod: async () => 'pm_x',
    createBookingPaymentIntent: async () => ({ id: 'pi_new', client_secret: 's', status: 'requires_capture' }),
    capturePaymentIntent: async () => ({ id: 'pi_1', status: 'succeeded', amount: 0 }),
    cancelPaymentIntent: async () => ({ id: 'pi_1', status: 'canceled', amount: 0 }),
    ...over,
  } as unknown as NonNullable<Parameters<typeof sessionAutoConfirmSweep.run>[1]['stripe']>;
}

const NOW = new Date('2026-07-12T12:00:00Z');

describe('SWEEPS registry', () => {
  it('includes screening + consultation + booking-payment + the OH-223 notification sweeps in order', () => {
    expect(SWEEPS.map((s) => s.name)).toEqual([
      'screening_disposal',
      'consultation_auto_complete',
      'booking_authorize_due',
      'booking_request_expiry',
      'session_auto_confirm',
      'session_start_reminder',
      'offer_expiry',
      'job_expiry_warn',
      'job_expiry',
    ]);
  });
});

describe('dueConsultationsQuery (SKIP LOCKED claim)', () => {
  it('compiles to a FOR UPDATE SKIP LOCKED select bounded by auto_complete_at', () => {
    const { sql } = dueConsultationsQuery(compileOnlyDb(), new Date('2026-07-10T12:00:00Z'), 1000).compile();
    const lower = sql.toLowerCase();

    expect(lower).toContain('for update');
    expect(lower).toContain('skip locked');
    expect(lower).toContain('"auto_complete_at" <=');
    // Only accepted Provider consultations are claimed.
    expect(lower).toContain('"kind" =');
    expect(lower).toContain('"state" =');
  });
});

describe('consultationAutoCompleteSweep', () => {
  it('completes due accepted consultations and reports the count', async () => {
    const updates: Array<{ set: Record<string, unknown>; ids: unknown }> = [];
    const trx = {
      selectFrom: () => trx,
      select: () => trx,
      where: () => trx,
      orderBy: () => trx,
      limit: () => trx,
      forUpdate: () => trx,
      skipLocked: () => trx,
      execute: async () => [
        { id: 'b1', state: 'accepted' },
        { id: 'b2', state: 'accepted' },
      ],
      updateTable: () => ({
        set: (set: Record<string, unknown>) => ({
          where: (_c: unknown, _op: unknown, ids: unknown) => ({
            execute: async () => {
              updates.push({ set, ids });
              return [];
            },
          }),
        }),
      }),
    } as unknown as Parameters<typeof consultationAutoCompleteSweep.run>[0];
    const db = {
      transaction: () => ({ execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx) }),
    } as unknown as Parameters<typeof consultationAutoCompleteSweep.run>[0];

    const result = await consultationAutoCompleteSweep.run(db, { now: new Date('2026-07-10T12:00:00Z'), limit: 1000 });
    expect(result).toEqual({ name: 'consultation_auto_complete', processed: 2 });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.set).toMatchObject({ state: 'completed' });
    expect(updates[0]!.ids).toEqual(['b1', 'b2']);
  });

  it('processes nothing when no consultation is due', async () => {
    const trx = {
      selectFrom: () => trx,
      select: () => trx,
      where: () => trx,
      orderBy: () => trx,
      limit: () => trx,
      forUpdate: () => trx,
      skipLocked: () => trx,
      execute: async () => [],
    } as unknown as Parameters<typeof consultationAutoCompleteSweep.run>[0];
    const db = {
      transaction: () => ({ execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx) }),
    } as unknown as Parameters<typeof consultationAutoCompleteSweep.run>[0];

    const result = await consultationAutoCompleteSweep.run(db, { now: new Date(), limit: 1000 });
    expect(result).toEqual({ name: 'consultation_auto_complete', processed: 0 });
  });
});

describe('dueScreeningsQuery (SKIP LOCKED claim)', () => {
  it('compiles to a FOR UPDATE SKIP LOCKED select bounded by purge_at', () => {
    const { sql } = dueScreeningsQuery(compileOnlyDb(), new Date('2026-06-26T12:00:00Z'), 100).compile();
    const lower = sql.toLowerCase();

    expect(lower).toContain('for update');
    expect(lower).toContain('skip locked');
    expect(lower).toContain('"purge_at" <=');
    // Only rows still holding raw FCRA-disposable detail.
    expect(lower).toContain('"vendor_report_id" is not null');
    expect(lower).toContain('"candidate_action_url" is not null');
    expect(lower).toContain("'{}'::jsonb");
  });
});

// ── Booking payment sweeps (OH-211) ────────────────────────────────────────────
describe('booking-payment due queries (SKIP LOCKED claims)', () => {
  it('dueAuthorizeQuery scans scheduled rows by authorize_at', () => {
    const { sql } = dueAuthorizeQuery(compileOnlyDb(), NOW, 1000).compile();
    const lower = sql.toLowerCase();
    expect(lower).toContain('for update');
    expect(lower).toContain('skip locked');
    expect(lower).toContain('"payment_status" =');
    expect(lower).toContain('"authorize_at" <=');
  });
  it('dueRequestExpiryQuery scans requested rows by request_expires_at', () => {
    const { sql } = dueRequestExpiryQuery(compileOnlyDb(), NOW, 1000).compile();
    const lower = sql.toLowerCase();
    expect(lower).toContain('for update');
    expect(lower).toContain('skip locked');
    expect(lower).toContain('"request_expires_at" <=');
  });
  it('dueAutoConfirmQuery scans awaiting-confirmation rows by confirm_deadline_at', () => {
    const { sql } = dueAutoConfirmQuery(compileOnlyDb(), NOW, 1000).compile();
    const lower = sql.toLowerCase();
    expect(lower).toContain('for update');
    expect(lower).toContain('skip locked');
    expect(lower).toContain('"confirm_deadline_at" <=');
  });
});

describe('bookingAuthorizeDueSweep', () => {
  it('skips (records an error) when Stripe is unconfigured', async () => {
    const { db } = makeTrx();
    const res = await bookingAuthorizeDueSweep.run(db, { now: NOW, limit: 100 });
    expect(res).toMatchObject({ name: 'booking_authorize_due', processed: 0, error: 'stripe_unconfigured' });
  });

  it('authorizes a scheduled occurrence off-session and clears authorize_at', async () => {
    const { db, updates } = makeTrx({
      bookings: [
        { id: 'b1', parent_uid: 'u1', provider_id: 'p1', authorized_amount_cents: 10000, commission_bp: 1500, commission_cents: 1500 },
      ],
      provider_connect_accounts: [{ stripe_account_id: 'acct', charges_enabled: true, payouts_enabled: true }],
      parent_subscriptions: [{ stripe_customer_id: 'cus' }],
    });
    const res = await bookingAuthorizeDueSweep.run(db, { now: NOW, limit: 100, stripe: makeStripe(), commissionBp: 1500 });
    expect(res).toEqual({ name: 'booking_authorize_due', processed: 1 });
    expect(updates[0]!.set).toMatchObject({
      payment_status: 'authorized',
      payment_intent_id: 'pi_new',
      authorize_at: null,
    });
  });

  it('leaves a row scheduled when the caregiver has no ready payout account', async () => {
    const { db, updates } = makeTrx({
      bookings: [{ id: 'b1', parent_uid: 'u1', provider_id: 'p1', authorized_amount_cents: 10000, commission_bp: 1500, commission_cents: 1500 }],
      provider_connect_accounts: [],
      parent_subscriptions: [{ stripe_customer_id: 'cus' }],
    });
    const res = await bookingAuthorizeDueSweep.run(db, { now: NOW, limit: 100, stripe: makeStripe(), commissionBp: 1500 });
    expect(res.processed).toBe(0);
    expect(updates).toHaveLength(0);
  });
});

describe('bookingRequestExpirySweep', () => {
  it('expires a stale requested Booking, releases the hold, and notifies the Parent', async () => {
    const { db, updates, inserts } = makeTrx({
      bookings: [{ id: 'b1', state: 'requested', parent_uid: 'par-1', origin: 'posted-job', payment_intent_id: 'pi_1', payment_status: 'authorized' }],
    });
    const res = await bookingRequestExpirySweep.run(db, { now: NOW, limit: 100, stripe: makeStripe() });
    expect(res).toEqual({ name: 'booking_request_expiry', processed: 1 });
    expect(updates[0]!.set).toMatchObject({ state: 'expired', payment_status: 'canceled' });
    expect(inserts.find((i) => i.table === 'notification_outbox')?.values).toMatchObject({
      recipient_uid: 'par-1',
      event_type: 'booking_expired',
      payload: { bookingId: 'b1' },
    });
  });
});

// ── OH-223 notification-producing sweeps ───────────────────────────────────────
describe('OH-223 due queries', () => {
  it('dueRemindersQuery joins providers, filters accepted, and is NOT a locking claim', () => {
    const end = new Date(NOW.getTime() + 60 * 60 * 1000);
    const { sql } = dueRemindersQuery(compileOnlyDb(), NOW, end, 1000).compile();
    const lower = sql.toLowerCase();
    expect(lower).toContain('inner join');
    expect(lower).toContain("time zone 'utc'");
    expect(lower).toContain('"state" =');
    // A reminder is read-only — no row is claimed/locked (the outbox dedupe guards it).
    expect(lower).not.toContain('for update');
  });
  it('dueOffersQuery is a SKIP LOCKED claim on pending offers by valid_until', () => {
    const { sql } = dueOffersQuery(compileOnlyDb(), NOW, 1000).compile();
    const lower = sql.toLowerCase();
    expect(lower).toContain('for update');
    expect(lower).toContain('skip locked');
    expect(lower).toContain('"valid_until" <=');
    expect(lower).toContain('"status" =');
  });
  it('dueJobWarningsQuery bounds by expires_at and excludes Jobs with Applications', () => {
    const end = new Date(NOW.getTime() + 48 * 60 * 60 * 1000);
    const { sql } = dueJobWarningsQuery(compileOnlyDb(), NOW, end, 1000).compile();
    const lower = sql.toLowerCase();
    expect(lower).toContain('"expires_at" <=');
    expect(lower).toContain('not exists');
    expect(lower).toContain('applications');
  });
  it('dueExpiredJobsQuery is a SKIP LOCKED claim on open Jobs past expires_at', () => {
    const { sql } = dueExpiredJobsQuery(compileOnlyDb(), NOW, 1000).compile();
    const lower = sql.toLowerCase();
    expect(lower).toContain('for update');
    expect(lower).toContain('skip locked');
    expect(lower).toContain('"expires_at" <=');
  });
});

describe('sessionStartReminderSweep', () => {
  it('reminds BOTH sides of an imminent session (parent + supply)', async () => {
    const { db, inserts } = makeFlatDb([{ id: 'b1', parent_uid: 'par-1', provider_uid: 'sup-1' }]);
    const res = await sessionStartReminderSweep.run(db, { now: NOW, limit: 100 });
    expect(res).toEqual({ name: 'session_start_reminder', processed: 1 });
    const recips = inserts.map((i) => i.values.recipient_uid).sort();
    expect(recips).toEqual(['par-1', 'sup-1']);
    expect(inserts.every((i) => i.values.event_type === 'session_start_reminder')).toBe(true);
    expect(inserts.every((i) => (i.values.payload as { bookingId: string }).bookingId === 'b1')).toBe(true);
  });

  it('processes nothing when no session is imminent', async () => {
    const { db, inserts } = makeFlatDb([]);
    const res = await sessionStartReminderSweep.run(db, { now: NOW, limit: 100 });
    expect(res).toEqual({ name: 'session_start_reminder', processed: 0 });
    expect(inserts).toHaveLength(0);
  });
});

describe('offerExpirySweep', () => {
  it('expires pending Offers and notifies the sender', async () => {
    const { db, updates, inserts } = makeTrx({
      offers: [{ id: 'o1', thread_id: 't1', sender_uid: 'snd-1' }],
    });
    const res = await offerExpirySweep.run(db, { now: NOW, limit: 100 });
    expect(res).toEqual({ name: 'offer_expiry', processed: 1 });
    expect(updates.find((u) => u.table === 'offers')?.set).toMatchObject({ status: 'expired' });
    expect(inserts.find((i) => i.table === 'notification_outbox')?.values).toMatchObject({
      recipient_uid: 'snd-1',
      event_type: 'offer_expired',
      payload: { threadId: 't1' },
    });
  });
});

describe('jobExpiryWarnSweep', () => {
  it('warns the Parent about an application-less Job nearing expiry', async () => {
    const { db, inserts } = makeFlatDb([{ id: 'j1', parent_uid: 'par-1' }]);
    const res = await jobExpiryWarnSweep.run(db, { now: NOW, limit: 100 });
    expect(res).toEqual({ name: 'job_expiry_warn', processed: 1 });
    expect(inserts[0]!.values).toMatchObject({
      recipient_uid: 'par-1',
      event_type: 'job_expiring_48h',
      payload: { jobId: 'j1' },
    });
  });
});

describe('jobExpirySweep', () => {
  it('expires an unawarded open Job and notifies the Parent', async () => {
    const { db, updates, inserts } = makeTrx({ jobs: [{ id: 'j1', parent_uid: 'par-1' }] });
    const res = await jobExpirySweep.run(db, { now: NOW, limit: 100 });
    expect(res).toEqual({ name: 'job_expiry', processed: 1 });
    expect(updates.find((u) => u.table === 'jobs')?.set).toMatchObject({ state: 'expired' });
    expect(inserts.find((i) => i.table === 'notification_outbox')?.values).toMatchObject({
      recipient_uid: 'par-1',
      event_type: 'job_expired_no_award',
      payload: { jobId: 'j1' },
    });
  });
});

describe('sessionAutoConfirmSweep', () => {
  it('captures + completes a Booking past its review deadline', async () => {
    const { db, updates } = makeTrx({
      bookings: [
        {
          id: 'b1',
          state: 'awaiting-confirmation',
          origin: 'posted-job',
          payment_intent_id: 'pi_1',
          authorized_amount_cents: 10000,
          computed_total_cents: 10000,
          proposed_amount_cents: null,
          commission_bp: 1500,
        },
      ],
    });
    const res = await sessionAutoConfirmSweep.run(db, { now: NOW, limit: 100, stripe: makeStripe() });
    expect(res).toEqual({ name: 'session_auto_confirm', processed: 1 });
    expect(updates[0]!.set).toMatchObject({
      state: 'completed',
      payment_status: 'captured',
      captured_amount_cents: 10000,
      commission_cents: 1500,
    });
    expect(updates[0]!.set.confirmed_at).toBe(NOW);
  });

  it('skips a Booking that never authorized (no PaymentIntent)', async () => {
    const { db, updates } = makeTrx({
      bookings: [
        { id: 'b1', state: 'awaiting-confirmation', origin: 'posted-job', payment_intent_id: null, authorized_amount_cents: 10000, computed_total_cents: 10000, proposed_amount_cents: null, commission_bp: 1500 },
      ],
    });
    const res = await sessionAutoConfirmSweep.run(db, { now: NOW, limit: 100, stripe: makeStripe() });
    expect(res.processed).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
