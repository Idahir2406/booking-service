import { describe, expect, it } from "vitest";

import {
  buildAvailabilityDates,
  isAvailabilityConfigured,
  parseBookingSettingsInput,
  parseCancellationPolicyInput,
  toCancellationSettings,
} from "@/contexts/site-wizard/utils/site-booking.utils";

function errorsOf(body: unknown): string[] {
  const result = parseBookingSettingsInput(body);
  return result.ok ? [] : result.errors;
}

describe("parseBookingSettingsInput", () => {
  it("accepts a valid all_year rule (numeric strings too)", () => {
    expect(
      parseBookingSettingsInput({
        mode: "all_year",
        min_nights: "2",
        max_nights: 30,
      }),
    ).toEqual({
      ok: true,
      value: { mode: "all_year", min_nights: 2, max_nights: 30 },
    });
    expect(
      errorsOf({ mode: "all_year", min_nights: 30, max_nights: 30 }),
    ).toEqual([]);
    expect(
      errorsOf({ mode: "all_year", min_nights: 1, max_nights: 365 }),
    ).toEqual([]);
  });

  it("rejects unknown modes and out of range values", () => {
    expect(
      errorsOf({ mode: "custom", min_nights: 0, max_nights: 400 }),
    ).toEqual([
      "mode: valor no válido (all_year)",
      "min_nights: debe estar entre 1 y 30",
      "max_nights: debe estar entre 1 y 365",
    ]);
    expect(
      errorsOf({ mode: "all_year", min_nights: 5, max_nights: 3 }),
    ).toEqual(["max_nights: debe estar entre 5 y 365"]);
    expect(
      errorsOf({ mode: "all_year", min_nights: 1.5, max_nights: null }),
    ).toEqual([
      "min_nights: debe ser un número entero",
      "max_nights: debe ser un número entero",
    ]);
    expect(errorsOf([])).toEqual(["body: formato no válido"]);
  });
});

describe("isAvailabilityConfigured", () => {
  it("needs a valid mode and both limits", () => {
    expect(isAvailabilityConfigured(null)).toBe(false);
    expect(
      isAvailabilityConfigured({
        availability_mode: null,
        min_nights: 1,
        max_nights: 30,
      }),
    ).toBe(false);
    expect(
      isAvailabilityConfigured({
        availability_mode: "all_year",
        min_nights: 1,
        max_nights: null,
      }),
    ).toBe(false);
    expect(
      isAvailabilityConfigured({
        availability_mode: "all_year",
        min_nights: 1,
        max_nights: 30,
      }),
    ).toBe(true);
  });
});

