import { describe, expect, it, vi, type Mock } from 'vitest';

import type { ExpoPushAdapter } from '../../_shared/expo-push.ts';
import type { ResendAdapter } from '../../_shared/resend.ts';
import type { TwilioAdapter } from '../../_shared/twilio.ts';
import type { WebPushAdapter } from '../../_shared/web-push.ts';
import type { OutboxRow } from '../outbox.ts';
import {
  createNotificationsDispatcher,
  type RecipientContacts,
  type RecipientResolver,
} from './notifications.ts';

const BASES = { mobile: 'ourhaven://', web: 'https://provider.ourhaven.com/' };

const FULL_CONTACTS: RecipientContacts = {
  email: 'cg@example.com',
  phone: '15551230000',
  expoPushTokens: ['ExponentPushToken[aaa]'],
  webPushSubscriptions: [{ endpoint: 'https://push.example.com/abc' }],
};

function makeResolver(contacts: RecipientContacts = FULL_CONTACTS): RecipientResolver & {
  pruneExpoTokens: ReturnType<typeof vi.fn>;
  pruneWebPushEndpoints: ReturnType<typeof vi.fn>;
} {
  return {
    resolve: vi.fn(async () => contacts),
    pruneExpoTokens: vi.fn(async () => {}),
    pruneWebPushEndpoints: vi.fn(async () => {}),
  };
}

function makeAdapters() {
  const expoPush: ExpoPushAdapter = {
    sendPush: vi.fn(async () => ({ tickets: [{ status: 'ok' as const }], invalidTokens: [] })),
  };
  const resend: ResendAdapter = { sendEmail: vi.fn(async () => ({ id: 'e1' })) };
  const twilio: TwilioAdapter = { sendSms: vi.fn(async () => ({ sid: 's1' })) };
  const webPush: WebPushAdapter = { sendTickle: vi.fn(async () => ({ sent: 1, goneEndpoints: [] })) };
  return { expoPush, resend, twilio, webPush };
}

/** First call's argument list of a vi mock (guarded for noUncheckedIndexedAccess). */
function firstCallArgs(fn: unknown): unknown[] {
  const first = (fn as Mock).mock.calls[0];
  if (!first) throw new Error('expected the mock to have been called');
  return first;
}

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 'outbox-1',
    recipient_uid: 'uid-1',
    event_type: 'application_received',
    payload: { jobId: 'j-1', actorName: 'Sam' },
    attempts: 0,
    max_attempts: 8,
    ...overrides,
  };
}

