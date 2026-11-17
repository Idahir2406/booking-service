import type { PaymentStatus } from "../../payments/domain/payment-state-machine";
import type { RefundStatus } from "../../payments/domain/refund-state-machine";
import type { ReservationEntity } from "../entities/reservation.entity";

import { PAYMENT_STATUS } from "../../payments/domain/payment-state-machine";
import { REFUND_STATUS } from "../../payments/domain/refund-state-machine";
import { formatUtcIsoDate } from "./reservation-policy.util";

/** Traveler-facing status (handoff §4.3). Raw enums never reach the UI. */
export const TRAVELER_STATUS = {
  CANCELLED: "cancelled",
  INCIDENT_REVIEW: "incident_review",
  FINALIZED: "finalized",
  PAYMENT_PENDING: "payment_pending",
  CONFIRMED: "confirmed",
  /** Conservative fallback ("En proceso"); the caller logs it. */
  IN_PROGRESS: "in_progress",
} as const;

export type TravelerStatus =
  (typeof TRAVELER_STATUS)[keyof typeof TRAVELER_STATUS];

export const TRAVELER_TAB = {
  UPCOMING: "upcoming",
  PAST: "past",
  CANCELLED: "cancelled",
} as const;

export type TravelerTab = (typeof TRAVELER_TAB)[keyof typeof TRAVELER_TAB];

export const TRAVELER_TABS = Object.values(TRAVELER_TAB);

/** jvariables keys (page cuenta_viajero) for the payment history. */
export const TRAVELER_PAYMENT_LABEL = {
  PAID: "cv_pay_paid",
  PENDING: "cv_pay_pending",
  FAILED: "cv_pay_failed",
} as const;

export type TravelerPaymentLabelKey =
  (typeof TRAVELER_PAYMENT_LABEL)[keyof typeof TRAVELER_PAYMENT_LABEL];

/** jvariables keys (page cuenta_viajero) for the refund history. */
export const TRAVELER_REFUND_LABEL = {
  PENDING: "cv_ref_pending",
  PROCESSING: "cv_ref_processing",
  COMPLETED: "cv_ref_completed",
  FAILED: "cv_ref_failed",
} as const;

export type TravelerRefundLabelKey =
  (typeof TRAVELER_REFUND_LABEL)[keyof typeof TRAVELER_REFUND_LABEL];

export interface TravelerStatusInput {
  reservation: Pick<ReservationEntity, "status" | "payment_status"> &
    Partial<
      Pick<ReservationEntity, "charge_mode" | "regularization_deadline_at">
    >;
  has_open_dispute: boolean;
  has_pending_refund: boolean;
  /** F-PV7a: reservation_incidents in received/in_review/needs_info. */
  has_open_incident: boolean;
  /**
   * F-PV7b: partially_refunded only by accepted-change adjustment refunds
   * (isPartiallyRefundedByChangeOnly) → shown as «Confirmada».
   */
  partial_refund_from_change?: boolean;
}

export interface TravelerStatusResult {
  status: TravelerStatus;
  is_fallback: boolean;
}

/**
 * Evaluation order (handoff §4.3): cancelled → open incident/dispute or
 * pending refund → finalized → pending+pending → confirmed+paid (or
 * confirmed+partially_refunded by an accepted change, F-PV7b) → fallback.
 */
export function mapTravelerFacingStatus(
  input: TravelerStatusInput,
): TravelerStatusResult {
  const { reservation } = input;
  if (reservation.status === "cancelled") {
    return { status: TRAVELER_STATUS.CANCELLED, is_fallback: false };
  }
  if (
    input.has_open_incident ||
    input.has_open_dispute ||
    input.has_pending_refund
  ) {
    return { status: TRAVELER_STATUS.INCIDENT_REVIEW, is_fallback: false };
  }
  if (reservation.status === "finalized") {
    return { status: TRAVELER_STATUS.FINALIZED, is_fallback: false };
  }
  if (
    reservation.status === "pending" &&
    reservation.payment_status === "pending"
  ) {
    return { status: TRAVELER_STATUS.PAYMENT_PENDING, is_fallback: false };
  }
  const paidLike =
    reservation.payment_status === "paid" ||
    (reservation.payment_status === "partially_refunded" &&
      input.partial_refund_from_change === true);
  if (reservation.status === "confirmed" && paidLike) {
    return { status: TRAVELER_STATUS.CONFIRMED, is_fallback: false };
  }
  // Fase 4: confirmed flexible reservation, card saved, charge pending
  // (or failed: then «Pago pendiente» until the regularization deadline).
  if (
    reservation.status === "confirmed" &&
    reservation.charge_mode === "flexible" &&
    reservation.payment_status === "pending"
  ) {
    return {
      status: reservation.regularization_deadline_at
        ? TRAVELER_STATUS.PAYMENT_PENDING
        : TRAVELER_STATUS.CONFIRMED,
      is_fallback: false,
    };
  }
  return { status: TRAVELER_STATUS.IN_PROGRESS, is_fallback: true };
}

