import { describe, expect, it } from 'vitest';

import {
  reduceBackgroundCheckEvent,
  type BackgroundCheckEvent,
} from './index.js';

const T = new Date('2026-06-01T12:00:00.000Z');

describe('reduceBackgroundCheckEvent', () => {
  it('initiated → sets screening_initiated_at only', () => {
    const event: BackgroundCheckEvent = {
      kind: 'initiated',
      vendorReportId: 'rep_1',
      occurredAt: T,
    };
    expect(reduceBackgroundCheckEvent(event)).toEqual({ screening_initiated_at: T });
  });

  it('completed/clear → sets screening_passed_at only', () => {
    const event: BackgroundCheckEvent = {
      kind: 'completed',
      vendorReportId: 'rep_1',
      occurredAt: T,
      outcome: 'clear',
    };
    expect(reduceBackgroundCheckEvent(event)).toEqual({ screening_passed_at: T });
  });

  it('completed/consider → rejects with prefixed reason', () => {
    const event: BackgroundCheckEvent = {
      kind: 'completed',
      vendorReportId: 'rep_1',
      occurredAt: T,
      outcome: 'consider',
      reason: 'pending county hit',
    };
    expect(reduceBackgroundCheckEvent(event)).toEqual({
      rejected_at: T,
      rejection_reason: 'consider: pending county hit',
    });
  });

  it('completed/suspended → rejects with prefixed reason', () => {
    const event: BackgroundCheckEvent = {
      kind: 'completed',
      vendorReportId: 'rep_1',
      occurredAt: T,
      outcome: 'suspended',
      reason: null,
    };
    expect(reduceBackgroundCheckEvent(event)).toEqual({
      rejected_at: T,
      rejection_reason: 'suspended',
    });
  });

  it('cancelled → empty patch (no auto-replay without re-charge)', () => {
    const event: BackgroundCheckEvent = {
      kind: 'cancelled',
      vendorReportId: 'rep_1',
      occurredAt: T,
    };
    expect(reduceBackgroundCheckEvent(event)).toEqual({});
  });
});
