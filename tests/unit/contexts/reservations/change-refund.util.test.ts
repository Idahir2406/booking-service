import type { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";

import { describe, expect, it } from "vitest";

import {
  buildChangeRefundReason,
  isChangeAdjustmentRefund,
  isPartiallyRefundedByChangeOnly,
} from "@/src/contexts/reservations/utils/change-refund.util";
import { travelerPolicyAllowsCancel } from "@/src/contexts/reservations/utils/refund-policy.util";
import {
  mapTravelerFacingStatus,
  TRAVELER_STATUS,
} from "@/src/contexts/reservations/utils/traveler-panel-status.util";

type Row = Pick<ReservationEntity, "status" | "payment_status" | "amount_refunded">;

const partial: Row = {
  status: "confirmed",
  payment_status: "partially_refunded",
  amount_refunded: 44.5,
};

const changeRefund = (overrides: Record<string, unknown> = {}) => ({
  reason: buildChangeRefundReason("proposal", 7),
  status: "partial_completed" as const,
  amount_cents: 4450,
  ...overrides,
});

describe("change-refund.util (F-PV7b)", () => {
  it("builds and recognises the change adjustment reason", () => {
    expect(buildChangeRefundReason("alternative", 3)).toBe(
      "change_accepted:alternative:3",
    );
    expect(isChangeAdjustmentRefund({ reason: "change_accepted:proposal:1" })).toBe(true);
    expect(isChangeAdjustmentRefund({ reason: "manual_refund" })).toBe(false);
    expect(isChangeAdjustmentRefund({ reason: null })).toBe(false);
  });

  it("true only when every live refund is a change adjustment summing amount_refunded", () => {
    expect(isPartiallyRefundedByChangeOnly(partial, [changeRefund()])).toBe(true);
    // processing (not yet completed) change refund counts too
    expect(
      isPartiallyRefundedByChangeOnly(partial, [changeRefund({ status: "processing" })]),
    ).toBe(true);
    // failed refunds moved no money and are ignored
    expect(
      isPartiallyRefundedByChangeOnly(partial, [
        changeRefund(),
        { reason: "manual_refund", status: "failed", amount_cents: 1000 },
      ]),
    ).toBe(true);
  });

  it("false for any other partial refund or state", () => {
    expect(isPartiallyRefundedByChangeOnly(partial, [])).toBe(false);
    expect(
      isPartiallyRefundedByChangeOnly(partial, [
        { reason: "manual_refund", status: "partial_completed", amount_cents: 4450 },
      ]),
    ).toBe(false);
    expect(
      isPartiallyRefundedByChangeOnly({ ...partial, amount_refunded: 64.5 }, [
        changeRefund(),
        { reason: "exceptional_refund", status: "pending", amount_cents: 2000 },
      ]),
    ).toBe(false);
    // amount_refunded includes money with no ledger row (Stripe dashboard)
    expect(
      isPartiallyRefundedByChangeOnly({ ...partial, amount_refunded: 60 }, [changeRefund()]),
    ).toBe(false);
    expect(
      isPartiallyRefundedByChangeOnly({ ...partial, payment_status: "paid" }, [changeRefund()]),
    ).toBe(false);
    expect(
      isPartiallyRefundedByChangeOnly({ ...partial, status: "cancelled" }, [changeRefund()]),
    ).toBe(false);
  });

  it("status label: «Confirmada» for a change-only partial refund, fallback otherwise", () => {
    const base = {
      reservation: { status: "confirmed", payment_status: "partially_refunded" } as const,
      has_open_dispute: false,
      has_pending_refund: false,
      has_open_incident: false,
    };
    expect(
      mapTravelerFacingStatus({ ...base, partial_refund_from_change: true }),
    ).toEqual({ status: TRAVELER_STATUS.CONFIRMED, is_fallback: false });
    expect(mapTravelerFacingStatus(base)).toEqual({
      status: TRAVELER_STATUS.IN_PROGRESS,
      is_fallback: true,
    });
    // An open incident still wins over the change flag.
    expect(
      mapTravelerFacingStatus({
        ...base,
        has_open_incident: true,
        partial_refund_from_change: true,
      }).status,
    ).toBe(TRAVELER_STATUS.INCIDENT_REVIEW);
  });

  it("cancel policy: change-only partial refund behaves like paid, payout block still applies", () => {
    const now = new Date("2099-01-01T00:00:00.000Z");
    const row = {
      status: "confirmed",
      payment_status: "partially_refunded",
      payout_status: "held",
      checkin: "2099-08-10",
      checkout: "2099-08-14",
    };
    expect(travelerPolicyAllowsCancel(row, now)).toBe(false);
    expect(
      travelerPolicyAllowsCancel(row, now, { partialRefundFromChange: true }),
    ).toBe(true);
    expect(
      travelerPolicyAllowsCancel({ ...row, payout_status: "blocked" }, now, {
        partialRefundFromChange: true,
      }),
    ).toBe(false);
  });
});