/** cancelled = status cancelled; past = finalized or checkout before today (UTC). */
export function resolveTravelerTab(
  reservation: Pick<ReservationEntity, "status" | "checkout">,
  now: Date,
): TravelerTab {
  if (reservation.status === "cancelled") {
    return TRAVELER_TAB.CANCELLED;
  }
  if (reservation.status === "finalized") {
    return TRAVELER_TAB.PAST;
  }
  if (reservation.checkout.slice(0, 10) < formatUtcIsoDate(now)) {
    return TRAVELER_TAB.PAST;
  }
  return TRAVELER_TAB.UPCOMING;
}

/** Abandoned immediate-charge checkout: hidden from the panel (D-12). */
export function isAbandonedPendingCheckout(
  reservation: Pick<
    ReservationEntity,
    "status" | "payment_status" | "expiration_date"
  >,
  now: Date,
): boolean {
  if (
    reservation.status !== "pending" ||
    reservation.payment_status !== "pending"
  ) {
    return false;
  }
  const expiresMs = new Date(reservation.expiration_date).getTime();
  return Number.isFinite(expiresMs) && expiresMs < now.getTime();
}

export interface TravelerPayability {
  can_pay: boolean;
  /** ISO instant until which the traveler can still pay (null if not payable). */
  pay_expires_at: string | null;
}

const NOT_PAYABLE: TravelerPayability = {
  can_pay: false,
  pay_expires_at: null,
};

/**
 * "Pagar reserva" (pay-pending): an unfinished immediate checkout the
 * traveler can still pay = pending + payment pending, hold not expired
 * (expiration_date in the future; the cron cancels it right after) and the
 * check-in day not past. Same rule the pay route validates with.
 */
export function resolveTravelerPayability(
  reservation: Pick<
    ReservationEntity,
    "status" | "payment_status" | "expiration_date" | "checkin"
  > &
    Partial<
      Pick<ReservationEntity, "charge_mode" | "regularization_deadline_at">
    >,
  now: Date,
): TravelerPayability {
  // Fase 4: failed deferred charge -> payable until the regularization
  // deadline (the pay route also accepts paying before charge_at).
  if (
    reservation.status === "confirmed" &&
    reservation.charge_mode === "flexible" &&
    reservation.payment_status === "pending"
  ) {
    const deadlineMs = reservation.regularization_deadline_at
      ? new Date(reservation.regularization_deadline_at).getTime()
      : Number.NaN;
    if (!Number.isFinite(deadlineMs) || deadlineMs <= now.getTime()) {
      return NOT_PAYABLE;
    }
    return {
      can_pay: true,
      pay_expires_at: new Date(deadlineMs).toISOString(),
    };
  }
  if (
    reservation.status !== "pending" ||
    reservation.payment_status !== "pending"
  ) {
    return NOT_PAYABLE;
  }
  const expiresMs = new Date(reservation.expiration_date).getTime();
  if (!Number.isFinite(expiresMs) || expiresMs <= now.getTime()) {
    return NOT_PAYABLE;
  }
  if (String(reservation.checkin).slice(0, 10) < formatUtcIsoDate(now)) {
    return NOT_PAYABLE;
  }
  return { can_pay: true, pay_expires_at: new Date(expiresMs).toISOString() };
}

export function mapPaymentLabelKey(
  status: PaymentStatus,
): TravelerPaymentLabelKey {
  switch (status) {
    case PAYMENT_STATUS.PAID: {
      return TRAVELER_PAYMENT_LABEL.PAID;
    }
    case PAYMENT_STATUS.FAILED:
    case PAYMENT_STATUS.DEFINITIVE_UNPAID: {
      return TRAVELER_PAYMENT_LABEL.FAILED;
    }
    default: {
      // method_validated, pending_charge, processing, pending_regularization
      return TRAVELER_PAYMENT_LABEL.PENDING;
    }
  }
}

export function mapRefundLabelKey(
  status: RefundStatus,
): TravelerRefundLabelKey {
  switch (status) {
    case REFUND_STATUS.PROCESSING: {
      return TRAVELER_REFUND_LABEL.PROCESSING;
    }
    case REFUND_STATUS.PARTIAL_COMPLETED:
    case REFUND_STATUS.TOTAL_COMPLETED: {
      return TRAVELER_REFUND_LABEL.COMPLETED;
    }
    case REFUND_STATUS.FAILED: {
      return TRAVELER_REFUND_LABEL.FAILED;
    }
    default: {
      // none, pending (awaiting V4P review)
      return TRAVELER_REFUND_LABEL.PENDING;
    }
  }
}
