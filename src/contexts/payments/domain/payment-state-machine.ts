import { defineStateMachine } from "./state-machine";

/** B3 · Estados de pago. */
export const PAYMENT_STATUS = {
  METHOD_VALIDATED: "method_validated",
  PENDING_CHARGE: "pending_charge",
  PROCESSING: "processing",
  PAID: "paid",
  FAILED: "failed",
  PENDING_REGULARIZATION: "pending_regularization",
  DEFINITIVE_UNPAID: "definitive_unpaid",
} as const;

export type PaymentStatus =
  (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_STATUSES = Object.values(PAYMENT_STATUS);

export const PAYMENT_TYPE = {
  CHARGE: "charge",
} as const;

export type PaymentType = (typeof PAYMENT_TYPE)[keyof typeof PAYMENT_TYPE];

export const PAYMENT_TYPES = Object.values(PAYMENT_TYPE);

const S = PAYMENT_STATUS;

/**
 * - method_validated: flexible rate (F3), card saved for a future charge.
 *                     pending_charge -> method_validated when the Checkout
 *                     Session in `setup` mode completes (Fase 4);
 *                     method_validated -> paid when the traveler pays early
 *                     through a normal Checkout Session.
 * - pending_charge:   charge not executed yet (today: Checkout Session open).
 * - processing:       Stripe is processing (async methods, off-session charge).
 * - failed -> paid:   "pagado tras reintento" / payment after expiry (F0 0.5):
 *                     kept as history in audit_log, no special final state.
 * - failed -> pending_regularization -> definitive_unpaid: 24 h window (regularization_window_hours, F3).
 * - paid is final: refunds live in their own entity (B1: independent states).
 */
export const paymentStateMachine = defineStateMachine<PaymentStatus>({
  name: "payment",
  states: PAYMENT_STATUSES,
  initial: [S.METHOD_VALIDATED, S.PENDING_CHARGE, S.PROCESSING, S.PAID],
  transitions: {
    [S.METHOD_VALIDATED]: [S.PENDING_CHARGE, S.PROCESSING, S.PAID, S.FAILED],
    [S.PENDING_CHARGE]: [S.METHOD_VALIDATED, S.PROCESSING, S.PAID, S.FAILED],
    [S.PROCESSING]: [S.PAID, S.FAILED],
    [S.FAILED]: [S.PROCESSING, S.PAID, S.PENDING_REGULARIZATION],
    [S.PENDING_REGULARIZATION]: [S.PROCESSING, S.PAID, S.DEFINITIVE_UNPAID],
    [S.PAID]: [],
    [S.DEFINITIVE_UNPAID]: [],
  },
});

/** Legacy reservations.payment_status (read by PHP) for a payment state. */
export function legacyPaymentStatusFor(
  status: PaymentStatus,
): "pending" | "paid" {
  return status === PAYMENT_STATUS.PAID ? "paid" : "pending";
}
