import { computePlatformFee } from "@/src/contexts/payments/domain/commission";
import {
  PAYMENT_STATUS,
  paymentStateMachine,
} from "@/src/contexts/payments/domain/payment-state-machine";
import {
  deriveLiquidationStatus,
  LIQUIDATION_STATUS,
  liquidationStateMachine,
  payoutStateMachine,
} from "@/src/contexts/payments/domain/payout-state-machine";
import {
  REFUND_STATUS,
  refundStateMachine,
  refundStatusFromStripe,
} from "@/src/contexts/payments/domain/refund-state-machine";
import {
  InvalidTransitionError,
  TRANSITION_RESULT,
} from "@/src/contexts/payments/domain/state-machine";
import { aggregateRefundStatus } from "@/src/contexts/payments/services/payment-ledger.service";

describe("payment state machine (B3)", () => {
  const P = PAYMENT_STATUS;

  it.each([
    [P.PENDING_CHARGE, P.PROCESSING],
    [P.PENDING_CHARGE, P.PAID],
    [P.PENDING_CHARGE, P.FAILED],
    [P.METHOD_VALIDATED, P.PENDING_CHARGE],
    [P.PROCESSING, P.PAID],
    [P.PROCESSING, P.FAILED],
    [P.FAILED, P.PAID], // "pagado tras reintento" / payment after expiry
    [P.FAILED, P.PENDING_REGULARIZATION],
    [P.PENDING_REGULARIZATION, P.PAID],
    [P.PENDING_REGULARIZATION, P.DEFINITIVE_UNPAID],
  ])("allows %s -> %s", (from, to) => {
    expect(paymentStateMachine.assertTransition(from, to)).toBe(
      TRANSITION_RESULT.CHANGED,
    );
  });

  it.each([
    [P.PAID, P.FAILED],
    [P.PAID, P.PENDING_CHARGE],
    [P.DEFINITIVE_UNPAID, P.PAID],
    [P.PENDING_CHARGE, P.DEFINITIVE_UNPAID],
    [P.PROCESSING, P.PENDING_CHARGE],
  ])("rejects %s -> %s", (from, to) => {
    expect(() => paymentStateMachine.assertTransition(from, to)).toThrow(
      InvalidTransitionError,
    );
  });

  it("treats same-state as an idempotent no-op", () => {
    expect(paymentStateMachine.assertTransition(P.PAID, P.PAID)).toBe(
      TRANSITION_RESULT.NOOP,
    );
    expect(paymentStateMachine.isTerminal(P.PAID)).toBe(true);
    expect(paymentStateMachine.isState("paid")).toBe(true);
    expect(paymentStateMachine.isState("refunded")).toBe(false);
  });
});

describe("refund state machine (B4)", () => {
  const R = REFUND_STATUS;

  it("follows pending -> processing -> completed and never skips processing", () => {
    expect(refundStateMachine.canTransition(R.PENDING, R.PROCESSING)).toBe(
      true,
    );
    expect(
      refundStateMachine.canTransition(R.PROCESSING, R.TOTAL_COMPLETED),
    ).toBe(true);
    expect(refundStateMachine.canTransition(R.PENDING, R.TOTAL_COMPLETED)).toBe(
      false,
    );
    expect(refundStateMachine.canTransition(R.FAILED, R.TOTAL_COMPLETED)).toBe(
      false,
    );
  });

  it("allows a completed refund to fail later (bank return) and a failed one to be retried", () => {
    expect(refundStateMachine.canTransition(R.TOTAL_COMPLETED, R.FAILED)).toBe(
      true,
    );
    expect(refundStateMachine.canTransition(R.FAILED, R.PROCESSING)).toBe(true);
    expect(
      refundStateMachine.canTransition(R.TOTAL_COMPLETED, R.PROCESSING),
    ).toBe(false);
  });

  it("maps Stripe refund statuses", () => {
    expect(refundStatusFromStripe("succeeded", true)).toBe(R.TOTAL_COMPLETED);
    expect(refundStatusFromStripe("succeeded", false)).toBe(
      R.PARTIAL_COMPLETED,
    );
    expect(refundStatusFromStripe("pending", true)).toBe(R.PROCESSING);
    expect(refundStatusFromStripe("requires_action", true)).toBe(R.PROCESSING);
    expect(refundStatusFromStripe("failed", true)).toBe(R.FAILED);
    expect(refundStatusFromStripe("canceled", true)).toBe(R.FAILED);
  });

  it("aggregates a reservation's refunds (failed never shown as completed)", () => {
    expect(aggregateRefundStatus([])).toBe(R.NONE);
    expect(aggregateRefundStatus([R.PARTIAL_COMPLETED])).toBe(
      R.PARTIAL_COMPLETED,
    );
    expect(aggregateRefundStatus([R.PARTIAL_COMPLETED, R.FAILED])).toBe(
      R.FAILED,
    );
    expect(aggregateRefundStatus([R.PARTIAL_COMPLETED, R.PROCESSING])).toBe(
      R.PROCESSING,
    );
    expect(
      aggregateRefundStatus([R.PARTIAL_COMPLETED, R.TOTAL_COMPLETED]),
    ).toBe(R.TOTAL_COMPLETED);
  });
});