describe("buildAvailabilityDates", () => {
  it("consecutive UTC dates across month/leap boundaries", () => {
    expect(buildAvailabilityDates("2028-02-28", 3)).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("365-night window", () => {
    const dates = buildAvailabilityDates("2026-09-29", 365);
    expect(dates).toHaveLength(365);
    expect(dates.at(0)).toBe("2026-09-29");
    expect(dates.at(-1)).toBe("2027-09-28");
    expect(new Set(dates).size).toBe(365);
  });

  it("invalid input -> []", () => {
    expect(buildAvailabilityDates("nope", 3)).toEqual([]);
    expect(buildAvailabilityDates("2026-01-01", 0)).toEqual([]);
  });
});

describe("parseCancellationPolicyInput", () => {
  const BASE = { mode: "all_year", min_nights: 1, max_nights: 30 };

  function parse(cancellation: unknown) {
    return parseCancellationPolicyInput({ ...BASE, cancellation });
  }

  function cancellationErrors(cancellation: unknown): string[] {
    const result = parse(cancellation);
    return result.ok ? [] : result.errors;
  }

  it("absent field (or non-object body) -> undefined, columns untouched", () => {
    expect(parseCancellationPolicyInput(BASE)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(parseCancellationPolicyInput(null)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("free cancellation with exceptions (numeric strings too)", () => {
    expect(
      parse({
        policy_type: "free_cancellation",
        deadline_days: "7",
        penalty_type: "percent_50",
        no_show_policy: "full_total",
        grace_after_booking_hours: "24",
        early_cancellation_weeks: 8,
        timezone: "Atlantic/Canary",
      }),
    ).toEqual({
      ok: true,
      value: {
        policy_type: "free_cancellation",
        deadline_days: 7,
        penalty_type: "percent_50",
        no_show_policy: "full_total",
        grace_after_booking_hours: 24,
        early_cancellation_weeks: 8,
        timezone: "Atlantic/Canary",
      },
    });
  });

  it("free cancellation with 100 % penalty and no exceptions", () => {
    expect(
      parse({
        policy_type: "free_cancellation",
        deadline_days: 30,
        penalty_type: "percent_100",
        no_show_policy: "same_as_cancellation",
        grace_after_booking_hours: "",
        early_cancellation_weeks: null,
        timezone: "Europe/Madrid",
      }),
    ).toEqual({
      ok: true,
      value: {
        policy_type: "free_cancellation",
        deadline_days: 30,
        penalty_type: "percent_100",
        no_show_policy: "same_as_cancellation",
        grace_after_booking_hours: null,
        early_cancellation_weeks: null,
        timezone: "Europe/Madrid",
      },
    });
  });

  it("partial from booking ignores deadline_days", () => {
    expect(
      parse({
        policy_type: "partial_from_booking",
        deadline_days: 7,
        penalty_type: "first_night",
        no_show_policy: "same_as_cancellation",
        timezone: "Europe/Madrid",
      }),
    ).toEqual({
      ok: true,
      value: {
        policy_type: "partial_from_booking",
        deadline_days: null,
        penalty_type: "first_night",
        no_show_policy: "same_as_cancellation",
        grace_after_booking_hours: null,
        early_cancellation_weeks: null,
        timezone: "Europe/Madrid",
      },
    });
  });

  it("non refundable forces 100 % and full_total no-show", () => {
    expect(
      parse({
        policy_type: "non_refundable",
        deadline_days: 3,
        penalty_type: "percent_50",
        no_show_policy: "same_as_cancellation",
        grace_after_booking_hours: 1,
        timezone: "Europe/Madrid",
      }),
    ).toEqual({
      ok: true,
      value: {
        policy_type: "non_refundable",
        deadline_days: null,
        penalty_type: "percent_100",
        no_show_policy: "full_total",
        grace_after_booking_hours: 1,
        early_cancellation_weeks: null,
        timezone: "Europe/Madrid",
      },
    });
  });

  it("rejects a non-object cancellation", () => {
    expect(cancellationErrors("free")).toEqual([
      "cancellation: formato no válido",
    ]);
    expect(cancellationErrors(null)).toEqual([
      "cancellation: formato no válido",
    ]);
  });

  it("invalid combinations -> cancellation.<field> errors", () => {
    expect(
      cancellationErrors({
        policy_type: "partial_from_booking",
        penalty_type: "percent_100",
        no_show_policy: "full_total",
        timezone: "Europe/Madrid",
      }),
    ).toEqual([
      "cancellation.penalty_type: valor no válido (percent_50, first_night)",
    ]);
    expect(
      cancellationErrors({
        policy_type: "free_cancellation",
        deadline_days: 5,
        penalty_type: "percent_50",
        no_show_policy: "full_total",
        timezone: "Europe/Madrid",
      }),
    ).toEqual(["cancellation.deadline_days: elige 1, 3, 7, 14, 30 días"]);
  });

  it("collects every field error", () => {
    expect(
      cancellationErrors({
        policy_type: "flexible",
        no_show_policy: "nope",
        grace_after_booking_hours: 2,
        early_cancellation_weeks: 5,
        timezone: "Europe/London",
      }),
    ).toEqual([
      "cancellation.policy_type: valor no válido (free_cancellation, partial_from_booking, non_refundable)",
      "cancellation.no_show_policy: valor no válido (same_as_cancellation, full_total)",
      "cancellation.grace_after_booking_hours: valor no válido (1, 4, 24)",
      "cancellation.early_cancellation_weeks: valor no válido (4, 8, 12)",
      "cancellation.timezone: valor no válido (Europe/Madrid, Atlantic/Canary)",
    ]);
  });
});

describe("toCancellationSettings", () => {
  const STORED = {
    cancellation_policy_type: "free_cancellation",
    cancellation_deadline_days: 14,
    cancellation_penalty_type: "first_night",
    no_show_policy: "same_as_cancellation",
    grace_after_booking_hours: null,
    early_cancellation_weeks: 4,
    timezone: null,
  };

  it("null / legacy rows -> null", () => {
    expect(toCancellationSettings(null)).toBeNull();
    expect(
      toCancellationSettings({ ...STORED, cancellation_policy_type: null }),
    ).toBeNull();
    expect(
      toCancellationSettings({ ...STORED, cancellation_policy_type: "x" }),
    ).toBeNull();
  });

  it("maps columns, timezone defaults to Europe/Madrid", () => {
    expect(toCancellationSettings(STORED)).toEqual({
      policy_type: "free_cancellation",
      deadline_days: 14,
      penalty_type: "first_night",
      no_show_policy: "same_as_cancellation",
      grace_after_booking_hours: null,
      early_cancellation_weeks: 4,
      timezone: "Europe/Madrid",
    });
  });
});
