import { describe, expect, it } from "vitest";

import {
  AUTO_FINALIZE_AFTER_HOURS,
  getAutoFinalizeAtUtc,
  getFinalizeAvailableFromUtc,
} from "@/contexts/reservations/utils/reservation-policy.util";

describe("finalize window", () => {
  it("opens at 00:00 local of the check-out day by default", () => {
    // Winter: Europe/Madrid = UTC+1
    expect(
      getFinalizeAvailableFromUtc("2026-01-10", "Europe/Madrid").toISOString(),
    ).toBe("2026-01-09T23:00:00.000Z");
  });

  it("uses the local check-out time and timezone", () => {
    expect(
      getFinalizeAvailableFromUtc(
        "2026-07-20",
        "Atlantic/Canary",
        "11:00",
      ).toISOString(),
    ).toBe("2026-07-20T10:00:00.000Z");
  });

  it("falls back to UTC midnight for an unknown timezone", () => {
    expect(
      getFinalizeAvailableFromUtc("2026-07-20", "Mars/Olympus").toISOString(),
    ).toBe("2026-07-20T00:00:00.000Z");
  });

  it("ignores a malformed check-out time", () => {
    expect(
      getFinalizeAvailableFromUtc(
        "2026-07-20",
        "Europe/Madrid",
        "25:99",
      ).toISOString(),
    ).toBe("2026-07-19T22:00:00.000Z");
  });

  it("auto-finalizes AUTO_FINALIZE_AFTER_HOURS after the finalize moment", () => {
    const from = getFinalizeAvailableFromUtc("2026-07-20", "Europe/Madrid");
    expect(getAutoFinalizeAtUtc("2026-07-20", "Europe/Madrid").getTime()).toBe(
      from.getTime() + AUTO_FINALIZE_AFTER_HOURS * 3_600_000,
    );
  });
});
