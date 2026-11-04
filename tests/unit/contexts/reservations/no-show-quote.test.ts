import type { ReservationSnapshotPayload } from "@/src/contexts/payments/domain/reservation-snapshot";
import type { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";

import { describe, expect, it } from "vitest";

import {
  CANCELLATION_POLICY_TYPE,
  type CancellationPolicyDefinition,
  NO_SHOW_POLICY,
  PENALTY_TYPE,
  quoteNoShow,
} from "@/src/contexts/payments/domain/cancellation-policy";
import { resolveNoShowQuote } from "@/src/contexts/reservations/utils/refund-policy.util";
import { computeReservationPolicyCapabilities } from "@/src/contexts/reservations/utils/reservation-policy.util";

const policy = (
  overrides: Partial<CancellationPolicyDefinition> = {},
): CancellationPolicyDefinition => ({
  policy_type: CANCELLATION_POLICY_TYPE.FREE_CANCELLATION,
  deadline_days: 7,
  penalty_type: PENALTY_TYPE.PERCENT_100,
  no_show_policy: NO_SHOW_POLICY.SAME_AS_CANCELLATION,
  grace_after_booking_hours: null,
  early_cancellation_weeks: null,
  ...overrides,
});

describe("quoteNoShow", () => {
  it("full_total retains everything", () => {
    expect(
      quoteNoShow(
        policy({
          no_show_policy: NO_SHOW_POLICY.FULL_TOTAL,
          penalty_type: PENALTY_TYPE.PERCENT_50,
        }),
        40_000,
        9000,
      ),
    ).toEqual({
      no_show_policy: "full_total",
      penalty_cents: 40_000,
      refund_cents: 0,
    });
  });

  it("same_as_cancellation applies the late 50 % penalty", () => {
    expect(
      quoteNoShow(policy({ penalty_type: PENALTY_TYPE.PERCENT_50 }), 40_000, 9000),
    ).toMatchObject({ penalty_cents: 20_000, refund_cents: 20_000 });
  });

  it("same_as_cancellation with first night refunds the rest", () => {
    expect(
      quoteNoShow(policy({ penalty_type: PENALTY_TYPE.FIRST_NIGHT }), 40_000, 9000),
    ).toMatchObject({ penalty_cents: 9000, refund_cents: 31_000 });
  });

  it("legacy reservation without policy retains everything", () => {
    expect(quoteNoShow(null, 40_000, 9000)).toEqual({
      no_show_policy: null,
      penalty_cents: 40_000,
      refund_cents: 0,
    });
  });
});

describe("resolveNoShowQuote", () => {
  const snapshot = {
    total_cents: 40_000,
    price_lines: [
      {
        type: "accommodation",
        quantity: 4,
        unit_amount_cents: 9000,
        amount_cents: 36_000,
      },
    ],
    refund_policy: {
      cancellation: policy({ penalty_type: PENALTY_TYPE.FIRST_NIGHT }),
    },
  } as unknown as ReservationSnapshotPayload;

  it("works on the remaining paid amount", () => {
    const reservation = {
      total_cents: 40_000,
      amount_refunded: 50,
      status: "confirmed",
      payment_status: "partially_refunded",
    } as unknown as ReservationEntity;

    expect(resolveNoShowQuote(reservation, snapshot)).toEqual({
      no_show_policy: "same_as_cancellation",
      paid_cents: 35_000,
      penalty_cents: 9000,
      refund_cents: 26_000,
    });
  });
});

describe("can_report_no_show", () => {
  const base = {
    checkin: "2026-08-10",
    checkout: "2026-08-14",
    status: "confirmed",
    payment_status: "paid",
    payout_status: "held",
  };

  it("is offered from the check-in day", () => {
    expect(
      computeReservationPolicyCapabilities(
        base,
        new Date("2026-08-09T23:00:00.000Z"),
      ).can_report_no_show,
    ).toBe(false);
    expect(
      computeReservationPolicyCapabilities(
        base,
        new Date("2026-08-10T08:00:00.000Z"),
      ).can_report_no_show,
    ).toBe(true);
  });

  it("is not offered once the payout is blocked or released", () => {
    const now = new Date("2026-08-11T08:00:00.000Z");
    expect(
      computeReservationPolicyCapabilities(
        { ...base, payout_status: "blocked" },
        now,
      ).can_report_no_show,
    ).toBe(false);
    expect(
      computeReservationPolicyCapabilities(
        { ...base, payout_status: "released" },
        now,
      ).can_report_no_show,
    ).toBe(false);
    expect(
      computeReservationPolicyCapabilities(
        { ...base, status: "finalized" },
        now,
      ).can_report_no_show,
    ).toBe(false);
  });
});
