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
  /**
   * Fase 4: off-session charge of a flexible reservation. `attempt` is the
   * ledger payment's attempts counter (persisted in the same transaction),
   * so a rolled-back run retries with the SAME key and Stripe returns the
   * original PaymentIntent instead of charging twice.
   */
  offsessionCharge: (reservationId: number, attempt: number): string =>
    `offsession-charge:${reservationId}:${attempt}`,
  expressAccount: (userId: number): string => `express-account:${userId}`,
  /**
   * Provider reservation (source = nuitee): manual-capture Checkout Session.
   * Same retry rule as checkoutSessionRetry (replaced session or "none").
   */
  providerCheckoutSession: (
    reservationId: number,
    replacedSessionId: string | null,
  ): string =>
    `provider-checkout:${reservationId}:${replacedSessionId ?? "none"}`,
  /** Capture of the authorized PaymentIntent once the provider confirmed. */
  providerCapture: (reservationId: number, paymentIntentId: string): string =>
    `provider-capture:${reservationId}:${paymentIntentId}`,
  /** Void (cancel) of the authorization when the provider booking failed. */
  providerVoid: (reservationId: number, paymentIntentId: string): string =>
    `provider-void:${reservationId}:${paymentIntentId}`,
} as const;

export function reservationTransferGroup(reservationId: number): string {
  return `reservation_${reservationId}`;
}
