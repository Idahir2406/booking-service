import type { ReservationSnapshotPayload } from "@/src/contexts/payments/domain/reservation-snapshot";
import type { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";

import { describe, expect, it } from "vitest";

import {
  CANCELLATION_POLICY_TYPE,
  type CancellationPolicyDefinition,
  freeCancellationDeadlineIso,
  NO_SHOW_POLICY,
  PENALTY_TYPE,
} from "@/src/contexts/payments/domain/cancellation-policy";
import {
  firstNightCentsFromSnapshot,
  resolveTravelerCancellationQuote,
  resolveTravelerRefundAmountCents,
} from "@/src/contexts/reservations/utils/refund-policy.util";

const CHECKIN = "2026-08-10";
const CHECKOUT = "2026-08-14";

const reservation = (
  overrides: Partial<ReservationEntity> = {},
): ReservationEntity =>
  ({
    id: 1,
    user_id: 10,
    checkin: CHECKIN,
    checkout: CHECKOUT,
    status: "confirmed",
    payment_status: "paid",
    payout_status: "held",
    total_cents: 40_000,
    subtotal: 380,
    commission: 20,
    amount_refunded: null,
    created_at: new Date("2026-06-01T10:00:00.000Z"),
    timezone: null,
    ...overrides,
  }) as ReservationEntity;

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

const snapshot = (
  cancellation: CancellationPolicyDefinition | null,
  extra: Partial<ReservationSnapshotPayload> = {},
): ReservationSnapshotPayload =>
  ({
    schema: 1,
    stay: {
      site_id: 1,
      checkin: CHECKIN,
      checkout: CHECKOUT,
      nights: 4,
      guests: 2,
      pets: 1,
    },
    room: null,
    board: null,
    currency: "EUR",
    total_cents: 40_000,
    price_lines: [
      {
        type: "accommodation",
        description: "Alojamiento",
        quantity: 4,
        unit_amount_cents: 9000,
        amount_cents: 36_000,
        is_optional: false,
        is_commissionable: true,
        is_penalizable: true,
      },
      {
        type: "board",
        description: "Desayuno",
        quantity: 1,
        unit_amount_cents: 4000,
        amount_cents: 4000,
        is_optional: false,
        is_commissionable: true,
        is_penalizable: true,
      },
    ],
    totals: {
      total_cents: 40_000,
      commissionable_cents: 40_000,
      penalizable_cents: 40_000,
      optional_cents: 0,
      non_commissionable_cents: 0,
    },
    commission: {
      rate: null,
      cents: null,
      base: "total",
      commissionable_cents: 40_000,
      penalizable_cents: 40_000,
    },
    refund_policy: {
      rule: "legacy_host_full_refund_until_24h_before_checkin",
      window_hours: 24,
      refund_deadline: "2026-08-09T00:00:00.000Z",
      deadline_local_time: null,
      timezone: null,
      cancellation,
      generated_text: cancellation ? "Texto congelado de la política" : null,
    },
    timezone: "Europe/Madrid",
    source: "checkout",
    ...extra,
  }) as ReservationSnapshotPayload;

describe("resolveTravelerCancellationQuote — legacy 24 h", () => {
  it("inside the window refunds everything paid", () => {
    const quote = resolveTravelerCancellationQuote({
      reservation: reservation(),
      snapshot: snapshot(null),
      reason: "change_of_plans",
      now: new Date("2026-08-08T12:00:00.000Z"),
    });
    expect(quote).toMatchObject({
      can_cancel: true,
      paid_cents: 40_000,
      penalty_cents: 0,
      refund_cents: 40_000,
      within_free_period: true,
      deadline_iso: "2026-08-09T00:00:00.000Z",
      policy_text: null,
      releases_inventory: true,
      requires_review: false,
      source: "legacy_24h",
    });
  });

  it("after the window refunds nothing (penalty = paid)", () => {
    const quote = resolveTravelerCancellationQuote({
      reservation: reservation(),
      snapshot: snapshot(null),
      reason: "voluntary",
      now: new Date("2026-08-09T12:00:00.000Z"),
    });
    expect(quote.within_free_period).toBe(false);
    expect(quote.refund_cents).toBe(0);
    expect(quote.penalty_cents).toBe(40_000);
    expect(quote.source).toBe("legacy_24h");
  });

  it("without snapshot falls back to checkin - 24 h and legacy amounts", () => {
    const quote = resolveTravelerCancellationQuote({
      reservation: reservation({ total_cents: null }),
      snapshot: null,
      reason: "illness_person",
      now: new Date("2026-08-08T12:00:00.000Z"),
    });
    expect(quote.paid_cents).toBe(40_000);
    expect(quote.refund_cents).toBe(40_000);
    expect(quote.deadline_iso).toBe("2026-08-09T00:00:00.000Z");
  });

  it("the reason does not change the amount (except force_majeure)", () => {
    const now = new Date("2026-08-09T12:00:00.000Z");
    for (const reason of [
      "change_of_plans",
      "transport",
      "dog_conditions",
      "other",
    ] as const) {
      expect(
        resolveTravelerRefundAmountCents(
          reservation(),
          snapshot(null),
          reason,
          now,
        ),
      ).toBe(0);
    }
  });
});

describe("resolveTravelerCancellationQuote — structured (quoteCancellation)", () => {
  it("free_cancellation 7 days: inside the deadline refunds everything", () => {
    const deadline = freeCancellationDeadlineIso(CHECKIN, 7, "Europe/Madrid");
    const quote = resolveTravelerCancellationQuote({
      reservation: reservation(),
      snapshot: snapshot(policy()),
      reason: "change_of_plans",
      now: new Date(new Date(deadline).getTime() - 1000),
    });
    expect(quote).toMatchObject({
      source: "structured",
      within_free_period: true,
      deadline_iso: deadline,
      penalty_cents: 0,
      refund_cents: 40_000,
      policy_text: "Texto congelado de la política",
    });
    // 2026-08-03 23:59:59 Madrid (CEST, UTC+2)
    expect(deadline).toBe("2026-08-03T21:59:59.000Z");
  });

  it("free_cancellation 7 days: after the deadline applies the penalty", () => {
    const deadline = freeCancellationDeadlineIso(CHECKIN, 7, "Europe/Madrid");
    const quote = resolveTravelerCancellationQuote({
      reservation: reservation(),
      snapshot: snapshot(policy({ penalty_type: PENALTY_TYPE.PERCENT_50 })),
      reason: "change_of_plans",
      now: new Date(new Date(deadline).getTime() + 1000),
    });
    expect(quote.within_free_period).toBe(false);
    expect(quote.penalty_cents).toBe(20_000);
    expect(quote.refund_cents).toBe(20_000);
  });

  it("partial_from_booking 50 %", () => {
    const quote = resolveTravelerCancellationQuote({
      reservation: reservation(),
      snapshot: snapshot(
        policy({
          policy_type: CANCELLATION_POLICY_TYPE.PARTIAL_FROM_BOOKING,
          deadline_days: null,
          penalty_type: PENALTY_TYPE.PERCENT_50,
        }),
      ),
      reason: "financial",
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(quote.deadline_iso).toBeNull();
    expect(quote.penalty_cents).toBe(20_000);
    expect(quote.refund_cents).toBe(20_000);
  });

  it("first_night uses the frozen accommodation line", () => {
    const snap = snapshot(
      policy({
        policy_type: CANCELLATION_POLICY_TYPE.PARTIAL_FROM_BOOKING,
        deadline_days: null,
        penalty_type: PENALTY_TYPE.FIRST_NIGHT,
      }),
    );
    expect(firstNightCentsFromSnapshot(snap)).toBe(9000);
    const quote = resolveTravelerCancellationQuote({
      reservation: reservation(),
      snapshot: snap,
      reason: "transport",
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(quote.penalty_cents).toBe(9000);
    expect(quote.refund_cents).toBe(31_000);
  });

  it("first night falls back to amount / quantity and 0 without accommodation", () => {
    const base = snapshot(null);
    const noUnit = {
      ...base,
      price_lines: [{ ...base.price_lines[0], unit_amount_cents: 0 }],
    } as ReservationSnapshotPayload;
    expect(firstNightCentsFromSnapshot(noUnit)).toBe(9000);
    expect(
      firstNightCentsFromSnapshot({
        ...base,
        price_lines: [base.price_lines[1]],
      } as ReservationSnapshotPayload),
    ).toBe(0);
  });

  it("non_refundable refunds nothing", () => {
    const quote = resolveTravelerCancellationQuote({
      reservation: reservation(),
      snapshot: snapshot(
        policy({
          policy_type: CANCELLATION_POLICY_TYPE.NON_REFUNDABLE,
          deadline_days: null,
        }),
      ),
      reason: "booking_error",
      now: new Date("2026-06-02T00:00:00.000Z"),
    });
    expect(quote.refund_cents).toBe(0);
    expect(quote.penalty_cents).toBe(40_000);
  });

  it("subtracts what was already refunded", () => {
    const quote = resolveTravelerCancellationQuote({
      reservation: reservation({ amount_refunded: 100 }),
      snapshot: snapshot(
        policy({
          policy_type: CANCELLATION_POLICY_TYPE.PARTIAL_FROM_BOOKING,
          deadline_days: null,
          penalty_type: PENALTY_TYPE.PERCENT_50,
        }),
      ),
      reason: "other",
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(quote.paid_cents).toBe(30_000);
    expect(quote.penalty_cents).toBe(15_000);
    expect(quote.refund_cents).toBe(15_000);
  });
});

describe("resolveTravelerCancellationQuote — special cases", () => {
  it("force_majeure requires review and shows the full amount as informative", () => {
    const quote = resolveTravelerCancellationQuote({
      reservation: reservation(),
      snapshot: snapshot(
        policy({
          policy_type: CANCELLATION_POLICY_TYPE.NON_REFUNDABLE,
          deadline_days: null,
        }),
      ),
      reason: "force_majeure",
      now: new Date("2026-08-09T12:00:00.000Z"),
    });
    expect(quote.requires_review).toBe(true);
    expect(quote.refund_cents).toBe(40_000);
    expect(quote.penalty_cents).toBe(0);
  });

  it("unpaid pending reservation: nothing paid, nothing refunded", () => {
    const quote = resolveTravelerCancellationQuote({
      reservation: reservation({
        status: "pending",
        payment_status: "pending",
      }),
      snapshot: snapshot(null),
      reason: "force_majeure",
      now: new Date("2026-08-09T12:00:00.000Z"),
    });
    expect(quote).toMatchObject({
      can_cancel: true,
      paid_cents: 0,
      penalty_cents: 0,
      refund_cents: 0,
      requires_review: false,
      releases_inventory: true,
    });
  });

  it("blocked payout (open incident) cannot cancel", () => {
    const quote = resolveTravelerCancellationQuote({
      reservation: reservation({ payout_status: "blocked" }),
      snapshot: snapshot(null),
      reason: "change_of_plans",
      now: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(quote.can_cancel).toBe(false);
    expect(quote.releases_inventory).toBe(false);
  });
});