describe("payout / liquidation (B5 subset)", () => {
  it("legacy payout_status transitions", () => {
    expect(payoutStateMachine.canTransition("held", "released")).toBe(true);
    expect(payoutStateMachine.canTransition("held", "blocked")).toBe(true);
    expect(payoutStateMachine.canTransition("blocked", "held")).toBe(true);
    expect(payoutStateMachine.canTransition("released", "blocked")).toBe(false);
    expect(payoutStateMachine.canTransition("released", "held")).toBe(false);
  });

  it("B5 machine", () => {
    const L = LIQUIDATION_STATUS;
    expect(
      liquidationStateMachine.canTransition(L.NOT_AVAILABLE, L.AVAILABLE),
    ).toBe(true);
    expect(liquidationStateMachine.canTransition(L.PROCESSING, L.SETTLED)).toBe(
      true,
    );
    expect(liquidationStateMachine.canTransition(L.FAILED, L.PROCESSING)).toBe(
      true,
    );
    expect(liquidationStateMachine.canTransition(L.SETTLED, L.FAILED)).toBe(
      false,
    );
    expect(
      liquidationStateMachine.canTransition(L.NOT_AVAILABLE, L.SETTLED),
    ).toBe(false);
  });

  it("derives B5 status from legacy columns", () => {
    const now = new Date("2026-08-20T12:00:00.000Z");
    expect(
      deriveLiquidationStatus(
        {
          status: "finalized",
          payout_status: "held",
          feedback_deadline_at: "2026-08-20T11:00:00.000Z",
        },
        now,
      ),
    ).toBe(LIQUIDATION_STATUS.AVAILABLE);
    expect(
      deriveLiquidationStatus(
        {
          status: "finalized",
          payout_status: "held",
          feedback_deadline_at: "2026-08-21T11:00:00.000Z",
        },
        now,
      ),
    ).toBe(LIQUIDATION_STATUS.NOT_AVAILABLE);
    expect(
      deriveLiquidationStatus({
        status: "confirmed",
        payout_status: "blocked",
      }),
    ).toBe(LIQUIDATION_STATUS.BLOCKED_INCIDENT);
    expect(
      deriveLiquidationStatus({
        status: "finalized",
        payout_status: "released",
      }),
    ).toBe(LIQUIDATION_STATUS.SETTLED);
    expect(
      deriveLiquidationStatus({
        status: "finalized",
        payout_status: "held",
        last_release_failed: true,
      }),
    ).toBe(LIQUIDATION_STATUS.FAILED);
  });
});

describe("platform fee at transfer time", () => {
  it("uses the frozen commission_cents when there were no refunds", () => {
    expect(
      computePlatformFee({
        commissionRate: 0.12,
        commissionCents: 2400,
        totalCents: 20_000,
        refundedCents: 0,
        fallbackRate: 0.1,
      }),
    ).toEqual({
      feeCents: 2400,
      hostAmountCents: 17_600,
      rateUsed: 0.12,
      source: "frozen_cents",
    });
  });

  it("applies the frozen rate to the retained amount after a partial refund", () => {
    const fee = computePlatformFee({
      commissionRate: 0.12,
      commissionCents: 2400,
      totalCents: 20_000,
      refundedCents: 5000,
      fallbackRate: 0.1,
    });
    expect(fee).toMatchObject({
      feeCents: 1800,
      hostAmountCents: 13_200,
      source: "frozen_rate",
    });
  });

  it("falls back to the env rate only for legacy rows", () => {
    const fee = computePlatformFee({
      commissionRate: null,
      commissionCents: null,
      totalCents: 20_000,
      refundedCents: 0,
      fallbackRate: 0.1,
    });
    expect(fee).toMatchObject({ feeCents: 2000, source: "env_fallback" });
  });
});
