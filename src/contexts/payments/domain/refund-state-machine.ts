import { defineStateMachine } from "./state-machine";

/** B4 · Estados de reembolso. */
export const REFUND_STATUS = {
  NONE: "none",
  PENDING: "pending",
  PROCESSING: "processing",
  PARTIAL_COMPLETED: "partial_completed",
  TOTAL_COMPLETED: "total_completed",
  FAILED: "failed",
} as const;

export type RefundStatus = (typeof REFUND_STATUS)[keyof typeof REFUND_STATUS];

export const REFUND_STATUSES = Object.values(REFUND_STATUS);

export const REFUND_RESPONSIBLE = {
  HOST: "host",
  PLATFORM: "platform",
  TRAVELER: "traveler",
} as const;

export type RefundResponsible =
  (typeof REFUND_RESPONSIBLE)[keyof typeof REFUND_RESPONSIBLE];

export const REFUND_RESPONSIBLES = Object.values(REFUND_RESPONSIBLE);

const S = REFUND_STATUS;

/**
 * One row per refund operation. `none` exists for the reservation-level
 * aggregate (no refund at all); rows start at `pending` (awaiting approval,
 * F2) or `processing` (sent to Stripe).
 * - completed -> failed is allowed: Stripe can fail a refund after reporting
 *   it succeeded (bank return). B4: a failed refund is NEVER shown completed.
 * - failed -> processing: retry with a NEW idempotency key (new row in F2;
 *   kept here so an admin retry of the same row is possible).
 */
export const refundStateMachine = defineStateMachine<RefundStatus>({
  name: "refund",
  states: REFUND_STATUSES,
  initial: [S.PENDING, S.PROCESSING],
  transitions: {
    [S.NONE]: [S.PENDING, S.PROCESSING],
    [S.PENDING]: [S.PROCESSING, S.FAILED],
    [S.PROCESSING]: [S.PARTIAL_COMPLETED, S.TOTAL_COMPLETED, S.FAILED],
    [S.PARTIAL_COMPLETED]: [S.FAILED],
    [S.TOTAL_COMPLETED]: [S.FAILED],
    [S.FAILED]: [S.PROCESSING],
  },
});

/** Stripe Refund.status -> our state (partial/total decided by the caller). */
export const STRIPE_REFUND_STATUS = {
  PENDING: "pending",
  REQUIRES_ACTION: "requires_action",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELED: "canceled",
} as const;

export function refundStatusFromStripe(
  stripeStatus: string | null | undefined,
  isTotal: boolean,
): RefundStatus {
  switch (stripeStatus) {
    case STRIPE_REFUND_STATUS.SUCCEEDED: {
      return isTotal ? S.TOTAL_COMPLETED : S.PARTIAL_COMPLETED;
    }
    case STRIPE_REFUND_STATUS.FAILED:
    case STRIPE_REFUND_STATUS.CANCELED: {
      return S.FAILED;
    }
    default: {
      return S.PROCESSING;
    }
  }
}

export function isRefundCompleted(status: RefundStatus): boolean {
  return status === S.PARTIAL_COMPLETED || status === S.TOTAL_COMPLETED;
}
