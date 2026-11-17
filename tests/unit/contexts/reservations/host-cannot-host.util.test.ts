import { describe, expect, it } from "vitest";

import { canReportHostCannotHost } from "@/contexts/reservations/utils/host-cannot-host.util";
import { isHiddenFromTraveler } from "@/contexts/reservations/utils/reservation-incident.util";

describe("canReportHostCannotHost", () => {
  const base = {
    status: "confirmed",
    payout_status: null,
    checkout: "2026-07-20",
  };

  it("allows a confirmed stay before check-out day", () => {
    expect(
      canReportHostCannotHost(base, new Date("2026-07-19T23:59:00.000Z")),
    ).toBe(true);
  });

  it("is closed from check-out day", () => {
    expect(
      canReportHostCannotHost(base, new Date("2026-07-20T00:00:00.000Z")),
    ).toBe(false);
  });

  it("is closed for non-confirmed reservations", () => {
    for (const status of ["pending", "cancelled", "finalized"]) {
      expect(
        canReportHostCannotHost(
          { ...base, status },
          new Date("2026-07-10T00:00:00.000Z"),
        ),
      ).toBe(false);
    }
  });

  it("is closed once the payout was released, open if blocked", () => {
    const now = new Date("2026-07-10T00:00:00.000Z");
    expect(
      canReportHostCannotHost({ ...base, payout_status: "released" }, now),
    ).toBe(false);
    expect(
      canReportHostCannotHost({ ...base, payout_status: "blocked" }, now),
    ).toBe(true);
  });
});

describe("isHiddenFromTraveler", () => {
  it("hides host_cannot_host only while in_review", () => {
    expect(
      isHiddenFromTraveler({ type: "host_cannot_host", status: "in_review" }),
    ).toBe(true);
    expect(
      isHiddenFromTraveler({ type: "host_cannot_host", status: "needs_info" }),
    ).toBe(false);
    expect(
      isHiddenFromTraveler({ type: "host_cannot_host", status: "resolved" }),
    ).toBe(false);
  });

  it("never hides traveler incidents", () => {
    expect(
      isHiddenFromTraveler({ type: "during_stay", status: "in_review" }),
    ).toBe(false);
  });
});
