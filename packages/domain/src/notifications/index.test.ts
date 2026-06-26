import { describe, expect, it } from 'vitest';

import {
  buildDeepLinks,
  buildRoutePath,
  CHANNEL_MATRIX,
  getChannelMatrixEntry,
  isNotificationEventKind,
  NOTIFICATION_EVENT_KINDS,
  renderNotification,
  type DeepLinkBases,
  type NotificationEventKind,
} from './index.js';

const BASES: DeepLinkBases = {
  mobile: 'ourhaven://',
  web: 'https://provider.ourhaven.com/',
};

describe('channel matrix', () => {
  it('every event kind has a matrix entry, and the registry matches the matrix keys', () => {
    expect(Object.keys(CHANNEL_MATRIX).sort()).toEqual([...NOTIFICATION_EVENT_KINDS].sort());
  });

  it('smsMandatory is true exactly when sms is in channels', () => {
    for (const kind of NOTIFICATION_EVENT_KINDS) {
      const e = CHANNEL_MATRIX[kind];
      expect(e.smsMandatory).toBe(e.channels.includes('sms'));
    }
  });

  it('the SMS-mandatory set is exactly the four CONTEXT events', () => {
    const mandatory = NOTIFICATION_EVENT_KINDS.filter((k) => CHANNEL_MATRIX[k].smsMandatory);
    expect(mandatory.sort()).toEqual(
      [
        'booking_request_received',
        'cancellation_within_24h',
        'consultation_booked',
        'job_awarded',
      ].sort(),
    );
  });

  it('every event always carries push + web_push + email', () => {
    for (const kind of NOTIFICATION_EVENT_KINDS) {
      const { channels } = CHANNEL_MATRIX[kind];
      expect(channels).toContain('push');
      expect(channels).toContain('web_push');
      expect(channels).toContain('email');
    }
  });

  it('route templates match the deep-link doc', () => {
    expect(getChannelMatrixEntry('booking_request_received').routeTemplate).toBe(
      'schedule/booking/{bookingId}',
    );
    expect(getChannelMatrixEntry('cancellation_within_24h').routeTemplate).toBe(
      'booking/{bookingId}',
    );
    expect(getChannelMatrixEntry('application_received').routeTemplate).toBe('job/{jobId}');
    expect(getChannelMatrixEntry('counter_offer_received').routeTemplate).toBe('thread/{threadId}');
  });

  it('isNotificationEventKind accepts known kinds and rejects operational event types', () => {
    expect(isNotificationEventKind('booking_request_received')).toBe(true);
    expect(isNotificationEventKind('screening.invite')).toBe(false);
    expect(isNotificationEventKind('provider_contact_intake.received')).toBe(false);
    expect(isNotificationEventKind('nope')).toBe(false);
  });
});

describe('buildRoutePath / buildDeepLinks', () => {
  it('fills placeholders and produces no leading slash', () => {
    expect(buildRoutePath('schedule/booking/{bookingId}', { bookingId: 'b-1' })).toBe(
      'schedule/booking/b-1',
    );
  });

  it('throws on a missing route param', () => {
    expect(() => buildRoutePath('job/{jobId}', {})).toThrow(/route param "jobId" missing/);
  });

  it('throws on an empty-string route param', () => {
    expect(() => buildRoutePath('job/{jobId}', { jobId: '' })).toThrow(/jobId/);
  });

  it('url-encodes route params', () => {
    expect(buildRoutePath('thread/{threadId}', { threadId: 'a/b c' })).toBe('thread/a%2Fb%20c');
  });

  it('joins the mobile scheme and web base with exactly one separator', () => {
    const links = buildDeepLinks('schedule/booking/{bookingId}', { bookingId: 'b-1' }, BASES);
    expect(links.mobile).toBe('ourhaven://schedule/booking/b-1');
    expect(links.web).toBe('https://provider.ourhaven.com/schedule/booking/b-1');
  });

  it('tolerates a web base without a trailing slash', () => {
    const links = buildDeepLinks('job/{jobId}', { jobId: 'j-1' }, {
      mobile: 'ourhaven://',
      web: 'https://web.example.com',
    });
    expect(links.web).toBe('https://web.example.com/job/j-1');
  });
});

describe('renderNotification', () => {
  it('builds push data.route from the MOBILE link and carries the kind', () => {
    const r = renderNotification('booking_request_received', { bookingId: 'b-1', actorName: 'Alex' }, BASES);
    expect(r.push.data).toEqual({
      kind: 'booking_request_received',
      route: 'ourhaven://schedule/booking/b-1',
    });
    expect(r.push.title).toBe('New booking request');
    expect(r.push.body).toContain('Alex');
  });

  it('SMS body is Our Haven-prefixed with the mobile link only (no web link)', () => {
    const r = renderNotification('job_awarded', { bookingId: 'b-9', actorName: 'The Lee family' }, BASES);
    expect(r.sms.body.startsWith('Our Haven:')).toBe(true);
    expect(r.sms.body).toContain('ourhaven://schedule/booking/b-9');
    expect(r.sms.body).not.toContain('https://');
  });

  it('email body carries BOTH links', () => {
    const r = renderNotification('application_received', { jobId: 'j-2', actorName: 'Sam' }, BASES);
    expect(r.email.subject).toBe('New application');
    expect(r.email.body).toContain('ourhaven://job/j-2');
    expect(r.email.body).toContain('https://provider.ourhaven.com/job/j-2');
  });

  it('falls back to generic copy when optional payload fields are absent', () => {
    const r = renderNotification('booking_request_received', { bookingId: 'b-1' }, BASES);
    expect(r.push.body).toBe('A family sent a booking request.');
  });

  it('renders sensible copy for every event kind without throwing', () => {
    const payloadFor = (kind: NotificationEventKind): Record<string, string> => {
      const params = CHANNEL_MATRIX[kind].routeParams;
      return Object.fromEntries(params.map((p) => [p, `${p}-x`]));
    };
    for (const kind of NOTIFICATION_EVENT_KINDS) {
      const r = renderNotification(kind, payloadFor(kind), BASES);
      expect(r.push.title.length).toBeGreaterThan(0);
      expect(r.push.body.length).toBeGreaterThan(0);
      expect(r.email.subject.length).toBeGreaterThan(0);
      expect(r.sms.body).toContain('Our Haven:');
    }
  });

  it('propagates a missing route param as a throw', () => {
    expect(() => renderNotification('application_received', {}, BASES)).toThrow(/jobId/);
  });
});
