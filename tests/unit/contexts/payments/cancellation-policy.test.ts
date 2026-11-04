import { describe, expect, it } from "vitest";

import {
  CANCELLATION_POLICY_TYPE,
  NO_SHOW_POLICY,
  PENALTY_TYPE,
  quoteCancellation,
} from "@/src/contexts/payments/domain/cancellation-policy";

const TZ = "Europe/Madrid";
const CHECKIN = "2026-08-20";
const PAID = 60_000;
const FIRST_NIGHT = 12_000;

describe("cancellation-policy", () => {
  it("C01: 7 días + 100 %", () => {
    const policy = {
      policy_type: CANCELLATION_POLICY_TYPE.FREE_CANCELLATION,
      deadline_days: 7,
      penalty_type: PENALTY_TYPE.PERCENT_100,
      no_show_policy: NO_SHOW_POLICY.SAME_AS_CANCELLATION,
      grace_after_booking_hours: null,
      early_cancellation_weeks: null,
    };
    const early = quoteCancellation({
      policy,
      checkin: CHECKIN,
      timezone: TZ,
      paid_cents: PAID,
      first_night_cents: FIRST_NIGHT,
      now: new Date("2026-08-12T10:00:00.000Z"),
    });
    const late = quoteCancellation({
      policy,
      checkin: CHECKIN,
      timezone: TZ,
      paid_cents: PAID,
      first_night_cents: FIRST_NIGHT,
      now: new Date("2026-08-14T22:00:00.000Z"),
    });
    expect(early.penalty_cents).toBe(0);
    expect(early.refund_cents).toBe(PAID);
    expect(late.penalty_cents).toBe(PAID);
    expect(late.refund_cents).toBe(0);
    expect(early.deadline_iso).toBeTruthy();
  });

  it("C02: 7 días + 50 %", () => {
    const policy = {
      policy_type: CANCELLATION_POLICY_TYPE.FREE_CANCELLATION,
      deadline_days: 7,
      penalty_type: PENALTY_TYPE.PERCENT_50,
      no_show_policy: NO_SHOW_POLICY.SAME_AS_CANCELLATION,
      grace_after_booking_hours: null,
      early_cancellation_weeks: null,
    };
    const late = quoteCancellation({
      policy,
      checkin: CHECKIN,
      timezone: TZ,
      paid_cents: PAID,
      first_night_cents: FIRST_NIGHT,
      now: new Date("2026-08-14T22:00:00.000Z"),
    });
    expect(late.penalty_cents).toBe(30_000);
    expect(late.refund_cents).toBe(30_000);
  });

  it("C03: primera noche tras el plazo", () => {
    const policy = {
      policy_type: CANCELLATION_POLICY_TYPE.FREE_CANCELLATION,
      deadline_days: 7,
      penalty_type: PENALTY_TYPE.FIRST_NIGHT,
      no_show_policy: NO_SHOW_POLICY.SAME_AS_CANCELLATION,
      grace_after_booking_hours: null,
      early_cancellation_weeks: null,
    };
    const late = quoteCancellation({
      policy,
      checkin: CHECKIN,
      timezone: TZ,
      paid_cents: PAID,
      first_night_cents: FIRST_NIGHT,
      now: new Date("2026-08-14T22:00:00.000Z"),
    });
    expect(late.penalty_cents).toBe(FIRST_NIGHT);
    expect(late.refund_cents).toBe(PAID - FIRST_NIGHT);
  });

  it("C04 y C05: no reembolsable y 50 % desde la reserva", () => {
    const nonRefundable = quoteCancellation({
      policy: {
        policy_type: CANCELLATION_POLICY_TYPE.NON_REFUNDABLE,
        deadline_days: null,
        penalty_type: PENALTY_TYPE.PERCENT_100,
        no_show_policy: NO_SHOW_POLICY.FULL_TOTAL,
        grace_after_booking_hours: null,
        early_cancellation_weeks: null,
      },
      checkin: CHECKIN,
      timezone: TZ,
      paid_cents: PAID,
      first_night_cents: FIRST_NIGHT,
      now: new Date("2026-07-01T10:00:00.000Z"),
    });
    expect(nonRefundable.penalty_cents).toBe(PAID);
    const partial = quoteCancellation({
      policy: {
        policy_type: CANCELLATION_POLICY_TYPE.PARTIAL_FROM_BOOKING,
        deadline_days: null,
        penalty_type: PENALTY_TYPE.PERCENT_50,
        no_show_policy: NO_SHOW_POLICY.SAME_AS_CANCELLATION,
        grace_after_booking_hours: null,
        early_cancellation_weeks: null,
      },
      checkin: CHECKIN,
      timezone: TZ,
      paid_cents: PAID,
      first_night_cents: FIRST_NIGHT,
      now: new Date("2026-07-01T10:00:00.000Z"),
    });
    expect(partial.penalty_cents).toBe(30_000);
  });
});
