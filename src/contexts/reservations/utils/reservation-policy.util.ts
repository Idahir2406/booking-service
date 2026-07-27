export const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ReservationPolicyInput {
  status: string;
  payment_status: string;
  payout_status?: string | null;
  checkin: string;
  checkout: string;
}

export interface ReservationPolicyCapabilities {
  can_cancel: boolean;
  can_refund: boolean;
  can_finalize: boolean;
  refund_deadline: string;
}

export function parseIsoDateAtUtcMidnight(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
}

export function formatUtcIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getCheckinStartUtc(checkin: string): Date {
  return parseIsoDateAtUtcMidnight(checkin);
}

export function getCheckoutStartUtc(checkout: string): Date {
  return parseIsoDateAtUtcMidnight(checkout);
}

export function getRefundDeadlineUtc(checkin: string): Date {
  return new Date(getCheckinStartUtc(checkin).getTime() - REFUND_WINDOW_MS);
}

export function computeReservationPolicyCapabilities(
  reservation: ReservationPolicyInput,
  now: Date = new Date(),
): ReservationPolicyCapabilities {
  const checkinStart = getCheckinStartUtc(reservation.checkin);
  const checkoutStart = getCheckoutStartUtc(reservation.checkout);
  const refundDeadline = getRefundDeadlineUtc(reservation.checkin);
  const refundDeadlineIso = refundDeadline.toISOString();
  const nowMs = now.getTime();
  const payoutBlocked = reservation.payout_status === "blocked";

  if (
    reservation.status === "cancelled" ||
    reservation.status === "finalized"
  ) {
    return {
      can_cancel: false,
      can_refund: false,
      can_finalize: false,
      refund_deadline: refundDeadlineIso,
    };
  }

  if (reservation.status === "pending") {
    return {
      can_cancel: !payoutBlocked,
      can_refund: false,
      can_finalize: false,
      refund_deadline: refundDeadlineIso,
    };
  }

  if (reservation.status === "confirmed") {
    const isPaid = reservation.payment_status === "paid";
    const payoutReleased = reservation.payout_status === "released";
    const beforeCheckout = nowMs < checkoutStart.getTime();
    const fromCheckin = nowMs >= checkinStart.getTime();

    return {
      can_cancel: isPaid && !payoutBlocked && beforeCheckout,
      can_refund:
        isPaid &&
        !payoutReleased &&
        !payoutBlocked &&
        nowMs <= refundDeadline.getTime(),
      can_finalize: isPaid && !payoutBlocked && fromCheckin,
      refund_deadline: refundDeadlineIso,
    };
  }

  return {
    can_cancel: false,
    can_refund: false,
    can_finalize: false,
    refund_deadline: refundDeadlineIso,
  };
}
