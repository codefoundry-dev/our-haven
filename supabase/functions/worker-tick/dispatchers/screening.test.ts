import { describe, expect, it, vi } from 'vitest';

import { SCREENING_INVITE_EVENT, type ScreeningInvitePayload } from '../../_shared/screening-invite.ts';
import type { BackgroundCheckAdapter } from '../../../../packages/domain/src/background-check/index.ts';
import type { Db } from '../db/kysely.ts';
import type { OutboxRow } from '../outbox.ts';
import { createScreeningInviteDispatcher } from './screening.ts';

function makeDb(screening?: Record<string, unknown> | null) {
  const captures = {
    updates: [] as Array<{ table: string; set: Record<string, unknown> }>,
  };
  const trx = {
    updateTable: (table: string) => {
      const chain: Record<string, unknown> = {
        set: (set: Record<string, unknown>) => {
          captures.updates.push({ table, set });
          return chain;
        },
        where: () => chain,
        execute: async () => [],
      };
      return chain;
    },
  };
  const selectFrom = (_table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      where: () => chain,
      executeTakeFirst: async () => screening ?? undefined,
    };
    return chain;
  };
  const db = {
    selectFrom,
    transaction: () => ({ execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx) }),
  } as unknown as Db;
  return { db, captures };
}

function makeCheckr(
  initiateScreening = vi.fn(async () => ({ vendorReportId: 'rep_1', candidateActionUrl: 'https://apply.checkr.test/x' })),
): BackgroundCheckAdapter {
  return {
    vendor: 'checkr',
    initiateScreening,
    verifySignature: () => false,
    normalizeWebhookEvent: () => null,
  };
}

const PAYLOAD: ScreeningInvitePayload = {
  screeningId: 'screening-1',
  providerId: 'prov-1',
  email: 'cg@example.com',
  firstName: 'Casey',
  lastName: 'Giver',
  state: 'CA',
};

function inviteRow(payload: ScreeningInvitePayload = PAYLOAD): OutboxRow {
  return {
    id: 'outbox-1',
    recipient_uid: 'uid-cg',
    event_type: SCREENING_INVITE_EVENT,
    payload: payload as unknown as Record<string, unknown>,
    attempts: 0,
    max_attempts: 8,
  };
}

describe('createScreeningInviteDispatcher', () => {
  it('delegates non-screening events to the fallback dispatcher (and never calls Checkr)', async () => {
    const fallback = { dispatch: vi.fn(async () => {}) };
    const checkr = makeCheckr();
    const stub = new Proxy({} as never, { get: () => stub }) as Db;
    const dispatcher = createScreeningInviteDispatcher({ db: stub, checkr, fallback });

    const row: OutboxRow = { ...inviteRow(), event_type: 'booking.requested' };
    await dispatcher.dispatch(row);

    expect(fallback.dispatch).toHaveBeenCalledWith(row);
    expect(checkr.initiateScreening).not.toHaveBeenCalled();
  });

  it('initiates the Checkr screening and writes back the report id + screening_initiated_at', async () => {
    const { db, captures } = makeDb({ id: 'screening-1', status: 'payment_succeeded' });
    const checkr = makeCheckr();
    const dispatcher = createScreeningInviteDispatcher({ db, checkr });

    await dispatcher.dispatch(inviteRow());

    expect(checkr.initiateScreening).toHaveBeenCalledWith({
      providerId: 'prov-1',
      email: 'cg@example.com',
      firstName: 'Casey',
      lastName: 'Giver',
      state: 'CA',
      correlationId: 'screening-1',
    });

    const screeningSet = captures.updates.find((u) => u.table === 'provider_screenings')!.set;
    expect(screeningSet).toMatchObject({
      status: 'in_progress',
      vendor_report_id: 'rep_1',
      candidate_action_url: 'https://apply.checkr.test/x',
    });
    expect(screeningSet.initiated_at).toBeInstanceOf(Date);

    const verificationSet = captures.updates.find((u) => u.table === 'provider_verifications')!.set;
    expect(verificationSet.screening_initiated_at).toBeInstanceOf(Date);
  });

  it('is idempotent: skips the Checkr call when the row is no longer payment_succeeded', async () => {
    const { db, captures } = makeDb({ id: 'screening-1', status: 'in_progress' });
    const checkr = makeCheckr();
    const dispatcher = createScreeningInviteDispatcher({ db, checkr });

    await dispatcher.dispatch(inviteRow());

    expect(checkr.initiateScreening).not.toHaveBeenCalled();
    expect(captures.updates).toHaveLength(0);
  });

  it('treats a missing screening row as handled (no Checkr call, no throw)', async () => {
    const { db, captures } = makeDb(null);
    const checkr = makeCheckr();
    const dispatcher = createScreeningInviteDispatcher({ db, checkr });

    await expect(dispatcher.dispatch(inviteRow())).resolves.toBeUndefined();
    expect(checkr.initiateScreening).not.toHaveBeenCalled();
    expect(captures.updates).toHaveLength(0);
  });

  it('throws on a malformed payload (the drain retries / backs off)', async () => {
    const { db } = makeDb({ id: 'screening-1', status: 'payment_succeeded' });
    const checkr = makeCheckr();
    const dispatcher = createScreeningInviteDispatcher({ db, checkr });

    const bad: OutboxRow = { ...inviteRow(), payload: { providerId: 'prov-1' } };
    await expect(dispatcher.dispatch(bad)).rejects.toThrow(/malformed payload/);
  });

  it('propagates a Checkr failure so the outbox row is retried', async () => {
    const { db } = makeDb({ id: 'screening-1', status: 'payment_succeeded' });
    const checkr = makeCheckr(
      vi.fn(async () => {
        throw new Error('checkr /candidates failed: 503');
      }),
    );
    const dispatcher = createScreeningInviteDispatcher({ db, checkr });

    await expect(dispatcher.dispatch(inviteRow())).rejects.toThrow(/checkr/);
  });
});
