import { describe, expect, it } from "vitest";

import {
  CANCELLATION_POLICY_TYPE,
  type CancellationPolicyDefinition,
  CHARGE_MODE,
  endOfLocalDayUtcIso,
  formatDeadlineLocal,
  freeCancellationDeadlineIso,
  generateCancellationText,
  localTimeUtcIso,
  NO_SHOW_POLICY,
  PENALTY_TYPE,
  quoteCancellation,
  resolveChargePlan,
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

describe("A5/A6: plazo a las 18:00 y plan de cobro", () => {
  const A_CHECKIN = "2026-06-20";
  const A_TOTAL = 30_000;
  const A_FIRST_NIGHT = 10_000;
  const A_DEADLINE = "2026-06-13T16:00:00.000Z";
  const LOCAL_TIME = "18:00";
  const MIN_LEAD = 48;

  const freePolicy: CancellationPolicyDefinition = {
    policy_type: CANCELLATION_POLICY_TYPE.FREE_CANCELLATION,
    deadline_days: 7,
    penalty_type: PENALTY_TYPE.PERCENT_50,
    no_show_policy: NO_SHOW_POLICY.SAME_AS_CANCELLATION,
    grace_after_booking_hours: null,
    early_cancellation_weeks: null,
  };
  const partialPolicy: CancellationPolicyDefinition = {
    policy_type: CANCELLATION_POLICY_TYPE.PARTIAL_FROM_BOOKING,
    deadline_days: null,
    penalty_type: PENALTY_TYPE.FIRST_NIGHT,
    no_show_policy: NO_SHOW_POLICY.SAME_AS_CANCELLATION,
    grace_after_booking_hours: null,
    early_cancellation_weeks: null,
  };
  const nonRefundablePolicy: CancellationPolicyDefinition = {
    policy_type: CANCELLATION_POLICY_TYPE.NON_REFUNDABLE,
    deadline_days: null,
    penalty_type: PENALTY_TYPE.PERCENT_100,
    no_show_policy: NO_SHOW_POLICY.FULL_TOTAL,
    grace_after_booking_hours: null,
    early_cancellation_weeks: null,
  };

  const plan = (policy: CancellationPolicyDefinition, now: string) =>
    resolveChargePlan({
      policy,
      checkin: A_CHECKIN,
      timezone: TZ,
      deadlineLocalTime: LOCAL_TIME,
      now: new Date(now),
      minLeadHours: MIN_LEAD,
    });

  it("plazo = 18:00 Madrid del día checkin − 7", () => {
    expect(freeCancellationDeadlineIso(A_CHECKIN, 7, TZ, LOCAL_TIME)).toBe(
      A_DEADLINE,
    );
    expect(localTimeUtcIso(2026, 6, 13, "18:00", TZ)).toBe(A_DEADLINE);
  });

  it("sin hora local mantiene 23:59:59 (legacy)", () => {
    expect(freeCancellationDeadlineIso(A_CHECKIN, 7, TZ)).toBe(
      "2026-06-13T21:59:59.000Z",
    );
    expect(endOfLocalDayUtcIso(2026, 6, 13, TZ)).toBe(
      "2026-06-13T21:59:59.000Z",
    );
  });

  it("gratuita reservada con margen → flexible, cobro en el plazo", () => {
    expect(plan(freePolicy, "2026-06-01T10:00:00.000Z")).toEqual({
      charge_mode: CHARGE_MODE.FLEXIBLE,
      charge_at_iso: A_DEADLINE,
      deadline_iso: A_DEADLINE,
      deadline_local: { date: "2026-06-13", time: "18:00", timezone: TZ },
      is_last_minute: false,
    });
  });

  it("gratuita con menos de 48 h hasta el plazo → inmediata, no última hora", () => {
    const result = plan(freePolicy, "2026-06-12T10:00:00.000Z");
    expect(result.charge_mode).toBe(CHARGE_MODE.IMMEDIATE);
    expect(result.charge_at_iso).toBeNull();
    expect(result.deadline_iso).toBe(A_DEADLINE);
    expect(result.deadline_local).toEqual({
      date: "2026-06-13",
      time: "18:00",
      timezone: TZ,
    });
    expect(result.is_last_minute).toBe(false);
  });

  it("gratuita con plazo vencido → inmediata, última hora", () => {
    const result = plan(freePolicy, "2026-06-16T10:00:00.000Z");
    expect(result.charge_mode).toBe(CHARGE_MODE.IMMEDIATE);
    expect(result.charge_at_iso).toBeNull();
    expect(result.deadline_iso).toBe(A_DEADLINE);
    expect(result.is_last_minute).toBe(true);
  });

  it("justo en el plazo cuenta como vencido", () => {
    expect(plan(freePolicy, A_DEADLINE).is_last_minute).toBe(true);
  });

  it("cancelar tras el plazo: 50 % de 300 €", () => {
    const quote = quoteCancellation({
      policy: freePolicy,
      checkin: A_CHECKIN,
      timezone: TZ,
      paid_cents: A_TOTAL,
      first_night_cents: A_FIRST_NIGHT,
      now: new Date("2026-06-16T10:00:00.000Z"),
      deadline_local_time: LOCAL_TIME,
    });
    expect(quote.within_free_period).toBe(false);
    expect(quote.deadline_iso).toBe(A_DEADLINE);
    expect(quote.penalty_cents).toBe(15_000);
    expect(quote.refund_cents).toBe(15_000);
    expect(quote.generated_text).toContain(
      "13/06/2026 a las 18:00 (hora de Madrid)",
    );
  });

  it("entre las 18:00 y las 23:59 del último día ya no es gratis con hora local", () => {
    const quote = quoteCancellation({
      policy: freePolicy,
      checkin: A_CHECKIN,
      timezone: TZ,
      paid_cents: A_TOTAL,
      first_night_cents: A_FIRST_NIGHT,
      now: new Date("2026-06-13T17:00:00.000Z"),
      deadline_local_time: LOCAL_TIME,
    });
    expect(quote.within_free_period).toBe(false);
  });

  it("límite exacto: 17:59:59 gratis, 18:00:00 ya penaliza (con hora local)", () => {
    const at = (now: string, localTime?: string) =>
      quoteCancellation({
        policy: freePolicy,
        checkin: A_CHECKIN,
        timezone: TZ,
        paid_cents: A_TOTAL,
        first_night_cents: A_FIRST_NIGHT,
        now: new Date(now),
        deadline_local_time: localTime,
      });
    expect(at("2026-06-13T15:59:59.000Z", LOCAL_TIME).within_free_period).toBe(
      true,
    );
    const atDeadline = at(A_DEADLINE, LOCAL_TIME);
    expect(atDeadline.within_free_period).toBe(false);
    expect(atDeadline.penalty_cents).toBe(15_000);
    // Sin hora local se mantiene el plazo inclusivo de 23:59:59.
    const legacyDeadline = freeCancellationDeadlineIso(A_CHECKIN, 7, TZ);
    expect(at(legacyDeadline).within_free_period).toBe(true);
  });

  it("parcial primera noche → inmediata; cancelar retiene 100 €", () => {
    expect(plan(partialPolicy, "2026-06-01T10:00:00.000Z")).toEqual({
      charge_mode: CHARGE_MODE.IMMEDIATE,
      charge_at_iso: null,
      deadline_iso: null,
      deadline_local: null,
      is_last_minute: false,
    });
    const quote = quoteCancellation({
      policy: partialPolicy,
      checkin: A_CHECKIN,
      timezone: TZ,
      paid_cents: A_TOTAL,
      first_night_cents: A_FIRST_NIGHT,
      now: new Date("2026-06-02T10:00:00.000Z"),
      deadline_local_time: LOCAL_TIME,
    });
    expect(quote.penalty_cents).toBe(10_000);
    expect(quote.refund_cents).toBe(20_000);
  });

  it("no reembolsable → inmediata; cancelar no devuelve nada", () => {
    const result = plan(nonRefundablePolicy, "2026-06-01T10:00:00.000Z");
    expect(result.charge_mode).toBe(CHARGE_MODE.IMMEDIATE);
    expect(result.deadline_iso).toBeNull();
    expect(result.is_last_minute).toBe(false);
    const quote = quoteCancellation({
      policy: nonRefundablePolicy,
      checkin: A_CHECKIN,
      timezone: TZ,
      paid_cents: A_TOTAL,
      first_night_cents: A_FIRST_NIGHT,
      now: new Date("2026-06-02T10:00:00.000Z"),
      deadline_local_time: LOCAL_TIME,
    });
    expect(quote.penalty_cents).toBe(A_TOTAL);
    expect(quote.refund_cents).toBe(0);
  });

  it("Atlantic/Canary: 18:00 en verano = 17:00Z", () => {
    const iso = freeCancellationDeadlineIso(
      A_CHECKIN,
      7,
      "Atlantic/Canary",
      LOCAL_TIME,
    );
    expect(iso).toBe("2026-06-13T17:00:00.000Z");
    const text = generateCancellationText(
      freePolicy,
      iso,
      formatDeadlineLocal(iso, "Atlantic/Canary"),
    );
    expect(text).toContain("13/06/2026 a las 18:00 (hora de Canarias)");
  });

  it("cambio de hora: 25/10/2026 (CET) y 29/03/2026 (CEST)", () => {
    expect(freeCancellationDeadlineIso("2026-11-01", 7, TZ, LOCAL_TIME)).toBe(
      "2026-10-25T17:00:00.000Z",
    );
    expect(freeCancellationDeadlineIso("2026-04-05", 7, TZ, LOCAL_TIME)).toBe(
      "2026-03-29T16:00:00.000Z",
    );
    expect(endOfLocalDayUtcIso(2026, 10, 25, TZ)).toBe(
      "2026-10-25T22:59:59.000Z",
    );
    expect(endOfLocalDayUtcIso(2026, 3, 29, TZ)).toBe(
      "2026-03-29T21:59:59.000Z",
    );
  });

  it("generateCancellationText con hora local y zona desconocida", () => {
    const text = generateCancellationText(freePolicy, A_DEADLINE, {
      date: "2026-06-13",
      time: "18:00",
      timezone: TZ,
    });
    expect(text).toBe(
      "Cancelación gratuita hasta el 13/06/2026 a las 18:00 (hora de Madrid). Después se cobra el 50 % del importe total.",
    );
    expect(
      generateCancellationText(
        freePolicy,
        A_DEADLINE,
        formatDeadlineLocal(A_DEADLINE, "America/New_York"),
      ),
    ).toContain("13/06/2026 a las 12:00 (hora de America/New_York)");
  });

  it("localTimeUtcIso rechaza formatos inválidos", () => {
    expect(() => localTimeUtcIso(2026, 6, 13, "25:00", TZ)).toThrow();
    expect(() => localTimeUtcIso(2026, 6, 13, "18h", TZ)).toThrow();
  });
});
