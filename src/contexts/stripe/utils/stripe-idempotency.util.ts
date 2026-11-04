/**
 * Deterministic idempotency keys for every Stripe mutation (F0 payments).
 * Same logical operation => same key, so a retry after a crash/timeout
 * returns the original object instead of charging/refunding/transferring twice.
 * Stripe keeps keys for 24 h; transfers additionally use `transfer_group`
 * so an already-sent transfer can be found after that window.
 */
export const stripeIdempotencyKeys = {
  checkoutSession: (reservationId: number): string =>
    `checkout:${reservationId}`,
  /**
   * pay-pending: new session for the SAME reservation once the previous one
   * is no longer open. The attempt is identified by the session it replaces
   * ("none" when there was none), so concurrent clicks on "Pagar reserva"
   * get the same Stripe session instead of two payable ones.
   */
  checkoutSessionRetry: (
    reservationId: number,
    replacedSessionId: string | null,
  ): string => `checkout:${reservationId}:retry:${replacedSessionId ?? "none"}`,
  checkoutCustomer: (reservationId: number): string =>
    `checkout-customer:${reservationId}`,
  refund: (reservationId: number, sequence: number): string =>
    `refund:${reservationId}:${sequence}`,
  refundPending: (reservationId: number, pendingId: number): string =>
    `refund-pending:${reservationId}:${pendingId}`,
  transfer: (reservationId: number): string => `transfer:${reservationId}`,
  expressAccount: (userId: number): string => `express-account:${userId}`,
} as const;

export function reservationTransferGroup(reservationId: number): string {
  return `reservation_${reservationId}`;
}
