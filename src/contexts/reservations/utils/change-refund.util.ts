import type { RefundEntity } from "../../payments/entities/refund.entity";
import type { ReservationEntity } from "../entities/reservation.entity";

import { REFUND_STATUS } from "../../payments/domain/refund-state-machine";

/**
 * F-PV7b: `refunds.reason` (varchar 128, no migration) of the refund that
 * returns the price difference of an accepted change/alternative. Written by
 * ReservationChangeApplyService and read back here to tell a change
 * adjustment from any other partial refund (manual/admin, host exceptional,
 * dispute, Stripe dashboard...).
 */
export const CHANGE_REFUND_REASON_PREFIX = "change_accepted:";

export function buildChangeRefundReason(kind: string, offerId: number): string {
  return `${CHANGE_REFUND_REASON_PREFIX}${kind}:${offerId}`;
}

export function isChangeAdjustmentRefund(
  refund: Pick<RefundEntity, "reason">,
): boolean {
  return (
    typeof refund.reason === "string" &&
    refund.reason.startsWith(CHANGE_REFUND_REASON_PREFIX)
  );
}

export type ChangeRefundInput = Pick<
  RefundEntity,
  "reason" | "status" | "amount_cents"
>;

/**
 * "Partially refunded only because of an accepted change": confirmed +
 * partially_refunded, at least one live refund, EVERY live refund (pending,
 * processing or completed; failed ones moved no money) is a change
 * adjustment, and those refunds add up to `amount_refunded` (so a refund
 * with no ledger row, e.g. from the Stripe dashboard, keeps the old
 * behaviour). For such a row the traveler still sees «Confirmada» and can
 * cancel/report/change like a confirmed+paid reservation; every other
 * partial refund keeps the conservative "En proceso" path.
 */
export function isPartiallyRefundedByChangeOnly(
  reservation: Pick<
    ReservationEntity,
    "status" | "payment_status" | "amount_refunded"
  >,
  refunds: readonly ChangeRefundInput[],
): boolean {
  if (
    reservation.status !== "confirmed" ||
    reservation.payment_status !== "partially_refunded"
  ) {
    return false;
  }
  const live = refunds.filter(
    refund =>
      refund.status !== REFUND_STATUS.FAILED &&
      refund.status !== REFUND_STATUS.NONE,
  );
  if (live.length === 0 || !live.every(isChangeAdjustmentRefund)) {
    return false;
  }
  const refundedCents = Math.round(
    Number(reservation.amount_refunded ?? 0) * 100,
  );
  const changeCents = live.reduce(
    (sum, refund) => sum + Number(refund.amount_cents ?? 0),
    0,
  );
  return refundedCents > 0 && changeCents === refundedCents;
}
