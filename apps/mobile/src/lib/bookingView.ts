/**
 * Booking-detail view helpers (OH-211) — the shared data hook + formatting the
 * native + web Parent BookingDetail screens use, so both render the same live
 * booking (payment lifecycle, schedule, pricing) from `GET /v1/bookings/{id}`.
 */
import { useCallback, useEffect, useState } from 'react';

import { ApiError, getBooking, type BookingDetail } from '@/api/client';

export function useBookingDetail(bookingId: string | null) {
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!bookingId) {
      setLoading(false);
      setError('No booking selected.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setBooking(await getBooking(bookingId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this booking.');
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { booking, loading, error, reload, setBooking };
}

export type BookingActions = {
  /** The Parent can cancel while the Booking is still active (not terminal). */
  canCancel: boolean;
  /** Confirm-hours is offered only inside the ~24h review window. */
  canConfirm: boolean;
  /** Dispute is reachable on accepted / awaiting-confirmation / completed. */
  canDispute: boolean;
  /** Adjust-time (extend now / request a shorten) — accepted Caregiver Bookings with no pending change (OH-212). */
  canAdjustTime: boolean;
  /** A pending shorten the Parent can rescind before the Caregiver acts. */
  hasPendingTimeChange: boolean;
};

const ACTIVE = new Set(['requested', 'accepted', 'in-progress', 'awaiting-confirmation']);
const DISPUTABLE_WINDOW = new Set(['accepted', 'awaiting-confirmation', 'completed']);

export function bookingActionsFor(b: BookingDetail): BookingActions {
  return {
    canCancel: b.kind === 'caregiver' ? ACTIVE.has(b.state) : b.state === 'accepted',
    canConfirm: b.kind === 'caregiver' && b.state === 'awaiting-confirmation',
    canDispute: b.kind === 'caregiver' && DISPUTABLE_WINDOW.has(b.state),
    canAdjustTime: b.kind === 'caregiver' && b.state === 'accepted' && b.pendingTimeChange == null,
    hasPendingTimeChange: b.pendingTimeChange != null,
  };
}

/** A short human label for the payment lifecycle (shown on the detail). */
export function paymentLabel(status: BookingDetail['paymentStatus']): string {
  switch (status) {
    case 'scheduled':
      return 'Payment scheduled';
    case 'requires_action':
      return 'Card confirmation needed';
    case 'authorized':
      return 'Card authorized (held)';
    case 'captured':
      return 'Paid';
    case 'refunded':
      return 'Refunded';
    case 'canceled':
      return 'Hold released';
    case 'failed':
      return 'Payment failed';
    default:
      return 'Off-platform';
  }
}

function to12h(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const isAm = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${isAm ? 'AM' : 'PM'}`;
}

export function formatTimeRange(startMin: number, endMin: number): string {
  return `${to12h(startMin)}–${to12h(endMin)}`;
}

export function formatBookingDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function durationHours(startMin: number, endMin: number): number {
  return Math.round(((endMin - startMin) / 60) * 10) / 10;
}
