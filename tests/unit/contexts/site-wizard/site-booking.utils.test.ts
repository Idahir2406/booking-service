import { describe, expect, it } from "vitest";

import {
  buildAvailabilityDates,
  isAvailabilityConfigured,
  parseBookingSettingsInput,
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