describe('createNotificationsDispatcher', () => {
  it('delegates unrecognised event types to the fallback (and touches no channel)', async () => {
    const fallback = { dispatch: vi.fn(async () => {}) };
    const a = makeAdapters();
    const dispatcher = createNotificationsDispatcher({
      resolver: makeResolver(),
      bases: BASES,
      ...a,
      fallback,
    });

    const r = row({ event_type: 'screening.invite' });
    await dispatcher.dispatch(r);

    expect(fallback.dispatch).toHaveBeenCalledWith(r);
    expect(a.twilio.sendSms).not.toHaveBeenCalled();
    expect(a.expoPush.sendPush).not.toHaveBeenCalled();
  });

  it('routes a push+email event to push + web_push + email, NOT sms', async () => {
    const a = makeAdapters();
    const dispatcher = createNotificationsDispatcher({ resolver: makeResolver(), bases: BASES, ...a });

    await dispatcher.dispatch(row());

    expect(a.twilio.sendSms).not.toHaveBeenCalled();
    expect(a.expoPush.sendPush).toHaveBeenCalledTimes(1);
    expect(a.webPush.sendTickle).toHaveBeenCalledTimes(1);
    expect(a.resend.sendEmail).toHaveBeenCalledTimes(1);

    const pushArg = (firstCallArgs(a.expoPush.sendPush)[0] as unknown[])[0];
    expect(pushArg).toMatchObject({
      to: 'ExponentPushToken[aaa]',
      title: 'New application',
      data: { kind: 'application_received', route: 'ourhaven://job/j-1' },
    });

    const emailArg = firstCallArgs(a.resend.sendEmail)[0] as {
      to: string;
      text: string;
      tags: Array<{ name: string; value: string }>;
    };
    expect(emailArg.to).toBe('cg@example.com');
    expect(emailArg.text).toContain('https://provider.ourhaven.com/job/j-1');
    expect(emailArg.tags).toEqual([
      { name: 'event_kind', value: 'application_received' },
      { name: 'dispatch_id', value: 'outbox-1' },
      { name: 'category', value: 'application_received' },
    ]);
  });

  it('sends the mandatory SMS (normalised to E.164) for an SMS-mandatory event', async () => {
    const a = makeAdapters();
    const dispatcher = createNotificationsDispatcher({ resolver: makeResolver(), bases: BASES, ...a });

    await dispatcher.dispatch(
      row({ event_type: 'booking_request_received', payload: { threadId: 't-1', actorName: 'Alex' } }),
    );

    expect(a.twilio.sendSms).toHaveBeenCalledTimes(1);
    const smsArg = firstCallArgs(a.twilio.sendSms)[0] as { to: string; body: string };
    expect(smsArg.to).toBe('+15551230000');
    expect(smsArg.body).toContain('Our Haven:');
    expect(smsArg.body).toContain('ourhaven://thread/t-1');
  });

  it('throws when an SMS-mandatory event has no Twilio configured (row retries, no other channel touched)', async () => {
    const a = makeAdapters();
    const dispatcher = createNotificationsDispatcher({
      resolver: makeResolver(),
      bases: BASES,
      expoPush: a.expoPush,
      resend: a.resend,
      webPush: a.webPush,
      // twilio intentionally absent
    });

    await expect(
      dispatcher.dispatch(row({ event_type: 'job_awarded', payload: { bookingId: 'b-2' } })),
    ).rejects.toThrow(/Twilio is not configured/);
    // SMS is attempted first, so the best-effort channels never ran (no duplicate on retry).
    expect(a.expoPush.sendPush).not.toHaveBeenCalled();
    expect(a.resend.sendEmail).not.toHaveBeenCalled();
  });

  it('throws when an SMS-mandatory recipient has no phone on file', async () => {
    const a = makeAdapters();
    const dispatcher = createNotificationsDispatcher({
      resolver: makeResolver({ ...FULL_CONTACTS, phone: null }),
      bases: BASES,
      ...a,
    });

    await expect(
      dispatcher.dispatch(row({ event_type: 'consultation_booked', payload: { bookingId: 'b-3' } })),
    ).rejects.toThrow(/no phone on file/);
  });

  it('is best-effort: a push failure does not block email, and the row succeeds', async () => {
    const a = makeAdapters();
    (a.expoPush.sendPush as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('expo 502'));
    const dispatcher = createNotificationsDispatcher({ resolver: makeResolver(), bases: BASES, ...a });

    await expect(dispatcher.dispatch(row())).resolves.toBeUndefined();
    expect(a.resend.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('throws when NOTHING was delivered and a best-effort channel errored (transient → retry)', async () => {
    const a = makeAdapters();
    (a.expoPush.sendPush as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('expo down'));
    (a.webPush.sendTickle as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ sent: 0, goneEndpoints: [] });
    (a.resend.sendEmail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('resend down'));
    const dispatcher = createNotificationsDispatcher({ resolver: makeResolver(), bases: BASES, ...a });

    await expect(dispatcher.dispatch(row())).rejects.toThrow(/all channels failed/);
  });

  it('marks done (no throw) when nothing was delivered only for want of destinations', async () => {
    const a = makeAdapters();
    const dispatcher = createNotificationsDispatcher({
      resolver: makeResolver({ email: null, phone: null, expoPushTokens: [], webPushSubscriptions: [] }),
      bases: BASES,
      ...a,
    });

    await expect(dispatcher.dispatch(row())).resolves.toBeUndefined();
    expect(a.expoPush.sendPush).not.toHaveBeenCalled();
    expect(a.resend.sendEmail).not.toHaveBeenCalled();
  });

  it('prunes Expo tokens Expo reports as DeviceNotRegistered', async () => {
    const a = makeAdapters();
    (a.expoPush.sendPush as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      tickets: [{ status: 'error' }],
      invalidTokens: ['ExponentPushToken[bbb]'],
    });
    const resolver = makeResolver();
    const dispatcher = createNotificationsDispatcher({ resolver, bases: BASES, ...a });

    await dispatcher.dispatch(row());
    expect(resolver.pruneExpoTokens).toHaveBeenCalledWith(['ExponentPushToken[bbb]']);
  });

  it('prunes web-push endpoints the push service reports gone', async () => {
    const a = makeAdapters();
    (a.webPush.sendTickle as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sent: 0,
      goneEndpoints: ['https://push.example.com/abc'],
    });
    const resolver = makeResolver();
    const dispatcher = createNotificationsDispatcher({ resolver, bases: BASES, ...a });

    await dispatcher.dispatch(row());
    expect(resolver.pruneWebPushEndpoints).toHaveBeenCalledWith(['https://push.example.com/abc']);
  });

  it('throws on a malformed payload (missing route param) before any send', async () => {
    const a = makeAdapters();
    const dispatcher = createNotificationsDispatcher({ resolver: makeResolver(), bases: BASES, ...a });

    await expect(dispatcher.dispatch(row({ payload: {} }))).rejects.toThrow(/jobId/);
    expect(a.expoPush.sendPush).not.toHaveBeenCalled();
  });

  it('skips a channel whose adapter is unconfigured without failing a non-mandatory event', async () => {
    const dispatcher = createNotificationsDispatcher({
      resolver: makeResolver(),
      bases: BASES,
      // only email configured
      resend: { sendEmail: vi.fn(async () => ({ id: 'e1' })) },
    });
    await expect(dispatcher.dispatch(row())).resolves.toBeUndefined();
  });
});
